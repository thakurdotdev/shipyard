import { Elysia, t } from 'elysia';
import { EnvService } from '../services/env-service';
import { ProjectAccessService } from '../services/project-access-service';

export const envRoutes = new Elysia({ prefix: '/projects/:id/env' })
  .get('/', async ({ params: { id }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return await EnvService.getAll(id);
  })
  .post(
    '/',
    async ({ params: { id }, body, request, set }) => {
      if (!(await ProjectAccessService.getOwnedProject(request, id))) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      return await EnvService.create(id, body.key, body.value);
    },
    {
      body: t.Object({
        key: t.String(),
        value: t.String(),
      }),
    },
  )
  .delete('/:key', async ({ params: { id, key }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, id))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    await EnvService.delete(id, key);
    return { success: true };
  });
