import { Elysia, t } from 'elysia';
import { ProjectService } from '../services/project-service';
import { ProjectAccessService } from '../services/project-access-service';
import { UptimeService } from '../services/uptime-service';
import { SecurityService } from '../services/security-service';
import { db } from '../db';
import { deployments } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { DeploymentService } from '../services/deployment-service';
import { AppType, APP_TYPES } from '../config/framework-config';

const appTypeSchema = t.Union(
  APP_TYPES.map((type) => t.Literal(type)) as [
    ReturnType<typeof t.Literal>,
    ...ReturnType<typeof t.Literal>[],
  ],
  { error: 'Invalid app type' },
);
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';

export const projectsRoutes = new Elysia({ prefix: '/projects' })
  .get('/', async ({ request }) => {
    const ownerId = await ProjectAccessService.userIdFromRequest(request);
    return ownerId ? ProjectService.getAll(ownerId) : [];
  })
  .post(
    '/check-port',
    async ({ body, set }) => {
      try {
        return await ProjectService.checkPortAvailability(body.port);
      } catch (e: any) {
        set.status = 400;
        return { error: e.message };
      }
    },
    {
      body: t.Object({
        port: t.Number({ error: 'Port must be a number' }),
      }),
    },
  )
  .get('/next-port', async ({ set }) => {
    try {
      const port = await ProjectService.allocateNextPort();
      return { port, available: true };
    } catch (e: any) {
      set.status = 503;
      return { error: e.message };
    }
  })
  .post(
    '/',
    async ({ body, request, set }) => {
      try {
        SecurityService.validateBuildCommand(body.build_command);
        const ownerId = await ProjectAccessService.userIdFromRequest(request);
        if (!ownerId) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        return await ProjectService.create({
          ...body,
          owner_id: ownerId,
          app_type: body.app_type as AppType,
        });
      } catch (e: any) {
        console.error('RAW ERROR:', e);
        set.status = 400;
        return { error: e.message };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, error: 'Project name is required' }),
        github_url: t.String({ minLength: 1, error: 'GitHub URL is required' }),
        build_command: t.String({ minLength: 1, error: 'Build command is required' }),
        app_type: appTypeSchema,
        root_directory: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        port: t.Optional(
          t.Integer({
            minimum: 1024,
            maximum: 65535,
            error: 'Port must be between 1024 and 65535',
          }),
        ),
        env_vars: t.Optional(t.Record(t.String(), t.String())),
        github_repo_id: t.Optional(t.String()),
        github_repo_full_name: t.Optional(t.String()),
        github_branch: t.Optional(t.String()),
        github_installation_id: t.Optional(t.String()),
        auto_deploy: t.Optional(t.Boolean()),
      }),
    },
  )
  .get('/:id', async ({ params: { id }, request, set }) => {
    const project = await ProjectAccessService.getOwnedProject(request, id);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return project;
  })
  .put(
    '/:id',
    async ({ params: { id }, body, request, set }) => {
      try {
        const ownerId = await ProjectAccessService.userIdFromRequest(request);
        if (!ownerId) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        if (!(await ProjectAccessService.getOwnedProject(request, id))) {
          set.status = 404;
          return { error: 'Project not found' };
        }
        if (body.build_command) {
          SecurityService.validateBuildCommand(body.build_command);
        }
        const updateData = {
          ...body,
          app_type: body.app_type ? (body.app_type as AppType) : undefined,
        };
        return await ProjectService.update(id, ownerId, updateData);
      } catch (e: any) {
        set.status = 400;
        return { error: e.message };
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        github_url: t.Optional(t.String()),
        build_command: t.Optional(t.String()),
        app_type: t.Optional(appTypeSchema),
        root_directory: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        port: t.Optional(t.Integer({ minimum: 1024, maximum: 65535 })),
        auto_deploy: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete('/:id', async ({ params: { id }, request, set }) => {
    const ownerId = await ProjectAccessService.userIdFromRequest(request);
    if (!ownerId) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    const project = await ProjectService.delete(id, ownerId);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return project;
  })
  .get('/:id/deployment', async ({ params: { id }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    const deployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.project_id, id), eq(deployments.status, 'active')),
    });
    if (!deployment) {
      set.status = 404;
      return null;
    }
    return deployment;
  })
  .get('/:id/deployments', async ({ params: { id }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    // Get all deployments for this project (for status tracking in UI)
    const allDeployments = await db.query.deployments.findMany({
      where: eq(deployments.project_id, id),
      orderBy: (deployments, { desc }) => [desc(deployments.activated_at)],
    });
    return allDeployments;
  })
  .post('/:id/stop', async ({ params: { id }, request, set }) => {
    try {
      if (!(await ProjectAccessService.getOwnedProject(request, id))) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      await DeploymentService.stop(id);
      return { success: true };
    } catch (e: any) {
      set.status = 400;
      return { error: e.message };
    }
  })
  .post('/:id/preview', async ({ params: { id }, request, set }) => {
    const project = await ProjectAccessService.getOwnedProject(request, id);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    const activeDeployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.project_id, id), eq(deployments.status, 'active')),
      columns: { id: true },
    });
    if (!activeDeployment || !project.port || !project.domain) {
      return { preview_url: null, embeddable: false };
    }

    const subdomain = project.domain.slice(0, -(BASE_DOMAIN.length + 1));
    if (!subdomain || project.domain !== `${subdomain}.${BASE_DOMAIN}`) {
      return {
        preview_url: `https://${project.domain}`,
        embeddable: false,
      };
    }

    try {
      const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4012';
      const response = await fetch(`${deployEngineUrl}/nginx/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, port: project.port }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`Preview proxy setup failed: ${(await response.text()).slice(0, 300)}`);
      }
      return {
        preview_url: `https://${project.domain}/__shipyard_preview/`,
        embeddable: true,
      };
    } catch (error) {
      console.error(`[ProjectPreview] Failed to configure preview for ${id}`, error);
      set.status = 503;
      return { error: 'Could not configure the embedded preview' };
    }
  })
  .get('/:id/uptime', async ({ params: { id }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    const settings = await UptimeService.getSettings(id);
    if (!settings) {
      set.status = 404;
      return { error: 'Uptime monitor not found' };
    }
    return settings;
  })
  .put(
    '/:id/uptime',
    async ({ params: { id }, request, body, set }) => {
      if (!(await ProjectAccessService.getOwnedProject(request, id))) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      try {
        const settings = await UptimeService.updateSettings(id, body);
        if (!settings) {
          set.status = 404;
          return { error: 'Uptime monitor not found' };
        }
        return settings;
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Invalid uptime settings' };
      }
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        endpoint_url: t.Optional(t.Union([t.String(), t.Null()])),
        interval_seconds: t.Optional(
          t.Union([t.Literal(60), t.Literal(300), t.Literal(600), t.Literal(900), t.Literal(1800)]),
        ),
      }),
    },
  );
