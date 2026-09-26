import { Elysia, t } from 'elysia';
import { DeployService } from './services/deploy-service';
import { NginxService } from './services/nginx-service';
import { SSLService } from './services/ssl-service';
import { DockerService } from './services/docker';
import { PM0Service } from './services/pm0';
import { InfraContainers } from './services/infra-containers';

import { isPortAvailable, findAvailablePort } from './utils/port';

const PORT = process.env.PORT || 4012;
const USE_DOCKER = process.env.USE_DOCKER === 'true';

const app = new Elysia()
  .post('/ports/check', async ({ body }) => {
    const { port } = body as { port: number };
    if (!port) return new Response('Port required', { status: 400 });
    const available = await isPortAvailable(port);
    return { available };
  })
  .post('/ports/allocate', async ({ body }) => {
    const { startPort, endPort } = (body || {}) as { startPort?: number; endPort?: number };
    try {
      const port = await findAvailablePort(startPort, endPort);
      if (!port) {
        return new Response(JSON.stringify({ error: 'No available ports in range' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return { port, available: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
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
  // SSL certificate management endpoints
  .post('/ssl/issue', async ({ body }) => {
    const { domain, buildId } = body as { domain: string; buildId?: string };
    if (!domain) return new Response('domain required', { status: 400 });
    try {
      const result = await SSLService.issueCertificate(domain, buildId);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return result;
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .get('/ssl/status', async ({ query }) => {
    const { domain } = query as { domain: string };
    if (!domain) return new Response('domain required', { status: 400 });
    const result = await SSLService.checkCertificate(domain);
    return result;
  })
  .post('/ssl/revoke', async ({ body }) => {
    const { domain } = body as { domain: string };
    if (!domain) return new Response('domain required', { status: 400 });
    try {
      const result = await SSLService.revokeCertificate(domain);
      return result;
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  // Nginx configuration management endpoints
  .post('/nginx/http-only', async ({ body }) => {
    const { subdomain, port } = body as { subdomain: string; port: number };
    if (!subdomain || !port) return new Response('subdomain and port required', { status: 400 });
    try {
      await NginxService.createHttpOnlyConfig(subdomain, port);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/nginx/upgrade-https', async ({ body }) => {
    const { subdomain, port } = body as { subdomain: string; port: number };
    if (!subdomain || !port) return new Response('subdomain and port required', { status: 400 });
    try {
      await NginxService.upgradeToHttps(subdomain, port);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/nginx/remove', async ({ body }) => {
    const { subdomain } = body as { subdomain: string };
    if (!subdomain) return new Response('subdomain required', { status: 400 });
    try {
      await NginxService.removeConfig(subdomain);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .get('/*', () => {
    return DeployService.serveRequest();
  })
  .listen(PORT);

console.log(`🚀 Deploy Engine is running at ${app.server?.hostname}:${app.server?.port}`);

// Recover managed processes on startup
if (USE_DOCKER) {
  DockerService.recoverLogStreams().catch((e) => {
    console.error('Failed to recover Docker log streams:', e);
  });
} else {
  PM0Service.recoverProcesses().catch((e) => {
    console.error('Failed to recover PM0 processes:', e);
  });
}
