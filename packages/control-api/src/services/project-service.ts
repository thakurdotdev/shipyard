import { db } from '../db';
import { projects } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { AppType } from '../config/framework-config';

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
    app_type: AppType;
    domain?: string;
    env_vars?: Record<string, string>;
    github_repo_id?: string;
    github_repo_full_name?: string;
    github_branch?: string;
    github_installation_id?: string;
    auto_deploy?: boolean;
  }) {
    // Determine next available port
    const resultMax = await db
      .select({ maxPort: sql<number>`MAX(${projects.port})` })
      .from(projects);

    const basePort = 8000;
    // Start checking from the highest assigned port + 1, or base port
    let nextPort = (resultMax[0]?.maxPort || basePort - 1) + 1;

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

      // Generate random suffix for uniqueness (4 chars: letters + numbers)
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const subdomain = `${slug}-${randomSuffix}`;
      const candidateDomain = `${subdomain}.${baseDomain}`;

      // Verify uniqueness (should virtually always be unique with random suffix)
      const { CloudflareService } = await import('./cloudflare-service');

      // 1. Check database
      const existingInDb = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.domain, candidateDomain))
        .limit(1);

      if (existingInDb.length > 0) {
        throw new Error(`Domain collision detected: ${candidateDomain} already exists in database`);
      }

      // 2. Check Cloudflare DNS
      try {
        const isAvailableInDns = await CloudflareService.checkSubdomain(subdomain);
        if (!isAvailableInDns) {
          throw new Error(`Domain collision detected: ${candidateDomain} already exists in DNS`);
        }
      } catch (error: any) {
        // If it's our own error, re-throw
        if (error.message.includes('Domain collision')) throw error;
        // Otherwise, log warning and proceed (Cloudflare check failed, but DB check passed)
        console.warn(`[ProjectService] Could not verify Cloudflare DNS:`, error.message);
      }

      domain = candidateDomain;
      console.log(`[ProjectService] Auto-generated unique domain: ${domain}`);
    }

    // Transactional Creation
    return await db.transaction(async (tx) => {
      const result = await tx
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
          auto_deploy: data.auto_deploy ?? true, // Default true
        })
        .returning();

      const projectId = result[0].id;

      // Save env vars if provided
      if (data.env_vars) {
        const { EnvService } = await import('./env-service');
        const { environmentVariables } = await import('../db/schema');

        for (const [key, value] of Object.entries(data.env_vars)) {
          // Encrypt using EnvService helper
          const encryptedValue = EnvService.encrypt(value);

          await tx.insert(environmentVariables).values({
            project_id: projectId,
            key,
            value: encryptedValue,
          });
        }
      }

      return result[0];
    });
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

    console.log(`[ProjectService] Deleting project ${id} (${project.name})...`);

    // 1. Get all builds for this project to clean up artifacts
    const { builds, deployments, environmentVariables } = await import('../db/schema');

    const projectBuilds = await db
      .select({ id: builds.id })
      .from(builds)
      .where(eq(builds.project_id, id));
    const buildIds = projectBuilds.map((b) => b.id);
    console.log(`[ProjectService] Found ${buildIds.length} builds to cleanup artifacts for.`);

    // 2. Call Deploy Engine to cleanup
    // WE ALWAYS CALL THIS, even if port is missing, to clean up artifacts/dirs
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    try {
      const subdomain =
        project.domain?.split('.')[0] ||
        project.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/^-+|-+$/g, '');

      console.log(`[ProjectService] Requesting Deploy Engine cleanup for ${id}...`);
      const res = await fetch(`${deployEngineUrl}/projects/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: project.port,
          subdomain,
          buildIds, // Send build IDs for artifact cleanup
        }),
      });

      if (!res.ok) {
        console.error(`[ProjectService] Deploy Engine cleanup failed with status: ${res.status}`);
      } else {
        console.log(`[ProjectService] Deploy Engine cleanup successful.`);
      }
    } catch (e) {
      console.error('[ProjectService] Failed to cleanup on Deploy Engine', e);
      // Continue with DB deletion even if cleanup fails
    }

    // 3. Cascade delete in DB
    console.log(`[ProjectService] Starting DB deletion...`);

    // Delete env vars
    await db.delete(environmentVariables).where(eq(environmentVariables.project_id, id));
    console.log(`[ProjectService] Deleted environment variables.`);

    // Delete deployments
    await db.delete(deployments).where(eq(deployments.project_id, id));
    console.log(`[ProjectService] Deleted deployments.`);

    // Delete builds
    await db.delete(builds).where(eq(builds.project_id, id));
    console.log(`[ProjectService] Deleted builds.`);

    // Delete project - use returning to verify it was deleted
    const deletedProject = await db.delete(projects).where(eq(projects.id, id)).returning();
    console.log(`[ProjectService] Deleted ${deletedProject.length} project record(s).`);

    if (deletedProject.length === 0) {
      console.error(`[ProjectService] Project ${id} was not deleted - delete returned 0 rows`);
      throw new Error('Failed to delete project from database');
    }

    console.log(`[ProjectService] DB deletion complete.`);

    // 4. Verification Check
    const verifyProject = await this.getById(id);
    if (verifyProject) {
      console.error(`[ProjectService] CRITICAL: Project ${id} still exists after deletion!`);
      throw new Error('Failed to delete project from database');
    }
    console.log(`[ProjectService] Verified project ${id} is gone from DB.`);

    return project;
  },
};
