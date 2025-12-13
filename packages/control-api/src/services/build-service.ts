import { db } from '../db';
import { builds, deployments } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { DeploymentService } from './deployment-service';

export const BuildService = {
  async create(data: {
    project_id: string;
    status: 'pending' | 'building' | 'success' | 'failed';
  }) {
    const result = await db.insert(builds).values(data).returning();
    const build = result[0];

    // Enqueue build job
    if (data.status === 'pending') {
      const { ProjectService } = await import('./project-service');
      const { EnvService } = await import('./env-service');
      const { JobQueue } = await import('../queue');

      const project = await ProjectService.getById(data.project_id);
      if (project) {
        const envVarsList = await EnvService.getAll(project.id);
        const envVars = envVarsList.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});

        await JobQueue.enqueue({
          build_id: build.id,
          project_id: project.id,
          github_url: project.github_url,
          build_command: project.build_command,
          root_directory: project.root_directory || './',
          app_type: project.app_type as 'nextjs' | 'vite',
          env_vars: envVars,
          installation_id: project.github_installation_id || undefined,
        });
      }
    }

    return build;
  },

  async getByProjectId(projectId: string) {
    return await db
      .select()
      .from(builds)
      .where(eq(builds.project_id, projectId))
      .orderBy(desc(builds.created_at));
  },

  async getById(id: string) {
    const result = await db.select().from(builds).where(eq(builds.id, id));
    return result[0] || null;
  },

  async updateStatus(
    id: string,
    status: 'pending' | 'building' | 'success' | 'failed',
    logs?: string,
    artifactId?: string,
  ) {
    const data: any = { status, updated_at: new Date() };
    if (logs) data.logs = logs;
    if (artifactId) data.artifact_id = artifactId;
    if (status === 'success' || status === 'failed') {
      data.completed_at = new Date();
    }

    const [updated] = await db
      .update(builds)
      .set({
        ...data, // Keep existing data fields
        status: status,
        completed_at: status === 'success' || status === 'failed' ? new Date() : null,
      })
      .where(eq(builds.id, id))
      .returning();

    // Auto-activate if it's the first successful build
    if (status === 'success' && updated) {
      const activeDeployments = await db
        .select()
        .from(deployments)
        .where(
          and(eq(deployments.project_id, updated.project_id), eq(deployments.status, 'active')),
        );

      if (activeDeployments.length === 0) {
        console.log(
          `[BuildService] No active deployments for project ${updated.project_id}. Auto-activating build ${id}.`,
        );
        try {
          // Import DeploymentService dynamically to avoid circular dependency if possible,
          // or ensure DeploymentService imports BuildService only for types or not at all.
          // Checking DeploymentService... it imports db and schema. It does NOT import BuildService.
          // So safe to import here.
          await DeploymentService.activateBuild(updated.project_id, id);
        } catch (e) {
          console.error(`[BuildService] Auto-activation failed:`, e);
        }
      }
    }

    return updated || null;
  },
};
