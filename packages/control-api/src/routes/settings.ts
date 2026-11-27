import { config, getServerHost } from '@shipyard/config';
import { Elysia, t } from 'elysia';
import { GitHubService, resetGitHubAppCache } from '../services/github-service';
import { engineDockerAvailable } from '../services/engine-settings';
import {
  isGitHubAppConfigured,
  isGitHubLoginConfigured,
  isInternalSetting,
  isSettingKey,
  MAX_BUILD_CONCURRENCY,
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
    if (isInternalSetting(key)) continue;
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
    deployments: {
      /** Whether the engine can run Docker; null when it could not be asked. */
      docker_available: await engineDockerAvailable(),
      max_build_concurrency: MAX_BUILD_CONCURRENCY,
    },
    github: {
      login_ready: isGitHubLoginConfigured(),
      app_ready: isGitHubAppConfigured(),
      deployment_status: isGitHubAppConfigured()
        ? await GitHubService.getDeploymentStatusSupport()
        : { state: 'unknown' as const, missing: [] },
    },
  };
}

/** Dashboard-editable platform settings (signed-in users only). */
export const settingsRoutes = new Elysia({ prefix: '/settings' }).get('', fullView).put(
  '',
  async ({ body, set }) => {
    const updates: Partial<Record<SettingKey, string | null>> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!isSettingKey(key) || isInternalSetting(key)) {
        set.status = 400;
        return { error: `Unknown setting: ${key}` };
      }
      updates[key] = value;
    }
    // Docker mode on a host without Docker would fail every deploy, so check first.
    if (updates.use_docker === 'true' && !SettingsService.flag('use_docker')) {
      const available = await engineDockerAvailable();
      if (available !== true) {
        set.status = 400;
        return {
          error:
            available === null
              ? 'Could not reach the Deploy Engine to check for Docker. Try again shortly.'
              : 'Docker is not available to the platform user. Install Docker (and add the user to the docker group), then try again.',
        };
      }
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
