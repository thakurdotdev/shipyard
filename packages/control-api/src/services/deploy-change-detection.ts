/**
 * Pure logic for monorepo-aware auto deploys ("build filters").
 *
 * Filtering is opt-in per project via `projects.auto_deploy_paths`. When it is
 * blank every push deploys (the historical behaviour). When it is set, a push
 * only deploys if a changed file matches the project's watch set:
 *
 *   1. the project's root directory (when it is not the repo root),
 *   2. the root directories of internal workspace packages the project depends
 *      on (resolved transitively, see workspace-dependency-resolver.ts),
 *   3. repo-root build inputs (lockfiles, workspace manifests, toolchain pins),
 *   4. the user's own patterns, evaluated last in order, gitignore-style:
 *      `apps/web`, `packages/*`, `**\/*.graphql`, and `!docs/**` to exclude.
 *
 * Every "we cannot be sure" path fails open (build), so a filter can only ever
 * save builds, never leave a deployment silently stale.
 */

export const MAX_WATCH_PATTERNS = 50;
export const MAX_WATCH_PATTERN_LENGTH = 255;

/** Files at the repository root that can change any workspace's install or build. */
export const ROOT_BUILD_INPUTS = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  '.yarnrc.yml',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lock',
  'bun.lockb',
  'bunfig.toml',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.tool-versions',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'go.work',
  'go.work.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'composer.json',
  'composer.lock',
];

export function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** True when a project root directory refers to the repository root. */
export function isRepoRoot(rootDirectory: string | null | undefined): boolean {
  const normalized = normalizeRepoPath(rootDirectory ?? '');
  return normalized === '' || normalized === '.';
}

/**
 * Validate and canonicalise user-entered patterns for storage.
 * Accepts newline or comma separated input. Returns null when empty (filter off).
 * Throws a user-facing Error for invalid input.
 */
export function normalizeWatchPatternsInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const patterns: string[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    const body = normalizeRepoPath(negated ? trimmed.slice(1) : trimmed);
    if (!body || body === '.') {
      throw new Error(`Invalid deploy path "${trimmed}": use a repository-relative path`);
    }
    if (body.split('/').some((segment) => segment === '..')) {
      throw new Error(`Invalid deploy path "${trimmed}": ".." is not allowed`);
    }
    if (body.length > MAX_WATCH_PATTERN_LENGTH) {
      throw new Error(`Deploy path "${trimmed.slice(0, 40)}…" is too long`);
    }
    try {
      globToRegExp(body);
    } catch {
      throw new Error(`Invalid deploy path "${trimmed}": malformed glob pattern`);
    }
    const pattern = negated ? `!${body}` : body;
    if (!patterns.includes(pattern)) patterns.push(pattern);
  }
  if (patterns.length > MAX_WATCH_PATTERNS) {
    throw new Error(`At most ${MAX_WATCH_PATTERNS} deploy paths are allowed`);
  }
  if (patterns.length > 0 && patterns.every((p) => p.startsWith('!'))) {
    throw new Error('Add at least one path to watch; exclusions (!) only narrow watched paths');
  }
  return patterns.length ? patterns.join('\n') : null;
}

/** Split stored patterns; tolerant of legacy/unnormalised values. */
export function parseWatchPatterns(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return stored
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) =>
      line.startsWith('!') ? `!${normalizeRepoPath(line.slice(1))}` : normalizeRepoPath(line),
    )
    .filter((line) => line && line !== '!');
}

const regexCache = new Map<string, RegExp>();

/**
 * Convert a glob to an anchored RegExp. Supports `*` (within a segment),
 * `**` (any number of segments), `?`, and `{a,b}` alternatives.
 */
export function globToRegExp(glob: string): RegExp {
  const cached = regexCache.get(glob);
  if (cached) return cached;

  let source = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const atSegmentEnd = i + 2 === glob.length || glob[i + 2] === '/';
        i++;
        if (atSegmentStart && glob[i + 1] === '/') {
          source += '(?:.*/)?'; // `**/` matches zero or more directories
          i++;
        } else if (atSegmentStart && atSegmentEnd) {
          source += '.*';
        } else {
          source += '[^/]*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      braceDepth++;
      source += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth--;
      source += ')';
    } else if (char === ',' && braceDepth > 0) {
      source += '|';
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${source}$`);
  regexCache.set(glob, regex);
  return regex;
}

const GLOB_CHARS = /[*?{]/;

/**
 * Whether `pattern` matches `path` or one of its ancestor directories
 * (so `apps/web` and `apps/*` both match `apps/web/src/index.ts`).
 */
export function patternMatchesPath(pattern: string, path: string): boolean {
  if (!GLOB_CHARS.test(pattern)) {
    return path === pattern || path.startsWith(`${pattern}/`);
  }
  const regex = globToRegExp(pattern);
  if (regex.test(path)) return true;
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    if (regex.test(path.slice(0, i))) return true;
  }
  return false;
}

/** Gitignore-style evaluation: the last matching pattern wins; `!` excludes. */
export function matchesWatchSet(patterns: string[], path: string): boolean {
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    if (matched === !negated) continue; // cannot change the outcome
    if (patternMatchesPath(body, path)) matched = !negated;
  }
  return matched;
}

export interface DeployFilterInput {
  /** Stored `auto_deploy_paths`. Blank disables filtering. */
  configuredPatterns: string | null | undefined;
  /** The project's root directory (`./` means repository root). */
  rootDirectory: string | null | undefined;
  /**
   * Changed paths between the deployed commit and the pushed commit.
   * `null` means the change set is unknown (truncated, force push, API error).
   */
  changedFiles: string[] | null;
  /**
   * Root directories of internal workspace packages the project depends on.
   * `null` means resolution failed, so dependencies are unknown.
   */
  dependencyDirectories: string[] | null;
}

