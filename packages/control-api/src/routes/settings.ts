import { config, getServerHost } from '@thakur-deploy/config';
import { Elysia, t } from 'elysia';
import { resetGitHubAppCache } from '../services/github-service';
import {
  isGitHubAppConfigured,
  isGitHubLoginConfigured,
  isSettingKey,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SettingKey,
  SettingsService,
} from '../services/settings-service';

export interface SettingView {
  configured: boolean;
  /** 'dashboard' when saved here, 'env' when it comes from the server's .env file. */
  source: 'dashboard' | 'env' | null;
  secret: boolean;
  /** Plain value for non-secret settings. */
  value?: string;
  /** Last characters of a secret, so it can be recognised without being revealed. */
  hint?: string;
}

function hintFor(key: SettingKey, value: string): string {
  if (key === 'github_private_key') return 'PEM key';
  return value.length > 8 ? `…${value.slice(-4)}` : '••••';
}

export function settingsView(): Record<SettingKey, SettingView> {
  const out = {} as Record<SettingKey, SettingView>;
  for (const key of SETTING_KEYS) {
    const value = SettingsService.get(key);
    const secret = SETTING_DEFINITIONS[key].secret;
    out[key] = {
      configured: Boolean(value),
      source: SettingsService.source(key),
      secret,
      ...(value && (secret ? { hint: hintFor(key, value) } : { value })),
    };
  }
  return out;
}

async function fullView() {
  return {
    settings: settingsView(),
    server: {
      public_url: config.publicUrl,
      base_domain: config.baseDomain,
      server_ip: await getServerHost(),
      production: config.isProduction,
    },
    github: {
      login_ready: isGitHubLoginConfigured(),
      app_ready: isGitHubAppConfigured(),
    },
  };
}

/** Dashboard-editable platform settings (signed-in users only). */
export const settingsRoutes = new Elysia({ prefix: '/settings' }).get('', fullView).put(
  '',
  async ({ body, set }) => {
    const updates: Partial<Record<SettingKey, string | null>> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!isSettingKey(key)) {
        set.status = 400;
        return { error: `Unknown setting: ${key}` };
      }
      updates[key] = value;
    }
    try {
      await SettingsService.set(updates);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Could not save settings' };
    }
    if (Object.keys(updates).some((key) => key.startsWith('github_'))) resetGitHubAppCache();
    return fullView();
  },
  {
    body: t.Record(t.String(), t.Union([t.String({ maxLength: 10000 }), t.Null()])),
  },
);
