import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { NginxService } from './services/nginx-service';
import { requestNginxOrigin } from './services/nginx-health';
import { isNextStaticExport, pageCandidates, resolveStaticSite } from './services/static-site';
import { FRAMEWORKS, shouldUseStaticServer } from './config/framework-config';

/**
 * A `next build` with `output: "export"` writes one HTML file per route into out/:
 * index.html, about.html, blog/index.html (trailingSlash), 404.html, the RSC payloads
 * (*.txt) and the hashed assets under _next/static/.
 */
async function writeNextExport(appDir: string) {
  const out = join(appDir, 'out');
  await mkdir(join(out, '_next', 'static', 'chunks'), { recursive: true });
  await mkdir(join(out, 'blog', 'first-post'), { recursive: true });
  await mkdir(join(out, 'images'), { recursive: true });
  await writeFile(join(out, 'index.html'), '<html>home</html>');
  await writeFile(join(out, 'about.html'), '<html>about</html>');
  await writeFile(join(out, 'about.txt'), 'about rsc payload');
  await writeFile(join(out, 'blog', 'index.html'), '<html>blog</html>');
  await writeFile(join(out, 'blog', 'first-post', 'index.html'), '<html>first post</html>');
  await writeFile(join(out, '404.html'), '<html>custom not found</html>');
  await writeFile(join(out, '_next', 'static', 'chunks', 'main-abc123.js'), 'console.log(1)');
  await writeFile(join(out, 'images', 'logo.svg'), '<svg/>');
  return out;
}

const PAGE_EXPECTATIONS: [string, number, string][] = [
  ['/', 200, '<html>home</html>'],
  ['/about', 200, '<html>about</html>'],
  ['/about.html', 200, '<html>about</html>'],
  ['/blog', 200, '<html>blog</html>'],
  ['/blog/', 200, '<html>blog</html>'],
  ['/blog/first-post', 200, '<html>first post</html>'],
  ['/blog/first-post/', 200, '<html>first post</html>'],
  ['/missing', 404, '<html>custom not found</html>'],
  ['/blog/missing-post', 404, '<html>custom not found</html>'],
];

describe('Next.js static export detection', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/shipyard-next-detect-');
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('a server build (no out/) runs as a process', async () => {
    const app = join(directory, 'server');
    await mkdir(join(app, '.next'), { recursive: true });
    expect(isNextStaticExport(app)).toBe(false);
    expect(resolveStaticSite('nextjs', app)).toBeNull();
    expect(shouldUseStaticServer('nextjs', app)).toBe(false);
  });

  test('an out/ folder that is not a Next export is ignored', async () => {
    const app = join(directory, 'stray-out');
    await mkdir(join(app, 'out'), { recursive: true });
    await writeFile(join(app, 'out', 'index.html'), 'not next');
    expect(resolveStaticSite('nextjs', app)).toBeNull();
  });

  test('an export is served as page files from out/', async () => {
    const app = join(directory, 'export');
    const out = await writeNextExport(app);
    expect(resolveStaticSite('nextjs', app)).toEqual({ directory: out, kind: 'pages' });
    expect(shouldUseStaticServer('nextjs', app)).toBe(true);
    expect(FRAMEWORKS.nextjs.requiresInstall).toBe(true);
  });

  test('Vite stays a single-page app', async () => {
    const app = join(directory, 'vite');
    await mkdir(join(app, 'dist'), { recursive: true });
    await writeFile(join(app, 'dist', 'index.html'), 'spa');
    expect(resolveStaticSite('vite', app)).toEqual({ directory: join(app, 'dist'), kind: 'spa' });
  });

  test('page lookup order matches Next routing', () => {
    expect(pageCandidates('/about')).toEqual(['/about', '/about.html', '/about/index.html']);
    expect(pageCandidates('/blog/')).toEqual(['/blog/index.html']);
  });
});

