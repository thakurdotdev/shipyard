import { Elysia } from 'elysia';
import { BuildService } from '../services/build-service';
import { ProjectService } from '../services/project-service';
import { LogService } from '../services/log-service';
import { WebSocketService } from '../ws';
import { LogLevel } from '../db/schema';
import { BuildQueue } from '../queue';

export const buildsRoutes = new Elysia()
  .group('/projects/:id/builds', (app) =>
    app
      .post('/', async ({ params: { id }, set }) => {
        const project = await ProjectService.getById(id);
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }

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
      .get('/queue/stats', async () => {
        // Get queue statistics
        return await BuildQueue.getQueueInfo();
      })
      .get('/:id', async ({ params: { id }, set }) => {
        const build = await BuildService.getById(id);
        if (!build) {
          set.status = 404;
          return { error: 'Build not found' };
        }
        return build;
      })
      .get('/:id/queue-position', async ({ params: { id } }) => {
        // Get job position in queue
        const position = await BuildQueue.getJobPosition(id);
        const stats = await BuildQueue.getStats();
        return {
          position,
          totalWaiting: stats.waiting,
          totalActive: stats.active,
          isActive: position === 0,
          isWaiting: position > 0,
          notFound: position === -1,
        };
      })
      .get('/:id/logs', async ({ params: { id }, query }) => {
        // `?since=<ISO timestamp>` returns only lines persisted after that
        // point so clients can backfill what they missed over a flaky transport.
        const since = (query as { since?: string } | undefined)?.since;
        if (since) {
          const ts = new Date(since);
          if (!Number.isNaN(ts.getTime())) {
            return await LogService.getLogsSince(id, ts);
          }
        }
        return await LogService.getLogs(id);
      })
      .delete('/:id/logs', async ({ params: { id } }) => {
        await LogService.clearLogs(id);
        return { success: true, message: 'Logs cleared' };
      }),
  );

export const internalBuildRoutes = new Elysia().group('/builds', (app) =>
  app
    .post('/:id/logs', async ({ params: { id }, body }) => {
      const { logs, level } = body as { logs: string; level?: LogLevel };
      // Persist first so the DB is the source of truth, then broadcast with the
      // real row id/timestamp so clients can de-duplicate on backfill.
      const row = await LogService.persist(id, logs, level || 'info');
      WebSocketService.broadcast(id, logs, level || 'info', {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
      });
      return { success: true };
    })
    .put('/:id', async ({ params: { id }, body }) => {
      const { status } = body as { status: string };
      const updated = await BuildService.updateStatus(id, status as any);

      if (updated) {
        WebSocketService.broadcastBuildUpdate(updated.project_id, updated);
      }
      return updated;
    }),
);
