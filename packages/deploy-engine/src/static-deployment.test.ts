import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readlink, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { DeployService } from './services/deploy-service';
import { DockerService } from './services/docker';
import { NginxService } from './services/nginx-service';
import { getStaticDirectory } from './services/static-site';
import { PM0Service } from './services/pm0';
import { createServer } from 'net';

describe('Vite static deployment', () => {
  let directory: string;
  let child: ReturnType<typeof Bun.spawn>;
  let origin: string;

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/opencode/shipyard-static-');
    const dist = join(directory, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<html>new build</html>');
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log("new build");');
    await writeFile(join(directory, 'secret.txt'), 'outside static root');

    const reservation = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = reservation.port;
    reservation.stop(true);
    origin = `http://127.0.0.1:${port}`;
    const compiledDirectory = join(directory, 'compiled');
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, 'static-server.ts')],
      outdir: compiledDirectory,
      target: 'bun',
    });
    expect(build.success).toBe(true);
    child = Bun.spawn(
      [process.execPath, join(compiledDirectory, 'static-server.js'), dist, `${port}`],
      {
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(origin)).ok) return;
      } catch {
        // Wait for the child to bind its listener.
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

  test('serves browser-history routes and dotted route parameters with fresh HTML', async () => {
    for (const path of ['/', '/dashboard/settings', '/users/jane.doe', '/api-docs']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toBe('<html>new build</html>');
    }
  });

  test('serves bundles with the correct type and returns 404 for missing assets', async () => {
    const bundle = await fetch(`${origin}/assets/app.js`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('javascript');
    expect(await bundle.text()).toContain('new build');
    for (const path of ['/assets/missing.js', '/assets/missing', '/missing.css']) {
      expect((await fetch(origin + path)).status).toBe(404);
    }
  });

  test('supports HEAD and refuses writes and encoded traversal', async () => {
    const head = await fetch(`${origin}/dashboard`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await fetch(origin, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${origin}/..%2fsecret.txt`)).status).toBe(404);
  });

  test('rejects missing build output instead of starting a 404-only server', async () => {
    expect(getStaticDirectory(directory)).toBe(join(directory, 'dist'));
    expect(() => getStaticDirectory(join(directory, 'missing'))).toThrow('dist/index.html');
    await expect(
      DeployService.startApplication(join(directory, 'missing'), 9999, 'vite', directory),
    ).rejects.toThrow('Static build output missing');
  });

  test('a 404 is not a healthy static deployment; backend reachability remains supported', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('Not Found', { status: 404 }) });
    try {
      expect(await DockerService.waitForHealthy(server.port!, 20, true)).toBe(false);
      expect(await DockerService.waitForHealthy(server.port!, 1000)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test.each([403, 404])('reports the actual HTTP %s readiness failure', async (status) => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('not serving the build', { status, headers: { Server: 'nginx' } }),
    });
    try {
      await expect(
        DeployService.performHealthCheck(
          server.port!,
          undefined,
          true,
          '<html>new build</html>',
          30,
        ),
      ).rejects.toThrow(`HTTP ${status} from nginx`);
    } finally {
      server.stop(true);
    }
  });

  test('rejects HTTP 200 from a stale server and accepts the expected build', async () => {
    let body = '<html>old build</html>';
    const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
    try {
      await expect(
        DeployService.performHealthCheck(
          server.port!,
          undefined,
          true,
          '<html>new build</html>',
          30,
        ),
      ).rejects.toThrow('response does not match');
      body = '<html>new build</html>';
      await DeployService.performHealthCheck(server.port!, undefined, true, body, 1000);
    } finally {
      server.stop(true);
    }
  });

  test('detects a busy non-HTTP port without hanging on an HTTP request', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    try {
      await expect(DeployService.ensurePortFree(address.port, 30)).rejects.toThrow('still in use');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await DeployService.ensurePortFree(address.port, 1000);
  });

  test('does not suppress a failed port handoff after attempting to stop pm0', async () => {
    const stop = spyOn(PM0Service, 'delete').mockResolvedValue(false);
    const portCheck = spyOn(DeployService, 'ensurePortFree').mockRejectedValue(
      new Error('Port still in use'),
    );
    try {
      await expect(DeployService.killProjectProcess('project-123', 5001)).rejects.toThrow(
        'Port still in use',
      );
      expect(stop).toHaveBeenCalledWith('project-123');
    } finally {
      stop.mockRestore();
      portCheck.mockRestore();
    }
  });

  test('tracks a new build with an atomic symlink replacement', async () => {
    await DeployService.updateSymlink(directory, join(directory, 'old'), 'old');
    await DeployService.updateSymlink(directory, join(directory, 'dist'), 'new');
    expect(await readlink(join(directory, 'current'))).toBe(join(directory, 'dist'));
    expect(await Bun.file(join(directory, 'current_build_id')).text()).toBe('new');
  });

  test('Nginx serves a static domain directly with no application listener or proxy', () => {
    const config = NginxService.generateStaticDomainConfig(
      'example',
      '/var/lib/shipyard/apps/example/dist',
    );
    expect(config).toContain('listen 443 ssl;');
    expect(config).not.toContain('proxy_pass');
    expect(config).not.toContain('127.0.0.1:');
    expect(config).toContain('try_files $uri $uri/ /index.html;');
    expect(config).toContain('try_files $uri =404;');
    expect(config).toContain('Cache-Control "no-cache"');
    expect(config).toContain('location ^~ /__shipyard_preview/');
    expect(() => NginxService.generateStaticDomainConfig('example', '/bad";root /;')).toThrow();
  });

  test('static preview and SSL provisioning preserve the domain root without inventing a port', async () => {
    const oldSitesDir = process.env.NGINX_SITES_DIR;
    process.env.NGINX_SITES_DIR = directory;
    const root = join(directory, 'dist');
    await writeFile(
      join(directory, 'static-preview.conf'),
      NginxService.generateStaticDomainConfig('static-preview', root),
    );
    const reload = spyOn(NginxService, 'reload').mockResolvedValue(undefined);
    try {
      expect(NginxService.getStaticRoot('static-preview')).toBe(root);
      await NginxService.ensurePreviewConfig('static-preview', null);
      expect(reload).not.toHaveBeenCalled();
      for (const config of [
        NginxService.generateConfig('static-preview', null),
        NginxService.generateHttpOnlyConfig('static-preview', null),
      ]) {
        expect(config).toContain(`root "${root}";`);
        expect(config).not.toContain('proxy_pass');
        expect(config).not.toContain('127.0.0.1:null');
      }
      const unbuilt = NginxService.generateHttpOnlyConfig('unbuilt-static', null);
      expect(unbuilt).toContain('return 503;');
      expect(unbuilt).toContain('/.well-known/acme-challenge/');
      expect(unbuilt).not.toContain('proxy_pass');
    } finally {
      reload.mockRestore();
      if (oldSitesDir === undefined) delete process.env.NGINX_SITES_DIR;
      else process.env.NGINX_SITES_DIR = oldSitesDir;
    }
  });

  test('failed Nginx reload or serving verification restores the previous static root', async () => {
    const oldSitesDir = process.env.NGINX_SITES_DIR;
    process.env.NGINX_SITES_DIR = directory;
    const configPath = join(directory, 'rollback-test.conf');
    const previous = NginxService.generateStaticDomainConfig('rollback-test', '/previous/dist');
    await writeFile(configPath, previous);
    const reload = spyOn(NginxService, 'reload');
    try {
      reload.mockRejectedValueOnce(new Error('reload failed')).mockResolvedValue(undefined);
      await expect(
        NginxService.createStaticDomainConfig('rollback-test', '/next/dist', async () => {}),
      ).rejects.toThrow('reload failed');
      expect(await Bun.file(configPath).text()).toBe(previous);
      expect(reload).toHaveBeenCalledTimes(2);

      await expect(
        NginxService.createStaticDomainConfig('rollback-test', '/next/dist', async () => {
          throw new Error('site returned 404');
        }),
      ).rejects.toThrow('site returned 404');
      expect(await Bun.file(configPath).text()).toBe(previous);
      expect(reload).toHaveBeenCalledTimes(4);
    } finally {
      reload.mockRestore();
      if (oldSitesDir === undefined) delete process.env.NGINX_SITES_DIR;
      else process.env.NGINX_SITES_DIR = oldSitesDir;
    }
  });
});
