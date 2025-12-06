import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { projectsRoutes } from "./routes/projects";
import { buildsRoutes } from "./routes/builds";
import { envRoutes } from "./routes/env";
import { deploymentsRoutes } from "./routes/deployments";

import { WebSocketService } from "./ws";

const app = new Elysia()
  .use(cors({ origin: true }))
  .use(projectsRoutes)
  .use(buildsRoutes)
  .use(envRoutes)
  .use(deploymentsRoutes)
  .get("/", () => "Hello from Control API")
  .listen(4000);

// Initialize Socket.IO on separate port
WebSocketService.initialize();

console.log(
  `🦊 Control API is running at ${app.server?.hostname}:${app.server?.port}`,
);
