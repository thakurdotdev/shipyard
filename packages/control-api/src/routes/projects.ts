import { Elysia, t } from "elysia";
import { ProjectService } from "../services/project-service";
import { SecurityService } from "../services/security-service";
import { db } from "../db";
import { deployments } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { DeploymentService } from "../services/deployment-service";

export const projectsRoutes = new Elysia({ prefix: "/projects" })
  .get("/", async () => {
    return await ProjectService.getAll();
  })
  .post(
    "/",
    async ({ body }) => {
      try {
        SecurityService.validateBuildCommand(body.build_command);
        return await ProjectService.create(body);
      } catch (e: any) {
        return new Response(e.message, { status: 400 });
      }
    },
    {
      body: t.Object({
        name: t.String(),
        github_url: t.String(),
        build_command: t.String(),
        app_type: t.Union([t.Literal("nextjs"), t.Literal("vite")]),
        root_directory: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        env_vars: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )
  .get("/:id", async ({ params: { id } }) => {
    const project = await ProjectService.getById(id);
    if (!project) throw new Error("Project not found");
    return project;
  })
  .put(
    "/:id",
    async ({ params: { id }, body }) => {
      try {
        if (body.build_command) {
          SecurityService.validateBuildCommand(body.build_command);
        }
        return await ProjectService.update(id, body);
      } catch (e: any) {
        return new Response(e.message, { status: 400 });
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        github_url: t.Optional(t.String()),
        build_command: t.Optional(t.String()),
        app_type: t.Optional(t.Union([t.Literal("nextjs"), t.Literal("vite")])),
        domain: t.Optional(t.String()),
      }),
    },
  )
  .delete("/:id", async ({ params: { id } }) => {
    return await ProjectService.delete(id);
  })
  .get("/:id/deployment", async ({ params: { id } }) => {
    const deployment = await db.query.deployments.findFirst({
      where: and(
        eq(deployments.project_id, id),
        eq(deployments.status, "active"),
      ),
    });
    if (!deployment) return null;
    return deployment;
  })
  .post("/:id/stop", async ({ params: { id } }) => {
    try {
      await DeploymentService.stop(id);
      return { success: true };
    } catch (e: any) {
      return new Response(e.message, { status: 400 });
    }
  });
