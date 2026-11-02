import { describe, expect, it } from 'bun:test';
import {
  evaluateDeployFilter,
  getPushChangedFiles,
  matchesWatchSet,
  normalizeWatchPatternsInput,
  parsePnpmWorkspacePackages,
  patternMatchesPath,
  resolveDependencyClosure,
  selectWorkspaceDirectories,
} from './deploy-change-detection';
import { RepoChangeResolver } from './deploy-change-resolver';

const base = { rootDirectory: 'apps/web', dependencyDirectories: [] as string[] };

describe('normalizeWatchPatternsInput', () => {
  it('returns null for blank input (filter disabled)', () => {
    expect(normalizeWatchPatternsInput('')).toBeNull();
    expect(normalizeWatchPatternsInput('  \n # comment \n')).toBeNull();
    expect(normalizeWatchPatternsInput(null)).toBeNull();
  });

  it('canonicalises and de-duplicates', () => {
    expect(normalizeWatchPatternsInput('./apps/web/\n/apps/web, packages\\ui\n!docs/')).toBe(
      'apps/web\npackages/ui\n!docs',
    );
  });

  it('rejects traversal, root-only and exclusion-only input', () => {
    expect(() => normalizeWatchPatternsInput('../secret')).toThrow();
    expect(() => normalizeWatchPatternsInput('.')).toThrow();
    expect(() => normalizeWatchPatternsInput('!docs')).toThrow();
  });
});

describe('pattern matching', () => {
  it('treats plain paths as file-or-directory prefixes', () => {
    expect(patternMatchesPath('apps/web', 'apps/web/src/a.ts')).toBe(true);
    expect(patternMatchesPath('apps/web', 'apps/web')).toBe(true);
    expect(patternMatchesPath('apps/web', 'apps/website/a.ts')).toBe(false);
  });

  it('supports globs', () => {
    expect(patternMatchesPath('packages/*', 'packages/ui/src/a.ts')).toBe(true);
    expect(patternMatchesPath('**/*.graphql', 'schema/x/y.graphql')).toBe(true);
    expect(patternMatchesPath('**/*.graphql', 'y.graphql')).toBe(true);
    expect(patternMatchesPath('apps/**/*.{ts,tsx}', 'apps/web/a.tsx')).toBe(true);
    expect(patternMatchesPath('apps/**/*.{ts,tsx}', 'apps/web/a.md')).toBe(false);
  });

  it('lets later exclusions override earlier inclusions', () => {
    const set = ['apps/web', '!apps/web/**/*.md', 'apps/web/CHANGELOG.md'];
    expect(matchesWatchSet(set, 'apps/web/src/a.ts')).toBe(true);
    expect(matchesWatchSet(set, 'apps/web/README.md')).toBe(false);
    expect(matchesWatchSet(set, 'apps/web/CHANGELOG.md')).toBe(true);
  });
});

describe('evaluateDeployFilter', () => {
  it('always builds when filtering is disabled', () => {
    const d = evaluateDeployFilter({
      ...base,
      configuredPatterns: null,
      changedFiles: ['docs/a.md'],
    });
    expect(d.shouldBuild).toBe(true);
  });

  it('skips when nothing relevant changed', () => {
    const d = evaluateDeployFilter({
      ...base,
      configuredPatterns: 'packages/shared',
      changedFiles: ['apps/api/src/index.ts', 'docs/readme.md', 'apps/api/package.json'],
    });
    expect(d.shouldBuild).toBe(false);
  });

  it('implicitly watches the project root directory', () => {
    const d = evaluateDeployFilter({
      ...base,
      configuredPatterns: 'packages/shared',
      changedFiles: ['apps/web/src/page.tsx'],
    });
    expect(d).toMatchObject({ shouldBuild: true, matchedFile: 'apps/web/src/page.tsx' });
  });

  it('watches root lockfiles/manifests but not other apps’ manifests', () => {
    const input = { ...base, configuredPatterns: 'apps/web' };
    expect(evaluateDeployFilter({ ...input, changedFiles: ['bun.lock'] }).shouldBuild).toBe(true);
    expect(
      evaluateDeployFilter({ ...input, changedFiles: ['apps/other/package.json'] }).shouldBuild,
    ).toBe(false);
  });

  it('builds when a workspace dependency changed', () => {
    const d = evaluateDeployFilter({
      ...base,
      configuredPatterns: 'apps/web',
      changedFiles: ['packages/ui/src/button.tsx'],
      dependencyDirectories: ['packages/ui'],
    });
    expect(d.shouldBuild).toBe(true);
  });

  it('fails open when changes or dependencies are unknown, and on empty commits', () => {
    const input = { ...base, configuredPatterns: 'apps/web' };
    expect(evaluateDeployFilter({ ...input, changedFiles: null }).shouldBuild).toBe(true);
    expect(evaluateDeployFilter({ ...input, changedFiles: [] }).shouldBuild).toBe(true);
    expect(
      evaluateDeployFilter({ ...input, changedFiles: ['docs/a.md'], dependencyDirectories: null })
        .shouldBuild,
    ).toBe(true);
  });

  it('honours user exclusions inside the root directory', () => {
    const d = evaluateDeployFilter({
      ...base,
      configuredPatterns: 'apps/web\n!apps/web/**/*.md',
      changedFiles: ['apps/web/README.md'],
    });
    expect(d.shouldBuild).toBe(false);
  });
});

