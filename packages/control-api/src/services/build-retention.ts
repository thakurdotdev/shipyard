/**
 * Build retention: after a successful deploy, delete builds beyond the newest
 * `keep_builds` for that project. Opt-in per project; null keeps every build.
 */

export const MIN_KEEP_BUILDS = 2;
export const MAX_KEEP_BUILDS = 50;

interface RetentionBuild {
  id: string;
  status: string;
  created_at: Date | string;
}

/**
 * Returns the ids of builds to delete. Keeps the newest `keep` builds, and
 * always keeps the live build and anything still queued or building,
 * whatever their age.
 */
export function selectBuildsToPrune(
  builds: RetentionBuild[],
  keep: number | null | undefined,
  activeBuildId: string | null | undefined,
): string[] {
  if (keep == null || !Number.isInteger(keep) || keep < MIN_KEEP_BUILDS) return [];

  const newestFirst = [...builds].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return newestFirst
    .slice(keep)
    .filter(
      (build) =>
        build.id !== activeBuildId && build.status !== 'pending' && build.status !== 'building',
    )
    .map((build) => build.id);
}

/**
 * Deletes a project's builds beyond its retention limit, one at a time through
 * BuildService.delete so disk cleanup and its safety checks still apply.
 * Best-effort: a failure is logged and the rest continue.
 */
export async function pruneProjectBuilds(projectId: string, activeBuildId: string) {
  // Imported lazily: build-service imports deployment-service, which calls this.
  const { db } = await import('../db');
  const { builds, projects } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const { BuildService } = await import('./build-service');
  const { EventStreamService } = await import('./event-stream-service');

  const [project] = await db
    .select({ keep_builds: projects.keep_builds })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project?.keep_builds) return [];

  const projectBuilds = await db
    .select({ id: builds.id, status: builds.status, created_at: builds.created_at })
    .from(builds)
    .where(eq(builds.project_id, projectId));

  const doomed = selectBuildsToPrune(projectBuilds, project.keep_builds, activeBuildId);
  const deleted: string[] = [];
  for (const id of doomed) {
    try {
      if (await BuildService.delete(id)) {
        deleted.push(id);
        EventStreamService.broadcastBuildUpdate(projectId, { id, deleted: true });
      }
    } catch (error) {
      console.error(`[BuildRetention] Could not delete build ${id}:`, error);
    }
  }
  if (deleted.length > 0) {
    console.log(
      `[BuildRetention] Project ${projectId}: deleted ${deleted.length} build(s) beyond the newest ${project.keep_builds}`,
    );
  }
  return deleted;
}
