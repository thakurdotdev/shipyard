import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { auth } from './lib/auth';
import { buildsRoutes, internalBuildRoutes } from './routes/builds';
import { deploymentsRoutes } from './routes/deployments';
import { domainsRoutes } from './routes/domains';
import { envRoutes } from './routes/env';
import { projectsRoutes } from './routes/projects';
import { githubWebhook } from './routes/webhook-handler';
import { githubRoutes } from './routes/github';
import { infraRoutes } from './routes/infra';
import { WebSocketService } from './ws';
import { BuildQueue } from './queue';

// 1. Create your Elysia app
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
      origin: process.env.CLIENT_URL!,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  )
  .use(githubWebhook)
  .use(githubRoutes)
  .use(internalBuildRoutes)
  .mount(auth.handler)
  .guard(
    {
      async beforeHandle({ request, set }) {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session) {
          return new Response('Unauthorized', { status: 401 });
        }
      },
    },
    (app) =>
      app
        .use(projectsRoutes)
        .use(buildsRoutes)
        .use(envRoutes)
        .use(deploymentsRoutes)
        .use(domainsRoutes)
        .use(infraRoutes),
  )
  .get('/', () => 'Hello from Thakur Deploy');

// 2. Create Socket.IO server
const io = new IOServer({
  cors: {
    origin: process.env.CLIENT_URL!,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// 3. Initialize your WebSocketService
WebSocketService.initialize(io);

// 4. Initialize Build Queue
BuildQueue.initialize().catch((err) => {
  console.error('[BuildQueue] Failed to initialize:', err);
});

// 4. Create Node.js compatible HTTP server manually to support Socket.IO on the same port
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url?.startsWith('/socket.io/')) {
    // Socket.IO will manage upgrade + response
    return;
  }

  try {
    const protocol = 'http';
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '', `${protocol}://${host}`);

    const method = req.method || 'GET';

    // Create verify body
    let body: any = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = req;
    }

    const webReq = new Request(url.toString(), {
      method,
      headers: req.headers as any,
      body,
      duplex: 'half',
    });

    // Handle with Elysia
    const webRes = await app.handle(webReq);

    // Convert Web Response back to Node Response
    res.statusCode = webRes.status;

    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (webRes.body) {
      // Pipe the body to response
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error('Error handling request:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

// 5. Attach Socket.IO to the server
io.attach(server);

const PORT = process.env.PORT || 4010;

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Control API port ${PORT} is already in use.`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

// 7. Listen on port
server.listen(PORT, () => {
  console.log(`Control API + Socket.IO running on port ${PORT} 🚀`);
});

// 8. Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    await BuildQueue.shutdown();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
