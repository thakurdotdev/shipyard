import { Elysia } from 'elysia';
import { InfraService } from '../services/infra-service';
import { ServiceType } from '../db/schema';

export const infraRoutes = new Elysia().group('/infra/services', (app) =>
  app
    // Create a new infrastructure service
    .post('/', async ({ body, set }) => {
      const { name, service_type, version, bind_localhost } = body as {
        name: string;
        service_type: ServiceType;
        version?: string;
        bind_localhost?: boolean;
      };

      if (!name || !service_type) {
        set.status = 400;
        return { error: 'name and service_type are required' };
      }

      if (!['redis', 'postgres'].includes(service_type)) {
        set.status = 400;
        return { error: 'service_type must be redis or postgres' };
      }

      try {
        const service = await InfraService.create({
          name,
          service_type,
          version,
          bind_localhost,
        });

        set.status = 201;
        return service;
      } catch (error: any) {
        set.status = 500;
        return { error: error.message };
      }
    })

    // List all infrastructure services
    .get('/', async () => {
      return await InfraService.getAll();
    })

    // Get a specific service with connection details
    .get('/:id', async ({ params: { id }, set }) => {
      const service = await InfraService.getById(id);
      if (!service) {
        set.status = 404;
        return { error: 'Service not found' };
      }
      return service;
    })

    // Delete a service
    .delete('/:id', async ({ params: { id }, set }) => {
      try {
        await InfraService.delete(id);
        return { success: true, message: 'Service deleted' };
      } catch (error: any) {
        set.status = 500;
        return { error: error.message };
      }
    })

    // Restart a service
    .post('/:id/restart', async ({ params: { id }, set }) => {
      try {
        const result = await InfraService.restart(id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { error: error.message };
      }
    })

    // Get service logs
    .get('/:id/logs', async ({ params: { id }, query, set }) => {
      const tail = parseInt((query as any).tail) || 100;
      try {
        const logs = await InfraService.getLogs(id, tail);
        return { logs };
      } catch (error: any) {
        set.status = 500;
        return { error: error.message };
      }
    }),
);
