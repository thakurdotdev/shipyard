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
import { processesRoutes } from './routes/processes';
import { projectsRoutes } from './routes/projects';
import { githubWebhook } from './routes/webhook-handler';
import { UptimeService } from './services/uptime-service';

const publicRoutes = new Elysia()
  .use(githubWebhook)
  .use(githubRoutes)
  .use(internalBuildRoutes)
  .use(gateRoutes);

const protectedRoutes = new Elysia()
  .use(projectsRoutes)
  .use(buildsRoutes)
  .use(envRoutes)
  .use(deploymentsRoutes)
  .use(domainsRoutes)
  .use(infraRoutes)
  .use(processesRoutes);

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
      origin: process.env.CLIENT_URL || true,
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
