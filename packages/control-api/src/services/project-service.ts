import { db } from '../db';
import { projects } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

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
    app_type: 'nextjs' | 'vite';
    domain?: string;
    env_vars?: Record<string, string>;
    github_repo_id?: string;
    github_repo_full_name?: string;
    github_branch?: string;
    github_installation_id?: string;
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
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';

    while (true) {
      let available = false;
      try {
        const res = await fetch(`${deployEngineUrl}/ports/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: nextPort }),
        });
        if (res.ok) {
          const data = (await res.json()) as { available: boolean };
          available = data.available;
        }
      } catch (e) {
        console.error('Failed to check port availability on Deploy Engine', e);
        throw new Error('Deploy Engine unreachable for port check');
      }

      if (available) {
        break;
      }
      console.log(`Port ${nextPort} is in use on Deploy Engine, checking next...`);
      nextPort++;
    }

    // Determine domain (Auto-generate in Production if missing)
    let domain = data.domain?.trim() || null;
    if (process.env.NODE_ENV === 'production' && !domain) {
      const baseDomain = process.env.BASE_DOMAIN || 'thakur.dev';
      const slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '');
      domain = `${slug}.${baseDomain}`;
    }

    const result = await db
      .insert(projects)
      .values({
        name: data.name,
        github_url: data.github_url,
        build_command: data.build_command,
        app_type: data.app_type,
        root_directory: data.root_directory,
        domain: domain,
        port: nextPort,
        github_repo_id: data.github_repo_id,
        github_repo_full_name: data.github_repo_full_name,
        github_branch: data.github_branch || 'main',
        github_installation_id: data.github_installation_id,
      })
      .returning();

    const projectId = result[0].id;

    // Save env vars if provided
    if (data.env_vars) {
      const { EnvService } = await import('./env-service');
      for (const [key, value] of Object.entries(data.env_vars)) {
        await EnvService.create(projectId, key, value);
      }
    }

    return result[0];
  },

  async update(id: string, data: Partial<typeof projects.$inferInsert>) {
    const updateData = { ...data };
    const domain = updateData.domain;
    if (typeof domain === 'string' && domain.trim() === '') {
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

    // 1. Get all builds for this project to clean up artifacts
    const { builds, deployments, environmentVariables } = await import('../db/schema');

    const projectBuilds = await db
      .select({ id: builds.id })
      .from(builds)
      .where(eq(builds.project_id, id));
    const buildIds = projectBuilds.map((b) => b.id);

    // 2. Call Deploy Engine to cleanup
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    try {
      if (project.port) {
        const subdomain =
          project.domain?.split('.')[0] ||
          project.name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/^-+|-+$/g, '');

        await fetch(`${deployEngineUrl}/projects/${id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            port: project.port,
            subdomain,
            buildIds, // Send build IDs for artifact cleanup
          }),
        });
      }
    } catch (e) {
      console.error('Failed to cleanup on Deploy Engine', e);
      // Continue with DB deletion even if cleanup fails
    }

    // 3. Cascade delete in DB

    await db.transaction(async (tx) => {
      // Delete env vars
      await tx.delete(environmentVariables).where(eq(environmentVariables.project_id, id));
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
