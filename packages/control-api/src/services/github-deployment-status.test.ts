import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// --- Fakes for the database and the GitHub App token -------------------------------------
const row = {
  build: {
    id: 'build-1234-5678',
    commit_sha: 'abc123',
    github_deployment_id: null as string | null,
  },
  project: {
    id: 'proj-1',
    name: 'web',
    domain: 'web.example.com',
    github_installation_id: '42',
    github_repo_full_name: 'acme/site',
  },
};
const savedDeploymentIds: string[] = [];

mock.module('../db', () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    }),
    update: () => ({
      set: (values: { github_deployment_id: string }) => ({
        where: async () => {
          savedDeploymentIds.push(values.github_deployment_id);
          row.build.github_deployment_id = values.github_deployment_id;
        },
      }),
    }),
  },
}));
mock.module('./github-service', () => ({
  GitHubService: { getInstallationToken: async () => 'token-xyz' },
}));

const { GitHubDeploymentStatus, mapState, githubNames } =
  await import('./github-deployment-status');

// --- fetch recorder -------------------------------------------------------------------------
type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  row.build.github_deployment_id = null;
  savedDeploymentIds.length = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url.endsWith('/deployments'))
      return new Response(JSON.stringify({ id: 777 }), { status: 201 });
    return new Response('{}', { status: 201 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('mapState', () => {
  it('maps ShipYard stages to GitHub states', () => {
    expect(mapState('queued')).toMatchObject({ deployment: 'queued', commit: 'pending' });
    expect(mapState('building')).toMatchObject({ deployment: 'in_progress', commit: 'pending' });
    expect(mapState('success')).toMatchObject({ deployment: 'success', commit: 'success' });
    expect(mapState('failure')).toMatchObject({ deployment: 'failure', commit: 'failure' });
    expect(mapState('inactive')).toMatchObject({ deployment: 'inactive', commit: null });
  });

  it('keeps descriptions within GitHub’s 140 character limit', () => {
    expect(mapState('failure', 'x'.repeat(500)).description).toHaveLength(140);
  });
});

describe('githubNames', () => {
  it('names the environment and check per project', () => {
    expect(githubNames('web')).toEqual({
      environment: 'Production – web',
      context: 'ShipYard – web',
    });
  });
});

describe('GitHubDeploymentStatus.report', () => {
  it('creates one deployment per build and posts statuses in order', async () => {
    GitHubDeploymentStatus.report('build-1234-5678', 'queued');
    GitHubDeploymentStatus.report('build-1234-5678', 'building');
    await GitHubDeploymentStatus.report('build-1234-5678', 'success');

    const deploymentsCreated = calls.filter((c) => c.url.endsWith('/repos/acme/site/deployments'));
    expect(deploymentsCreated).toHaveLength(1);
    expect(deploymentsCreated[0].body).toMatchObject({
      ref: 'abc123',
      environment: 'Production – web',
      required_contexts: [],
      auto_merge: false,
    });
    expect(savedDeploymentIds).toEqual(['777']);

    const deploymentStates = calls
      .filter((c) => c.url.endsWith('/deployments/777/statuses'))
      .map((c) => c.body.state);
    expect(deploymentStates).toEqual(['queued', 'in_progress', 'success']);

    const commitStates = calls
      .filter((c) => c.url.endsWith('/statuses/abc123'))
      .map((c) => c.body.state);
    expect(commitStates).toEqual(['pending', 'pending', 'success']);
  });

  it('skips builds without a commit', async () => {
    const sha = row.build.commit_sha;
    row.build.commit_sha = null as unknown as string;
    await GitHubDeploymentStatus.report('build-1234-5678', 'queued');
    row.build.commit_sha = sha;
    expect(calls).toHaveLength(0);
  });

  it('never throws when GitHub refuses the request', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      GitHubDeploymentStatus.report('build-1234-5678', 'queued'),
    ).resolves.toBeUndefined();
  });
});
