import { config } from '@thakur-deploy/config';

/**
 * The engine builds full domains (`<sub>.<base domain>`) and frame-ancestor headers from
 * the dashboard URL. The Control API is the source of truth for both, so when they aren't
 * set in this process's environment the engine asks it, retrying until it answers.
 */
export function syncPlatformInfo(retryMs = 5000): void {
  if (process.env.PUBLIC_URL?.trim() && process.env.BASE_DOMAIN?.trim()) return;

  const attempt = async () => {
    try {
      const res = await fetch(`${config.controlApiUrl}/setup/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = (await res.json()) as { public_url?: string; base_domain?: string };
      if (status.public_url && !process.env.PUBLIC_URL?.trim()) {
        process.env.PUBLIC_URL = status.public_url;
      }
      if (status.base_domain && !process.env.BASE_DOMAIN?.trim()) {
        process.env.BASE_DOMAIN = status.base_domain;
      }
      console.log(`[Platform] Dashboard ${config.publicUrl}, apps under *.${config.baseDomain}`);
    } catch {
      setTimeout(attempt, retryMs);
    }
  };
  void attempt();
}
