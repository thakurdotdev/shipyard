import { config } from '@thakur-deploy/config';
import { db } from '../db';
import { builds, buildLogs, deployments } from '../db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { DeploymentService } from './deployment-service';
import { AppType } from '../config/framework-config';
import { BuildQueue, type BuildJobData } from '../queue';
import { ProjectService } from './project-service';
import { EnvService } from './env-service';
import { LogService } from './log-service';
import { EventStreamService } from './event-stream-service';
import { GitHubDeploymentStatus } from './github-deployment-status';
import { DeployNotifications } from './deploy-notifications';
import { deployEngineFetch } from './deploy-engine-client';

export type BuildStatus = 'pending' | 'building' | 'success' | 'failed' | 'cancelled';

export const BuildService = {
  async create(data: {
    project_id: string;
    status: 'pending' | 'building' | 'success' | 'failed';
    commit_sha?: string;
    commit_message?: string | null;
  }) {
    const project =
      data.status === 'pending' ? await ProjectService.getById(data.project_id) : null;

    // Dashboard deploys don't carry a commit; record the branch head so the build shows
    // its commit and can be reported on GitHub.
    let commitSha = data.commit_sha;
    let commitMessage = data.commit_message;
    if (!commitSha && project) {
      const head = await GitHubDeploymentStatus.resolveBranchHead(project);
      if (head) {
        commitSha = head.sha;
        commitMessage ??= head.message;
      }
    }

    const result = await db
      .insert(builds)
      .values({
        project_id: data.project_id,
        status: data.status,
        commit_sha: commitSha,
        commit_message: commitMessage,
      })
      .returning();
    const build = result[0];

    if (data.status === 'pending') {
      if (project) {
        void GitHubDeploymentStatus.report(build.id, 'queued');

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
          // Build exactly the commit this build is recorded as, not whatever the branch
          // head is when the worker gets to it.
          commit_sha: commitSha || undefined,
          // Only repo-connected projects have a branch chosen from the repository; the
          // column's 'main' default would be a guess for anything else.
          branch: (project.github_repo_id && project.github_branch) || undefined,
        };

        try {
          // Add job to BullMQ queue
          const { jobId, timestamp } = await BuildQueue.addJob(buildJobData);
          await this.supersedeOlderBuilds(build, timestamp);
          // After superseding, so the position doesn't count the builds just removed.
          const position = await BuildQueue.getJobPosition(jobId);

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
          void GitHubDeploymentStatus.report(build.id, 'failure', 'Build could not be queued');
          DeployNotifications.buildFailed(build.id);

          console.error(`[BuildService] Build ${build.id} marked as failed due to queue error`);
        }
      }
    }

    return build;
  },

  /**
   * Latest commit wins: once `newer` is queued, the same project's builds still waiting
   * in the queue would only deploy older code before it, so they are cancelled. A build
   * that is already running finishes. Best effort: on any error the old builds just run.
   */
  async supersedeOlderBuilds(
    newer: { id: string; project_id: string; commit_sha: string | null },
    queuedAt: number,
  ) {
    try {
      const removed = await BuildQueue.removeSuperseded({
        id: newer.id,
        timestamp: queuedAt,
        data: { build_id: newer.id, project_id: newer.project_id },
      });
      if (removed.length === 0) return;

      const cancelled = await db
        .update(builds)
        .set({ status: 'cancelled', completed_at: new Date() })
        .where(and(inArray(builds.id, removed), eq(builds.status, 'pending')))
        .returning();

      const replacement = newer.commit_sha
        ? `commit ${newer.commit_sha.slice(0, 7)}`
        : `build #${newer.id.slice(0, 8)}`;
      for (const build of cancelled) {
        const message = `⏭️ Skipped: superseded by newer ${replacement} before this build started\n`;
        await LogService.persist(build.id, message, 'info');
        EventStreamService.broadcast(build.id, message, 'info');
        EventStreamService.broadcastBuildUpdate(build.project_id, build);
        void GitHubDeploymentStatus.report(build.id, 'superseded', `Superseded by ${replacement}`);
      }

      if (cancelled.length > 0) {
        const plural = cancelled.length === 1 ? 'build' : 'builds';
        await LogService.persist(
          newer.id,
          `⏭️ Replaced ${cancelled.length} older queued ${plural} for this project\n`,
          'info',
        );
        console.log(
          `[BuildService] Build ${newer.id} superseded ${cancelled.length} queued ${plural}: ${cancelled.map((b) => b.id).join(', ')}`,
        );
      }
    } catch (error) {
      console.error(`[BuildService] Could not supersede older builds for ${newer.id}:`, error);
    }
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

  /**
   * Deletes one build (a single row in the deployment-history list) and frees
   * the disk it consumed: build output dir, artifact tarball, logs, deployment
   * rows. The build currently serving traffic cannot be deleted — roll back or
   * promote another build first.
   */
  async delete(id: string) {
    const build = await this.getById(id);
    if (!build) return null;

    if (build.status === 'pending' || build.status === 'building') {
      throw new Error('Cannot delete a build that is queued or in progress');
    }

    const [activeDeployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.project_id, build.project_id))
      .orderBy(desc(deployments.activated_at))
      .limit(1);

    if (activeDeployment?.build_id === id && activeDeployment.status === 'active') {
      throw new Error(
        'Cannot delete the currently active build. Activate another build first, then delete this one.',
      );
    }

    // Tell the deploy engine to remove the build output dir + artifact tarball
    // before dropping the DB rows. Best-effort: DB deletion proceeds regardless.
    try {
      const res = await deployEngineFetch(`/projects/${build.project_id}/builds/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error(`[BuildService] Deploy Engine build cleanup failed: ${res.status}`);
      }
    } catch (e) {
      console.error('[BuildService] Failed to cleanup build on Deploy Engine', e);
    }

    await db.delete(deployments).where(eq(deployments.build_id, id));
    await db.delete(buildLogs).where(eq(buildLogs.build_id, id));
    await db.delete(builds).where(eq(builds.id, id));

    return { id, project_id: build.project_id };
  },

  async updateStatus(id: string, status: BuildStatus, logs?: string, artifactId?: string) {
    const data: any = { status, updated_at: new Date() };
    if (logs) data.logs = logs;
    if (artifactId) data.artifact_id = artifactId;
    const finished = status === 'success' || status === 'failed' || status === 'cancelled';
    if (finished) {
      data.completed_at = new Date();
    }

    const [updated] = await db
      .update(builds)
      .set({
        ...data,
        status: status,
        completed_at: finished ? new Date() : null,
      })
      .where(eq(builds.id, id))
      .returning();

    if (updated && status === 'building') {
      void GitHubDeploymentStatus.report(id, 'building');
      DeployNotifications.started(id);
    } else if (updated && status === 'failed') {
      void GitHubDeploymentStatus.report(id, 'failure', 'Build failed');
      DeployNotifications.buildFailed(id);
    }

    // Auto-activate on successful builds
    if (status === 'success' && updated) {
      console.log(
        `[BuildService] Auto-activating successful build ${id} for project ${updated.project_id}`,
      );

      // Log deployment start to build logs
      const startMsg = '🚀 Starting deployment activation...\n';
      await LogService.persist(id, startMsg, 'deploy');
      EventStreamService.broadcast(id, startMsg, 'deploy');

      try {
        await DeploymentService.activateBuild(updated.project_id, id);
        console.log(`[BuildService] Deployment activated successfully for build ${id}`);

        // Log success to build logs
        const successMsg = '✅ Deployment activated successfully!\n';
        await LogService.persist(id, successMsg, 'deploy');
        EventStreamService.broadcast(id, successMsg, 'deploy');
      } catch (e: any) {
        const errorMsg = e?.message || 'Unknown error';
        console.error(`[BuildService] Auto-activation failed for build ${id}:`, e);

        // Log error to build logs so users can see it
        const failMsg = `❌ Auto-deployment activation failed: ${errorMsg}\nPlease try activating manually.\n`;
        await LogService.persist(id, failMsg, 'error');
        EventStreamService.broadcast(id, failMsg, 'error');

        // Don't re-throw - build was successful, just activation failed
      }
    }

    return updated || null;
  },
};
