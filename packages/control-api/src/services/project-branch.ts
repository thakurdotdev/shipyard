import { GitHubService } from './github-service';

/**
 * Branch names a project may deploy from. Mirrors the deploy engine's check
 * (packages/deploy-engine/src/services/build/git-service.ts), which refuses anything
 * else at clone time; checking here too means a bad name fails when it is saved.
 */
export function isSafeBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !/[\x00-\x20\x7f~^:?*[\\]/.test(value)
  );
}

export interface BranchList {
  default_branch: string | null;
  branches: { name: string; protected: boolean }[];
  /** True when the repo has more branches than were listed. */
  truncated: boolean;
}

const API = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** `owner/repo` with each part limited to GitHub's characters, so it is safe in a URL path. */
function assertRepoFullName(fullName: string) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(fullName)) {
    throw new BranchError(`Invalid repository name: ${fullName}`, 400);
  }
}

/** A branch name in a URL path: each segment encoded, the slashes kept. */
function branchPath(branch: string) {
  return branch.split('/').map(encodeURIComponent).join('/');
}

export class BranchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function githubGet(token: string, path: string) {
  return fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'shipyard-control-api',
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export const ProjectBranch = {
  /** The repository's branches (default branch first), read with the installation's token. */
  async list(installationId: string, repoFullName: string): Promise<BranchList> {
    assertRepoFullName(repoFullName);
    const token = await GitHubService.getInstallationToken(installationId);

    // The repo (for its default branch) is fetched alongside the branch pages.
    const repoPromise = githubGet(token, `/repos/${repoFullName}`).catch(() => null);
    const branches: { name: string; protected: boolean }[] = [];
    let truncated = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await githubGet(
        token,
        `/repos/${repoFullName}/branches?per_page=${PER_PAGE}&page=${page}`,
      );
      if (!res.ok) {
        throw new BranchError(
          `GitHub could not list branches (HTTP ${res.status})`,
          res.status === 404 ? 404 : 502,
        );
      }
      const batch = (await res.json()) as { name: string; protected?: boolean }[];
      branches.push(...batch.map((b) => ({ name: b.name, protected: !!b.protected })));
      if (!/rel="next"/.test(res.headers.get('link') ?? '')) break;
      if (page === MAX_PAGES) truncated = true;
    }

    const repoRes = await repoPromise;
    const defaultBranch = repoRes?.ok
      ? (((await repoRes.json()) as { default_branch?: string }).default_branch ?? null)
      : null;

    // Default branch first, the rest in GitHub's (alphabetical) order.
    const sorted = defaultBranch
      ? [
          ...branches.filter((b) => b.name === defaultBranch),
          ...branches.filter((b) => b.name !== defaultBranch),
        ]
      : branches;
    return { default_branch: defaultBranch, branches: sorted, truncated };
  },

  /**
   * Throws a BranchError when `branch` is not a usable name or GitHub says it does not
   * exist. When GitHub can't be asked (network, rate limit), a well-formed name is
   * accepted: the build reports clearly if the branch really is missing.
   */
  async assertDeployable(
    branch: string,
    repo: { installationId: string | null; repoFullName: string | null },
  ): Promise<void> {
    if (!isSafeBranchName(branch)) {
      throw new BranchError(`"${branch}" is not a valid branch name`, 400);
    }
    if (!repo.installationId || !repo.repoFullName) return;
    assertRepoFullName(repo.repoFullName);

    let res: Response;
    try {
      const token = await GitHubService.getInstallationToken(repo.installationId);
      res = await githubGet(token, `/repos/${repo.repoFullName}/branches/${branchPath(branch)}`);
    } catch (error) {
      console.warn(`[ProjectBranch] Could not verify branch "${branch}":`, error);
      return;
    }
    if (res.status === 404) {
      throw new BranchError(`Branch "${branch}" does not exist in ${repo.repoFullName}`, 400);
    }
    if (!res.ok) {
      console.warn(`[ProjectBranch] Could not verify branch "${branch}" (HTTP ${res.status})`);
    }
  },
};
