/**
 * Platform configuration shared by the Control API and the Deploy Engine.
 *
 * A server needs only a handful of values in one `.env` at the repository root:
 *
 *   DATABASE_URL   Postgres connection string
 *   REDIS_URL      Redis connection string (default redis://127.0.0.1:6379/0)
 *   PUBLIC_URL     Where the dashboard is served, e.g. https://deploy.example.com
 *   SECRET         One long random string; every other secret is derived from it
 *
 * Everything else is derived (base domain, auth/encryption keys, internal URLs) or
 * stored in the database and edited from the dashboard (GitHub, Cloudflare, email).
 *
 * Older installs keep working: per-package `.env` files are still loaded by Bun and take
 * precedence, and the old names (CLIENT_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY,
 * PLATFORM_ENV, ...) are still honoured. Explicit values always win over derived ones,
 * which matters for ENCRYPTION_KEY: data encrypted with it must stay readable.
 */
import { createHmac } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { dirname, join } from 'path';

// Read through an alias: `bun build` replaces the literal `process.env.NODE_ENV` with its
// build-time value, which once compiled production behaviour out of a bundle.
const env: Record<string, string | undefined> = process.env;

/** Keys that are per-process and must not be shared through the root `.env`. */
const PER_PROCESS_KEYS = new Set(['PORT']);

/** Parse a dotenv file: KEY=value, optional `export`, quotes, `#` comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    let value = rest.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** The repository root: the nearest parent of `from` whose package.json has workspaces. */
export function findRepoRoot(from = process.cwd()): string | null {
  let dir = from;
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {
        // unreadable package.json: keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load the root `.env` into process.env without overriding anything already set
 * (process environment and per-package `.env` files win). Runs once on import.
 */
export function loadRootEnv(file = env.SHIPYARD_ENV_FILE): string | null {
  const path =
    file ||
    (() => {
      const root = findRepoRoot();
      return root ? join(root, '.env') : null;
    })();
  if (!path || !existsSync(path)) return null;
  const values = parseDotenv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (PER_PROCESS_KEYS.has(key)) continue;
    if (env[key] === undefined) env[key] = value;
  }
  return path;
}

export const rootEnvPath = loadRootEnv();

// ---------------------------------------------------------------------------------------

function trimmed(key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Apps are served at <name>.<base domain>. Derived from the dashboard host by dropping
 * its first label: deploy.example.com -> example.com. A dashboard on the apex
 * (example.com) hosts apps under itself. IPs and localhost fall back to `localhost`,
 * where browsers resolve <name>.localhost to this machine.
 */
export function deriveBaseDomain(publicUrl: string): string {
  let host: string;
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    return 'localhost';
  }
  if (!host || host === 'localhost' || isIpAddress(host) || !host.includes('.')) {
    return 'localhost';
  }
  const labels = host.split('.');
  return labels.length >= 3 ? labels.slice(1).join('.') : host;
}

/** A purpose-specific key derived from the master secret (hex, 64 chars). */
export function deriveKey(master: string, purpose: string): string {
  return createHmac('sha256', master).update(`shipyard:${purpose}`).digest('hex');
}

function requireMaster(what: string): string {
  const master = config.secret;
  if (!master) {
    throw new Error(
      `SECRET is not set (needed for ${what}). Add SECRET=<long random string> to .env`,
    );
  }
  return master;
}

export const config = {
  /** Production behaviour: real domains, Nginx, certificates. Read at runtime. */
  get isProduction(): boolean {
    return env['NODE_ENV'] === 'production' || env['PLATFORM_ENV'] === 'production';
  },

  /** Dashboard origin, e.g. https://deploy.example.com (no trailing slash). */
  get publicUrl(): string {
    return (
      originOf(trimmed('PUBLIC_URL')) ||
      originOf(trimmed('CLIENT_URL')) ||
      originOf(trimmed('BETTER_AUTH_URL')) ||
      originOf(trimmed('DASHBOARD_ORIGIN')) ||
      'http://localhost:4013'
    );
  },

  get baseDomain(): string {
    return trimmed('BASE_DOMAIN') || deriveBaseDomain(this.publicUrl);
  },

  get databaseUrl(): string {
    const url = trimmed('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is not set. Add it to .env');
    return url;
  },

  get redisUrl(): string {
    return trimmed('REDIS_URL') || 'redis://127.0.0.1:6379/0';
  },

  get controlApiUrl(): string {
    return (trimmed('CONTROL_API_URL') || 'http://127.0.0.1:4010').replace(/\/+$/, '');
  },

  get deployEngineUrl(): string {
    return (trimmed('DEPLOY_ENGINE_URL') || 'http://127.0.0.1:4012').replace(/\/+$/, '');
  },

  /** Master secret. BETTER_AUTH_SECRET stands in on installs from before SECRET existed. */
  get secret(): string | undefined {
    return trimmed('SECRET') || trimmed('BETTER_AUTH_SECRET');
  },

  /** Signs login sessions (and password-gate cookies). */
  get authSecret(): string {
    return trimmed('BETTER_AUTH_SECRET') || deriveKey(requireMaster('sign-in'), 'auth');
  },

  /**
   * AES-256 key for stored env vars and credentials. Used as a 32-character string, the
   * same shape ENCRYPTION_KEY always had, so explicitly set keys keep decrypting.
   */
  get encryptionKey(): string {
    const explicit = trimmed('ENCRYPTION_KEY');
    if (explicit) return explicit;
    return deriveKey(requireMaster('encryption'), 'encryption').slice(0, 32);
  },

  /** Shared by Control API and Deploy Engine to authenticate internal calls. */
  get internalToken(): string | undefined {
    const master = this.secret;
    return master ? deriveKey(master, 'internal') : undefined;
  },

  /** One-time code that unlocks first-run setup before anyone can sign in. */
  get setupToken(): string | undefined {
    const master = this.secret;
    return master ? deriveKey(master, 'setup').slice(0, 24) : undefined;
  },
};

let serverHostPromise: Promise<string> | null = null;

/**
 * Public IP of this server, used for DNS records and connection strings.
 * SERVER_HOST wins; otherwise detected once (public lookup, then interfaces).
 */
export function getServerHost(): Promise<string> {
  const explicit = trimmed('SERVER_HOST');
  if (explicit) return Promise.resolve(explicit);
  serverHostPromise ??= detectServerHost();
  return serverHostPromise;
}

async function detectServerHost(): Promise<string> {
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const ip = (await res.text()).trim();
      if (res.ok && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      // try the next source
    }
  }
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

/** Platform-only variables that must never reach user builds or deploy commands. */
const PLATFORM_SECRET_KEYS = [
  'SECRET',
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'CLOUDFLARE_API_TOKEN',
  'RESEND_API_KEY',
];

/** process.env minus the platform's own secrets, for spawning user commands. */
export function childProcessEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const key of PLATFORM_SECRET_KEYS) delete out[key];
  return out;
}