describe('getPushChangedFiles', () => {
  const commit = { added: ['a'], modified: ['b'], removed: ['c'] };
  it('collects files from a normal push', () => {
    expect(getPushChangedFiles({ before: 'abc', commits: [commit] })?.sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('returns null for force pushes, new branches and truncated payloads', () => {
    expect(getPushChangedFiles({ before: 'abc', forced: true, commits: [commit] })).toBeNull();
    expect(getPushChangedFiles({ before: '0000000', commits: [commit] })).toBeNull();
    expect(getPushChangedFiles({ before: 'abc', commits: Array(2048).fill(commit) })).toBeNull();
    expect(getPushChangedFiles({ before: 'abc', commits: [{ added: ['a'] }] })).toBeNull();
  });
});

describe('workspace resolution', () => {
  it('parses pnpm-workspace.yaml', () => {
    expect(
      parsePnpmWorkspacePackages(
        "packages:\n  - 'apps/*'\n  - \"packages/**\" # x\n  - '!**/test/**'\ncatalog:\n  - nope\n",
      ),
    ).toEqual(['apps/*', 'packages/**', '!**/test/**']);
  });

  it('selects workspace directories with negation and ignores node_modules', () => {
    expect(
      selectWorkspaceDirectories(
        ['', 'apps/web', 'packages/ui', 'packages/ui/node_modules/x', 'packages/test/fixture'],
        ['apps/*', 'packages/**', '!packages/test/**'],
      ),
    ).toEqual(['apps/web', 'packages/ui']);
  });

  it('resolves transitive internal dependencies', () => {
    const packages = [
      {
        dir: 'apps/web',
        manifest: { name: 'web', dependencies: { ui: 'workspace:*', react: '19' } },
      },
      { dir: 'packages/ui', manifest: { name: 'ui', devDependencies: { tokens: '*' } } },
      { dir: 'packages/tokens', manifest: { name: 'tokens' } },
      { dir: 'packages/unused', manifest: { name: 'unused' } },
    ];
    expect(resolveDependencyClosure('apps/web', packages)).toEqual([
      'packages/tokens',
      'packages/ui',
    ]);
  });
});

describe('RepoChangeResolver', () => {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { ui: '*' } }),
    'packages/ui/package.json': JSON.stringify({ name: 'ui' }),
    'packages/other/package.json': JSON.stringify({ name: 'other' }),
  };
  const fakeFetch = async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes('/compare/')) {
      return Response.json({
        status: 'ahead',
        files: [{ filename: 'packages/ui/new.ts', previous_filename: 'apps/x/old.ts' }],
      });
    }
    if (u.pathname.includes('/git/trees/')) {
      return Response.json({
        truncated: false,
        tree: Object.keys(files).map((path) => ({ path, type: 'blob' })),
      });
    }
    const path = decodeURIComponent(u.pathname.split('/contents/')[1] ?? '');
    return path in files ? new Response(files[path]) : new Response('', { status: 404 });
  };

  it('compares and resolves dependencies through the GitHub API', async () => {
    const resolver = new RepoChangeResolver('t', 'o/r', 'head', fakeFetch as any);
    expect((await resolver.compare('base')).files?.sort()).toEqual([
      'apps/x/old.ts',
      'packages/ui/new.ts',
    ]);
    expect(await resolver.dependencyDirectories('./apps/web/')).toEqual(['packages/ui']);
    expect(await resolver.dependencyDirectories('./')).toEqual([]);
  });

  it('treats diverged history and API failures as unknown', async () => {
    const diverged = new RepoChangeResolver('t', 'o/r', 'head', (async () =>
      Response.json({ status: 'diverged', files: [] })) as any);
    expect((await diverged.compare('base')).files).toBeNull();
    const failing = new RepoChangeResolver(
      't',
      'o/r',
      'head',
      (async () => new Response('', { status: 500 })) as any,
    );
    expect((await failing.compare('base')).files).toBeNull();
    expect(await failing.dependencyDirectories('apps/web')).toBeNull();
  });
});
