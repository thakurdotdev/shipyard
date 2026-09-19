import { db } from '../db';
import { builds, deployments } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { DeploymentService } from './deployment-service';
import { AppType } from '../config/framework-config';
import { BuildQueue, type BuildJobData } from '../queue';

export const BuildService = {
  async create(data: {
    project_id: string;
    status: 'pending' | 'building' | 'success' | 'failed';
    commit_sha?: string;
    commit_message?: string | null;
  }) {
    const result = await db
      .insert(builds)
      .values({
        project_id: data.project_id,
        status: data.status,
        commit_sha: data.commit_sha,
        commit_message: data.commit_message,
      })
      .returning();
    const build = result[0];

    if (data.status === 'pending') {
      const { ProjectService } = await import('./project-service');
      const { EnvService } = await import('./env-service');
      const { LogService } = await import('./log-service');

      const project = await ProjectService.getById(data.project_id);
      if (project) {
        const envVarsList = await EnvService.getAll(project.id);
        const envVars = envVarsList.reduce(
          (acc, curr) => ({ ...acc, [curr.key]: curr.value }),
          {} as Record<string, string>,
        );

        const buildJobData: BuildJobData = {
          build_id: build.id,
          project_id: project.id,
          github_url: project.github_url,
          build_command: project.build_command,
          root_directory: project.root_directory || './',
          app_type: project.app_type as AppType,
          env_vars: envVars,
          installation_id: project.github_installation_id || undefined,
        };

        try {
          // Add job to BullMQ queue
          const { jobId, position } = await BuildQueue.addJob(buildJobData);

          console.log(`[BuildService] Build ${build.id} queued at position ${position}`);

          // Log initial queue status
          const stats = await BuildQueue.getStats();
          const totalInQueue = stats.waiting + stats.active;

          if (position > 0) {
            await LogService.persist(
              build.id,
              `🔄 Build queued (position ${position} of ${totalInQueue})\n`,
              'info',
            );

            if (stats.active > 0) {
              await LogService.persist(
                build.id,
                `⏳ Waiting for ${stats.active} active build(s) to complete...\n`,
                'info',
              );
            }
          } else {
            await LogService.persist(
              build.id,
              `🚀 Build starting immediately (no queue)\n`,
              'info',
            );
          }
        } catch (error: any) {
          console.error(`[BuildService] Failed to queue build ${build.id}:`, error);

          // Mark build as failed if queue submission fails
          await db
            .update(builds)
            .set({
              status: 'failed',
              logs: `Failed to queue build: ${error.message}`,
              completed_at: new Date(),
            })
            .where(eq(builds.id, build.id));

          console.error(`[BuildService] Build ${build.id} marked as failed due to queue error`);
        }
      }
    }

    return build;
  },

  async getByProjectId(projectId: string) {
    // Join builds with their deployments to send everything in one response
    const buildsWithDeployments = await db
      .select({
        // Build fields
        id: builds.id,
        project_id: builds.project_id,
        status: builds.status,
        commit_sha: builds.commit_sha,
        commit_message: builds.commit_message,
        logs: builds.logs,
        artifact_id: builds.artifact_id,
        created_at: builds.created_at,
        completed_at: builds.completed_at,
        // Deployment fields (will be null if no deployment exists)
        deployment_id: deployments.id,
        deployment_status: deployments.status,
        deployment_activated_at: deployments.activated_at,
      })
      .from(builds)
      .leftJoin(deployments, eq(builds.id, deployments.build_id))
      .where(eq(builds.project_id, projectId))
      .orderBy(desc(builds.created_at));

    return buildsWithDeployments;
  },

  async getById(id: string) {
    const result = await db.select().from(builds).where(eq(builds.id, id));
    return result[0] || null;
  },

  async updateStatus(
    id: string,
    status: 'pending' | 'building' | 'success' | 'failed',
    logs?: string,
    artifactId?: string,
  ) {
    const data: any = { status, updated_at: new Date() };
    if (logs) data.logs = logs;
    if (artifactId) data.artifact_id = artifactId;
    if (status === 'success' || status === 'failed') {
      data.completed_at = new Date();
    }

    const [updated] = await db
      .update(builds)
      .set({
        ...data,
        status: status,
        completed_at: status === 'success' || status === 'failed' ? new Date() : null,
      })
      .where(eq(builds.id, id))
      .returning();

    // Auto-activate on successful builds
    if (status === 'success' && updated) {
      const { LogService } = await import('./log-service');
      const { WebSocketService } = await import('../ws');

      console.log(
        `[BuildService] Auto-activating successful build ${id} for project ${updated.project_id}`,
      );

      // Log deployment start to build logs
      const startMsg = '🚀 Starting deployment activation...\n';
      await LogService.persist(id, startMsg, 'deploy');
      WebSocketService.broadcast(id, startMsg, 'deploy');

      try {
        await DeploymentService.activateBuild(updated.project_id, id);
        console.log(`[BuildService] Deployment activated successfully for build ${id}`);

        // Log success to build logs
        const successMsg = '✅ Deployment activated successfully!\n';
        await LogService.persist(id, successMsg, 'deploy');
        WebSocketService.broadcast(id, successMsg, 'deploy');
      } catch (e: any) {
        const errorMsg = e?.message || 'Unknown error';
        console.error(`[BuildService] Auto-activation failed for build ${id}:`, e);

        // Log error to build logs so users can see it
        const failMsg = `❌ Auto-deployment activation failed: ${errorMsg}\nPlease try activating manually.\n`;
        await LogService.persist(id, failMsg, 'error');
        WebSocketService.broadcast(id, failMsg, 'error');

        // Don't re-throw - build was successful, just activation failed
      }
    }

    return updated || null;
  },
};
