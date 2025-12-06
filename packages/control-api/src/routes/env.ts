import { Elysia, t } from "elysia";
import { EnvService } from "../services/env-service";

export const envRoutes = new Elysia({ prefix: "/projects/:id/env" })
  .get("/", async ({ params: { id } }) => {
    return await EnvService.getAll(id);
  })
  .post(
    "/",
    async ({ params: { id }, body }) => {
      return await EnvService.create(id, body.key, body.value);
    },
    {
      body: t.Object({
        key: t.String(),
        value: t.String(),
      }),
    },
  )
  .delete("/:key", async ({ params: { id, key } }) => {
    await EnvService.delete(id, key);
    return { success: true };
  });
