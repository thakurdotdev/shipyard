import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { NginxService } from './services/nginx-service';
import { requestNginxOrigin } from './services/nginx-health';

const nginx = process.env.NGINX_BIN || Bun.which('nginx');
const openssl = Bun.which('openssl');

describe.skipIf(!nginx || !openssl)('direct static Nginx virtual host', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let tlsPort: number;
  let ca: Buffer;
  const domain = NginxService.domainForSubdomain('static-fixture');
  const html = '<html><body>current static build</body></html>';

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/opencode/shipyard-nginx-');
    const root = join(directory, 'dist');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), html);
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("static build");');
    await writeFile(join(root, 'assets', 'index-B1x_Y3z4.js'), 'console.log("hashed");');
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

    // An empty guard folder: the include must match nothing and change nothing.
    await mkdir(join(directory, 'guards'));
    process.env.NGINX_SITE_GUARD = join(directory, 'guards', '*.conf');
    const config = NginxService.generateStaticDomainConfig('static-fixture', root)
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
        if ((await requestNginxOrigin(domain, 500, { port: tlsPort, ca })).ok) return;
      } catch {
        // Wait for the Nginx listener to become ready.
      }
      if (child.exitCode !== null) break;
      await Bun.sleep(20);
    }
    throw new Error(`Nginx did not start: ${await Bun.file(join(directory, 'error.log')).text()}`);
  });

  afterAll(async () => {
    delete process.env.NGINX_SITE_GUARD;
    child?.kill();
    if (child) await child.exited;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test('serves root and deep routes through the HTTPS virtual host without an app server', async () => {
    for (const path of ['/', '/dashboard/settings', '/users/jane.doe']) {
      const response = await requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(html);
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
  });

  test('serves bundles with the proper MIME type and keeps missing assets as 404', async () => {
    const bundle = await requestNginxOrigin(domain, 1000, {
      port: tlsPort,
      ca,
      path: '/assets/app.js',
    });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('javascript');
    for (const path of ['/assets/missing.js', '/missing.css', '/assets/missing']) {
      expect((await requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path })).status).toBe(
        404,
      );
    }
  });

  test('lets browsers and the CDN keep content-hashed bundles for a year', async () => {
    const hashed = await requestNginxOrigin(domain, 1000, {
      port: tlsPort,
      ca,
      path: '/assets/index-B1x_Y3z4.js',
    });
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get('content-type')).toContain('javascript');
    expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(
      (await requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path: '/assets/x-missing1.js' }))
        .status,
    ).toBe(404);
  });

  test('does not mark files without a content hash as immutable', async () => {
    const plain = await requestNginxOrigin(domain, 1000, {
      port: tlsPort,
      ca,
      path: '/assets/app.js',
    });
    expect(plain.headers.get('cache-control')).toBeNull();
  });

  test('supports embedded SPA previews with the dashboard framing policy', async () => {
    for (const path of ['/__shipyard_preview/', '/__shipyard_preview/dashboard']) {
      const response = await requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path });
      if (response.status !== 200) {
        throw new Error(
          `${path}: HTTP ${response.status}\n${await Bun.file(join(directory, 'error.log')).text()}`,
        );
      }
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(html);
      expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
    for (const path of [
      '/__shipyard_preview/assets/missing.js',
      '/__shipyard_preview/assets/missing',
    ]) {
      expect((await requestNginxOrigin(domain, 1000, { port: tlsPort, ca, path })).status).toBe(
        404,
      );
    }
  });

  test('serves preview assets and keeps the internal preview shell private', async () => {
    const bundle = await requestNginxOrigin(domain, 1000, {
      port: tlsPort,
      ca,
      path: '/__shipyard_preview/assets/app.js',
    });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('javascript');
    expect(
      (
        await requestNginxOrigin(domain, 1000, {
          port: tlsPort,
          ca,
          path: '/__shipyard_preview_shell',
        })
      ).status,
    ).toBe(404);
  });

  test('checks the domain certificate when probing the local origin', async () => {
    await expect(
      requestNginxOrigin('wrong-domain.example', 1000, { port: tlsPort, ca }),
    ).rejects.toThrow();
  });

  test('applies a site guard dropped into the guard folder after a reload', async () => {
    // The kind of rule an admin adds, e.g. refusing connections that skip a CDN.
    await writeFile(
      join(directory, 'guards', 'block-test.conf'),
      'if ($arg_test_block) { return 403; }\n',
    );
    child.kill('SIGHUP');
    let blocked = 0;
    for (let attempt = 0; attempt < 100 && blocked !== 403; attempt++) {
      await Bun.sleep(20);
      const response = await requestNginxOrigin(domain, 1000, {
        port: tlsPort,
        ca,
        path: '/?test_block=1',
      });
      blocked = response.status;
    }
    expect(blocked).toBe(403);
    expect((await requestNginxOrigin(domain, 1000, { port: tlsPort, ca })).status).toBe(200);
  });
});
