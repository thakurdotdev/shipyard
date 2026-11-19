import { hasInternalToken, platformListenHost } from '@thakur-deploy/config';
import { Elysia, t } from 'elysia';
import { syncPlatformInfo } from './services/platform-sync';
import { DeployService } from './services/deploy-service';
import { NginxService } from './services/nginx-service';
import { SSLService } from './services/ssl-service';
import { DockerService } from './services/docker';
import { PM0Service } from './services/pm0';
import { InfraContainers } from './services/infra-containers';
import { BuildWorker } from './queue';

import { isPortAvailable, findAvailablePort } from './utils/port';

const PORT = process.env.PORT || 4012;
const USE_DOCKER = process.env.USE_DOCKER === 'true';

const app = new Elysia()
  // Every route below acts with the platform's privileges (writes Nginx configs, issues
  // certificates, starts and deletes deployments). Deployed apps share this host and can
  // reach the port over loopback, so only the Control API (holding the internal token)
  // may call them. The bare liveness response stays open.
  .onBeforeHandle(({ request, path }) => {
    if (request.method === 'GET' && path === '/') return;
    if (!hasInternalToken(request)) return new Response('Forbidden', { status: 403 });
  })
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
    async ({
      body,
    }: {
      body: {
        projectId: string;
        buildId: string;
        port: number | null;
        appType: any;
        subdomain: string;
        rootDirectory?: string;
        envVars?: Record<string, string>;
        projectName?: string;
        gated?: boolean;
        preDeployCommand?: string | null;
        aliases?: string[];
      };
    }) => {
      const {
        projectId,
        buildId,
        port,
        appType,
        subdomain,
        rootDirectory,
        envVars,
        projectName,
        gated,
        preDeployCommand,
        aliases,
      } = body;

      try {
        return await DeployService.activateDeployment(
          projectId,
          buildId,
          port,
          appType,
          subdomain,
          envVars || {},
          rootDirectory,
          projectName,
          gated,
          preDeployCommand,
          aliases,
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return new Response(message, { status: 500 });
      }
    },
    {
      body: t.Object({
        projectId: t.String(),
        buildId: t.String(),
        port: t.Nullable(t.Number()),
        appType: t.Union([
          t.Literal('nextjs'),
          t.Literal('vite'),
          t.Literal('express'),
          t.Literal('hono'),
          t.Literal('elysia'),
          t.Literal('bun'),
          t.Literal('go'),
        ]),
        subdomain: t.String(),
        rootDirectory: t.Optional(t.String()),
        envVars: t.Optional(t.Record(t.String(), t.String())),
        projectName: t.Optional(t.String()),
        gated: t.Optional(t.Boolean()),
        preDeployCommand: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        aliases: t.Optional(t.Array(t.String({ maxLength: 253 }), { maxItems: 4 })),
      }),
    },
  )
  .post(
    '/stop',
    async ({ body }: { body: any }) => {
      const { port, projectId, buildId, subdomain, appType } = body;
      try {
        await DeployService.stopDeployment(port, projectId, buildId, subdomain, appType);
        return { success: true };
      } catch (e: any) {
        return new Response(e.message, { status: 500 });
      }
    },
    {
      body: t.Object({
        port: t.Nullable(t.Number()),
        projectId: t.Optional(t.String()),
        buildId: t.Optional(t.String()),
        subdomain: t.Optional(t.String()),
        appType: t.Optional(t.String()),
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
  .delete('/projects/:projectId/builds/:buildId', async ({ params: { projectId, buildId } }) => {
    try {
      await DeployService.deleteBuild(projectId, buildId);
      return { success: true };
    } catch (e: any) {
      const status = e.message === 'Cannot delete the currently active build' ? 400 : 500;
      return new Response(e.message, { status });
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
    const { domain, buildId, aliases } = body as {
      domain: string;
      buildId?: string;
      aliases?: string[];
    };
    if (!domain) return new Response('domain required', { status: 400 });
    try {
      const result = await SSLService.issueCertificate(
        domain,
        buildId,
        Array.isArray(aliases) ? aliases : [],
      );
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
    const { domain, aliases } = query as { domain: string; aliases?: string };
    if (!domain) return new Response('domain required', { status: 400 });
    const result = await SSLService.checkCertificate(domain);
    // `covered`: the certificate exists and already includes every requested name.
    const names = [domain, ...(aliases ? aliases.split(',') : [])].map((n) => n.toLowerCase());
    const covered = result.success
      ? await SSLService.getCertNames(domain).then(
          (sans) => sans !== null && names.every((n) => sans.includes(n)),
        )
      : false;
    return { ...result, covered };
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
    const { subdomain, port, gated, aliases } = (body || {}) as {
      subdomain: string;
      port: number | null;
      gated?: boolean;
      aliases?: string[];
    };
    if (!subdomain || port === undefined)
      return new Response('subdomain and port (or null for static hosting) required', {
        status: 400,
      });
    try {
      await NginxService.createHttpOnlyConfig(subdomain, port, gated, aliases);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/nginx/upgrade-https', async ({ body }) => {
    const { subdomain, port, gated, aliases } = body as {
      subdomain: string;
      port: number | null;
      gated?: boolean;
      aliases?: string[];
    };
    if (!subdomain || port === undefined)
      return new Response('subdomain and port (or null for static hosting) required', {
        status: 400,
      });
    try {
      await NginxService.upgradeToHttps(subdomain, port, gated, aliases);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/nginx/preview', async ({ body }) => {
    const { subdomain, port } = body as { subdomain: string; port: number | null };
    if (
      !NginxService.isSubdomainAllowed(subdomain) ||
      (port !== null && (!Number.isInteger(port) || port < 1024 || port > 65535))
    ) {
      return new Response('valid subdomain and port required', { status: 400 });
    }
    try {
      await NginxService.ensurePreviewConfig(subdomain, port);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .post('/nginx/gate', async ({ body }) => {
    const { subdomain, port, gated } = body as {
      subdomain: string;
      port: number | null;
      gated: boolean;
    };
    if (
      !NginxService.isSubdomainAllowed(subdomain) ||
      typeof gated !== 'boolean' ||
      (port !== null && (!Number.isInteger(port) || port < 1024 || port > 65535))
    ) {
      return new Response('valid subdomain, port and gated flag required', { status: 400 });
    }
    try {
      return { success: true, applied: await NginxService.setGate(subdomain, port, gated) };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  /** Other enabled Nginx sites that a site with these hostnames would take over. */
  .post('/nginx/conflicts', async ({ body }) => {
    const { subdomain, aliases } = (body || {}) as { subdomain: string; aliases?: string[] };
    if (!subdomain || !NginxService.isSubdomainAllowed(subdomain)) {
      return new Response('valid subdomain or hostname required', { status: 400 });
    }
    try {
      const names = [
        NginxService.domainForSubdomain(subdomain),
        ...(NginxService.normalizeAliases(subdomain, aliases ?? []) ?? []),
      ];
      return {
        conflicts: NginxService.findConflicts(subdomain, names).map((c) => ({
          file: c.file,
          names: c.names,
        })),
      };
    } catch (e: any) {
      return new Response(e.message, { status: 400 });
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
  .listen({ port: Number(PORT), hostname: platformListenHost() });

console.log(`🚀 Deploy Engine is running at ${app.server?.hostname}:${app.server?.port}`);

// Learn the dashboard URL and base domain from the Control API when not set here.
syncPlatformInfo();

// Start the in-engine build worker (consumes the shared BullMQ build queue)
BuildWorker.initialize().catch((err) => {
  console.error('[BuildWorker] Failed to initialize:', err);
});

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

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    await BuildWorker.shutdown();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
