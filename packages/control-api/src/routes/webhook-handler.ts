import { Elysia } from 'elysia';
import { randomUUID } from 'crypto';
import { GitHubService } from '../services/github-service';
import { db } from '../db';
import { githubInstallations, projects, builds, deployments } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { BuildService } from '../services/build-service';
import {
  evaluateDeployFilter,
  getPushChangedFiles,
  parseWatchPatterns,
  type DeployFilterDecision,
} from '../services/deploy-change-detection';
import { RepoChangeResolver } from '../services/deploy-change-resolver';

/** Commit SHA currently live for a project (the build behind its active deployment). */
async function getDeployedCommitSha(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ commit_sha: builds.commit_sha })
    .from(deployments)
    .innerJoin(builds, eq(deployments.build_id, builds.id))
    .where(and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')))
    .orderBy(desc(deployments.activated_at))
    .limit(1);
  return row?.commit_sha ?? null;
}

// Generate a unique request ID for log tracing
function generateRequestId(): string {
  return randomUUID().slice(0, 8);
}

export const githubWebhook = new Elysia()
  // Capture raw body BEFORE Elysia parses it (required for webhook signature verification)
  .derive(async ({ request }) => {
    const clonedRequest = request.clone();
    const rawBody = await clonedRequest.text();
    const requestId = generateRequestId();
    return { rawBody, requestId };
  })
  .post('/github/webhook', async ({ request, rawBody, requestId, set }) => {
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    const deliveryId = request.headers.get('x-github-delivery') || 'unknown';

    const log = (level: 'info' | 'warn' | 'error', message: string, data?: object) => {
      const prefix = `[Webhook:${requestId}]`;
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      if (level === 'error') {
        console.error(`${prefix} ${message}${dataStr}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}${dataStr}`);
      } else {
        console.log(`${prefix} ${message}${dataStr}`);
      }
    };

    log('info', `Received ${event} event`, { deliveryId });

    // 1. Validate signature header
    if (!signature) {
      log('warn', 'Missing signature header');
      set.status = 401;
      return { error: 'Missing signature' };
    }

    // 2. Verify webhook signature
    try {
      const verified = GitHubService.verifyWebhookSignature(rawBody, signature);
      if (!verified) {
        log('warn', 'Signature verification failed');
        set.status = 401;
        return { error: 'Invalid signature' };
      }
    } catch (e) {
      log('error', 'Signature verification error', { error: String(e) });
      set.status = 500;
      return { error: 'Signature verification failed' };
    }

    // 3. Parse payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      log('error', 'Failed to parse webhook payload');
      set.status = 400;
      return { error: 'Invalid JSON payload' };
    }

    try {
      // =====================
      // INSTALLATION EVENTS
      // =====================
      if (event === 'installation') {
        const action = payload.action;
        const installation = payload.installation;

        if (action === 'created') {
          await db
            .insert(githubInstallations)
            .values({
              github_installation_id: installation.id.toString(),
              account_login: installation.account.login,
              account_id: installation.account.id.toString(),
              account_type: installation.account.type,
            })
            .onConflictDoUpdate({
              target: githubInstallations.github_installation_id,
              set: {
                account_login: installation.account.login,
              },
            });
          log('info', `Installation registered: ${installation.id}`);
        } else if (action === 'deleted') {
          await db
            .delete(githubInstallations)
            .where(eq(githubInstallations.github_installation_id, installation.id.toString()));

          await db
            .update(projects)
            .set({ github_installation_id: null })
            .where(eq(projects.github_installation_id, installation.id.toString()));

          log('info', `Installation deleted: ${installation.id}`);
        }

        return { processed: true, event: 'installation', action };
      }

      // =====================
      // PUSH EVENTS
      // =====================
      if (event === 'push') {
        const ref = payload.ref; // 'refs/heads/main'
        const repo = payload.repository;
        const branch = typeof ref === 'string' ? ref.replace('refs/heads/', '') : '';
        const installationId = payload.installation?.id?.toString();
        const commitSha = payload.after; // The commit SHA after the push
        const commitMessage = payload.head_commit?.message?.slice(0, 255) || null; // Store full message (up to 255 chars)
        const payloadChangedFiles = getPushChangedFiles(payload);

        log('info', `Push to ${repo.full_name}:${branch}`, {
          commit: commitSha?.slice(0, 7),
          message: commitMessage,
        });

        if (payload.deleted || !ref?.startsWith('refs/heads/')) {
          log('info', `Ignoring ${payload.deleted ? 'branch deletion' : `non-branch ref ${ref}`}`);
          return { processed: true, builds_triggered: 0, ignored: true };
        }

        if (!installationId) {
          log('warn', 'Push event missing installation ID');
          return { processed: false, reason: 'No installation ID' };
        }

        // Find connected projects
        const repoId = repo.id.toString();
        const connectedProjects = await db
          .select()
          .from(projects)
          .where(and(eq(projects.github_repo_id, repoId), eq(projects.github_branch, branch)));

        if (connectedProjects.length === 0) {
          log('info', `No projects found for ${repo.full_name}:${branch}`);
          return { processed: true, builds_triggered: 0 };
        }

        log('info', `Found ${connectedProjects.length} connected project(s)`);

        let buildsTriggered = 0;
        let buildsSkipped = 0;
        const results: { project: string; action: 'queued' | 'skipped'; reason: string }[] = [];

        // Lazily created: only projects with path filters need GitHub API access.
        let resolverPromise: Promise<RepoChangeResolver | null> | null = null;
        const getResolver = () => {
          resolverPromise ??= GitHubService.getInstallationToken(installationId)
            .then((token) => new RepoChangeResolver(token, repo.full_name, commitSha))
            .catch((e) => {
              log('warn', 'Could not create GitHub client for change detection', {
                error: String(e),
              });
              return null;
            });
          return resolverPromise;
        };

        /** Decide whether a path-filtered project is affected by this push. */
        const decide = async (
          project: typeof projects.$inferSelect,
        ): Promise<DeployFilterDecision> => {
          const base = {
            configuredPatterns: project.auto_deploy_paths,
            rootDirectory: project.root_directory,
          };
          if (parseWatchPatterns(project.auto_deploy_paths).length === 0) {
            return evaluateDeployFilter({ ...base, changedFiles: [], dependencyDirectories: [] });
          }

          const deployedSha = await getDeployedCommitSha(project.id);
          if (!deployedSha) {
            return { shouldBuild: true, reason: 'No active deployment to compare against' };
          }

          // Diff against what is live, not just this push: a previously failed or
          // skipped-but-relevant change must still deploy on the next push.
          const resolver = await getResolver();
          let changedFiles: string[] | null = null;
          if (resolver) {
            const changeSet = await resolver.compare(deployedSha);
            changedFiles = changeSet.files;
            if (changedFiles === null) {
              log('info', `Change set unavailable for ${project.name}`, {
                detail: changeSet.detail,
              });
            }
          }
          // The push payload is equivalent when the push starts at the deployed commit.
          if (changedFiles === null && payload.before === deployedSha) {
            changedFiles = payloadChangedFiles;
          }

          // Cheap pass first: root directory / explicit paths often decide without
          // resolving the workspace dependency graph.
          const quick = evaluateDeployFilter({ ...base, changedFiles, dependencyDirectories: [] });
          if (quick.shouldBuild) return quick;

          const dependencyDirectories = resolver
            ? await resolver.dependencyDirectories(project.root_directory)
            : null;
          return evaluateDeployFilter({ ...base, changedFiles, dependencyDirectories });
        };

        for (const project of connectedProjects) {
          // Check auto_deploy setting
          if (!project.auto_deploy) {
            log('info', `Skipping project ${project.name} (auto_deploy disabled)`);
            results.push({
              project: project.name,
              action: 'skipped',
              reason: 'Auto deploy disabled',
            });
            buildsSkipped++;
            continue;
          }

          // Idempotency check: prevent duplicate builds for same commit
          if (commitSha) {
            const existingBuild = await db
              .select()
              .from(builds)
              .where(and(eq(builds.project_id, project.id), eq(builds.commit_sha, commitSha)))
              .limit(1);

            if (existingBuild.length > 0) {
              log(
                'info',
                `Skipping duplicate build for commit ${commitSha.slice(0, 7)} on project ${project.name}`,
              );
              results.push({
                project: project.name,
                action: 'skipped',
                reason: 'Build already exists for this commit',
              });
              buildsSkipped++;
              continue;
            }
          }

          let decision: DeployFilterDecision;
          try {
            decision = await decide(project);
          } catch (e) {
            decision = { shouldBuild: true, reason: `Change detection failed: ${String(e)}` };
          }
          if (!decision.shouldBuild) {
            log('info', `Skipping project ${project.name}: ${decision.reason}`, {
              auto_deploy_paths: project.auto_deploy_paths,
              root_directory: project.root_directory,
            });
            results.push({ project: project.name, action: 'skipped', reason: decision.reason });
            buildsSkipped++;
            continue;
          }

          // Create build with commit SHA and message for tracking
          try {
            await BuildService.create({
              project_id: project.id,
              status: 'pending',
              commit_sha: commitSha,
              commit_message: commitMessage,
            });
            log('info', `Build queued for project ${project.name}`, {
              project_id: project.id,
              reason: decision.reason,
            });
            results.push({ project: project.name, action: 'queued', reason: decision.reason });
            buildsTriggered++;
          } catch (e) {
            log('error', `Failed to create build for project ${project.name}`, {
              error: String(e),
            });
          }
        }

        return {
          processed: true,
          builds_triggered: buildsTriggered,
          builds_skipped: buildsSkipped,
          results,
        };
      }

      // =====================
      // OTHER EVENTS
      // =====================
      log('info', `Ignoring unhandled event: ${event}`);
      return { processed: true, event, ignored: true };
    } catch (e) {
      log('error', 'Error processing webhook', { error: String(e) });
      set.status = 500;
      return { error: 'Internal processing error' };
    }
  });
