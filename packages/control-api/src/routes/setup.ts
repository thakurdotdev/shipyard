import { config } from '@thakur-deploy/config';
import { Elysia, t } from 'elysia';
import { auth, authBaseUrl, canCreateAccount } from '../lib/auth';
import { resetGitHubAppCache } from '../services/github-service';
import {
  buildManifest,
  convertManifestCode,
  createState,
  isValidSetupToken,
  manifestActionUrl,
  verifyState,
} from '../services/github-manifest';
import {
  githubAppConfig,
  isGitHubAppConfigured,
  isGitHubLoginConfigured,
  SettingsService,
} from '../services/settings-service';

function installUrl(): string | null {
  const slug = githubAppConfig().slug;
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}

/**
 * First-run setup. Before a GitHub App exists nobody can sign in, so creating one is
 * unlocked by the setup code the installer prints (derived from SECRET). Once signed in,
 * the same flow can replace the App from Settings.
 */
export const setupRoutes = new Elysia({ prefix: '/setup' })
  .get('/status', async () => ({
    github_login_ready: isGitHubLoginConfigured(),
    github_app_ready: isGitHubAppConfigured(),
    signups_open: await canCreateAccount(),
    public_url: config.publicUrl,
    base_domain: config.baseDomain,
    install_url: installUrl(),
  }))

  .post(
    '/github/manifest',
    async ({ body, request, set }) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) {
        if (isGitHubLoginConfigured()) {
          set.status = 401;
          return {
            error: 'A GitHub App is already connected. Sign in and replace it from Settings.',
          };
        }
        if (!isValidSetupToken(body.token)) {
          set.status = 403;
          return { error: 'That setup code is not valid. Use the link the installer printed.' };
        }
      }

      const organization = body.organization?.trim() || undefined;
      if (organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) {
        set.status = 400;
        return { error: 'Organization must be a GitHub organization name' };
      }

      const state = createState(session ? 'settings' : 'setup');
      return {
        action_url: manifestActionUrl(state, organization),
        manifest: JSON.stringify(buildManifest(config.publicUrl, authBaseUrl())),
      };
    },
    {
      body: t.Object({
        token: t.Optional(t.String({ maxLength: 200 })),
        organization: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  )

  .get(
    '/github/callback',
    async ({ query, redirect }) => {
      const returnTo = verifyState(query.state);
      const page = returnTo === 'settings' ? '/settings' : '/setup';
      const back = (params: Record<string, string>) =>
        redirect(`${config.publicUrl}${page}?${new URLSearchParams(params)}`, 302);

      if (!returnTo) return back({ error: 'This setup link expired. Start again.' });
      if (!query.code) return back({ error: 'GitHub did not return a setup code.' });

      try {
        const app = await convertManifestCode(query.code);
        await SettingsService.set({
          github_app_id: String(app.id),
          github_app_slug: app.slug,
          github_client_id: app.client_id,
          github_client_secret: app.client_secret,
          github_private_key: app.pem,
          github_webhook_secret: app.webhook_secret ?? null,
        });
        resetGitHubAppCache();
        console.log(`[Setup] Connected GitHub App "${app.name}" (${app.slug}, id ${app.id})`);
        return back({ github: 'connected' });
      } catch (error) {
        console.error('[Setup] GitHub App creation failed:', error);
        return back({
          error: error instanceof Error ? error.message : 'GitHub App creation failed',
        });
      }
    },
    {
      query: t.Object({ code: t.Optional(t.String()), state: t.Optional(t.String()) }),
    },
  );
