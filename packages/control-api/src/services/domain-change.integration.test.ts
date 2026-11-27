/**
 * Moves real projects between domains against a real Postgres, with Cloudflare and the
 * deploy engine replaced by an in-memory fake. Needs a scratch database:
 *
 *   TEST_DATABASE_URL=postgres://... (migrated) DATABASE_URL=$TEST_DATABASE_URL \
 *     PLATFORM_ENV=production SERVER_HOST=203.0.113.10 BASE_DOMAIN=example.com \
 *     bun test src/services/domain-change.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

const enabled =
  Boolean(process.env.TEST_DATABASE_URL) &&
  process.env.DATABASE_URL === process.env.TEST_DATABASE_URL &&
  process.env.PLATFORM_ENV === 'production' &&
  process.env.SERVER_HOST === '203.0.113.10' &&
  process.env.BASE_DOMAIN === 'example.com';

const IP = '203.0.113.10';
const ZONE = 'a'.repeat(32);

interface FakeRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

// Defined only when enabled: the suite imports the database module, which needs it.
(enabled ? describe : describe.skip)('moving a project between domains', async () => {
  if (!enabled) return;
  const { db } = await import('../db');
  const schema = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const { SettingsService } = await import('./settings-service');
  const { DomainChangeService } = await import('./domain-change-service');
  const { DomainService } = await import('./domain-service');

  let records: FakeRecord[];
  let calls: { method: string; path: string; body?: any }[];
  let certCovers: Set<string>;
  let activateFails: boolean;
  let nextId = 1;
  const realFetch = globalThis.fetch;

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });

    if (url.hostname === 'api.cloudflare.com') {
      const path = url.pathname.replace('/client/v4', '');
      if (path === '/zones') {
        const name = url.searchParams.get('name');
        return json({ success: true, result: name === 'example.com' ? [{ id: ZONE, name }] : [] });
      }
      if (path === `/zones/${ZONE}`)
        return json({ success: true, result: { id: ZONE, name: 'example.com' } });
      if (path === `/zones/${ZONE}/dns_records` && method === 'GET') {
        const name = url.searchParams.get('name');
        return json({ success: true, result: records.filter((r) => r.name === name) });
      }
      if (path === `/zones/${ZONE}/dns_records` && method === 'POST') {
        const record = { id: `rec-${nextId++}`, ...body };
        records.push(record);
        return json({ success: true, result: record });
      }
      const recordMatch = path.match(new RegExp(`^/zones/${ZONE}/dns_records/(.+)$`));
      if (recordMatch) {
        const record = records.find((r) => r.id === recordMatch[1]);
        if (!record) return json({ success: false, errors: [{ message: 'not found' }] }, 404);
        if (method === 'DELETE') records = records.filter((r) => r !== record);
        if (method === 'PATCH') Object.assign(record, body);
        return json({ success: true, result: record });
      }
      return json({ success: false, errors: [{ message: `unexpected ${path}` }] }, 404);
    }

    // Deploy engine
    switch (url.pathname) {
      case '/ssl/status': {
        const names = [
          url.searchParams.get('domain'),
          ...(url.searchParams.get('aliases') || '').split(',').filter(Boolean),
        ];
        return json({ success: true, covered: names.every((n) => certCovers.has(n!)) });
      }
      case '/ssl/issue':
        for (const n of [body.domain, ...(body.aliases ?? [])]) certCovers.add(n);
        return json({
          success: true,
          reused: false,
          certPath: `/etc/letsencrypt/live/${body.domain}/fullchain.pem`,
        });
      case '/activate':
        return activateFails
          ? new Response('new site did not answer', { status: 500 })
          : json({ success: true, hosting: 'static' });
      case '/nginx/conflicts':
        return json({
          conflicts:
            body.subdomain === 'example.com'
              ? [
                  {
                    file: '/etc/nginx/sites-enabled/portfolio',
                    names: ['example.com', 'www.example.com'],
                  },
                ]
              : [],
        });
      default:
        return json({ success: true });
    }
  }

  let projectId: string;
  let otherProjectId: string;

  async function seed(provision: Partial<typeof schema.domainProvisions.$inferInsert>) {
    await db.delete(schema.domainProvisions);
    await db.delete(schema.buildLogs);
    await db.delete(schema.deployments);
    await db.delete(schema.builds);
    await db.delete(schema.uptimeMonitors);
    await db.delete(schema.projects);
    const [project] = await db
      .insert(schema.projects)
      .values({
        name: 'portfolio',
        github_url: 'https://github.com/x/portfolio',
        build_command: 'bun run build',
        app_type: 'vite',
        domain: 'portfolio.example.com',
      })
      .returning();
    projectId = project.id;
    const [other] = await db
      .insert(schema.projects)
      .values({
        name: 'shop',
        github_url: 'https://github.com/x/shop',
        build_command: 'bun run build',
        app_type: 'vite',
        domain: 'shop.example.com',
      })
      .returning();
    otherProjectId = other.id;
    const [build] = await db
      .insert(schema.builds)
      .values({ project_id: projectId, status: 'success' })
      .returning();
    await db
      .insert(schema.deployments)
      .values({ project_id: projectId, build_id: build.id, status: 'active' });
    await db.insert(schema.domainProvisions).values({
      project_id: projectId,
      subdomain: 'portfolio',
      full_domain: 'portfolio.example.com',
      server_ip: IP,
      dns_record_id: 'rec-portfolio',
      dns_status: 'proxied',
      ssl_status: 'issued',
      ...provision,
    });
  }

  async function project() {
    return (await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) }))!;
  }

  async function finish() {
    for (let i = 0; i < 200; i++) {
      const state = DomainChangeService.getSwitch(projectId);
      if (state && state.state !== 'running') return state;
      await Bun.sleep(10);
    }
    throw new Error('domain switch did not finish');
  }

  let settings: ReturnType<typeof spyOn>;
  let dnsWait: ReturnType<typeof spyOn>;
  beforeAll(() => {
    dnsWait = spyOn(DomainService, 'waitForDns').mockResolvedValue(undefined);
    settings = spyOn(SettingsService, 'get').mockImplementation(((key: string) =>
      key === 'cloudflare_api_token'
        ? 'token'
        : key === 'cloudflare_zone_id'
          ? ZONE
          : undefined) as any);
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    settings.mockRestore();
    dnsWait.mockRestore();
    globalThis.fetch = realFetch;
  });
  beforeEach(() => {
    calls = [];
    activateFails = false;
    certCovers = new Set(['portfolio.example.com', 'example.com', 'www.example.com']);
    records = [
      { id: 'rec-portfolio', type: 'A', name: 'portfolio.example.com', content: IP, proxied: true },
      { id: 'rec-apex', type: 'A', name: 'example.com', content: IP, proxied: true },
      { id: 'rec-mx', type: 'MX', name: 'example.com', content: 'mx.example.net', proxied: false },
      { id: 'rec-www', type: 'A', name: 'www.example.com', content: IP, proxied: true },
    ];
  });

  test('check reports reuse, takeover and blockers without changing anything', async () => {
    await seed({});
    const ok = await DomainChangeService.check(await project(), 'https://Example.com/', true);
    expect(ok.errors).toEqual([]);
    expect(ok.domain).toBe('example.com');
    expect(ok.hosts).toEqual([
      { name: 'example.com', status: 'ours', proxied: true },
      { name: 'www.example.com', status: 'ours', proxied: true },
    ]);
    expect(ok.replaces[0].file).toContain('portfolio');

    records.find((r) => r.id === 'rec-www')!.content = '9.9.9.9';
    const blocked = await DomainChangeService.check(await project(), 'example.com', true);
    expect(blocked.errors.join(' ')).toContain('points somewhere else');

    const taken = await DomainChangeService.check(await project(), 'shop', false);
    expect(taken.errors.join(' ')).toContain('used by project "shop"');
    expect(calls.some((c) => c.method !== 'GET' && c.path.includes('dns_records'))).toBe(false);
    expect(otherProjectId).toBeTruthy();
  });

  test('moves to the apex with www, reusing its DNS and certificate, and retires the old subdomain', async () => {
    await seed({});
    const started = await DomainChangeService.start(await project(), 'example.com', true);
    expect(started.started).toBe(true);
    const result = await finish();
    expect(result.state).toBe('done');

    const moved = await project();
    expect(moved.domain).toBe('example.com');
    expect(moved.www_redirect).toBe(true);

    const activate = calls.find((c) => c.path === '/activate')!;
    expect(activate.body.subdomain).toBe('example.com');
    expect(activate.body.aliases).toEqual(['www.example.com']);
    // The certificate exists: no ACME listener, nothing written before the single switch.
    expect(
      calls.some((c) => c.path === '/nginx/http-only' || c.path === '/nginx/upgrade-https'),
    ).toBe(false);

    const provision = (await DomainService.getByProjectId(projectId))!;
    expect(provision.full_domain).toBe('example.com');
    expect(provision.subdomain).toBe('example.com');
    expect(provision.dns_record_owned).toBe(false);
    expect(provision.ssl_reused).toBe(false); // the fake engine reports a fresh issue
    expect(JSON.parse(provision.alias_records!)).toEqual([
      { name: 'www.example.com', id: 'rec-www', zoneId: ZONE, owned: false },
    ]);

    // Existing apex/www/mail records untouched; the old subdomain's own record removed.
    expect(records.map((r) => r.id).sort()).toEqual(['rec-apex', 'rec-mx', 'rec-www']);
    expect(records.find((r) => r.id === 'rec-apex')!.proxied).toBe(true);
    expect(calls.find((c) => c.path === '/nginx/remove')!.body).toEqual({ subdomain: 'portfolio' });
    expect(calls.find((c) => c.path === '/ssl/revoke')!.body).toEqual({
      domain: 'portfolio.example.com',
    });
  });

  test('a failed switch puts the old domain and its records back', async () => {
    await seed({});
    activateFails = true;
    certCovers = new Set(['portfolio.example.com']); // the new one needs a certificate
    await DomainChangeService.start(await project(), 'newsite', false);
    const result = await finish();
    expect(result.state).toBe('failed');
    expect(result.message).toContain('portfolio.example.com is still live');

    const back = await project();
    expect(back.domain).toBe('portfolio.example.com');
    const provision = (await DomainService.getByProjectId(projectId))!;
    expect(provision.full_domain).toBe('portfolio.example.com');
    expect(provision.dns_record_id).toBe('rec-portfolio');
    expect(provision.dns_status).toBe('proxied');
    // The record created for the new name is gone again; the old site was never touched.
    expect(records.some((r) => r.name === 'newsite.example.com')).toBe(false);
    expect(records.some((r) => r.id === 'rec-portfolio')).toBe(true);
    // Only the new name's own HTTP-only config is removed; the old site is never touched.
    expect(calls.filter((c) => c.path === '/nginx/remove').map((c) => c.body)).toEqual([
      { subdomain: 'newsite' },
    ]);
    expect(calls.some((c) => c.path === '/ssl/revoke')).toBe(false);
  });

  test('refuses to take over a site when no certificate covers the domain yet', async () => {
    await seed({});
    certCovers = new Set(['portfolio.example.com']);
    const check = await DomainChangeService.check(await project(), 'example.com', true);
    expect(check.errors.join(' ')).toContain('no certificate covering');
    await expect(DomainChangeService.start(await project(), 'example.com', true)).rejects.toThrow(
      'no certificate covering',
    );
    expect((await project()).domain).toBe('portfolio.example.com');
  });

  test('deleting a project never removes DNS records or certificates it found in place', async () => {
    await seed({
      subdomain: 'example.com',
      full_domain: 'example.com',
      dns_record_id: 'rec-apex',
      dns_record_owned: false,
      ssl_reused: true,
      alias_records: JSON.stringify([
        { name: 'www.example.com', id: 'rec-www', zoneId: ZONE, owned: false },
      ]),
    });
    await DomainService.deprovision(projectId);
    expect(records.map((r) => r.id).sort()).toEqual([
      'rec-apex',
      'rec-mx',
      'rec-portfolio',
      'rec-www',
    ]);
    expect(calls.some((c) => c.path === '/ssl/revoke')).toBe(false);
    expect(calls.find((c) => c.path === '/nginx/remove')!.body).toEqual({
      subdomain: 'example.com',
    });
  });

  test('switching www off keeps the site and drops only a www record ShipYard created', async () => {
    await seed({
      subdomain: 'example.com',
      full_domain: 'example.com',
      dns_record_id: 'rec-apex',
      dns_record_owned: false,
      ssl_reused: true,
      alias_records: JSON.stringify([
        { name: 'www.example.com', id: 'rec-www', zoneId: ZONE, owned: true },
      ]),
    });
    await db
      .update(schema.projects)
      .set({ domain: 'example.com', www_redirect: true })
      .where(eq(schema.projects.id, projectId));
    await DomainChangeService.start(await project(), 'example.com', false);
    expect((await finish()).state).toBe('done');
    expect(records.some((r) => r.id === 'rec-www')).toBe(false);
    expect(records.some((r) => r.id === 'rec-apex')).toBe(true);
    expect(calls.some((c) => c.path === '/nginx/remove')).toBe(false);
    expect(calls.find((c) => c.path === '/activate')!.body.aliases).toEqual([]);
  });
});
