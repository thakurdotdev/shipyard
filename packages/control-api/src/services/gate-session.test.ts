import { beforeAll, describe, expect, it } from 'bun:test';
import {
  LoginThrottle,
  monitorToken,
  normalizeHost,
  readCookie,
  sanitizeNext,
  signSession,
  verifyMonitorToken,
  verifySession,
} from './gate-session';

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-for-gate-tokens';
});

const HASH = '$argon2id$example-hash';

describe('session tokens', () => {
  it('accepts a fresh token for the same project and password', () => {
    const token = signSession('p1', HASH, 24);
    expect(verifySession(token, 'p1', HASH)).toBe(true);
  });

  it('rejects expired tokens', () => {
    const token = signSession('p1', HASH, 1, Date.now() - 2 * 3600_000);
    expect(verifySession(token, 'p1', HASH)).toBe(false);
  });

  it('is bound to the project, so one project’s cookie never opens another', () => {
    expect(verifySession(signSession('p1', HASH, 24), 'p2', HASH)).toBe(false);
  });

  it('is invalidated when the password changes', () => {
    expect(verifySession(signSession('p1', HASH, 24), 'p1', '$argon2id$new-hash')).toBe(false);
  });

  it('rejects tampered expiry or signature', () => {
    const [expires, signature] = signSession('p1', HASH, 1).split('.');
    expect(verifySession(`${Number(expires) + 3600}.${signature}`, 'p1', HASH)).toBe(false);
    expect(verifySession(`${expires}.${signature}x`, 'p1', HASH)).toBe(false);
  });

  it.each([undefined, null, '', 'garbage', '.', '123.', 'abc.def', `${'9'.repeat(300)}`])(
    'rejects malformed token %p',
    (token) => {
      expect(verifySession(token as string, 'p1', HASH)).toBe(false);
    },
  );
});

describe('monitor tokens', () => {
  it('verify only for their own project and password', () => {
    const token = monitorToken('p1', HASH);
    expect(verifyMonitorToken(token, 'p1', HASH)).toBe(true);
    expect(verifyMonitorToken(token, 'p2', HASH)).toBe(false);
    expect(verifyMonitorToken(token, 'p1', 'other')).toBe(false);
    expect(verifyMonitorToken(undefined, 'p1', HASH)).toBe(false);
  });

  it('are not interchangeable with session tokens', () => {
    expect(verifySession(monitorToken('p1', HASH), 'p1', HASH)).toBe(false);
  });
});

describe('sanitizeNext', () => {
  it('keeps same-site paths with their query', () => {
    expect(sanitizeNext('/dashboard?tab=a&b=2')).toBe('/dashboard?tab=a&b=2');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'dashboard',
    '/a\r\nSet-Cookie: x=1',
    '/__shipyard_gate/login',
    '/__shipyard_gate',
    `/${'a'.repeat(3000)}`,
    '',
    null,
    undefined,
  ])('falls back to / for %p', (value) => {
    expect(sanitizeNext(value as string)).toBe('/');
  });
});

describe('readCookie', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('a=1; shipyard_gate=tok.en; b=2', 'shipyard_gate')).toBe('tok.en');
    expect(readCookie('a=1', 'shipyard_gate')).toBeUndefined();
    expect(readCookie(null, 'shipyard_gate')).toBeUndefined();
  });
});

describe('normalizeHost', () => {
  it('lowercases and drops the port', () => {
    expect(normalizeHost('Site.Thakur.dev:443')).toBe('site.thakur.dev');
  });
  it.each(['', null, 'bad host', 'a/b', '-x.com', 'x.com\nfoo'])('rejects %p', (value) => {
    expect(normalizeHost(value)).toBeNull();
  });
});

describe('LoginThrottle', () => {
  const options = { maxFailures: 3, windowMs: 60_000 };

  it('blocks after repeated failures and reports the wait', () => {
    const throttle = new LoginThrottle(options);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(throttle.retryAfter('k', now)).toBe(0);
      throttle.recordFailure('k', now);
    }
    expect(throttle.retryAfter('k', now)).toBe(60);
    expect(throttle.retryAfter('k', now + 30_000)).toBe(30);
  });

  it('is per key', () => {
    const throttle = new LoginThrottle(options);
    for (let i = 0; i < 3; i++) throttle.recordFailure('a');
    expect(throttle.retryAfter('a')).toBeGreaterThan(0);
    expect(throttle.retryAfter('b')).toBe(0);
  });

  it('forgives after the window or a successful login', () => {
    const throttle = new LoginThrottle(options);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) throttle.recordFailure('k', now);
    expect(throttle.retryAfter('k', now + 60_001)).toBe(0);
    for (let i = 0; i < 3; i++) throttle.recordFailure('k', now);
    throttle.reset('k');
    expect(throttle.retryAfter('k', now)).toBe(0);
  });
});
