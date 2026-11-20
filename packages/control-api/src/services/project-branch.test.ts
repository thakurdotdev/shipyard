import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('./github-service', () => ({
  GitHubService: { getInstallationToken: async () => 'token-xyz' },
}));

const { ProjectBranch, BranchError, isSafeBranchName } = await import('./project-branch');

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** Serves GitHub routes from a table: path (without host) → [status, body, link header]. */
function serve(routes: Record<string, [number, unknown, string?]>) {
  globalThis.fetch = (async (url: string) => {
    const path = url.replace('https://api.github.com', '');
    requested.push(path);
    const route = routes[path];
    if (!route) return new Response('{}', { status: 404 });
    const [status, body, link] = route;
    return new Response(JSON.stringify(body), {
      status,
      headers: link ? { link } : {},
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('isSafeBranchName', () => {
  it('accepts ordinary branch names', () => {
    for (const name of ['main', 'feature/login', 'release-1.2', 'user_x/fix-123']) {
      expect(isSafeBranchName(name)).toBe(true);
    }
  });

  it('rejects names git or the clone would misread', () => {
    for (const name of ['', '-x', '/x', 'x/', 'a..b', 'a//b', 'x.lock', 'a b', 'x@{1}', 'a:b']) {
      expect(isSafeBranchName(name)).toBe(false);
    }
  });
});

describe('ProjectBranch.list', () => {
  it('follows pagination and puts the default branch first', async () => {
    serve({
      '/repos/acme/site': [200, { default_branch: 'main' }],
      '/repos/acme/site/branches?per_page=100&page=1': [
        200,
        [{ name: 'develop' }, { name: 'main', protected: true }],
        '<https://api.github.com/x?page=2>; rel="next"',
      ],
      '/repos/acme/site/branches?per_page=100&page=2': [200, [{ name: 'staging' }]],
    });

    const list = await ProjectBranch.list('42', 'acme/site');
    expect(list.default_branch).toBe('main');
    expect(list.branches).toEqual([
      { name: 'main', protected: true },
      { name: 'develop', protected: false },
      { name: 'staging', protected: false },
    ]);
    expect(list.truncated).toBe(false);
  });

  it('refuses a repository name that is not owner/repo', async () => {
    serve({});
    await expect(ProjectBranch.list('42', '../../user')).rejects.toBeInstanceOf(BranchError);
    expect(requested).toHaveLength(0);
  });
});

describe('ProjectBranch.assertDeployable', () => {
  const repo = { installationId: '42', repoFullName: 'acme/site' };

  it('accepts a branch GitHub knows, keeping slashes in the path', async () => {
    serve({ '/repos/acme/site/branches/feature/login': [200, { name: 'feature/login' }] });
    await ProjectBranch.assertDeployable('feature/login', repo);
    expect(requested).toEqual(['/repos/acme/site/branches/feature/login']);
  });

  it('rejects a branch that does not exist', async () => {
    serve({});
    await expect(ProjectBranch.assertDeployable('nope', repo)).rejects.toThrow(
      'Branch "nope" does not exist in acme/site',
    );
  });

  it('rejects an unsafe name without asking GitHub', async () => {
    serve({});
    await expect(ProjectBranch.assertDeployable('--upload-pack=x', repo)).rejects.toThrow(
      'not a valid branch name',
    );
    expect(requested).toHaveLength(0);
  });

  it('accepts a well-formed name when GitHub cannot be asked', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(ProjectBranch.assertDeployable('main', repo)).resolves.toBeUndefined();
  });
});
