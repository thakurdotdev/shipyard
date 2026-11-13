import { config } from '@thakur-deploy/config';
import { Elysia, t } from 'elysia';
import { ProjectService } from '../services/project-service';
import { ProjectAccessService } from '../services/project-access-service';
import { UptimeService } from '../services/uptime-service';
import { SecurityService } from '../services/security-service';
import { GateError, GateService } from '../services/gate-service';
import { MAX_SESSION_HOURS, MIN_SESSION_HOURS } from '../services/gate-session';
import { db } from '../db';
import { deployments, uptimeMonitors } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { DeploymentService } from '../services/deployment-service';
import { AppType, APP_TYPES, isStaticFramework } from '../config/framework-config';
import { MAX_KEEP_BUILDS, MIN_KEEP_BUILDS } from '../services/build-retention';
import { EventStreamService } from '../services/event-stream-service';

const appTypeSchema = t.Union(
  APP_TYPES.map((type) => t.Literal(type)) as [
    ReturnType<typeof t.Literal>,
    ...ReturnType<typeof t.Literal>[],
  ],
  { error: 'Invalid app type' },
);
const BASE_DOMAIN = config.baseDomain;

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
        SecurityService.validatePreDeployCommand(body.pre_deploy_command);
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
        pre_deploy_command: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
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
        auto_deploy_paths: t.Optional(t.Union([t.String({ maxLength: 16384 }), t.Null()])),
        access: t.Optional(
          t.Object({
            password: t.String({ maxLength: 1024 }),
            session_hours: t.Optional(
              t.Integer({ minimum: MIN_SESSION_HOURS, maximum: MAX_SESSION_HOURS }),
            ),
          }),
        ),
      }),
    },
  )
  .get('/:id', async ({ params: { id }, request, set }) => {
    const project = await ProjectAccessService.getOwnedProject(request, id);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    const monitor = await db.query.uptimeMonitors.findFirst({
      where: eq(uptimeMonitors.project_id, id),
    });
    return {
      ...project,
      uptime_status: monitor?.enabled ? monitor.current_status : null,
      access_protected: await GateService.isEnabled(id),
    };
  })
  .get('/:id/events', async ({ params: { id }, request, set }) => {
    const project = await ProjectAccessService.getOwnedProject(request, id);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return EventStreamService.subscribeProject(id);
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
        SecurityService.validatePreDeployCommand(body.pre_deploy_command);
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
        pre_deploy_command: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
        app_type: t.Optional(appTypeSchema),
        root_directory: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        port: t.Optional(t.Integer({ minimum: 1024, maximum: 65535 })),
        auto_deploy: t.Optional(t.Boolean()),
        auto_deploy_paths: t.Optional(t.Union([t.String({ maxLength: 16384 }), t.Null()])),
        keep_builds: t.Optional(
          t.Union([t.Integer({ minimum: MIN_KEEP_BUILDS, maximum: MAX_KEEP_BUILDS }), t.Null()]),
        ),
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
    if (
      !activeDeployment ||
      (!project.port && !isStaticFramework(project.app_type)) ||
      !project.domain
    ) {
      return { preview_url: null, embeddable: false };
    }

    // The embedded preview bypasses nothing, so a password-protected site would only show its
    // login page inside the frame. Send the owner to the real site instead.
    if (await GateService.isEnabled(id)) {
      return { preview_url: `https://${project.domain}`, embeddable: false };
    }

    const subdomain = project.domain.slice(0, -(BASE_DOMAIN.length + 1));
    if (!subdomain || project.domain !== `${subdomain}.${BASE_DOMAIN}`) {
      return {
        preview_url: `https://${project.domain}`,
        embeddable: false,
      };
    }

    try {
      const deployEngineUrl = config.deployEngineUrl;
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
  .get('/:id/access', async ({ params: { id }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return GateService.getSettings(id);
  })
  .put(
    '/:id/access',
    async ({ params: { id }, request, body, set }) => {
      const project = await ProjectAccessService.getOwnedProject(request, id);
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      const previous = await GateService.snapshot(id);
      try {
        const settings = await GateService.updateSettings(id, body);
        // Apply to the live site now; a project with nothing deployed picks it up on activation.
        try {
          await GateService.applyToProxy(project, settings.enabled);
        } catch (error) {
          await GateService.restore(id, previous);
          throw error;
        }
        return settings;
      } catch (error) {
        if (error instanceof GateError) {
          set.status = 400;
          return { error: error.message };
        }
        console.error(`[Access] Failed to update protection for ${id}`, error);
        set.status = 500;
        return { error: 'Could not update access protection' };
      }
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        password: t.Optional(t.String({ maxLength: 1024 })),
        session_hours: t.Optional(
          t.Integer({ minimum: MIN_SESSION_HOURS, maximum: MAX_SESSION_HOURS }),
        ),
      }),
    },
  )
  .get(
    '/:id/uptime',
    async ({ params: { id }, query, request, set }) => {
      if (!(await ProjectAccessService.getOwnedProject(request, id))) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      const limit = query?.limit ? Math.min(Math.max(Number(query.limit) || 20, 1), 100) : 20;
      const settings = await UptimeService.getSettings(id, limit);
      if (!settings) {
        set.status = 404;
        return { error: 'Uptime monitor not found' };
      }
      return settings;
    },
    {
      query: t.Optional(
        t.Object({
          limit: t.Optional(t.String()),
        }),
      ),
    },
  )
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
