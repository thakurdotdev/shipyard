import { beforeAll, describe, expect, it } from 'bun:test';

beforeAll(() => {
  process.env.SECRET = 'test-master-secret';
  delete process.env.BETTER_AUTH_SECRET;
});

const {
  buildManifest,
  convertManifestCode,
  createState,
  isValidSetupToken,
  manifestActionUrl,
  verifyState,
} = await import('./github-manifest');
const { config } = await import('@thakur-deploy/config');

describe('manifest', () => {
  it('describes an App with the URLs and permissions ShipYard uses', () => {
    const m = buildManifest('https://deploy.example.com', 'https://deploy.example.com') as any;
    expect(m.name).toBe('ShipYard deploy.example.com');
    expect(m.redirect_url).toBe('https://deploy.example.com/api/setup/github/callback');
    expect(m.callback_urls).toEqual(['https://deploy.example.com/api/auth/callback/github']);
    expect(m.setup_url).toBe('https://deploy.example.com/import');
    expect(m.hook_attributes).toEqual({
      url: 'https://deploy.example.com/api/github/webhook',
      active: true,
    });
    expect(m.default_events).toEqual(['push']);
    expect(m.default_permissions).toEqual({ contents: 'read', metadata: 'read' });
    expect(m.public).toBe(false);
  });

  it('keeps names within GitHub’s 34 character limit', () => {
    const m = buildManifest('https://a-very-long-subdomain-name.example.com', 'https://x.y') as any;
    expect(m.name.length).toBeLessThanOrEqual(34);
  });

  it('leaves out the webhook for local installs GitHub cannot reach', () => {
    for (const url of ['http://localhost:4013', 'http://192.168.1.5', 'http://10.0.0.2']) {
      const m = buildManifest(url, url) as any;
      expect(m.hook_attributes).toBeUndefined();
      expect(m.default_events).toBeUndefined();
    }
  });

  it('posts to the user or organization App page with the state', () => {
    expect(manifestActionUrl('s')).toBe('https://github.com/settings/apps/new?state=s');
    expect(manifestActionUrl('s', 'acme')).toBe(
      'https://github.com/organizations/acme/settings/apps/new?state=s',
    );
  });
});

describe('state', () => {
  it('round-trips and remembers where to return', () => {
    expect(verifyState(createState('setup'))).toBe('setup');
    expect(verifyState(createState('settings'))).toBe('settings');
  });

  it('rejects tampered, malformed and expired states', () => {
    const state = createState('setup');
    expect(verifyState(state.replace('.setup.', '.settings.'))).toBeNull();
    expect(verifyState(`${state}x`)).toBeNull();
    expect(verifyState('a.b.c')).toBeNull();
    expect(verifyState(undefined)).toBeNull();
    const old = createState('setup', Date.now() - 2 * 3600_000);
    expect(verifyState(old)).toBeNull();
  });
});

describe('setup token', () => {
  it('accepts only the code derived from SECRET', () => {
    expect(isValidSetupToken(config.setupToken)).toBe(true);
    expect(isValidSetupToken(` ${config.setupToken} `)).toBe(true);
    expect(isValidSetupToken('wrong')).toBe(false);
    expect(isValidSetupToken('')).toBe(false);
    expect(isValidSetupToken(undefined)).toBe(false);
  });
});

describe('code conversion', () => {
  it('returns the new App credentials', async () => {
    let calledUrl = '';
    const fakeFetch = (async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          id: 42,
          slug: 'shipyard-test',
          name: 'ShipYard test',
          client_id: 'Iv1.abc',
          client_secret: 'secret',
          webhook_secret: 'hook',
          pem: '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----',
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;
    const app = await convertManifestCode('abc123', fakeFetch);
    expect(calledUrl).toBe('https://api.github.com/app-manifests/abc123/conversions');
    expect(app.id).toBe(42);
    expect(app.slug).toBe('shipyard-test');
  });

  it('refuses odd codes and surfaces GitHub errors', async () => {
    await expect(convertManifestCode('../x')).rejects.toThrow('Invalid code');
    const failing = (async () =>
      new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
    await expect(convertManifestCode('abc', failing)).rejects.toThrow('HTTP 404');
  });
});
