import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { deployments, projects } from '../db/schema';
import type { DeploymentStatus } from '../db/schema';
import { EnvService } from './env-service';
import { DomainService } from './domain-service';

const IS_PLATFORM_PROD =
  process.env.NODE_ENV === 'production' || process.env.PLATFORM_ENV === 'production';

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
        // Update existing deployment
        await db
          .update(deployments)
          .set({
            status: 'pending',
            status_message: 'Preparing deployment...',
            failed_at_step: null,
          })
          .where(eq(deployments.id, existingDeployment.id));

        deploymentId = existingDeployment.id;
      } else {
        // Create new deployment record
        const [newDeployment] = await db
          .insert(deployments)
          .values({
            project_id: projectId,
            build_id: buildId,
            status: 'pending',
            status_message: 'Preparing deployment...',
          })
          .returning();

        deploymentId = newDeployment.id;
      }

      // Broadcast initial status
      await this.broadcastStatus(
        projectId,
        deploymentId,
        buildId,
        'pending',
        'Preparing deployment...',
      );
    } catch (dbError: any) {
      console.error(`[DeploymentService] Failed to prepare deployment record:`, dbError);
      throw new Error(`Failed to prepare deployment record: ${dbError.message}`);
    }

    // ──────────────────────────────────────────────
    // Step 1: Domain provisioning (DNS + SSL) — production only
    // ──────────────────────────────────────────────
    if (IS_PLATFORM_PROD && project.domain) {
      const subdomain =
        project.domain.split('.')[0] ||
        project.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/^-+|-+$/g, '');

      // Check if domain is already provisioned
      const domainProvision = await DomainService.getByProjectId(projectId);
      const isFullyProvisioned =
        domainProvision &&
        (domainProvision.dns_status === 'created' || domainProvision.dns_status === 'proxied') &&
        domainProvision.ssl_status === 'issued';

      if (!isFullyProvisioned) {
        try {
          const result = await DomainService.provision(
            projectId,
            subdomain,
            project.port,
            async (step, message) => {
              // Map domain provisioning steps to deployment statuses
              await this.updateDeploymentStatus(deploymentId, step as DeploymentStatus, message);
              await this.broadcastStatus(
                projectId,
                deploymentId,
                buildId,
                step as DeploymentStatus,
                message,
              );
            },
          );

          if (!result.success) {
            await this.updateDeploymentStatus(
              deploymentId,
              'failed',
              result.error || 'Domain provisioning failed',
            );
            await this.broadcastStatus(
              projectId,
              deploymentId,
              buildId,
              'failed',
              result.error || 'Domain provisioning failed',
            );

            // Store which step failed for retry
            await db
              .update(deployments)
              .set({ failed_at_step: result.failedAtStep || 'domain_provisioning' })
              .where(eq(deployments.id, deploymentId));

            throw new Error(result.error || 'Domain provisioning failed');
          }
        } catch (error: any) {
          if (
            error.message.includes('Domain provisioning failed') ||
            error.message.includes('DNS') ||
            error.message.includes('SSL')
          ) {
            // Already handled above
            throw error;
          }
          // Unexpected error
          await this.updateDeploymentStatus(
            deploymentId,
            'failed',
            `Domain provisioning error: ${error.message}`,
          );
          await this.broadcastStatus(
            projectId,
            deploymentId,
            buildId,
            'failed',
            `Domain provisioning error: ${error.message}`,
          );
          throw error;
        }
      } else {
        // Domain already provisioned — skip to app deployment
        await this.updateDeploymentStatus(
          deploymentId,
          'nginx_configured',
          'Domain already provisioned',
        );
        await this.broadcastStatus(
          projectId,
          deploymentId,
          buildId,
          'nginx_configured',
          'Domain already provisioned',
        );
      }
    }

    // ──────────────────────────────────────────────
    // Step 2: Start application via Deploy Engine
    // ──────────────────────────────────────────────
    await this.updateDeploymentStatus(deploymentId, 'app_starting', 'Starting application...');
    await this.broadcastStatus(
      projectId,
      deploymentId,
      buildId,
      'app_starting',
      'Starting application...',
    );

    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    try {
      const subdomain =
        project.domain?.split('.')[0] ||
        project.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/^-+|-+$/g, '');

      const res = await fetch(`${deployEngineUrl}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          buildId: buildId,
          port: project.port,
          appType: project.app_type,
          subdomain,
          envVars: envVarsObject,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Deploy Engine activation failed: ${err}`);
      }

      // ──────────────────────────────────────────────
      // Step 3: Mark as active
      // ──────────────────────────────────────────────
      try {
        await db.transaction(async (tx) => {
          // Mark all current active deployments for this project as inactive
          await tx
            .update(deployments)
            .set({ status: 'inactive', status_message: null })
            .where(and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')));

          // Update this deployment to active
          await tx
            .update(deployments)
            .set({
              status: 'active',
              status_message: 'Application is live',
              failed_at_step: null,
            })
            .where(eq(deployments.id, deploymentId));
        });

        // Broadcast successful activation
        await this.broadcastStatus(
          projectId,
          deploymentId,
          buildId,
          'active',
          'Application is live! 🎉',
        );
      } catch (dbError: any) {
        console.error(
          `[DeploymentService] Database transaction FAILED for build ${buildId}:`,
          dbError,
        );
        await this.updateDeploymentStatus(
          deploymentId,
          'failed',
          `Database error: ${dbError.message}`,
        );
        await this.broadcastStatus(
          projectId,
          deploymentId,
          buildId,
          'failed',
          `Database error: ${dbError.message}`,
        );
        throw new Error(`Failed to update deployment database: ${dbError.message}`);
      }
    } catch (deployError: any) {
      console.error(
        `[DeploymentService] Deployment activation failed for build ${buildId}:`,
        deployError,
      );

      try {
        await this.updateDeploymentStatus(deploymentId, 'failed', deployError.message);
        await this.broadcastStatus(projectId, deploymentId, buildId, 'failed', deployError.message);
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
      .set({ status: 'inactive', status_message: 'Deployment stopped' })
      .where(eq(deployments.id, activeDeployment.id));

    return true;
  },

  // ─── Helpers ────────────────────────────────────

  async updateDeploymentStatus(
    deploymentId: string,
    status: DeploymentStatus | string,
    message?: string,
  ) {
    await db
      .update(deployments)
      .set({
        status,
        status_message: message || null,
      })
      .where(eq(deployments.id, deploymentId));
  },

  async broadcastStatus(
    projectId: string,
    deploymentId: string,
    buildId: string,
    status: DeploymentStatus | string,
    message?: string,
  ) {
    const { WebSocketService } = await import('../ws');
    WebSocketService.broadcastDeploymentUpdate(projectId, {
      id: deploymentId,
      project_id: projectId,
      build_id: buildId,
      status,
      status_message: message,
    });
  },
};