describe('static server for a Next.js export', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let origin: string;

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/shipyard-next-server-');
    const out = await writeNextExport(directory);
    await writeFile(join(directory, 'secret.txt'), 'outside the site');
    const reservation = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = reservation.port!;
    reservation.stop(true);
    origin = `http://127.0.0.1:${port}`;
    child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'static-server.ts'), out, `${port}`, 'pages'],
      { stdout: 'ignore', stderr: 'pipe' },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(origin)).ok) return;
      } catch {
        // Wait for the listener.
      }
      await Bun.sleep(20);
    }
    throw new Error('Static server did not start');
  });

  afterAll(async () => {
    child?.kill();
    if (child) await child.exited;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test.each(PAGE_EXPECTATIONS)('%s -> %i', async (path, status, body) => {
    const response = await fetch(origin + path);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('serves assets and RSC payloads, 404s missing ones without HTML', async () => {
    const chunk = await fetch(`${origin}/_next/static/chunks/main-abc123.js`);
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get('content-type')).toContain('javascript');
    expect(chunk.headers.get('cache-control')).toContain('immutable');
    expect(await (await fetch(`${origin}/about.txt`)).text()).toBe('about rsc payload');
    const missing = await fetch(`${origin}/_next/static/chunks/missing.js`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('<html>');
  });

  test('refuses writes and path traversal', async () => {
    expect((await fetch(origin, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${origin}/..%2fsecret.txt`)).status).toBe(404);
  });
});

describe('Nginx config for a Next.js export', () => {
  test('routes page files, keeps 404s real and records the site kind', () => {
    const config = NginxService.generateStaticDomainConfig(
      'next-site',
      '/var/lib/shipyard/apps/next-site/out',
      false,
      'pages',
    );
    expect(config).toContain('# shipyard-static-kind: pages');
    expect(config).toContain('try_files $uri $uri.html $uri/index.html =404;');
    expect(config).toContain('error_page 404 /404.html;');
    expect(config).toContain('location ^~ /_next/static/');
    expect(config).not.toContain('/index.html;\n    }'); // no SPA fallback
    expect(config).not.toContain('proxy_pass');
  });

  test('gate, preview and SSL rewrites keep page routing', async () => {
    const directory = await mkdtemp('/tmp/shipyard-next-nginx-');
    const oldSitesDir = process.env.NGINX_SITES_DIR;
    process.env.NGINX_SITES_DIR = directory;
    try {
      const root = join(directory, 'out');
      await writeFile(
        join(directory, 'next-site.conf'),
        NginxService.generateStaticDomainConfig('next-site', root, false, 'pages'),
      );
      expect(NginxService.getStaticKind('next-site')).toBe('pages');
      expect(NginxService.getStaticRoot('next-site')).toBe(root);
      for (const config of [
        NginxService.generateConfig('next-site', null, true),
        NginxService.generateHttpOnlyConfig('next-site', null, false),
        NginxService.generateStaticDomainConfig('next-site', root),
      ]) {
        expect(config).toContain('# shipyard-static-kind: pages');
        expect(config).toContain('try_files $uri $uri.html $uri/index.html =404;');
      }
      // SPA sites keep their single-page fallback.
      await writeFile(
        join(directory, 'spa-site.conf'),
        NginxService.generateStaticDomainConfig('spa-site', root, false, 'spa'),
      );
      expect(NginxService.getStaticKind('spa-site')).toBe('spa');
      expect(NginxService.generateConfig('spa-site', null)).toContain(
        'try_files $uri $uri/ /index.html;',
      );
    } finally {
      if (oldSitesDir === undefined) delete process.env.NGINX_SITES_DIR;
      else process.env.NGINX_SITES_DIR = oldSitesDir;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const nginx = process.env.NGINX_BIN || Bun.which('nginx');
const openssl = Bun.which('openssl');

describe.skipIf(!nginx || !openssl)('Nginx serving a Next.js export (real Nginx)', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let tlsPort: number;
  let ca: Buffer;
  const domain = NginxService.domainForSubdomain('next-fixture');

  const get = (path: string) => requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path });

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/shipyard-next-real-nginx-');
    const root = await writeNextExport(directory);
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    const certificate = Bun.spawn(
      [
        openssl!,
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${domain}`,
        '-addext',
        `subjectAltName=DNS:${domain}`,
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );
    expect(await certificate.exited).toBe(0);
    ca = await readFile(cert);

    const http = Bun.serve({ port: 0, fetch: () => new Response('') });
    const tls = Bun.serve({ port: 0, fetch: () => new Response('') });
    const httpPort = http.port!;
    tlsPort = tls.port!;
    http.stop(true);
    tls.stop(true);

    const config = NginxService.generateStaticDomainConfig('next-fixture', root, false, 'pages')
      .replace('listen 80;', `listen 127.0.0.1:${httpPort};`)
      .replace('listen 443 ssl;', `listen 127.0.0.1:${tlsPort} ssl;`)
      .replace(/ssl_certificate [^;]+;/, `ssl_certificate "${cert}";`)
      .replace(/ssl_certificate_key [^;]+;/, `ssl_certificate_key "${key}";`);
    const configPath = join(directory, 'nginx.conf');
    await writeFile(
      configPath,
      `
daemon off;
pid "${join(directory, 'nginx.pid')}";
error_log "${join(directory, 'error.log')}" info;
events {}
http {
    access_log off;
    client_body_temp_path "${join(directory, 'body')}";
    proxy_temp_path "${join(directory, 'proxy')}";
    fastcgi_temp_path "${join(directory, 'fastcgi')}";
    uwsgi_temp_path "${join(directory, 'uwsgi')}";
    scgi_temp_path "${join(directory, 'scgi')}";
    types { text/html html; application/javascript js; text/plain txt; image/svg+xml svg; }
${config}
}
`,
    );
    child = Bun.spawn([nginx!, '-p', directory, '-c', configPath], {
      stdout: 'ignore',
      stderr: 'pipe',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await get('/')).ok) return;
      } catch {
        // Wait for Nginx.
      }
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

  test.each(PAGE_EXPECTATIONS)('%s -> %i', async (path, status, body) => {
    const response = await get(path);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('serves hashed assets as immutable and RSC payloads as files', async () => {
    const chunk = await get('/_next/static/chunks/main-abc123.js');
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get('content-type')).toContain('javascript');
    expect(chunk.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const rsc = await get('/about.txt');
    expect(rsc.status).toBe(200);
    expect(await rsc.text()).toBe('about rsc payload');
    expect((await get('/images/logo.svg')).status).toBe(200);
  });

  test('missing assets are 404, never an HTML page with a 200', async () => {
    for (const path of ['/_next/static/chunks/missing.js', '/missing.css', '/missing.txt']) {
      expect((await get(path)).status).toBe(404);
    }
  });

  test('the dashboard preview resolves pages the same way', async () => {
    for (const [path, body] of [
      ['/__shipyard_preview/', '<html>home</html>'],
      ['/__shipyard_preview/about', '<html>about</html>'],
      ['/__shipyard_preview/blog/', '<html>blog</html>'],
    ]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
      expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    }
    expect((await get('/__shipyard_preview/missing')).status).toBe(404);
  });
});
