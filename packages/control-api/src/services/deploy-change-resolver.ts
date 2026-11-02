import {
  getPackageJsonWorkspaces,
  isRepoRoot,
  normalizeRepoPath,
  parsePnpmWorkspacePackages,
  resolveDependencyClosure,
  selectWorkspaceDirectories,
  type WorkspacePackage,
} from './deploy-change-detection';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
/** GitHub's compare endpoint returns at most 300 files; at that size the list may be truncated. */
const COMPARE_FILE_LIMIT = 300;
/** Upper bound on workspace manifests fetched per push, to bound API usage. */
const MAX_WORKSPACE_PACKAGES = 300;
const FETCH_CONCURRENCY = 8;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChangeSet {
  /** null = unknown; caller must fail open. */
  files: string[] | null;
  source: 'compare' | 'payload' | 'none';
  detail?: string;
}

/**
 * Per-push, per-repository GitHub reader. All lookups are memoised so several
 * projects connected to the same monorepo share API calls within one webhook.
 */
export class RepoChangeResolver {
  private readonly compareCache = new Map<string, Promise<ChangeSet>>();
  private readonly fileCache = new Map<string, Promise<string | null>>();
  private treeCache: Promise<{ paths: string[]; truncated: boolean }> | null = null;
  private workspaceCache: Promise<WorkspacePackage[] | null> | null = null;

  constructor(
    private readonly token: string,
    private readonly repoFullName: string,
    private readonly headSha: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
    return this.fetchImpl(`${GITHUB_API}/repos/${this.repoFullName}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /**
   * Files changed between `baseSha` (what is currently deployed) and the pushed head.
   * Includes the previous path of renamed files, since moving a file out of a watched
   * directory affects that project too.
   */
  compare(baseSha: string): Promise<ChangeSet> {
    let cached = this.compareCache.get(baseSha);
    if (!cached) {
      cached = this.fetchCompare(baseSha);
      this.compareCache.set(baseSha, cached);
    }
    return cached;
  }

  private async fetchCompare(baseSha: string): Promise<ChangeSet> {
    try {
      const res = await this.request(
        `/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(this.headSha)}?per_page=1`,
      );
      if (!res.ok) {
        return { files: null, source: 'compare', detail: `compare API returned ${res.status}` };
      }
      const data: any = await res.json();
      // "diverged" (force push / history rewrite) or "behind" (rollback) cannot be
      // summarised by a forward diff of the deployed commit, so treat as unknown.
      if (data.status !== 'ahead') {
        return { files: null, source: 'compare', detail: `history ${data.status}` };
      }
      const files: any[] = Array.isArray(data.files) ? data.files : [];
      if (files.length >= COMPARE_FILE_LIMIT) {
        return { files: null, source: 'compare', detail: 'change set too large to inspect' };
      }
      const paths = new Set<string>();
      for (const file of files) {
        if (typeof file?.filename === 'string') paths.add(file.filename);
        if (typeof file?.previous_filename === 'string') paths.add(file.previous_filename);
      }
      return { files: [...paths], source: 'compare' };
    } catch (e) {
      return { files: null, source: 'compare', detail: `compare failed: ${String(e)}` };
    }
  }

  /** Raw file content at the pushed head, or null when missing. Throws on API errors. */
  private readFile(path: string): Promise<string | null> {
    let cached = this.fileCache.get(path);
    if (!cached) {
      cached = (async () => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const res = await this.request(
          `/contents/${encoded}?ref=${encodeURIComponent(this.headSha)}`,
          'application/vnd.github.raw+json',
        );
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`contents API returned ${res.status} for ${path}`);
        return res.text();
      })();
      this.fileCache.set(path, cached);
    }
    return cached;
  }

  private readTree(): Promise<{ paths: string[]; truncated: boolean }> {
    if (!this.treeCache) {
      this.treeCache = (async () => {
        const res = await this.request(
          `/git/trees/${encodeURIComponent(this.headSha)}?recursive=1`,
        );
        if (!res.ok) throw new Error(`tree API returned ${res.status}`);
        const data: any = await res.json();
        const paths = (Array.isArray(data.tree) ? data.tree : [])
          .filter((entry: any) => entry?.type === 'blob' && typeof entry.path === 'string')
          .map((entry: any) => entry.path as string);
        return { paths, truncated: Boolean(data.truncated) };
      })();
    }
    return this.treeCache;
  }

  /** All JS workspace packages at head; [] when the repo is not a workspace; null on failure. */
  private loadWorkspacePackages(): Promise<WorkspacePackage[] | null> {
    if (!this.workspaceCache) {
      this.workspaceCache = (async () => {
        try {
          const [rootManifest, pnpmWorkspace] = await Promise.all([
            this.readFile('package.json'),
            this.readFile('pnpm-workspace.yaml'),
          ]);
          const globs = [
            ...(rootManifest ? getPackageJsonWorkspaces(JSON.parse(rootManifest)) : []),
            ...(pnpmWorkspace ? parsePnpmWorkspacePackages(pnpmWorkspace) : []),
          ];
          if (globs.length === 0) return [];

          const tree = await this.readTree();
          if (tree.truncated) return null;
          const manifestDirs = tree.paths
            .filter((p) => p === 'package.json' || p.endsWith('/package.json'))
            .map((p) => (p === 'package.json' ? '' : p.slice(0, -'/package.json'.length)));
          const dirs = selectWorkspaceDirectories(manifestDirs, globs);
          if (dirs.length > MAX_WORKSPACE_PACKAGES) return null;

          const packages: WorkspacePackage[] = [];
          for (let i = 0; i < dirs.length; i += FETCH_CONCURRENCY) {
            const batch = dirs.slice(i, i + FETCH_CONCURRENCY);
            const contents = await Promise.all(
              batch.map((dir) => this.readFile(`${dir}/package.json`)),
            );
            batch.forEach((dir, index) => {
              const content = contents[index];
              if (!content) return;
              try {
                packages.push({ dir, manifest: JSON.parse(content) });
              } catch {
                // An unparseable manifest cannot be a resolvable dependency; skip it.
              }
            });
          }
          return packages;
        } catch (e) {
          console.warn(`[DeployFilter] Workspace resolution failed for ${this.repoFullName}`, e);
          return null;
        }
      })();
    }
    return this.workspaceCache;
  }

  /**
   * Directories of internal workspace packages the project (transitively) depends on.
   * Returns [] for non-workspace repos or root-level projects, null when unknown.
   */
  async dependencyDirectories(rootDirectory: string | null | undefined): Promise<string[] | null> {
    if (isRepoRoot(rootDirectory)) return [];
    const projectDir = normalizeRepoPath(rootDirectory!);
    const packages = await this.loadWorkspacePackages();
    if (packages === null) return null;
    if (packages.length === 0) return [];
    if (!packages.some((pkg) => pkg.dir === projectDir)) {
      // The project lives in the repo but is not a workspace member; if it has its
      // own manifest, read it so workspace deps it references are still tracked.
      try {
        const own = await this.readFile(`${projectDir}/package.json`);
        if (!own) return [];
        return resolveDependencyClosure(projectDir, [
          ...packages,
          { dir: projectDir, manifest: JSON.parse(own) },
        ]);
      } catch {
        return null;
      }
    }
    return resolveDependencyClosure(projectDir, packages);
  }
}
