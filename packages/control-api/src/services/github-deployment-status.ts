import { config } from '@thakur-deploy/config';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { builds, projects } from '../db/schema';
import { GitHubService } from './github-service';

/**
 * Mirrors ShipYard builds onto GitHub the way Vercel/Netlify do:
 *
 *  - a GitHub Deployment per build, so the repo sidebar ("Environments") and pull
 *    requests show "Deployed to Production – <project>" with a link to the live site;
 *  - a commit status per build, so the commit and PR checks show ● / ✓ / ✗ with a
 *    link to the build logs.
 *
 * Needs the App permissions `deployments: write` and `statuses: write`. Everything here
 * is best effort: GitHub being down or a missing permission never affects a deploy.
 */

export type ReportState = 'queued' | 'building' | 'deploying' | 'success' | 'failure' | 'inactive';

type DeploymentState = 'queued' | 'in_progress' | 'success' | 'failure' | 'inactive';
type CommitState = 'pending' | 'success' | 'failure';

interface StateMapping {
  deployment: DeploymentState;
  commit: CommitState | null;
  description: string;
}

const MAPPING: Record<ReportState, StateMapping> = {
  queued: { deployment: 'queued', commit: 'pending', description: 'Build queued' },
  building: { deployment: 'in_progress', commit: 'pending', description: 'Building' },
  deploying: { deployment: 'in_progress', commit: 'pending', description: 'Deploying' },
  success: { deployment: 'success', commit: 'success', description: 'Deployment is live' },
  failure: { deployment: 'failure', commit: 'failure', description: 'Deployment failed' },
  // A stopped deployment: the environment goes inactive, the commit's check stays as it was.
  inactive: { deployment: 'inactive', commit: null, description: 'Deployment stopped' },
};

export function mapState(state: ReportState, description?: string): StateMapping {
  const base = MAPPING[state];
  // GitHub rejects descriptions over 140 characters.
  return { ...base, description: (description || base.description).slice(0, 140) };
}

/** Environment and status-check names, per project so monorepos get one entry each. */
export function githubNames(projectName: string) {
  return {
    environment: `Production – ${projectName}`.slice(0, 255),
    context: `ShipYard – ${projectName}`.slice(0, 255),
  };
}

const API = 'https://api.github.com';
const TOKEN_TTL_MS = 50 * 60 * 1000; // Installation tokens live 60 minutes.
const DENIED_BACKOFF_MS = 10 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** `<installation>:<api>` → time until which we stop trying after a permission error. */
const deniedUntil = new Map<string, number>();
/** One promise chain per build so GitHub receives the states in order. */
const chains = new Map<string, Promise<void>>();

