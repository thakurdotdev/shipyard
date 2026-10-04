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

// Ensure base dirs exist
if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

/** Absolute path to a project's directory. */
export function getProjectDir(projectId: string): string {
  return join(BASE_DIR, projectId);
}

/** Absolute path where a build's output lives (also the git clone root for monorepos). */
export function getBuildExtractDir(projectId: string, buildId: string): string {
  return join(getProjectDir(projectId), 'builds', buildId, 'extracted');
}
