import { findRepoRoot } from '@thakur-deploy/config';
import { inArray } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { db } from '../db';
import { platformSettings } from '../db/schema';
import { decrypt, encrypt } from '../lib/crypto';

/**
 * Platform settings that used to live in `.env` and are now edited from the dashboard.
 *
 * Lookup order for each key: a database row (set from the dashboard), then the legacy
 * environment variable, so existing installs keep working without any migration.
 * Values are cached in memory; this process is the only writer.
 */
export const SETTING_DEFINITIONS = {
  github_app_id: { env: 'GITHUB_APP_ID', secret: false },
  github_app_slug: { env: 'GITHUB_APP_SLUG', secret: false },
  github_client_id: { env: 'GITHUB_CLIENT_ID', secret: false },
  github_client_secret: { env: 'GITHUB_CLIENT_SECRET', secret: true },
  github_private_key: { env: 'GITHUB_APP_PRIVATE_KEY_PATH', secret: true },
  github_webhook_secret: { env: 'GITHUB_WEBHOOK_SECRET', secret: true },
  cloudflare_api_token: { env: 'CLOUDFLARE_API_TOKEN', secret: true },
  cloudflare_zone_id: { env: 'CLOUDFLARE_ZONE_ID', secret: false },
  resend_api_key: { env: 'RESEND_API_KEY', secret: true },
  resend_from_email: { env: 'RESEND_FROM_EMAIL', secret: false },
  allow_signups: { env: undefined, secret: false },
} as const satisfies Record<string, { env: string | undefined; secret: boolean }>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingSource = 'dashboard' | 'env' | null;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFINITIONS;
}

const stored = new Map<SettingKey, string>();
const listeners = new Set<(changed: SettingKey[]) => void>();
let loaded = false;

/** The GitHub App private key from a file, the way it was configured before settings. */
function readPrivateKeyFile(): string | undefined {
  const configured = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  const root = findRepoRoot();
  const path = configured ? resolve(configured) : root ? join(root, 'github-app.pem') : undefined;
  if (!path || !existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function fromEnv(key: SettingKey): string | undefined {
  if (key === 'github_private_key') return readPrivateKeyFile();
  const name = SETTING_DEFINITIONS[key].env;
  const value = name ? process.env[name]?.trim() : undefined;
  return value || undefined;
}

/** Validate and normalise a value before it is stored. Throws a user-facing message. */
export function normalizeSetting(key: SettingKey, raw: string): string {
  const value = key === 'github_private_key' ? raw.trim().replace(/\r\n/g, '\n') : raw.trim();
  switch (key) {
    case 'github_app_id':
      if (!/^\d+$/.test(value)) throw new Error('GitHub App ID must be a number');
      break;
    case 'github_private_key':
      if (!value.includes('-----BEGIN') || !value.includes('PRIVATE KEY-----')) {
        throw new Error('Private key must be the full PEM file from GitHub');
      }
      break;
    case 'allow_signups':
      if (value !== 'true' && value !== 'false')
        throw new Error('allow_signups must be true or false');
      break;
    case 'github_app_slug':
      if (!/^[a-z0-9-]+$/i.test(value))
        throw new Error('GitHub App slug may only contain letters, numbers and dashes');
      break;
  }
  return value;
}

export const SettingsService = {
  /** Load every stored row into memory. Call once before serving requests. */
  async load() {
    const rows = await db.select().from(platformSettings);
    stored.clear();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      try {
        stored.set(row.key, row.encrypted ? decrypt(row.value) : row.value);
      } catch (error) {
        console.error(`[Settings] Could not decrypt ${row.key}; ignoring it.`, error);
      }
    }
    loaded = true;
  },

  isLoaded() {
    return loaded;
  },

  get(key: SettingKey): string | undefined {
    return stored.get(key) ?? fromEnv(key);
  },

  source(key: SettingKey): SettingSource {
    if (stored.has(key)) return 'dashboard';
    return fromEnv(key) ? 'env' : null;
  },

  /** True only when the setting is explicitly "true". */
  flag(key: SettingKey): boolean {
    return this.get(key) === 'true';
  },

  /**
   * Store values. An empty string or null removes the dashboard value, so the key falls
   * back to `.env` (or becomes unset). All values are validated before anything is written.
   */
  async set(updates: Partial<Record<SettingKey, string | null>>) {
    const entries = Object.entries(updates) as [SettingKey, string | null][];
    const toWrite: { key: SettingKey; value: string }[] = [];
    const toDelete: SettingKey[] = [];
    for (const [key, raw] of entries) {
      if (!isSettingKey(key)) throw new Error(`Unknown setting: ${key}`);
      if (raw === null || raw.trim() === '') toDelete.push(key);
      else toWrite.push({ key, value: normalizeSetting(key, raw) });
    }

    await db.transaction(async (tx) => {
      if (toDelete.length) {
        await tx.delete(platformSettings).where(inArray(platformSettings.key, toDelete));
      }
      for (const { key, value } of toWrite) {
        const secret = SETTING_DEFINITIONS[key].secret;
        const row = {
          value: secret ? encrypt(value) : value,
          encrypted: secret,
          updated_at: new Date(),
        };
        await tx
          .insert(platformSettings)
          .values({ key, ...row })
          .onConflictDoUpdate({ target: platformSettings.key, set: row });
      }
    });

    for (const key of toDelete) stored.delete(key);
    for (const { key, value } of toWrite) stored.set(key, value);
    const changed = entries.map(([key]) => key);
    for (const listener of listeners) {
      try {
        listener(changed);
      } catch (error) {
        console.error('[Settings] change listener failed', error);
      }
    }
  },

  onChange(listener: (changed: SettingKey[]) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Test hook: replace the in-memory values without a database. */
  _setForTests(values: Partial<Record<SettingKey, string>>) {
    stored.clear();
    for (const [key, value] of Object.entries(values)) stored.set(key as SettingKey, value!);
    loaded = true;
  },
};

/** What the GitHub integration needs, resolved from settings. */
export function githubAppConfig() {
  return {
    appId: SettingsService.get('github_app_id'),
    slug: SettingsService.get('github_app_slug'),
    clientId: SettingsService.get('github_client_id'),
    clientSecret: SettingsService.get('github_client_secret'),
    privateKey: SettingsService.get('github_private_key'),
    webhookSecret: SettingsService.get('github_webhook_secret'),
  };
}

/** Sign-in works once the OAuth half of the GitHub App is known. */
export function isGitHubLoginConfigured(): boolean {
  const gh = githubAppConfig();
  return Boolean(gh.clientId && gh.clientSecret);
}

/** Repository access (installation tokens) needs the App ID and its private key. */
export function isGitHubAppConfigured(): boolean {
  const gh = githubAppConfig();
  return Boolean(gh.appId && gh.privateKey && gh.clientId && gh.clientSecret);
}
