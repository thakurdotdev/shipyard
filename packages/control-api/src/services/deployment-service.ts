import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { deployments, projects } from '../db/schema';
import { EnvService } from './env-service';

export const DeploymentService = {
  async activateBuild(projectId: string, buildId: string) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) throw new Error('Project not found');
    // Ensure we don't proceed if port is missing
    if (!project.port) throw new Error('Project has no assigned port');

    // Fetch and decrypt environment variables for this project
    const envVarsObject = await EnvService.getAsRecord(projectId);

    console.log(
      `[DeploymentService] STARTING activation for ${project.name} (Build: ${buildId}) on Port: ${project.port}`,
    );
    console.log(`[DeploymentService] Passing ${Object.keys(envVarsObject).length} env vars`);

    // Step 1: Create deployment record immediately with 'activating' status
    console.log(`[DeploymentService] Creating deployment record with status='activating'`);

    let deploymentId: string;
    try {
      const [newDeployment] = await db
        .insert(deployments)
        .values({
          project_id: projectId,
          build_id: buildId,
          status: 'activating',
        })
        .returning();

      deploymentId = newDeployment.id;
      console.log(`[DeploymentService] Created deployment record ${deploymentId}`);

      // Broadcast deployment status
      const { WebSocketService } = await import('../ws');
      WebSocketService.broadcastDeploymentUpdate(projectId, {
        id: deploymentId,
        project_id: projectId,
        build_id: buildId,
        status: 'activating',
      });
    } catch (dbError: any) {
      console.error(`[DeploymentService] Failed to create deployment record:`, dbError);
      throw new Error(`Failed to create deployment record: ${dbError.message}`);
    }

    // Step 2: Call Deploy Engine
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    console.log(
      `[DeploymentService] Requesting activation from deploy-engine for build ${buildId}...`,
    );

    try {
      const res = await fetch(`${deployEngineUrl}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          buildId: buildId,
          port: project.port,
          appType: project.app_type,
          subdomain:
            project.domain?.split('.')[0] ||
            project.name
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/^-+|-+$/g, ''), // Slugify
          envVars: envVarsObject, // Pass env vars to deploy engine
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Deploy Engine activation failed: ${err}`);
      }

      console.log(
        `[DeploymentService] Deploy Engine activation successful for build ${buildId}. Updating database...`,
      );

      // Step 3: Update deployment statuses in a transaction
      try {
        await db.transaction(async (tx) => {
          console.log(
            `[DeploymentService] Marking existing active deployments as inactive for project ${projectId}`,
          );

          // Mark all current active deployments for this project as inactive
          const deactivated = await tx
            .update(deployments)
            .set({ status: 'inactive' })
            .where(and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')))
            .returning();

          console.log(
            `[DeploymentService] Deactivated ${deactivated.length} existing deployment(s)`,
          );

          console.log(`[DeploymentService] Updating deployment ${deploymentId} to status='active'`);

          // Update this deployment to active
          await tx
            .update(deployments)
            .set({ status: 'active' })
            .where(eq(deployments.id, deploymentId));

          console.log(`[DeploymentService] Successfully activated deployment ${deploymentId}`);
        });

        console.log(
          `[DeploymentService] Database transaction completed successfully for build ${buildId}`,
        );

        // Broadcast successful activation
        const { WebSocketService } = await import('../ws');
        WebSocketService.broadcastDeploymentUpdate(projectId, {
          id: deploymentId,
          project_id: projectId,
          build_id: buildId,
          status: 'active',
        });
      } catch (dbError: any) {
        console.error(
          `[DeploymentService] Database transaction FAILED for build ${buildId}:`,
          dbError,
        );
        // Mark deployment as failed
        await db
          .update(deployments)
          .set({ status: 'failed' })
          .where(eq(deployments.id, deploymentId));

        // Broadcast failure
        const { WebSocketService } = await import('../ws');
        WebSocketService.broadcastDeploymentUpdate(projectId, {
          id: deploymentId,
          project_id: projectId,
          build_id: buildId,
          status: 'failed',
        });

        throw new Error(`Failed to update deployment database: ${dbError.message}`);
      }
    } catch (deployError: any) {
      // Mark deployment as failed if deploy-engine call fails
      console.error(
        `[DeploymentService] Deployment activation failed for build ${buildId}:`,
        deployError,
      );

      try {
        await db
          .update(deployments)
          .set({ status: 'failed' })
          .where(eq(deployments.id, deploymentId));
        console.log(`[DeploymentService] Marked deployment ${deploymentId} as failed`);

        // Broadcast failure
        const { WebSocketService } = await import('../ws');
        WebSocketService.broadcastDeploymentUpdate(projectId, {
          id: deploymentId,
          project_id: projectId,
          build_id: buildId,
          status: 'failed',
        });
      } catch (updateError) {
        console.error(`[DeploymentService] Failed to mark deployment as failed:`, updateError);
      }

      throw deployError;
    }

    return true;
  },

  async stop(projectId: string) {
    const activeDeployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')),
    });

    if (!activeDeployment) {
      throw new Error('No active deployment found');
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!project || !project.port) {
      throw new Error('Project or port not found');
    }

    // Call Deploy Engine
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    console.log(
      `[DeploymentService] Stopping deployment for project ${projectId} on port ${project.port}...`,
    );

    const res = await fetch(`${deployEngineUrl}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: project.port,
        projectId,
        buildId: activeDeployment.build_id,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deploy Engine stop failed: ${err}`);
    }

    // Update DB status
    await db
      .update(deployments)
      .set({ status: 'inactive' })
      .where(eq(deployments.id, activeDeployment.id));

    return true;
  },
};
