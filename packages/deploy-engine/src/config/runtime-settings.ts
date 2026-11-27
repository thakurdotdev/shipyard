import { config, internalAuthHeaders } from '@shipyard/config';

/**
 * Engine settings an owner can change from the dashboard without restarting anything.
 *
 * The Control API stores them (Settings page, falling back to its .env). The engine starts
 * from its own environment, asks the Control API for the saved values once it answers,
 * and receives every later change on POST /settings. Read them at the moment of use,
 * never into a module-level constant, so a change applies to the next build or deploy.
 */
export interface EngineSettings {
  /** Run apps in Docker containers instead of pm0 processes. */
  useDocker: boolean;
  /** Builds that may run at the same time. Builds of one project always run in order. */
  buildConcurrency: number;
  /** Email for new Let's Encrypt registrations; certbot may already have an account. */
  certbotEmail: string | undefined;
}

export const MAX_BUILD_CONCURRENCY = 4;

/** Wire format shared with the Control API (snake_case, like the rest of its API). */
export interface EngineSettingsPayload {
  use_docker?: boolean;
  build_concurrency?: number;
  certbot_email?: string | null;
}

export function clampConcurrency(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_BUILD_CONCURRENCY, Math.max(1, Math.trunc(n)));
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): EngineSettings {
  return {
    useDocker: env.USE_DOCKER === 'true',
    buildConcurrency: clampConcurrency(env.BUILD_CONCURRENCY ?? 1),
    certbotEmail: env.CERTBOT_EMAIL?.trim() || undefined,
  };
}

let current: EngineSettings = settingsFromEnv();
const listeners = new Set<(next: EngineSettings, previous: EngineSettings) => void>();

export function engineSettings(): EngineSettings {
  return current;
}

/** Apply values from the Control API. Missing fields keep their current value. */
export function applyEngineSettings(payload: EngineSettingsPayload): EngineSettings {
  const previous = current;
  current = {
    useDocker: typeof payload.use_docker === 'boolean' ? payload.use_docker : previous.useDocker,
    buildConcurrency:
      payload.build_concurrency === undefined
        ? previous.buildConcurrency
        : clampConcurrency(payload.build_concurrency),
    certbotEmail:
      payload.certbot_email === undefined
        ? previous.certbotEmail
        : payload.certbot_email?.trim() || undefined,
  };
  for (const listener of listeners) {
    try {
      listener(current, previous);
    } catch (error) {
      console.error('[Settings] change listener failed', error);
    }
  }
  return current;
}

export function onEngineSettingsChange(
  listener: (next: EngineSettings, previous: EngineSettings) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the Control API for the saved settings, retrying until it answers. */
export function syncEngineSettings(retryMs = 5000): void {
  const attempt = async () => {
    try {
      const res = await fetch(`${config.controlApiUrl}/internal/engine-settings`, {
        headers: internalAuthHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = applyEngineSettings((await res.json()) as EngineSettingsPayload);
      console.log(
        `[Settings] ${next.useDocker ? 'Docker' : 'pm0'} mode, ` +
          `${next.buildConcurrency} build${next.buildConcurrency === 1 ? '' : 's'} at a time`,
      );
    } catch {
      setTimeout(attempt, retryMs);
    }
  };
  void attempt();
}

/** Test hook: back to the environment's values, with no listeners. */
export function _resetEngineSettingsForTests(env: NodeJS.ProcessEnv = process.env) {
  current = settingsFromEnv(env);
  listeners.clear();
}
