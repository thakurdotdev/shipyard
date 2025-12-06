import { Elysia, t } from "elysia";
import { DeployService } from "./services/deploy-service";

import { isPortAvailable } from "./utils/port";

const app = new Elysia()
  .post("/ports/check", async ({ body }) => {
    const { port } = body as { port: number };
    if (!port) return new Response("Port required", { status: 400 });
    const available = await isPortAvailable(port);
    return { available };
  })
  .post("/artifacts/upload", async ({ query, request }) => {
    const buildId = query.buildId;
    if (!buildId) return new Response("Missing buildId", { status: 400 });

    if (!request.body) return new Response("Missing body", { status: 400 });

    return await DeployService.receiveArtifact(buildId, request.body);
  })
  .post(
    "/activate",
    async ({ body }: { body: any }) => {
      const { projectId, buildId, port, appType } = body;

      try {
        await DeployService.activateDeployment(
          projectId,
          buildId,
          port,
          appType,
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
        appType: t.Union([t.Literal("nextjs"), t.Literal("vite")]),
      }),
    },
  )
  .post(
    "/stop",
    async ({ body }: { body: any }) => {
      const { port } = body;
      try {
        await DeployService.stopDeployment(port);
        return { success: true };
      } catch (e: any) {
        return new Response(e.message, { status: 500 });
      }
    },
    {
      body: t.Object({
        port: t.Number(),
      }),
    },
  )
  .post("/projects/:id/delete", async ({ params: { id }, body }) => {
    const { port } = body as { port?: number };
    try {
      await DeployService.deleteProject(id, port);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  })
  .get("/*", ({ request }) => {
    return DeployService.serveRequest(request);
  })
  .listen(4002);

console.log(
  `🚀 Deploy Engine is running at ${app.server?.hostname}:${app.server?.port}`,
);
