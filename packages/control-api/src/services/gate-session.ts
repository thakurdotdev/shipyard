import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Pure helpers for the project password gate: session tokens, redirect
 * sanitising and login throttling. Nothing here touches the database.
 */

export const GATE_COOKIE = 'shipyard_gate';
export const GATE_PATH_PREFIX = '/__shipyard_gate';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_SESSION_HOURS = 1;
export const MAX_SESSION_HOURS = 24 * 90;
export const DEFAULT_SESSION_HOURS = 24 * 7;

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error('BETTER_AUTH_SECRET is required for password-protected sites');
  return value;
}

/**
 * Per-project signing key. It is derived from the stored password hash, so
 * changing the password invalidates every existing session and monitor token.
 */
function projectKey(projectId: string, passwordHash: string): Buffer {
  return createHmac('sha256', secret())
    .update(`shipyard-gate-v1:${projectId}:${passwordHash}`)
    .digest();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `<expiry unix seconds>.<signature>` */
export function signSession(
  projectId: string,
  passwordHash: string,
  sessionHours: number,
  nowMs = Date.now(),
): string {
  const expires = Math.floor(nowMs / 1000) + Math.round(sessionHours * 3600);
  const signature = createHmac('sha256', projectKey(projectId, passwordHash))
    .update(`session.${projectId}.${expires}`)
    .digest('base64url');
  return `${expires}.${signature}`;
}

export function verifySession(
  token: string | undefined | null,
  projectId: string,
  passwordHash: string,
  nowMs = Date.now(),
): boolean {
  if (!token || token.length > 200) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expiresRaw = token.slice(0, dot);
  if (!/^\d{1,12}$/.test(expiresRaw)) return false;
  const expires = Number(expiresRaw);
  if (expires * 1000 <= nowMs) return false;
  const expected = createHmac('sha256', projectKey(projectId, passwordHash))
    .update(`session.${projectId}.${expires}`)
    .digest('base64url');
  return safeEqual(token.slice(dot + 1), expected);
}

/** Lets ShipYard's own uptime checks past the gate when they target the project domain. */
export function monitorToken(projectId: string, passwordHash: string): string {
  return createHmac('sha256', projectKey(projectId, passwordHash))
    .update(`monitor.${projectId}`)
    .digest('base64url');
}

export function verifyMonitorToken(
  token: string | undefined | null,
  projectId: string,
  passwordHash: string,
): boolean {
  return !!token && token.length < 100 && safeEqual(token, monitorToken(projectId, passwordHash));
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${GATE_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${GATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Only same-site absolute paths are allowed as a post-login destination, so the
 * login form can't be used as an open redirect. The gate's own pages are never
 * a destination (that would loop back to the form).
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || next.length > 2048) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  if (next === GATE_PATH_PREFIX || next.startsWith(`${GATE_PATH_PREFIX}/`)) return '/';
  return next;
}

export interface ThrottleOptions {
  maxFailures: number;
  windowMs: number;
}

/**
 * In-memory failed-attempt throttle. Keyed by project + client address so one
 * visitor guessing passwords can't lock out everyone else.
 */
export class LoginThrottle {
  private attempts = new Map<string, { failures: number; resetAt: number }>();

  constructor(private options: ThrottleOptions = { maxFailures: 5, windowMs: 10 * 60_000 }) {}

  /** Seconds the caller must wait, or 0 when an attempt is allowed. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.attempts.get(key);
    if (!entry) return 0;
    if (entry.resetAt <= now) {
      this.attempts.delete(key);
      return 0;
    }
    return entry.failures >= this.options.maxFailures ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  recordFailure(key: string, now = Date.now()) {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { failures: 1, resetAt: now + this.options.windowMs });
    } else {
      entry.failures += 1;
    }
    if (this.attempts.size > 10_000) this.prune(now);
  }

  reset(key: string) {
    this.attempts.delete(key);
  }

  private prune(now: number) {
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
  }
}

/** Host header from nginx, reduced to a lowercase hostname (no port). */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase().replace(/:\d+$/, '');
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(value) ? value : null;
}
