import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Files/directories that a package manager reads to discover a workspace root.
 * Used to distinguish a real monorepo workspace (root declared `workspaces` or a
 * tool-specific workspace manifest) from a repo that merely has a root
 * `package.json` with no workspaces at all.
 */
const WORKSPACE_MANIFESTS = [
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  'turbo.json',
  'nx.json',
  'lerna.json',
];

/**
 * Returns true when `dir` looks like a workspace root that dependencies must be
 * installed at before building an individual workspace member.
 *
 * A directory qualifies when either:
 *   - its `package.json` declares a non-empty `workspaces` field, or
 *   - it contains a known workspace manifest (pnpm/turbo/nx/lerna).
 */
export function isWorkspaceRoot(dir: string): boolean {
  const pkgPath = join(dir, 'package.json');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces = pkg?.workspaces;

      if (Array.isArray(workspaces) && workspaces.length > 0) {
        return true;
      }

      // Yarn/Bun also accept `{ packages: [...] }`
      if (
        workspaces &&
        typeof workspaces === 'object' &&
        Array.isArray(workspaces.packages) &&
        workspaces.packages.length > 0
      ) {
        return true;
      }
    } catch {
      // Malformed package.json - fall through to manifest checks
    }
  }

  return WORKSPACE_MANIFESTS.some((manifest) => existsSync(join(dir, manifest)));
}
