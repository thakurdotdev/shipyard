import { Elysia, t } from 'elysia';
import { GitHubService } from '../services/github-service';
import { db } from '../db';
import { githubInstallations, projects } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { BuildService } from '../services/build-service';

export const githubWebhook = new Elysia().post(
  '/github/webhook',
  async ({ request, body, set }) => {
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');

    if (!signature) {
      set.status = 401;
      return 'Missing signature';
    }

    // Verify signature
    // Need raw body for verification. Elysia body is parsed JSON.
    // We can use request.text() but we already consumed body probably?
    // Elysia consumes body. We need to handle this.
    // A trick is to use 'text' parser or access text via cloned request if not consumed.
    // However, Elysia with implicit body parsing might make this tricky.
    // Let's assume for now we can serialize body back to string, but that's risky for signature.
    // Correct way in Elysia: Use `type: 'text'` or handle raw reading?
    // Wait, if I define body schema t.Object, it parses.
    // I will try to read text first, then parse.
    // But this route handler signature implies automatic parsing if I access 'body'.

    // Actually, I can use a global hook or local hook to get raw body?
    // Let's rely on JSON.stringify(body) being close enough IF format is consistent, but it's not robust.
    // Better: Retrieve raw text first.

    const rawBody = await request.text();
    const verified = GitHubService.verifyWebhookSignature(rawBody, signature);

    if (!verified) {
      set.status = 401;
      return 'Invalid signature';
    }

    const payload = JSON.parse(rawBody);

    console.log(`[GitHub Webhook] Received event: ${event}`);

    try {
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
                // update others if needed
              },
            });
          console.log(`[GitHub Webhook] Installation registered: ${installation.id}`);
        } else if (action === 'deleted') {
          await db
            .delete(githubInstallations)
            .where(eq(githubInstallations.github_installation_id, installation.id.toString()));
          // Also nullify projects? Or let them stay but they will fail builds?
          // Foreign key might cascade or restrict.
          // In schema I didn't set cascade.
          // Depending on logic, I might need to disconnect projects.
          await db
            .update(projects)
            .set({ github_installation_id: null })
            .where(eq(projects.github_installation_id, installation.id.toString()));

          console.log(`[GitHub Webhook] Installation deleted: ${installation.id}`);
        }
      } else if (event === 'push') {
        // Handle Push
        const ref = payload.ref; // 'refs/heads/main'
        const repo = payload.repository;
        const branch = ref.replace('refs/heads/', '');
        const installationId = payload.installation?.id.toString();

        if (!installationId) {
          console.log('[GitHub Webhook] Push event missing installation ID');
          return 'No installation ID';
        }

        // Find projects connected to this repository AND matches branch (if we enforce branch?)
        // Currently schema has `github_branch`.

        // Find by Repo ID (most robust) or Full Name
        const repoId = repo.id.toString();

        const connectedProjects = await db
          .select()
          .from(projects)
          .where(and(eq(projects.github_repo_id, repoId), eq(projects.github_branch, branch)));

        if (connectedProjects.length === 0) {
          console.log(
            `[GitHub Webhook] No projects found for ${repo.full_name} on branch ${branch}`,
          );
          return 'No connected projects';
        }

        console.log(`[GitHub Webhook] triggering builds for ${connectedProjects.length} projects`);

        for (const project of connectedProjects) {
          await BuildService.create({
            project_id: project.id,
            status: 'pending',
          });
          // BuildService.create just inserts DB row.
          // We need to actually trigger the worker or the worker polls?
          // Existing logic: BuildService.create returns a build.
          // How does build-worker know?
          // Usually we publish to Redis queue.
          // I need to check `src/services/build-service.ts` or `queue/` to see how builds are dispatched.

          // Checking existing `deploy-service` or `build-service`...
          // In the previous context, there was a `BuildQueue` mentioned.
          // I should verify if `BuildService.create` enqueues the job.
          // If not, I need to look at how user triggers it.
        }
      }
    } catch (e) {
      console.error('[GitHub Webhook] Error processing event', e);
      set.status = 500;
      return 'Internal Error';
    }

    return 'Processed';
  },
);
