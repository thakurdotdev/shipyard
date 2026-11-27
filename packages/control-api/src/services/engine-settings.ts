import { deployEngineFetch } from './deploy-engine-client';
import { SettingsService, type SettingKey } from './settings-service';

/** Settings the Deploy Engine applies (see config/runtime-settings.ts there). */
const ENGINE_KEYS: SettingKey[] = ['use_docker', 'build_concurrency', 'certbot_email'];

/** What the engine receives: one value per setting, after the .env fallback. */
export function engineSettingsPayload() {
  const concurrency = Number(SettingsService.get('build_concurrency'));
  return {
    use_docker: SettingsService.flag('use_docker'),
    build_concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1,
    certbot_email: SettingsService.get('certbot_email') ?? null,
  };
}

/** Send the current values to the engine. Returns false when it could not be reached. */
export async function pushEngineSettings(): Promise<boolean> {
  try {
    const res = await deployEngineFetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(engineSettingsPayload()),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (error) {
    // The engine also asks for these on startup, so it catches up after a restart.
    console.warn('[Settings] Could not send settings to the Deploy Engine:', error);
    return false;
  }
}

/** Whether Docker works for the engine on this host; null when the engine can't be reached. */
export async function engineDockerAvailable(): Promise<boolean | null> {
  try {
    const res = await deployEngineFetch('/docker/status', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return ((await res.json()) as { available?: boolean }).available === true;
  } catch {
    return null;
  }
}

/** Push to the engine whenever one of its settings changes. Call once at startup. */
export function followEngineSettings(): void {
  SettingsService.onChange((changed) => {
    if (changed.some((key) => ENGINE_KEYS.includes(key))) void pushEngineSettings();
  });
}
