import { db } from "../db";
import { projects } from "../db/schema";
import { eq, sql } from "drizzle-orm";

export const ProjectService = {
  async getAll() {
    return await db.select().from(projects);
  },

  async getById(id: string) {
    const result = await db.select().from(projects).where(eq(projects.id, id));
    return result[0] || null;
  },

  async create(data: {
    name: string;
    github_url: string;
    root_directory?: string;
    build_command: string;
    app_type: "nextjs" | "vite";
    domain?: string;
    env_vars?: Record<string, string>;
  }) {
    // Determine next available port
    const resultMax = await db
      .select({ maxPort: sql<number>`MAX(${projects.port})` })
      .from(projects);

    const basePort = 8000;
    // Start checking from the highest assigned port + 1, or base port
    let nextPort = (resultMax[0]?.maxPort || basePort - 1) + 1;

    // Check availability loop
    // Check availability loop
    const deployEngineUrl =
      process.env.DEPLOY_ENGINE_URL || "http://localhost:4002";

    while (true) {
      let available = false;
      try {
        const res = await fetch(`${deployEngineUrl}/ports/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port: nextPort }),
        });
        if (res.ok) {
          const data = (await res.json()) as { available: boolean };
          available = data.available;
        }
      } catch (e) {
        console.error("Failed to check port availability on Deploy Engine", e);
        throw new Error("Deploy Engine unreachable for port check");
      }

      if (available) {
        break;
      }
      console.log(
        `Port ${nextPort} is in use on Deploy Engine, checking next...`,
      );
      nextPort++;
    }

    const result = await db
      .insert(projects)
      .values({
        name: data.name,
        github_url: data.github_url,
        build_command: data.build_command,
        app_type: data.app_type,
        root_directory: data.root_directory,
        domain: data.domain?.trim() || null,
        port: nextPort,
      })
      .returning();

    const projectId = result[0].id;

    // Save env vars if provided
    if (data.env_vars) {
      const { EnvService } = await import("./env-service");
      for (const [key, value] of Object.entries(data.env_vars)) {
        await EnvService.create(projectId, key, value);
      }
    }

    return result[0];
  },

  async update(id: string, data: Partial<typeof projects.$inferInsert>) {
    const updateData = { ...data };
    const domain = updateData.domain;
    if (typeof domain === "string" && domain.trim() === "") {
      updateData.domain = null;
    }
    const result = await db
      .update(projects)
      .set({ ...updateData, updated_at: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return result[0] || null;
  },

  async delete(id: string) {
    const project = await this.getById(id);
    if (!project) return null;

    // 1. Call Deploy Engine to cleanup
    const deployEngineUrl =
      process.env.DEPLOY_ENGINE_URL || "http://localhost:4002";
    try {
      if (project.port) {
        const subdomain = project.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/^-+|-+$/g, "");
        await fetch(`${deployEngineUrl}/projects/${id}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port: project.port, subdomain }),
        });
      }
    } catch (e) {
      console.error("Failed to cleanup on Deploy Engine", e);
      // Continue with DB deletion even if cleanup fails?
      // Yes, otherwise user is stuck.
    }

    // 2. Cascade delete in DB
    // Assuming no CASCADE constraint in DB, we do it manually or rely on Drizzle if configured.
    // Schema didn't explicitly show ON DELETE CASCADE, so safe to manual delete.
    // Actually, let's check schema imports.
    // We need to import tables.
    const { builds, deployments, environmentVariables } = await import(
      "../db/schema"
    );

    await db.transaction(async (tx) => {
      // Delete env vars
      await tx
        .delete(environmentVariables)
        .where(eq(environmentVariables.project_id, id));
      // Delete deployments
      await tx.delete(deployments).where(eq(deployments.project_id, id));
      // Delete builds
      await tx.delete(builds).where(eq(builds.project_id, id));
      // Delete project
      await tx.delete(projects).where(eq(projects.id, id));
    });

    return project;
  },
};
