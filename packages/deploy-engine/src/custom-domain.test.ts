import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { existsSync, readdirSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '@thakur-deploy/config';
import { NginxService, serverNames } from './services/nginx-service';
import { parseSanNames } from './services/ssl-service';

const base = config.baseDomain;
const dashboard = new URL(config.publicUrl).hostname;

describe('site names', () => {
  test('labels stay subdomains of the base domain', () => {
    expect(NginxService.domainForSubdomain('portfolio')).toBe(`portfolio.${base}`);
  });

  test('full hostnames are custom domains', () => {
    expect(NginxService.isSubdomainAllowed('example.com')).toBe(true);
    expect(NginxService.isSubdomainAllowed('shop.example.co.uk')).toBe(true);
    expect(NginxService.domainForSubdomain('example.com')).toBe('example.com');
  });

  test('rejects the dashboard, unnormalized names and junk', () => {
    if (dashboard.includes('.')) expect(NginxService.isSubdomainAllowed(dashboard)).toBe(false);
    for (const bad of [
      'Example.com',
      'example',
      'a..b.com',
      '-x.com',
      'x.com/evil',
      'x.com;',
      '../etc.com',
      'x.c',
      // A plain <label>.<base> is always named by its label, never as a custom domain.
      `portfolio.${base}`,
    ]) {
      expect(NginxService.isSubdomainAllowed(bad)).toBe(bad === 'example' ? true : false);
    }
  });

  test('only www.<domain> of a custom domain can redirect', () => {
    expect(NginxService.normalizeAliases('example.com', ['WWW.example.com '])).toEqual([
      'www.example.com',
    ]);
    expect(() => NginxService.normalizeAliases('example.com', ['other.com'])).toThrow();
    expect(() => NginxService.normalizeAliases('portfolio', [`www.portfolio.${base}`])).toThrow();
  });

  test('reads certificate names and server names', () => {
    expect(
      parseSanNames('X509v3 Subject Alternative Name:\n    DNS:thakur.dev, DNS:www.thakur.dev'),
    ).toEqual(['thakur.dev', 'www.thakur.dev']);
    expect(serverNames('server_name a.com  www.a.com;\nserver_name _ *.a.com ~^x;')).toEqual([
      'a.com',
      'www.a.com',
    ]);
  });
});

describe('custom domain configs', () => {
  let directory: string;
  let oldSitesDir: string | undefined;
  let oldReplaced: string | undefined;
  let reload: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    directory = await mkdtemp('/tmp/shipyard-custom-domain-');
    oldSitesDir = process.env.NGINX_SITES_DIR;
    oldReplaced = process.env.NGINX_REPLACED_DIR;
    process.env.NGINX_SITES_DIR = join(directory, 'sites');
    process.env.NGINX_REPLACED_DIR = join(directory, 'replaced');
    await Bun.write(join(directory, 'sites', '.keep'), '');
    reload = spyOn(NginxService, 'reload').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    reload.mockRestore();
    if (oldSitesDir === undefined) delete process.env.NGINX_SITES_DIR;
    else process.env.NGINX_SITES_DIR = oldSitesDir;
    if (oldReplaced === undefined) delete process.env.NGINX_REPLACED_DIR;
    else process.env.NGINX_REPLACED_DIR = oldReplaced;
    // The takeover creates its folder with sudo, as it does under /etc/nginx.
    await Bun.spawn(['sudo', 'rm', '-rf', directory]).exited;
  });

  test('serves the apex and redirects www in one hop, over HTTP and HTTPS', () => {
    const conf = NginxService.generateStaticDomainConfig(
      'example.com',
      '/srv/site/out',
      false,
      'pages',
      ['www.example.com'],
    );
    expect(conf).toContain('# shipyard-redirects: ["www.example.com"]');
    expect(conf).toContain('server_name example.com www.example.com;'); // port 80
    expect(conf).toContain('location / { return 301 https://example.com$request_uri; }');
    expect(conf).toContain('server_name www.example.com;'); // HTTPS redirect server
    expect(
      conf.match(/ssl_certificate \/etc\/letsencrypt\/live\/example\.com\/fullchain\.pem;/g),
    ).toHaveLength(2);
    expect(conf).not.toContain(`example.com.${base}`);

    const proxy = NginxService.generateConfig('example.com', 5100, false, ['www.example.com']);
    expect(proxy).toContain('proxy_pass http://127.0.0.1:5100;');
    expect(proxy).toContain('server_name www.example.com;');
    const http = NginxService.generateHttpOnlyConfig('example.com', 5100, false, [
      'www.example.com',
    ]);
    expect(http).toContain('server_name example.com www.example.com;');
  });

  test('every HTTPS server includes the optional site guard, and only HTTPS servers', () => {
    const guard = 'include /etc/nginx/snippets/shipyard-site-guard*.conf;';
    const count = (text: string) => text.split(guard).length - 1;
    const aliases = ['www.example.com'];
    // Site, then its www redirect: two HTTPS servers each.
    expect(count(NginxService.generateConfig('example.com', 5100, false, aliases))).toBe(2);
    expect(
      count(
        NginxService.generateStaticDomainConfig('example.com', '/srv/out', false, 'spa', aliases),
      ),
    ).toBe(2);
    expect(count(NginxService.generateHttpOnlyConfig('example.com', 5100, false, aliases))).toBe(0);

    process.env.NGINX_SITE_GUARD = '/srv/guards/*.conf';
    try {
      expect(NginxService.generateConfig('example.com', 5100, false)).toContain(
        'include /srv/guards/*.conf;',
      );
    } finally {
      delete process.env.NGINX_SITE_GUARD;
    }
  });

  test('redirect names persist through gate and preview rewrites', async () => {
    await NginxService.applyDomainConfig(
      'example.com',
      NginxService.generateStaticDomainConfig('example.com', '/srv/out', false, 'pages', [
        'www.example.com',
      ]),
    );
    expect(NginxService.getAliases('example.com')).toEqual(['www.example.com']);
    expect(await NginxService.setGate('example.com', null, true)).toBe(true);
    const gated = await readFile(join(directory, 'sites', 'example.com.conf'), 'utf8');
    expect(gated).toContain('# shipyard-gate: on');
    expect(gated).toContain('server_name www.example.com;');
    expect(gated).toContain('# shipyard-static-kind: pages');
  });

  test('takes over a hand-written site for the same domain, in the same reload', async () => {
    const legacy = join(directory, 'sites', 'portfolio');
    await writeFile(
      legacy,
      'server {\n    listen 443 ssl;\n    server_name example.com www.example.com;\n}\n',
    );
    await writeFile(join(directory, 'sites', 'other'), 'server { server_name other.com; }\n');

    expect(
      NginxService.findConflicts('example.com', ['example.com', 'www.example.com']).map((c) =>
        c.file.split('/').pop(),
      ),
    ).toEqual(['portfolio']);

    let legacyPresentAtReload = null as boolean | null;
    reload.mockImplementation(async () => {
      legacyPresentAtReload = existsSync(legacy);
    });
    await NginxService.applyDomainConfig(
      'example.com',
      NginxService.generateStaticDomainConfig('example.com', '/srv/out', false, 'pages', [
        'www.example.com',
      ]),
    );
    expect(legacyPresentAtReload).toBe(false);
    expect(existsSync(legacy)).toBe(false);
    expect(readdirSync(join(directory, 'replaced'))[0]).toStartWith('portfolio.');
    expect(existsSync(join(directory, 'sites', 'other'))).toBe(true);
    // Its own config is never a conflict with itself.
    expect(NginxService.findConflicts('example.com', ['example.com'])).toEqual([]);
  });

  test('a failed switch restores the site it took over', async () => {
    const legacy = join(directory, 'sites', 'portfolio');
    const legacyContent = 'server { server_name example.com; }\n';
    await writeFile(legacy, legacyContent);
    await expect(
      NginxService.applyDomainConfig(
        'example.com',
        NginxService.generateStaticDomainConfig('example.com', '/srv/out', false, 'pages'),
        async () => {
          throw new Error('new site did not answer');
        },
      ),
    ).rejects.toThrow('new site did not answer');
    expect(await readFile(legacy, 'utf8')).toBe(legacyContent);
    expect(existsSync(join(directory, 'sites', 'example.com.conf'))).toBe(false);
  });

  test('subdomain sites keep their old file names and behaviour', async () => {
    await NginxService.applyDomainConfig(
      'portfolio',
      NginxService.generateConfig('portfolio', 5200, false),
    );
    const conf = await readFile(join(directory, 'sites', 'portfolio.conf'), 'utf8');
    expect(conf).toContain(`server_name portfolio.${base};`);
    expect(conf).not.toContain('shipyard-redirects');
    expect(NginxService.getAliases('portfolio')).toEqual([]);
    await NginxService.removeConfig('portfolio');
    expect(existsSync(join(directory, 'sites', 'portfolio.conf'))).toBe(false);
    await NginxService.removeConfig('../nope'); // never a site: ignored
  });
});

