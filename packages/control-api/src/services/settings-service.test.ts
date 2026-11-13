import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';

const {
  githubAppConfig,
  isGitHubAppConfigured,
  isGitHubLoginConfigured,
  normalizeSetting,
  SettingsService,
} = await import('./settings-service');

const ENV_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'CLOUDFLARE_API_TOKEN',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  SettingsService._setForTests({});
});

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';

describe('lookup order', () => {
  it('prefers a dashboard value, then falls back to .env', () => {
    process.env.CLOUDFLARE_API_TOKEN = 'from-env';
    SettingsService._setForTests({});
    expect(SettingsService.get('cloudflare_api_token')).toBe('from-env');
    expect(SettingsService.source('cloudflare_api_token')).toBe('env');

    SettingsService._setForTests({ cloudflare_api_token: 'from-dashboard' });
    expect(SettingsService.get('cloudflare_api_token')).toBe('from-dashboard');
    expect(SettingsService.source('cloudflare_api_token')).toBe('dashboard');
  });

  it('reads the legacy private key file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-pem-'));
    const file = join(dir, 'app.pem');
    writeFileSync(file, `${PEM}\n`);
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = file;
    SettingsService._setForTests({});
    expect(SettingsService.get('github_private_key')).toBe(PEM);
    expect(SettingsService.source('github_private_key')).toBe('env');
    rmSync(dir, { recursive: true });
  });

  it('reports nothing when a setting is unset everywhere', () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    expect(SettingsService.get('cloudflare_api_token')).toBeUndefined();
    expect(SettingsService.source('cloudflare_api_token')).toBeNull();
    expect(SettingsService.flag('allow_signups')).toBe(false);
  });
});

describe('GitHub readiness', () => {
  it('needs client credentials to sign in and the key for repository access', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    SettingsService._setForTests({ github_client_id: 'id', github_client_secret: 's' });
    expect(isGitHubLoginConfigured()).toBe(true);
    expect(isGitHubAppConfigured()).toBe(false);

    SettingsService._setForTests({
      github_client_id: 'id',
      github_client_secret: 's',
      github_app_id: '1',
      github_private_key: PEM,
    });
    expect(isGitHubAppConfigured()).toBe(true);
    expect(githubAppConfig().appId).toBe('1');
  });
});

describe('validation', () => {
  it('normalises and rejects bad values', () => {
    expect(normalizeSetting('github_app_id', ' 123 ')).toBe('123');
    expect(() => normalizeSetting('github_app_id', 'abc')).toThrow('must be a number');
    expect(normalizeSetting('github_private_key', PEM.replace(/\n/g, '\r\n'))).toBe(PEM);
    expect(() => normalizeSetting('github_private_key', 'nope')).toThrow('PEM');
    expect(() => normalizeSetting('allow_signups', 'yes')).toThrow();
    expect(() => normalizeSetting('github_app_slug', 'bad slug')).toThrow();
    expect(normalizeSetting('resend_from_email', ' A <a@b.c> ')).toBe('A <a@b.c>');
  });
});
