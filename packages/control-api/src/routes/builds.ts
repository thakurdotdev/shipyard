import { Elysia, t } from 'elysia';
import { BuildService } from '../services/build-service';
import { ProjectService } from '../services/project-service';
import { JobQueue } from '../queue';
import { LogService } from '../services/log-service';
import { WebSocketService } from '../ws';
import { db } from '../db';
import { deployments } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { DeploymentService } from '../services/deployment-service';

export const buildsRoutes = new Elysia()
  .group('/projects/:id/builds', (app) =>
    app
      .post('/', async ({ params: { id } }) => {
        const project = await ProjectService.getById(id);
        if (!project) throw new Error('Project not found');

        const build = await BuildService.create({
          project_id: id,
          status: 'pending',
        });

        return build;
      })
      .get('/', async ({ params: { id } }) => {
        return await BuildService.getByProjectId(id);
      }),
  )
  .group('/builds', (app) =>
    app
      .get('/:id', async ({ params: { id } }) => {
        const build = await BuildService.getById(id);
        if (!build) throw new Error('Build not found');
        return build;
      })
      .get('/:id/logs', async ({ params: { id } }) => {
        return await LogService.getLogs(id);
      })
      .post('/:id/logs', async ({ params: { id }, body }) => {
        const { logs } = body as { logs: string };
        await LogService.persist(id, logs);
        WebSocketService.broadcast(id, logs);
        return { success: true };
      })
      .put('/:id', async ({ params: { id }, body }) => {
        const { status } = body as { status: string };
        const updated = await BuildService.updateStatus(id, status as any);

        if (updated) {
          WebSocketService.broadcastBuildUpdate(updated.project_id, updated);

          // Auto-Deploy logic: If build succeeded and no active deployment exists, activate it.
          if (status === 'success') {
            const activeDeployment = await db.query.deployments.findFirst({
              where: and(
                eq(deployments.project_id, updated.project_id),
                eq(deployments.status, 'active'),
              ),
            });

            if (!activeDeployment) {
              console.log(
                `[AutoDeploy] No active deployment for project ${updated.project_id}. Auto-activating build ${updated.id}...`,
              );
              try {
                await DeploymentService.activateBuild(updated.project_id, updated.id);
                // Notify again about the deployment change via socket?
                // DeploymentService updates DB, but maybe we should emit a project update event if we had one.
                // For now, the frontend refreshing on build success or polling will catch it.
              } catch (e) {
                console.error(`[AutoDeploy] Failed to auto-activate build ${updated.id}:`, e);
              }
            }
          }
        }
        return updated;
      }),
  );
