import { config } from '@thakur-deploy/config';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { auth } from './lib/auth';
import { BuildQueue } from './queue';
import { buildsRoutes, internalBuildRoutes } from './routes/builds';
import { deploymentsRoutes } from './routes/deployments';
import { domainsRoutes } from './routes/domains';
import { gateRoutes } from './routes/gate';
import { envRoutes } from './routes/env';
import { githubRoutes } from './routes/github';
import { infraRoutes } from './routes/infra';
import { internalRoutes } from './routes/internal';
import { processesRoutes } from './routes/processes';
import { projectsRoutes } from './routes/projects';
import { settingsRoutes } from './routes/settings';
import { setupRoutes } from './routes/setup';
import { githubWebhook } from './routes/webhook-handler';
import { isGitHubLoginConfigured, SettingsService } from './services/settings-service';
import { UptimeService } from './services/uptime-service';

const publicRoutes = new Elysia()
  .use(githubWebhook)
  .use(githubRoutes)
  .use(internalBuildRoutes)
  .use(gateRoutes)
  .use(setupRoutes)
  .use(internalRoutes);

const protectedRoutes = new Elysia()
  .use(projectsRoutes)
  .use(buildsRoutes)
  .use(envRoutes)
  .use(deploymentsRoutes)
  .use(domainsRoutes)
  .use(infraRoutes)
  .use(processesRoutes)
  .use(settingsRoutes);

// 0. Settings edited from the dashboard (GitHub App, Cloudflare, email). An install whose
// migrations haven't run yet still starts, using values from .env.
try {
  await SettingsService.load();
} catch (error) {
  console.warn('[Settings] Could not load saved settings; using .env only:', error);
}

// 1. Create Elysia app
const app = new Elysia()
  .onError(({ code, error, set }) => {
    console.error('API Error:', error);

    // Safely extract error message
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific error codes
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not Found', message: errorMessage };
    }
    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'Validation Error', message: errorMessage };
    }
    if (code === 'PARSE') {
      set.status = 400;
      return { error: 'Parse Error', message: errorMessage };
    }

    // Default to 500 for unexpected errors
    set.status = 500;
    return { error: 'Internal Server Error', message: errorMessage };
  })
  .use(
    cors({
      origin: config.publicUrl,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  )
  .mount(auth.handler)
  .use(publicRoutes)
  .group('/api', (app) => app.use(publicRoutes))
  .guard(
    {
      async beforeHandle({ request }) {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session) {
          return new Response('Unauthorized', { status: 401 });
        }
      },
    },
    (app) => app.use(protectedRoutes).group('/api', (app) => app.use(protectedRoutes)),
  )
  .get('/', () => 'Hello from ShipYard')
  .get('/api', () => 'Hello from ShipYard');

// 2. Initialize background services
BuildQueue.initialize().catch((err) => {
  console.error('[BuildQueue] Failed to initialize:', err);
});
UptimeService.initialize().catch((err) => {
  console.error('[Uptime] Failed to initialize:', err);
});

const PORT = Number(process.env.PORT) || 4010;

// 3. Listen directly with native Bun server
app.listen(PORT, () => {
  console.log(`Control API running on port ${PORT} 🚀`);
  if (config.isProduction) {
    // Installers released before the shared config check the build for this exact text,
    // so it must stay in the bundle for `install.sh update` on older servers to succeed.
    console.log('[Config] Production mode: domains, Nginx and HTTPS on (IS_PLATFORM_PROD = true)');
  }
  if (!isGitHubLoginConfigured() && config.setupToken) {
    console.log(
      `[Setup] No GitHub App yet. Finish setup at ${config.publicUrl}/setup?token=${config.setupToken}`,
    );
  }
});

// 4. Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    await BuildQueue.shutdown();
    await UptimeService.shutdown();
    await app.stop();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