export interface DeployFilterDecision {
  shouldBuild: boolean;
  reason: string;
  /** First changed file that triggered the build, when applicable. */
  matchedFile?: string;
}

/** Build the ordered watch set: implicit inputs first, user patterns last so `!` can override. */
export function buildWatchSet(
  configured: string[],
  rootDirectory: string | null | undefined,
  dependencyDirectories: string[],
): string[] {
  const implicit = [...ROOT_BUILD_INPUTS];
  if (!isRepoRoot(rootDirectory)) implicit.push(normalizeRepoPath(rootDirectory!));
  for (const dir of dependencyDirectories) {
    const normalized = normalizeRepoPath(dir);
    if (normalized) implicit.push(normalized);
  }
  return [...implicit, ...configured];
}

export function evaluateDeployFilter(input: DeployFilterInput): DeployFilterDecision {
  const configured = parseWatchPatterns(input.configuredPatterns);
  if (configured.length === 0) {
    return { shouldBuild: true, reason: 'Path filtering disabled' };
  }
  if (input.changedFiles === null) {
    return { shouldBuild: true, reason: 'Changed files unknown; building to be safe' };
  }
  if (input.changedFiles.length === 0) {
    // e.g. `git commit --allow-empty -m "redeploy"`: an explicit request to deploy.
    return { shouldBuild: true, reason: 'Push contains no file changes (empty commit)' };
  }
  if (input.dependencyDirectories === null) {
    return { shouldBuild: true, reason: 'Workspace dependencies unknown; building to be safe' };
  }

  const watchSet = buildWatchSet(configured, input.rootDirectory, input.dependencyDirectories);
  for (const file of input.changedFiles) {
    const path = normalizeRepoPath(file);
    if (path && matchesWatchSet(watchSet, path)) {
      return { shouldBuild: true, reason: `Watched path changed: ${path}`, matchedFile: path };
    }
  }
  return {
    shouldBuild: false,
    reason: `None of ${input.changedFiles.length} changed file(s) affect this project`,
  };
}

const ZERO_SHA = /^0+$/;

/**
 * Changed files described by a push payload itself (before..after).
 * Returns null when the payload cannot describe the change set reliably.
 */
export function getPushChangedFiles(payload: any): string[] | null {
  if (payload?.forced || payload?.created || payload?.deleted) return null;
  if (typeof payload?.before !== 'string' || ZERO_SHA.test(payload.before)) return null;
  const commits = Array.isArray(payload?.commits) ? payload.commits : null;
  // GitHub caps push webhook commit lists at 2048; at the cap the set may be partial.
  if (!commits || commits.length === 0 || commits.length >= 2048) return null;

  const files = new Set<string>();
  for (const commit of commits) {
    for (const field of ['added', 'modified', 'removed']) {
      const list = commit?.[field];
      if (!Array.isArray(list)) return null;
      for (const path of list) {
        if (typeof path === 'string') files.add(path);
      }
    }
  }
  return [...files];
}

/** Parse the `packages:` list of a pnpm-workspace.yaml without a YAML dependency. */
export function parsePnpmWorkspacePackages(yaml: string): string[] {
  const result: string[] = [];
  let inPackages = false;
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      const inline = line.match(/\[(.*)\]/);
      if (inline) {
        result.push(...inline[1].split(',').map(unquote).filter(Boolean));
        inPackages = false;
      }
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s*(.+)$/);
      if (item) result.push(unquote(item[1]));
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return result.filter(Boolean);
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

/** Workspace globs from a root package.json (npm, yarn, bun). */
export function getPackageJsonWorkspaces(pkg: any): string[] {
  const workspaces = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return Array.isArray(workspaces) ? workspaces.filter((w: unknown) => typeof w === 'string') : [];
}

/** Directories (containing package.json) selected by workspace globs. */
export function selectWorkspaceDirectories(
  packageJsonDirectories: string[],
  workspaceGlobs: string[],
): string[] {
  const globs = workspaceGlobs.map((g) =>
    g.startsWith('!') ? `!${normalizeRepoPath(g.slice(1))}` : normalizeRepoPath(g),
  );
  return packageJsonDirectories.filter((dir) => {
    if (!dir || dir.split('/').includes('node_modules')) return false;
    let included = false;
    for (const glob of globs) {
      const negated = glob.startsWith('!');
      const body = negated ? glob.slice(1) : glob;
      if (body && globToRegExp(body).test(dir)) included = !negated;
    }
    return included;
  });
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export interface WorkspacePackage {
  dir: string;
  manifest: any;
}

/** Transitive internal dependency directories of `projectDir` (excluding itself). */
export function resolveDependencyClosure(
  projectDir: string,
  packages: WorkspacePackage[],
): string[] {
  const byName = new Map<string, WorkspacePackage>();
  for (const pkg of packages) {
    if (typeof pkg.manifest?.name === 'string') byName.set(pkg.manifest.name, pkg);
  }
  const start = packages.find((pkg) => pkg.dir === projectDir);
  if (!start) return [];

  const visited = new Set<string>([start.dir]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const field of DEPENDENCY_FIELDS) {
      const deps = current.manifest?.[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const name of Object.keys(deps)) {
        const dep = byName.get(name);
        if (dep && !visited.has(dep.dir)) {
          visited.add(dep.dir);
          queue.push(dep);
        }
      }
    }
  }
  visited.delete(start.dir);
  return [...visited].sort();
}
