import { Elysia, t } from "elysia";
import { DeploymentService } from "../services/deployment-service";
import { BuildService } from "../services/build-service";

export const deploymentsRoutes = new Elysia().group("/deploy", (app) =>
  app.post("/build/:id/activate", async ({ params: { id } }) => {
    const build = await BuildService.getById(id);
    if (!build) throw new Error("Build not found");

    await DeploymentService.activateBuild(build.project_id, build.id);
    return { success: true };
  }),
);
