import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { request } from 'https';
import { join } from 'path';
import { tmpdir } from 'os';
import { NginxService } from './services/nginx-service';

const nginx = process.env.NGINX_BIN || Bun.which('nginx');
const openssl = Bun.which('openssl');

const SUBDOMAIN = 'gate-fixture';
const html = '<html><body>private build</body></html>';

// A stand-in for the Control API's /gate routes. It speaks the same contract nginx relies on:
// 200 from /gate/verify admits the request, 401 sends the visitor to the login page.
const requests: { path: string; headers: Record<string, string> }[] = [];
let verifyMode: 'normal' | 'broken' = 'normal';
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const headers = Object.fromEntries(req.headers);
    requests.push({ path: `${req.method} ${url.pathname}`, headers });
    if (url.pathname === '/gate/verify') {
      if (verifyMode === 'broken') return new Response('boom', { status: 500 });
      if (headers['x-gate-host'] !== `${SUBDOMAIN}.thakur.dev`)
        return new Response(null, { status: 403 });
      return new Response(null, {
        status: /shipyard_gate=ok/.test(headers.cookie ?? '') ? 200 : 401,
      });
    }
    if (url.pathname === '/gate/login' && req.method === 'GET') {
      return new Response(`login-page original=${headers['x-original-uri']}`, {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    if (url.pathname === '/gate/login' && req.method === 'POST') {
      const form = new URLSearchParams(await req.text());
      return new Response(null, {
        status: 303,
        headers: { Location: form.get('next') ?? '/', 'Set-Cookie': 'shipyard_gate=ok; Path=/' },
      });
    }
    return new Response('not found', { status: 404 });
  },
});

// Test files share one process, so env changes are scoped to this suite and restored after it.
const savedEnv = {
  CONTROL_API_URL: process.env.CONTROL_API_URL,
  NGINX_SITES_DIR: process.env.NGINX_SITES_DIR,
};
let sitesDir: string;
beforeAll(async () => {
  sitesDir = await mkdtemp(join(tmpdir(), 'shipyard-gate-sites-'));
  process.env.CONTROL_API_URL = `http://127.0.0.1:${upstream.port}`;
  process.env.NGINX_SITES_DIR = sitesDir;
});
afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  upstream.stop(true);
  await rm(sitesDir, { recursive: true, force: true });
});

describe('gate configuration', () => {
  test('is off by default and leaves ungated sites without any auth subrequest', () => {
    const config = NginxService.generateStaticDomainConfig(SUBDOMAIN, '/var/www/dist', false);
    expect(config).not.toContain('auth_request');
    expect(config).not.toContain('shipyard-gate');
  });

  test('marks gated configs so later regenerations keep the gate', async () => {
    const config = NginxService.generateStaticDomainConfig(SUBDOMAIN, '/var/www/dist', true);
    expect(config).toContain('# shipyard-gate: on');
    expect(NginxService.getGate(SUBDOMAIN)).toBe(false);
    await writeFile(join(process.env.NGINX_SITES_DIR!, `${SUBDOMAIN}.conf`), config);
    expect(NginxService.getGate(SUBDOMAIN)).toBe(true);
    // No explicit flag: an existing gated site stays gated across redeploys.
    expect(NginxService.generateStaticDomainConfig(SUBDOMAIN, '/var/www/dist')).toContain(
      'auth_request /__shipyard_auth;',
    );
    await rm(join(process.env.NGINX_SITES_DIR!, `${SUBDOMAIN}.conf`));
  });

  test('gates reverse-proxied apps too', () => {
    const config = NginxService.generateConfig(SUBDOMAIN, 5100, true);
    expect(config).toContain('auth_request /__shipyard_auth;');
    expect(config).toContain('proxy_pass http://localhost:5100;');
  });

  test('serves nothing but the ACME challenge before the certificate exists', () => {
    const config = NginxService.generateHttpOnlyConfig(SUBDOMAIN, null, true);
    expect(config).toContain('return 503');
    expect(config).not.toContain('index.html');
    expect(config).not.toContain('proxy_pass');
  });
});

