import { config } from '@thakur-deploy/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * One-click GitHub App creation (GitHub "app manifest" flow):
 *   1. The dashboard posts a manifest describing the App to github.com.
 *   2. The user confirms on GitHub, which redirects back with a temporary code.
 *   3. We exchange the code for the App's ID, OAuth credentials, webhook secret and key.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

export type ManifestReturnTo = 'setup' | 'settings';

const STATE_TTL_SECONDS = 60 * 60;
const NAME_MAX = 34; // GitHub's limit for App names

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** The App description GitHub registers. Permissions match what ShipYard calls. */
export function buildManifest(publicUrl: string, authUrl: string) {
  const host = new URL(publicUrl).hostname;
  const manifest: Record<string, unknown> = {
    name: `ShipYard ${host}`.slice(0, NAME_MAX).trim(),
    url: publicUrl,
    redirect_url: `${publicUrl}/api/setup/github/callback`,
    callback_urls: [`${authUrl}/api/auth/callback/github`],
    setup_url: `${publicUrl}/import`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: 'read', metadata: 'read' },
  };
  // GitHub refuses webhook URLs it can't reach; local installs simply go without push deploys.
  if (!isLocalHost(host)) {
    manifest.hook_attributes = { url: `${publicUrl}/api/github/webhook`, active: true };
    manifest.default_events = ['push'];
  }
  return manifest;
}

/** Where the browser posts the manifest: the user's account, or an organization. */
export function manifestActionUrl(state: string, organization?: string): string {
  const base = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : 'https://github.com/settings/apps/new';
  return `${base}?state=${encodeURIComponent(state)}`;
}

function stateKey(): string {
  return createHmac('sha256', config.authSecret)
    .update('shipyard:github-manifest-state')
    .digest('hex');
}

function sign(payload: string): string {
  return createHmac('sha256', stateKey()).update(payload).digest('hex').slice(0, 32);
}

/** `<expiry>.<nonce>.<returnTo>.<signature>`, valid for an hour. */
export function createState(returnTo: ManifestReturnTo, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + STATE_TTL_SECONDS;
  const payload = `${expiry}.${randomBytes(8).toString('hex')}.${returnTo}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string | undefined, now = Date.now()): ManifestReturnTo | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [expiry, nonce, returnTo, signature] = parts;
  const expected = Buffer.from(sign(`${expiry}.${nonce}.${returnTo}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number(expiry) * 1000 < now) return null;
  return returnTo === 'setup' || returnTo === 'settings' ? returnTo : null;
}

/** Constant-time check of the one-time setup code printed by the installer. */
export function isValidSetupToken(token: string | undefined): boolean {
  const expected = config.setupToken;
  if (!token || !expected) return false;
  const a = Buffer.from(token.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ConvertedApp {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url?: string;
  owner?: { login?: string };
}

/** Exchange the temporary code from GitHub for the new App's credentials. */
export async function convertManifestCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConvertedApp> {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('Invalid code from GitHub');
  const res = await fetchImpl(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'shipyard-control-api',
    },
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`GitHub did not accept the setup code (HTTP ${res.status}): ${detail}`);
  }
  const app = (await res.json()) as ConvertedApp;
  if (!app.id || !app.client_id || !app.client_secret || !app.pem) {
    throw new Error('GitHub returned an incomplete App');
  }
  return app;
}
