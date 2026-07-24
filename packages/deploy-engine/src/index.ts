import { Elysia, t } from 'elysia';
import { DeployService } from './services/deploy-service';
import { NginxService } from './services/nginx-service';
import { DockerService } from './services/docker';
import { InfraContainers } from './services/infra-containers';

import { isPortAvailable } from './utils/port';

const app = new Elysia()
  .post('/ports/check', async ({ body }) => {
    const { port } = body as { port: number };
    if (!port) return new Response('Port required', { status: 400 });
    const available = await isPortAvailable(port);
    return { available };
  })
  .post('/artifacts/upload', async ({ query, request }) => {
    const buildId = query.buildId;
    if (!buildId) return new Response('Missing buildId', { status: 400 });

    if (!request.body) return new Response('Missing body', { status: 400 });

    return await DeployService.receiveArtifact(buildId, request.body);
  })
  .post(
    '/activate',
    async ({ body }: { body: any }) => {
      const { projectId, buildId, port, appType, subdomain, envVars } = body;

      try {
        await DeployService.activateDeployment(
          projectId,
          buildId,
          port,
          appType,
          subdomain,
          envVars || {},
        );
        return { success: true };
      } catch (e: any) {
        return new Response(e.message, { status: 500 });
      }
    },
    {
      body: t.Object({
        projectId: t.String(),
        buildId: t.String(),
        port: t.Number(),
        appType: t.Union([
          t.Literal('nextjs'),
          t.Literal('vite'),
          t.Literal('express'),
          t.Literal('hono'),
          t.Literal('elysia'),
        ]),
        subdomain: t.String(),
        envVars: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )
  .post(
    '/stop',
    async ({ body }: { body: any }) => {
      const { port, projectId, buildId } = body;
      try {
        await DeployService.stopDeployment(port, projectId, buildId);
        return { success: true };
      } catch (e: any) {
        return new Response(e.message, { status: 500 });
      }
    },
    {
      body: t.Object({
        port: t.Number(),
        projectId: t.Optional(t.String()),
        buildId: t.Optional(t.String()),
      }),
    },
  )
  .post('/projects/:id/delete', async ({ params: { id }, body }) => {
    const { port, subdomain, buildIds } = body as {
      port?: number;
      subdomain?: string;
      buildIds?: string[];
    };
    try {
      await DeployService.deleteProject(id, port, subdomain, buildIds);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  // Infrastructure service endpoints
  .post('/infra/start', async ({ body }) => {
    const config = body as any;
    try {
      const result = await InfraContainers.startService(config);
      if (!result.success) {
        return new Response(result.error || 'Failed to start service', { status: 500 });
      }
      return result;
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/infra/stop', async ({ body }) => {
    const { containerName, removeVolume } = body as {
      containerName: string;
      removeVolume?: boolean;
    };
    try {
      const result = await InfraContainers.stopService(containerName, removeVolume);
      return result;
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .get('/infra/status', async ({ query }) => {
    const { containerName } = query as { containerName: string };
    if (!containerName) return new Response('containerName required', { status: 400 });
    const status = await InfraContainers.getStatus(containerName);
    return { status };
  })
  .get('/infra/logs', async ({ query }) => {
    const { containerName, tail } = query as { containerName: string; tail?: string };
    if (!containerName) return new Response('containerName required', { status: 400 });
    const logs = await InfraContainers.getLogs(containerName, parseInt(tail || '100'));
    return { logs };
  })
  .get('/infra/list', async () => {
    const containers = await InfraContainers.listAll();
    return { containers };
  })
  .get('/*', () => {
    return DeployService.serveRequest();
  })
  .listen(4002);

console.log(`🚀 Deploy Engine is running at ${app.server?.hostname}:${app.server?.port}`);

// Initialize Nginx Default Config (Production Only)
if (process.env.NODE_ENV === 'production') {
  NginxService.createDefaultConfig().catch((e) => {
    console.error('Failed to initialize Nginx default config:', e);
  });
}

// Initialize Nginx Default Config (Production Only)
if (process.env.NODE_ENV === 'production') {
  NginxService.createDefaultConfig().catch((e) => {
    console.error('Failed to initialize Nginx default config:', e);
  });
}

// Recover Docker log streams (for all envs)
DockerService.recoverLogStreams().catch((e) => {
  console.error('Failed to recover Docker log streams:', e);
});
