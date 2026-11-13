import { API_URL } from '@/lib/api-url';

export interface SetupStatus {
  github_login_ready: boolean;
  github_app_ready: boolean;
  signups_open: boolean;
  public_url: string;
  base_domain: string;
  install_url: string | null;
}

export type SettingKey =
  | 'github_app_id'
  | 'github_app_slug'
  | 'github_client_id'
  | 'github_client_secret'
  | 'github_private_key'
  | 'github_webhook_secret'
  | 'cloudflare_api_token'
  | 'cloudflare_zone_id'
  | 'resend_api_key'
  | 'resend_from_email'
  | 'allow_signups';

export interface SettingView {
  configured: boolean;
  source: 'dashboard' | 'env' | null;
  secret: boolean;
  value?: string;
  hint?: string;
}

export interface PlatformSettings {
  settings: Record<SettingKey, SettingView>;
  server: { public_url: string; base_domain: string; server_ip: string; production: boolean };
  github: { login_ready: boolean; app_ready: boolean };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data as T;
}

/**
 * Send the browser to GitHub with the App manifest. GitHub only accepts the manifest as a
 * form POST, so a hidden form is built and submitted.
 */
export function submitManifest(actionUrl: string, manifest: string) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = actionUrl;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = manifest;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

export const platformApi = {
  getSetupStatus: () => request<SetupStatus>('/setup/status'),

  /** Start GitHub App creation. `token` is the installer's setup code (first run only). */
  async createGitHubApp(options: { token?: string; organization?: string } = {}) {
    const { action_url, manifest } = await request<{ action_url: string; manifest: string }>(
      '/setup/github/manifest',
      { method: 'POST', body: JSON.stringify(options) },
    );
    submitManifest(action_url, manifest);
  },

  getSettings: () => request<PlatformSettings>('/settings'),

  /** Save values; `null` or '' removes the dashboard value (falls back to .env). */
  saveSettings: (updates: Partial<Record<SettingKey, string | null>>) =>
    request<PlatformSettings>('/settings', { method: 'PUT', body: JSON.stringify(updates) }),
};
