import { Elysia, t } from 'elysia';
import { ProjectService } from '../services/project-service';
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

export const projectsRoutes = new Elysia({ prefix: '/projects' })
  .get('/', async () => {
    return await ProjectService.getAll();
  })
  .post(
    '/',
    async ({ body, set }) => {
      try {
        SecurityService.validateBuildCommand(body.build_command);
        return await ProjectService.create({
          ...body,
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
        env_vars: t.Optional(t.Record(t.String(), t.String())),
        github_repo_id: t.Optional(t.String()),
        github_repo_full_name: t.Optional(t.String()),
        github_branch: t.Optional(t.String()),
        github_installation_id: t.Optional(t.String()),
        auto_deploy: t.Optional(t.Boolean()),
      }),
    },
  )
  .get('/:id', async ({ params: { id }, set }) => {
    const project = await ProjectService.getById(id);
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    const { port, ...safeProject } = project;
    return safeProject;
  })
  .put(
    '/:id',
    async ({ params: { id }, body, set }) => {
      try {
        if (body.build_command) {
          SecurityService.validateBuildCommand(body.build_command);
        }
        const updateData = {
          ...body,
          app_type: body.app_type ? (body.app_type as AppType) : undefined,
        };
        return await ProjectService.update(id, updateData);
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
        auto_deploy: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete('/:id', async ({ params: { id } }) => {
    return await ProjectService.delete(id);
  })
  .get('/:id/deployment', async ({ params: { id }, set }) => {
    const deployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.project_id, id), eq(deployments.status, 'active')),
    });
    if (!deployment) {
      set.status = 404;
      return null;
    }
    return deployment;
  })
  .get('/:id/deployments', async ({ params: { id } }) => {
    // Get all deployments for this project (for status tracking in UI)
    const allDeployments = await db.query.deployments.findMany({
      where: eq(deployments.project_id, id),
      orderBy: (deployments, { desc }) => [desc(deployments.activated_at)],
    });
    return allDeployments;
  })
  .post('/:id/stop', async ({ params: { id }, set }) => {
    try {
      await DeploymentService.stop(id);
      return { success: true };
    } catch (e: any) {
      set.status = 400;
      return { error: e.message };
    }
  });
