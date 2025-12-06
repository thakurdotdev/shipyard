import { Elysia, t } from "elysia";
import { BuildService } from "../services/build-service";
import { ProjectService } from "../services/project-service";
import { JobQueue } from "../queue";
import { LogService } from "../services/log-service";
import { WebSocketService } from "../ws";
import { EnvService } from "../services/env-service";

export const buildsRoutes = new Elysia()
  .group("/projects/:id/builds", (app) =>
    app
      .post("/", async ({ params: { id } }) => {
        const project = await ProjectService.getById(id);
        if (!project) throw new Error("Project not found");

        const build = await BuildService.create({
          project_id: id,
          status: "pending",
        });

        // Enqueue build job
        await JobQueue.enqueue({
          build_id: build.id,
          project_id: project.id,
          github_url: project.github_url,
          build_command: project.build_command,
          root_directory: project.root_directory || "./",
          app_type: project.app_type as "nextjs" | "vite",
          env_vars: await EnvService.getAsRecord(project.id),
        });

        return build;
      })
      .get("/", async ({ params: { id } }) => {
        return await BuildService.getByProjectId(id);
      }),
  )
  .group("/builds", (app) =>
    app
      .get("/:id", async ({ params: { id } }) => {
        const build = await BuildService.getById(id);
        if (!build) throw new Error("Build not found");
        return build;
      })
      .get("/:id/logs", async ({ params: { id } }) => {
        return await LogService.getLogs(id);
      })
      .post("/:id/logs", async ({ params: { id }, body }) => {
        const { logs } = body as { logs: string };
        await LogService.persist(id, logs);
        WebSocketService.broadcast(id, logs);
        return { success: true };
      })
      .put("/:id", async ({ params: { id }, body }) => {
        const { status } = body as { status: string };
        const updated = await BuildService.updateStatus(id, status as any);
        if (updated) {
          WebSocketService.broadcastBuildUpdate(updated.project_id, updated);
        }
        return updated;
      }),
  );