const nginxBin = process.env.NGINX_BIN || Bun.which('nginx');
const opensslBin = Bun.which('openssl');

describe.skipIf(!nginxBin || !opensslBin)('a custom domain with www, on real Nginx', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let httpPort: number;
  let tlsPort: number;

  /** Sends a request with a chosen Host header; never follows redirects. */
  const request = (port: number, host: string, path: string, tls: boolean) =>
    new Promise<{ status: number; location: string | null; body: string }>((resolve, reject) => {
      const proc = Bun.spawn(
        [
          'curl',
          '-s',
          '-k',
          '-o',
          '-',
          '-w',
          '\n%{http_code} %{redirect_url}',
          '--resolve',
          `${host}:${port}:127.0.0.1`,
          `${tls ? 'https' : 'http'}://${host}:${port}${path}`,
        ],
        { stdout: 'pipe' },
      );
      new Response(proc.stdout)
        .text()
        .then((out) => {
          const lines = out.trimEnd().split('\n');
          const [status, location] = lines.pop()!.split(' ');
          resolve({ status: Number(status), location: location || null, body: lines.join('\n') });
        })
        .catch(reject);
    });

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/shipyard-custom-real-');
    const root = join(directory, 'out');
    await Bun.write(join(root, 'index.html'), '<html>apex home</html>');
    await Bun.write(join(root, 'about.html'), '<html>about</html>');
    await Bun.write(join(root, '404.html'), '<html>missing</html>');
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    const made = Bun.spawn(
      [
        opensslBin!,
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=example.com',
        '-addext',
        'subjectAltName=DNS:example.com,DNS:www.example.com',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    expect(await made.exited).toBe(0);
    for (const holder of [0, 1]) {
      const s = Bun.serve({ port: 0, fetch: () => new Response('') });
      if (holder === 0) httpPort = s.port!;
      else tlsPort = s.port!;
      s.stop(true);
    }
    const site = NginxService.generateStaticDomainConfig('example.com', root, false, 'pages', [
      'www.example.com',
    ])
      .replaceAll('listen 80;', `listen 127.0.0.1:${httpPort};`)
      .replaceAll('listen 443 ssl;', `listen 127.0.0.1:${tlsPort} ssl;`)
      .replaceAll(/ssl_certificate [^;]+;/g, `ssl_certificate "${cert}";`)
      .replaceAll(/ssl_certificate_key [^;]+;/g, `ssl_certificate_key "${key}";`);
    const conf = join(directory, 'nginx.conf');
    await Bun.write(
      conf,
      `daemon off; pid "${directory}/nginx.pid"; error_log "${directory}/error.log";
events {} http { access_log off; types { text/html html; }
client_body_temp_path "${directory}/b"; proxy_temp_path "${directory}/p"; fastcgi_temp_path "${directory}/f"; uwsgi_temp_path "${directory}/u"; scgi_temp_path "${directory}/s";
${site} }`,
    );
    child = Bun.spawn([nginxBin!, '-p', directory, '-c', conf], {
      stdout: 'ignore',
      stderr: 'pipe',
    });
    for (let i = 0; i < 100; i++) {
      if ((await request(tlsPort, 'example.com', '/', true).catch(() => null))?.status === 200)
        return;
      if (child.exitCode !== null) break;
      await Bun.sleep(20);
    }
    throw new Error(`Nginx did not start: ${await Bun.file(join(directory, 'error.log')).text()}`);
  });

  afterAll(async () => {
    child?.kill();
    if (child) await child.exited;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test('serves the apex over HTTPS with page routing', async () => {
    expect(await request(tlsPort, 'example.com', '/', true)).toMatchObject({
      status: 200,
      body: '<html>apex home</html>',
    });
    expect(await request(tlsPort, 'example.com', '/about', true)).toMatchObject({
      status: 200,
      body: '<html>about</html>',
    });
    expect((await request(tlsPort, 'example.com', '/nope', true)).status).toBe(404);
  });

  test('www and plain HTTP go to https://example.com in one hop, keeping the path', async () => {
    expect(await request(tlsPort, 'www.example.com', '/about?x=1', true)).toMatchObject({
      status: 301,
      location: 'https://example.com/about?x=1',
    });
    for (const host of ['example.com', 'www.example.com']) {
      expect(await request(httpPort, host, '/about', false)).toMatchObject({
        status: 301,
        location: 'https://example.com/about',
      });
    }
  });
});
