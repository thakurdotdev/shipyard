import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.BETTER_AUTH_SECRET = 'test-secret-for-gate-routes';

const { Elysia } = await import('elysia');
const { gateRoutes } = await import('./gate');
const { GateService } = await import('../services/gate-service');
const { GATE_COOKIE, signSession, monitorToken } = await import('../services/gate-session');

const app = new Elysia().use(gateRoutes);
const HOST = 'private.thakur.dev';
let hash: string;

beforeAll(async () => {
  hash = await Bun.password.hash('correct horse', { algorithm: 'argon2id' });
});

type Overrides = Partial<{ enabled: boolean; passwordHash: string | null; sessionHours: number }>;
function stubProject(overrides: Overrides = {}) {
  return spyOn(GateService, 'findByHost').mockImplementation(async (host: string) =>
    host === HOST
      ? {
          projectId: 'proj-1',
          projectName: 'My <Private> App',
          enabled: true,
          passwordHash: hash,
          sessionHours: 2,
          ...overrides,
        }
      : null,
  );
}

const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.handle(
    new Request(`http://control${path}`, {
      ...init,
      headers: { 'x-gate-host': HOST, 'x-real-ip': '1.2.3.4', ...init.headers },
    }),
  );

const login = (password: string, next = '/', ip = '1.2.3.4', extra: Record<string, string> = {}) =>
  call('/gate/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, ...extra },
    body: new URLSearchParams({ password, next }).toString(),
  });

afterEach(() => {
  GateService.invalidate();
});

describe('GET /gate/verify', () => {
  it('admits a visitor holding a valid session cookie', async () => {
    stubProject();
    const token = signSession('proj-1', hash, 2);
    const res = await call('/gate/verify', { headers: { cookie: `${GATE_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
  });

  it('asks everyone else to log in', async () => {
    stubProject();
    expect((await call('/gate/verify')).status).toBe(401);
    expect(
      (await call('/gate/verify', { headers: { cookie: `${GATE_COOKIE}=forged.value` } })).status,
    ).toBe(401);
  });

  it('rejects a session minted for another password', async () => {
    stubProject();
    const stale = signSession('proj-1', '$argon2id$old-password', 2);
    expect(
      (await call('/gate/verify', { headers: { cookie: `${GATE_COOKIE}=${stale}` } })).status,
    ).toBe(401);
  });

  it('lets the uptime monitor through with its token', async () => {
    stubProject();
    const res = await call('/gate/verify', {
      headers: { 'x-shipyard-gate-monitor': monitorToken('proj-1', hash) },
    });
    expect(res.status).toBe(200);
    expect(
      (await call('/gate/verify', { headers: { 'x-shipyard-gate-monitor': 'nope' } })).status,
    ).toBe(401);
  });

  it('allows everyone when protection is switched off', async () => {
    stubProject({ enabled: false });
    expect((await call('/gate/verify')).status).toBe(200);
  });

  it('fails closed for unknown hosts, missing hosts and passwordless records', async () => {
    stubProject();
    expect(
      (await call('/gate/verify', { headers: { 'x-gate-host': 'other.thakur.dev' } })).status,
    ).toBe(403);
    expect((await call('/gate/verify', { headers: { 'x-gate-host': 'bad host' } })).status).toBe(
      403,
    );
    GateService.invalidate();
    stubProject({ passwordHash: null });
    expect((await call('/gate/verify')).status).toBe(403);
  });
});

describe('GET /gate/login', () => {
  it('renders an escaped, locked-down login page that remembers the requested URL', async () => {
    stubProject();
    const res = await call('/gate/login', { headers: { 'x-original-uri': '/docs?a=1&b="2"' } });
    const body = await res.text();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(body).toContain('My &lt;Private&gt; App');
    expect(body).not.toContain('<Private>');
    expect(body).toContain('value="/docs?a=1&amp;b=&quot;2&quot;"');
    expect(body).toContain('name="password"');
  });

  it('takes the destination from ?next= when the form is opened directly', async () => {
    stubProject();
    const res = await call('/gate/login', {
      headers: { 'x-original-uri': '/__shipyard_gate/login?next=/pricing' },
    });
    expect(await res.text()).toContain('value="/pricing"');
  });

  it('sends visitors straight on when protection is off', async () => {
    stubProject({ enabled: false });
    const res = await call('/gate/login', { headers: { 'x-original-uri': '/docs' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/docs');
  });
});

describe('POST /gate/login', () => {
  it('sets a hardened session cookie and returns to the requested page', async () => {
    stubProject();
    const res = await login('correct horse', '/docs?x=1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/docs?x=1');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${GATE_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=7200');

    // The cookie it hands out really opens the gate.
    const token = /shipyard_gate=([^;]+)/.exec(cookie)![1];
    expect(
      (await call('/gate/verify', { headers: { cookie: `${GATE_COOKIE}=${token}` } })).status,
    ).toBe(200);
  });

  it('shows an error and no cookie for a wrong password', async () => {
    stubProject();
    const res = await login('wrong', '/docs', '5.5.5.5');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = await res.text();
    expect(body).toContain('Incorrect password');
    expect(body).toContain('value="/docs"');
  });

  it('never redirects off-site', async () => {
    stubProject();
    const res = await login('correct horse', 'https://evil.example/', '6.6.6.6');
    expect(res.headers.get('location')).toBe('/');
  });

  it('throttles repeated wrong guesses from one address, then recovers per address', async () => {
    stubProject();
    for (let i = 0; i < 5; i++) expect((await login('nope', '/', '7.7.7.7')).status).toBe(401);
    const blocked = await login('correct horse', '/', '7.7.7.7');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    // A different visitor is unaffected.
    expect((await login('correct horse', '/', '8.8.8.8')).status).toBe(303);
  });

  it('refuses cross-site form posts', async () => {
    stubProject();
    const res = await login('correct horse', '/', '9.9.9.9', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    const same = await login('correct horse', '/', '9.9.9.9', { origin: `https://${HOST}` });
    expect(same.status).toBe(303);
  });

  it('rejects empty and oversized passwords without checking them', async () => {
    stubProject();
    expect((await login('', '/', '10.0.0.1')).status).toBe(401);
    expect((await login('x'.repeat(5000), '/', '10.0.0.2')).status).toBe(401);
  });
});

describe('GET /gate/logout', () => {
  it('clears the session cookie', async () => {
    const res = await call('/gate/logout');
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
