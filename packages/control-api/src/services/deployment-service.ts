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

    let deploymentId: string;
    try {
      // Look for existing deployment for this build
      const existingDeployment = await db.query.deployments.findFirst({
        where: eq(deployments.build_id, buildId),
      });

      if (existingDeployment) {
        // Update existing deployment to 'activating'
        await db
          .update(deployments)
          .set({ status: 'activating' })
          .where(eq(deployments.id, existingDeployment.id));

        deploymentId = existingDeployment.id;
      } else {
        // Create new deployment record
        const [newDeployment] = await db
          .insert(deployments)
          .values({
            project_id: projectId,
            build_id: buildId,
            status: 'activating',
          })
          .returning();

        deploymentId = newDeployment.id;
      }

      // Broadcast deployment status
      const { WebSocketService } = await import('../ws');
      WebSocketService.broadcastDeploymentUpdate(projectId, {
        id: deploymentId,
        project_id: projectId,
        build_id: buildId,
        status: 'activating',
      });
    } catch (dbError: any) {
      console.error(`[DeploymentService] Failed to prepare deployment record:`, dbError);
      throw new Error(`Failed to prepare deployment record: ${dbError.message}`);
    }

    // Step 2: Call Deploy Engine
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
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

      // Step 3: Update deployment statuses in a transaction
      try {
        await db.transaction(async (tx) => {
          // Mark all current active deployments for this project as inactive
          const deactivated = await tx
            .update(deployments)
            .set({ status: 'inactive' })
            .where(and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')))
            .returning();

          // Update this deployment to active
          await tx
            .update(deployments)
            .set({ status: 'active' })
            .where(eq(deployments.id, deploymentId));
        });

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
