import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { auth } from './lib/auth';
import { buildsRoutes } from './routes/builds';
import { deploymentsRoutes } from './routes/deployments';
import { domainsRoutes } from './routes/domains';
import { envRoutes } from './routes/env';
import { projectsRoutes } from './routes/projects';
import { githubWebhook } from './routes/webhook-handler';
import { githubRoutes } from './routes/github';
import { WebSocketService } from './ws';

// 1. Create your Elysia app
const app = new Elysia()
  .use(
    cors({
      origin: process.env.CLIENT_URL!,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  )
  .use(projectsRoutes)
  .use(buildsRoutes)
  .use(envRoutes)
  .use(deploymentsRoutes)
  .use(domainsRoutes)
  .use(githubWebhook)
  .use(githubRoutes)
  .mount(auth.handler)
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

// 6. Listen on port 4000
server.listen(4000, () => {
  console.log('Control API + Socket.IO running on port 4000 🚀');
});
