import { Elysia, t } from 'elysia';
import { DeploymentService } from '../services/deployment-service';
import { BuildService } from '../services/build-service';
import { ProjectAccessService } from '../services/project-access-service';

export const deploymentsRoutes = new Elysia().group('/deploy', (app) =>
  app.post('/build/:id/activate', async ({ params: { id }, request, set }) => {
    try {
      const build = await BuildService.getById(id);
      if (!build) {
        set.status = 404;
        return { error: 'Build not found' };
      }

      if (!(await ProjectAccessService.getOwnedProject(request, build.project_id))) {
        set.status = 404;
        return { error: 'Build not found' };
      }

      await DeploymentService.activateBuild(build.project_id, build.id);
      return { success: true };
    } catch (e: any) {
      set.status = 400;
      return { error: e.message };
    }
  }),
);