async function installationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const token = await GitHubService.getInstallationToken(installationId);
  tokenCache.set(installationId, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function githubFetch(token: string, path: string, init: { method?: string; body?: unknown }) {
  return fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'shipyard-control-api',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

/** True when the API is allowed; logs once and backs off when the App lacks a permission. */
function allowed(installationId: string, api: 'deployments' | 'statuses'): boolean {
  return (deniedUntil.get(`${installationId}:${api}`) ?? 0) < Date.now();
}

async function check(res: Response, installationId: string, api: 'deployments' | 'statuses') {
  if (res.ok) return;
  const body = (await res.text()).slice(0, 300);
  if (res.status === 403 || res.status === 404) {
    deniedUntil.set(`${installationId}:${api}`, Date.now() + DENIED_BACKOFF_MS);
    console.warn(
      `[GitHubStatus] GitHub refused ${api} (HTTP ${res.status}). Give the GitHub App the ` +
        `"${api === 'deployments' ? 'Deployments' : 'Commit statuses'}: Read and write" ` +
        `permission and accept it on the installation. ${body}`,
    );
    throw new SkipError();
  }
  throw new Error(`GitHub ${api} request failed (HTTP ${res.status}): ${body}`);
}

class SkipError extends Error {}

function buildLogsUrl(projectId: string): string {
  return `${config.publicUrl}/projects/${projectId}?tab=deployments`;
}

function liveUrl(domain: string | null): string | undefined {
  if (!domain || !config.isProduction) return undefined;
  return domain.startsWith('http') ? domain : `https://${domain}`;
}

async function send(buildId: string, state: ReportState, description?: string) {
  const [row] = await db
    .select({ build: builds, project: projects })
    .from(builds)
    .innerJoin(projects, eq(builds.project_id, projects.id))
    .where(eq(builds.id, buildId))
    .limit(1);
  if (!row) return;
  const { build, project } = row;
  const installationId = project.github_installation_id;
  const repo = project.github_repo_full_name;
  const sha = build.commit_sha;
  // Manual (non-GitHub) projects and builds without a known commit have nothing to report.
  if (!installationId || !repo || !sha) return;

  const mapping = mapState(state, description);
  const names = githubNames(project.name);
  const logUrl = buildLogsUrl(project.id);
  const token = await installationToken(installationId);

  // 1. Commit status (the check next to the commit / in the PR).
  if (mapping.commit && allowed(installationId, 'statuses')) {
    try {
      const res = await githubFetch(token, `/repos/${repo}/statuses/${sha}`, {
        method: 'POST',
        body: {
          state: mapping.commit,
          target_url: logUrl,
          description: mapping.description,
          context: names.context,
        },
      });
      await check(res, installationId, 'statuses');
    } catch (error) {
      // Independent of the deployment below: one failing must not hold back the other.
      if (!(error instanceof SkipError)) {
        console.warn(`[GitHubStatus] Commit status "${state}" for build ${buildId} failed:`, error);
      }
    }
  }

  // 2. Deployment + deployment status (the "Environments" entry and PR timeline).
  if (!allowed(installationId, 'deployments')) return;
  try {
    let deploymentId = build.github_deployment_id;
    if (!deploymentId) {
      // Nothing to mark inactive if GitHub never heard of this build.
      if (state === 'inactive') return;
      const res = await githubFetch(token, `/repos/${repo}/deployments`, {
        method: 'POST',
        body: {
          ref: sha,
          environment: names.environment,
          description: `ShipYard build ${build.id.slice(0, 8)}`,
          auto_merge: false,
          required_contexts: [],
          production_environment: true,
          transient_environment: false,
          payload: { shipyard_build_id: build.id, shipyard_project_id: project.id },
        },
      });
      await check(res, installationId, 'deployments');
      const created = (await res.json()) as { id?: number };
      if (!created.id) throw new Error('GitHub created no deployment id');
      deploymentId = String(created.id);
      await db
        .update(builds)
        .set({ github_deployment_id: deploymentId })
        .where(eq(builds.id, build.id));
    }

    const environmentUrl = state === 'success' ? liveUrl(project.domain) : undefined;
    const res = await githubFetch(token, `/repos/${repo}/deployments/${deploymentId}/statuses`, {
      method: 'POST',
      body: {
        state: mapping.deployment,
        log_url: logUrl,
        description: mapping.description,
        environment: names.environment,
        ...(environmentUrl ? { environment_url: environmentUrl } : {}),
        // Older deployments to this environment become inactive once this one succeeds.
        auto_inactive: true,
      },
    });
    await check(res, installationId, 'deployments');
  } catch (error) {
    if (!(error instanceof SkipError)) throw error;
  }
}

export const GitHubDeploymentStatus = {
  /**
   * Queues a status update for a build. Never throws and never blocks the caller;
   * updates for the same build reach GitHub in the order they were reported.
   */
  report(buildId: string, state: ReportState, description?: string): Promise<void> {
    const previous = chains.get(buildId) ?? Promise.resolve();
    const next = previous
      .then(() => send(buildId, state, description))
      .catch((error) => {
        console.warn(`[GitHubStatus] Could not report "${state}" for build ${buildId}:`, error);
      });
    chains.set(buildId, next);
    void next.finally(() => {
      if (chains.get(buildId) === next) chains.delete(buildId);
    });
    return next;
  },

  /**
   * Head commit of a branch, for builds started from the dashboard (pushes already
   * carry their commit). Null when it can't be resolved quickly.
   */
  async resolveBranchHead(project: {
    github_installation_id: string | null;
    github_repo_full_name: string | null;
    github_branch: string | null;
  }): Promise<{ sha: string; message: string | null } | null> {
    const { github_installation_id: installationId, github_repo_full_name: repo } = project;
    if (!installationId || !repo) return null;
    try {
      const token = await installationToken(installationId);
      const branch = encodeURIComponent(project.github_branch || 'main');
      const res = await githubFetch(token, `/repos/${repo}/commits/${branch}`, {});
      if (!res.ok) return null;
      const data = (await res.json()) as { sha?: string; commit?: { message?: string } };
      if (!data.sha) return null;
      return { sha: data.sha, message: data.commit?.message?.slice(0, 255) ?? null };
    } catch {
      return null;
    }
  },
};
