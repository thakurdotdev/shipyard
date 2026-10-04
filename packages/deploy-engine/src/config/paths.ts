import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Shared filesystem layout for the deploy engine.
 *
 * BASE_DIR holds every deployed project's files:
 *   {BASE_DIR}/{projectId}/builds/{buildId}/extracted   --> built app (and repo root for monorepos)
 *   {BASE_DIR}/artifacts/{buildId}.tar.gz               --> legacy remote artifact uploads
 *   {BASE_DIR}/{projectId}/current -> builds/{buildId}/extracted
 *
 * Builds run inside the deploy engine and write straight into
 * {BASE_DIR}/{projectId}/builds/{buildId}/extracted, so no artifact copy is needed.
 *
 * IMPORTANT: the default lives OUTSIDE the platform repository on purpose. Frameworks
 * that infer a workspace root by walking up from the build dir (Next.js/Turbopack,
 * Vite, etc.) would otherwise discover the platform's own package.json/lockfile and
 * emit warnings or pick the wrong project root. Production deployments should pin this
 * via the BASE_DIR env var (e.g. /var/lib/shipyard/apps).
 */
export const BASE_DIR = process.env.BASE_DIR || join(homedir(), '.shipyard', 'apps');
export const ARTIFACTS_DIR = join(BASE_DIR, 'artifacts');

/**
 * Ensure the on-disk layout exists. Wraps mkdir in a clear error so a bad
 * BASE_DIR (missing permissions, read-only mount) fails fast with an
 * actionable message instead of a bare EACCES stack trace.
 */
function ensureDir(path: string): void {
  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  } catch (e: any) {
    const reason = e?.code === 'EACCES' || e?.code === 'EPERM' ? 'permission denied' : e?.message;
    throw new Error(
      `Cannot create directory "${path}" (${reason}). ` +
        `Fix it with one of: sudo mkdir -p "${path}" && sudo chown -R "$(id -un):$(id -gn)" "${path}", ` +
        `or point BASE_DIR at a writable directory.`,
    );
  }
}

// Ensure base dirs exist
ensureDir(BASE_DIR);
ensureDir(ARTIFACTS_DIR);

/** Absolute path to a project's directory. */
export function getProjectDir(projectId: string): string {
  return join(BASE_DIR, projectId);
}

/** Absolute path where a build's output lives (also the git clone root for monorepos). */
export function getBuildExtractDir(projectId: string, buildId: string): string {
  return join(getProjectDir(projectId), 'builds', buildId, 'extracted');
}
