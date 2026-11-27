import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { connect } from 'tls';
import { join } from 'path';
import { NginxService } from './services/nginx-service';
import { requestNginxOrigin } from './services/nginx-health';

const nginx = process.env.NGINX_BIN || Bun.which('nginx');
const openssl = Bun.which('openssl');

/** An app process behind nginx. It reports which socket each request arrived on. */
const seen: { socket: string; headers: Record<string, string> }[] = [];
const app = Bun.serve({
  port: 0,
  fetch(req, server) {
    if (req.headers.get('upgrade') === 'websocket') {
      return server.upgrade(req) ? undefined : new Response('no upgrade', { status: 400 });
    }
    const peer = server.requestIP(req);
    seen.push({
      socket: `${peer?.address}:${peer?.port}`,
      headers: Object.fromEntries(req.headers),
    });
    return new Response('app says hi');
  },
  websocket: {
    message(ws, message) {
      ws.send(`echo ${message}`);
    },
  },
});

describe.skipIf(!nginx || !openssl)('proxied app Nginx virtual host', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let tlsPort: number;
  let ca: Buffer;
  const domain = NginxService.domainForSubdomain('proxy-fixture');
  const get = (path = '/') => requestNginxOrigin(domain, 2000, { port: tlsPort, ca, path });

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/shipyard-proxy-nginx-');
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

    // An empty guard folder: the server's real guard rules need variables this nginx lacks.
    await mkdir(join(directory, 'guards'));
    process.env.NGINX_SITE_GUARD = join(directory, 'guards', '*.conf');
    const config = NginxService.generateConfig('proxy-fixture', app.port!, false)
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
        if ((await get()).ok) return;
      } catch {
        // Wait for the Nginx listener to become ready.
      }
      if (child.exitCode !== null) break;
      await Bun.sleep(20);
    }
    throw new Error(
      `Nginx did not start: ${await new Response(child.stderr as ReadableStream).text()}`,
    );
  });

  afterAll(async () => {
    delete process.env.NGINX_SITE_GUARD;
    child?.kill();
    if (child) await child.exited;
    app.stop(true);
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test('reuses one connection to the app for back-to-back requests', async () => {
    seen.length = 0;
    for (let i = 0; i < 5; i++) {
      const response = await get(i % 2 ? '/' : '/__shipyard_preview/');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('app says hi');
    }
    expect(new Set(seen.map((s) => s.socket)).size).toBe(1);
    // A plain request must not ask the app to upgrade or to close the connection.
    expect(seen[0]?.headers.connection).toBeUndefined();
  });

  test('tells the app the original scheme and host', async () => {
    seen.length = 0;
    await get();
    expect(seen[0]?.headers['x-forwarded-proto']).toBe('https');
    expect(seen[0]?.headers['x-forwarded-host']).toBe(domain);
  });

  test('still upgrades WebSocket connections', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: tlsPort, servername: domain, ca });
      let received = '';
      socket.on('secureConnect', () => {
        socket.write(
          [
            'GET /socket HTTP/1.1',
            `Host: ${domain}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n'),
        );
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('latin1');
        if (received.includes('\r\n\r\n')) {
          socket.destroy();
          resolve(received.split('\r\n')[0] ?? '');
        }
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error(`no upgrade reply: ${received}`)), 2000);
    });
    expect(reply).toContain('101');
  });
});
