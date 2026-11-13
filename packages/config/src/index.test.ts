import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  childProcessEnv,
  config,
  deriveBaseDomain,
  deriveKey,
  findRepoRoot,
  getServerHost,
  loadRootEnv,
  parseDotenv,
} from './index';

const KEYS = [
  'PUBLIC_URL',
  'CLIENT_URL',
  'BETTER_AUTH_URL',
  'DASHBOARD_ORIGIN',
  'BASE_DOMAIN',
  'SECRET',
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'NODE_ENV',
  'PLATFORM_ENV',
  'DEPLOY_ENGINE_URL',
  'CONTROL_API_URL',
  'SERVER_HOST',
  'SHIPYARD_TEST_A',
  'SHIPYARD_TEST_B',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('parseDotenv', () => {
  test('handles quotes, export, comments and blank lines', () => {
    const parsed = parseDotenv(
      [
        '# comment',
        '',
        'A=plain',
        'export B=exported',
        "C='single $NOT_EXPANDED'",
        'D="double # not a comment"',
        'E=value # trailing comment',
        'F=',
        'not a line',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      A: 'plain',
      B: 'exported',
      C: 'single $NOT_EXPANDED',
      D: 'double # not a comment',
      E: 'value',
      F: '',
    });
  });
});

describe('loadRootEnv', () => {
  test('fills only unset keys and never shares PORT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-config-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'SHIPYARD_TEST_A=from-file\nSHIPYARD_TEST_B=from-file\nPORT=1\n');
    process.env.SHIPYARD_TEST_A = 'from-process';
    const port = process.env.PORT;
    loadRootEnv(file);
    expect(process.env.SHIPYARD_TEST_A).toBe('from-process');
    expect(process.env.SHIPYARD_TEST_B).toBe('from-file');
    expect(process.env.PORT).toBe(port);
    rmSync(dir, { recursive: true });
  });

  test('findRepoRoot walks up to the workspace package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-root-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    const pkg = join(dir, 'packages', 'api');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'api' }));
    expect(findRepoRoot(pkg)).toBe(dir);
    rmSync(dir, { recursive: true });
  });
});

describe('derived values', () => {
  test('base domain comes from the dashboard host', () => {
    expect(deriveBaseDomain('https://deploy.example.com')).toBe('example.com');
    expect(deriveBaseDomain('https://a.b.example.co.uk')).toBe('b.example.co.uk');
    expect(deriveBaseDomain('https://example.com')).toBe('example.com');
    expect(deriveBaseDomain('http://35.94.192.61')).toBe('localhost');
    expect(deriveBaseDomain('http://localhost:4013')).toBe('localhost');
    expect(deriveBaseDomain('not a url')).toBe('localhost');
  });

  test('BASE_DOMAIN overrides the derived value', () => {
    process.env.PUBLIC_URL = 'https://deploy.example.com';
    expect(config.baseDomain).toBe('example.com');
    process.env.BASE_DOMAIN = 'apps.example.net';
    expect(config.baseDomain).toBe('apps.example.net');
  });

  test('public URL falls back through the legacy names and drops paths', () => {
    expect(config.publicUrl).toBe('http://localhost:4013');
    process.env.BETTER_AUTH_URL = 'https://old.example.com/api';
    expect(config.publicUrl).toBe('https://old.example.com');
    process.env.CLIENT_URL = 'https://client.example.com/';
    expect(config.publicUrl).toBe('https://client.example.com');
    process.env.PUBLIC_URL = 'https://deploy.example.com/';
    expect(config.publicUrl).toBe('https://deploy.example.com');
  });

  test('production flag reads NODE_ENV or PLATFORM_ENV at runtime', () => {
    expect(config.isProduction).toBe(false);
    process.env.PLATFORM_ENV = 'production';
    expect(config.isProduction).toBe(true);
    delete process.env.PLATFORM_ENV;
    process.env.NODE_ENV = 'production';
    expect(config.isProduction).toBe(true);
  });

  test('internal URLs default to the standard local ports', () => {
    expect(config.controlApiUrl).toBe('http://127.0.0.1:4010');
    expect(config.deployEngineUrl).toBe('http://127.0.0.1:4012');
    process.env.DEPLOY_ENGINE_URL = 'http://localhost:9000/';
    expect(config.deployEngineUrl).toBe('http://localhost:9000');
  });
});

describe('secrets', () => {
  test('keys derive from SECRET and differ by purpose', () => {
    process.env.SECRET = 'master';
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.encryptionKey).toBe(deriveKey('master', 'encryption').slice(0, 32));
    expect(config.authSecret).toBe(deriveKey('master', 'auth'));
    expect(new Set([config.encryptionKey, config.authSecret, config.internalToken]).size).toBe(3);
    expect(config.setupToken).toHaveLength(24);
  });

  test('explicit legacy secrets win, so existing data stays readable', () => {
    process.env.SECRET = 'master';
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.BETTER_AUTH_SECRET = 'legacy-auth';
    expect(config.encryptionKey).toBe('0123456789abcdef0123456789abcdef');
    expect(config.authSecret).toBe('legacy-auth');
  });

  test('BETTER_AUTH_SECRET acts as the master secret on old installs', () => {
    process.env.BETTER_AUTH_SECRET = 'legacy-auth';
    expect(config.secret).toBe('legacy-auth');
    expect(config.internalToken).toBe(deriveKey('legacy-auth', 'internal'));
  });

  test('missing secret is a clear error', () => {
    expect(() => config.encryptionKey).toThrow(/SECRET is not set/);
    expect(config.internalToken).toBeUndefined();
  });

  test('child processes never see platform secrets', () => {
    process.env.SECRET = 'master';
    process.env.ENCRYPTION_KEY = 'k';
    process.env.SHIPYARD_TEST_A = 'kept';
    const child = childProcessEnv();
    expect(child.SECRET).toBeUndefined();
    expect(child.ENCRYPTION_KEY).toBeUndefined();
    expect(child.SHIPYARD_TEST_A).toBe('kept');
    expect(child.PATH).toBe(process.env.PATH);
  });
});

test('SERVER_HOST is used as-is when set', async () => {
  process.env.SERVER_HOST = '203.0.113.7';
  expect(await getServerHost()).toBe('203.0.113.7');
});