describe.skipIf(!nginx || !openssl)('password-gated nginx virtual host', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let tlsPort: number;
  let ca: Buffer;
  const domain = `${SUBDOMAIN}.thakur.dev`;

  function fetchOrigin(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ status: number; headers: Headers; text: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: tlsPort,
          ca,
          servername: domain,
          agent: false,
          path,
          method: init.method ?? 'GET',
          headers: { Host: domain, ...init.headers },
          signal: AbortSignal.timeout(2000),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
            }
            resolve({
              status: res.statusCode ?? 0,
              headers,
              text: Buffer.concat(chunks).toString(),
            });
          });
        },
      );
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  }

  const authed = { Cookie: 'shipyard_gate=ok' };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipyard-nginx-gate-'));
    const root = join(directory, 'dist');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), html);
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("private");');
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

    const probeHttp = Bun.serve({ port: 0, fetch: () => new Response('') });
    const probeTls = Bun.serve({ port: 0, fetch: () => new Response('') });
    const httpPort = probeHttp.port!;
    tlsPort = probeTls.port!;
    probeHttp.stop(true);
    probeTls.stop(true);

    const config = NginxService.generateStaticDomainConfig(SUBDOMAIN, root, true)
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
    types { text/html html; application/javascript js; text/css css; }
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
        if ((await fetchOrigin('/', { headers: authed })).status === 200) return;
      } catch {
        // Wait for the listener.
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

  test('shows the login page, never the site, to visitors without a session', async () => {
    const response = await fetchOrigin('/');
    expect(response.status).toBe(401);
    expect(response.text).toContain('login-page');
    expect(response.text).not.toContain('private build');
  });

  test('keeps the visitor on the URL they asked for, so login can send them back to it', async () => {
    const response = await fetchOrigin('/dashboard/team?tab=a&b=2');
    expect(response.status).toBe(401);
    expect(response.text).toContain('original=/dashboard/team?tab=a&b=2');
  });

  test('protects assets and the dashboard preview route too', async () => {
    for (const path of ['/assets/app.js', '/index.html', '/__shipyard_preview/', '/missing.css']) {
      const response = await fetchOrigin(path);
      expect(response.status).toBe(401);
      expect(response.text).not.toContain('private');
    }
  });

  test('serves the site once the gate accepts the visitor', async () => {
    for (const path of ['/', '/dashboard/team', '/assets/app.js']) {
      const response = await fetchOrigin(path, { headers: authed });
      expect(response.status).toBe(200);
    }
    expect((await fetchOrigin('/', { headers: authed })).text).toBe(html);
    expect((await fetchOrigin('/assets/missing.js', { headers: authed })).status).toBe(404);
  });

  test('forwards the visitor cookie to the gate and tells it which site was asked for', async () => {
    requests.length = 0;
    await fetchOrigin('/', { headers: authed });
    const verify = requests.find((r) => r.path === 'GET /gate/verify');
    expect(verify?.headers['x-gate-host']).toBe(domain);
    expect(verify?.headers.cookie).toBe('shipyard_gate=ok');
  });

  test('proxies the login form submission to the gate and relays its cookie', async () => {
    const response = await fetchOrigin('/__shipyard_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=secret&next=%2Fdashboard',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(response.headers.get('set-cookie')).toContain('shipyard_gate=ok');
  });

  test('tells the gate the real client address on login attempts', async () => {
    requests.length = 0;
    await fetchOrigin('/__shipyard_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Real-IP': '9.9.9.9' },
      body: 'password=x',
    });
    const login = requests.find((r) => r.path === 'POST /gate/login');
    expect(login?.headers['x-real-ip']).toBe('127.0.0.1');
    expect(login?.headers['x-forwarded-for']).toBe('127.0.0.1');
  });

  test('does not expose the internal verification endpoint', async () => {
    const response = await fetchOrigin('/__shipyard_auth', { headers: authed });
    expect(response.status).toBe(404);
  });

  test('refuses to serve the site when the gate is unavailable', async () => {
    verifyMode = 'broken';
    try {
      const response = await fetchOrigin('/', { headers: authed });
      expect(response.status).toBe(500);
      expect(response.text).not.toContain('private build');
    } finally {
      verifyMode = 'normal';
    }
  });
});
