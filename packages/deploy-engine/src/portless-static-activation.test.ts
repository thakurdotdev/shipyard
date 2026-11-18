import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readlink, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { DeployService } from './services/deploy-service';
import { NginxService } from './services/nginx-service';
import { PM0Service } from './services/pm0';
import { DockerService } from './services/docker';
import { LogService } from './services/log-service';
import * as health from './services/nginx-health';

// Run with PLATFORM_ENV=production to exercise production selection without
// changing process-wide configuration underneath other tests.
describe.skipIf(process.env.PLATFORM_ENV !== 'production' && process.env.NODE_ENV !== 'production')(
  'portless production static activation',
  () => {
    let directory: string;
    const html = '<html>portless build</html>';

    beforeAll(async () => {
      directory = await mkdtemp('/tmp/opencode/shipyard-portless-');
      await mkdir(join(directory, 'extracted', 'client', 'dist'), { recursive: true });
      await writeFile(join(directory, 'extracted', 'client', 'dist', 'index.html'), html);
    });

    afterAll(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    test('activates a monorepo static site with a null port and retires legacy hosting after readiness', async () => {
      const order: string[] = [];
      const paths = spyOn(DeployService, 'getPaths').mockReturnValue({
        projectDir: directory,
        extractDir: join(directory, 'extracted'),
        artifact: join(directory, 'unused.tar.gz'),
      });
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const configure = spyOn(NginxService, 'createStaticDomainConfig').mockImplementation(
        async (_sub, _root, verify) => {
          order.push('configure');
          await verify();
        },
      );
      const probe = spyOn(health, 'requestNginxOrigin').mockImplementation(async () => {
        order.push('probe');
        return new Response(html);
      });
      const stop = spyOn(PM0Service, 'delete').mockImplementation(async () => {
        order.push('stop legacy process');
        return true;
      });
      const retire = spyOn(NginxService, 'removeStaticConfig').mockImplementation(async () => {
        order.push('remove legacy listener');
      });
      const start = spyOn(PM0Service, 'start').mockResolvedValue({ success: false });
      const docker = spyOn(DockerService, 'deploy').mockResolvedValue({ success: false });
      const dockerStop = spyOn(DockerService, 'stop').mockResolvedValue(true);
      const portCheck = spyOn(DeployService, 'ensurePortFree').mockResolvedValue(undefined);
      try {
        await DeployService.activateDeployment(
          'project-123',
          'build-123',
          null,
          'vite',
          'static-fixture',
          {},
          'client',
        );
        expect(configure).toHaveBeenCalledWith(
          'static-fixture',
          join(directory, 'extracted', 'client', 'dist'),
          expect.any(Function),
          undefined,
          'spa',
        );
        expect(probe).toHaveBeenCalledWith(NginxService.domainForSubdomain('static-fixture'));
        expect(order).toEqual([
          'configure',
          'probe',
          'stop legacy process',
          'remove legacy listener',
        ]);
        expect(start).not.toHaveBeenCalled();
        expect(docker).not.toHaveBeenCalled();
        expect(portCheck).not.toHaveBeenCalled();
        expect(await readlink(join(directory, 'current'))).toBe(join(directory, 'extracted'));
      } finally {
        for (const spy of [
          paths,
          log,
          configure,
          probe,
          stop,
          retire,
          start,
          docker,
          dockerStop,
          portCheck,
        ])
          spy.mockRestore();
      }
    });

    test('a failed new domain check leaves legacy hosting and current tracking intact', async () => {
      const paths = spyOn(DeployService, 'getPaths').mockReturnValue({
        projectDir: directory,
        extractDir: join(directory, 'extracted'),
        artifact: join(directory, 'unused.tar.gz'),
      });
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const configure = spyOn(NginxService, 'createStaticDomainConfig').mockImplementation(
        async (_sub, _root, verify) => verify(),
      );
      const check = spyOn(DeployService, 'performHealthCheck').mockRejectedValue(
        new Error('HTTP 403 from nginx'),
      );
      const stop = spyOn(PM0Service, 'delete').mockResolvedValue(true);
      const retire = spyOn(NginxService, 'removeStaticConfig').mockResolvedValue(undefined);
      const track = spyOn(DeployService, 'updateSymlink').mockResolvedValue(undefined);
      try {
        await expect(
          DeployService.activateDeployment(
            'project-123',
            'failed-build',
            null,
            'vite',
            'static-fixture',
            {},
            'client',
          ),
        ).rejects.toThrow('HTTP 403');
        expect(stop).not.toHaveBeenCalled();
        expect(retire).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
      } finally {
        for (const spy of [paths, log, configure, check, stop, retire, track]) spy.mockRestore();
      }
    });

    test('a Next.js static export is served by Nginx and its server process is retired', async () => {
      const out = join(directory, 'next', 'extracted', 'out');
      await mkdir(join(out, '_next', 'static'), { recursive: true });
      await writeFile(join(out, 'index.html'), '<html>next export</html>');
      const order: string[] = [];
      const paths = spyOn(DeployService, 'getPaths').mockReturnValue({
        projectDir: join(directory, 'next'),
        extractDir: join(directory, 'next', 'extracted'),
        artifact: join(directory, 'unused.tar.gz'),
      });
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const configure = spyOn(NginxService, 'createStaticDomainConfig').mockImplementation(
        async (_sub, _root, verify) => {
          order.push('configure');
          await verify();
        },
      );
      const probe = spyOn(health, 'requestNginxOrigin').mockResolvedValue(
        new Response('<html>next export</html>'),
      );
      const stop = spyOn(PM0Service, 'delete').mockImplementation(async () => {
        order.push('stop next server');
        return true;
      });
      const retire = spyOn(NginxService, 'removeStaticConfig').mockResolvedValue(undefined);
      const start = spyOn(PM0Service, 'start').mockResolvedValue({ success: false });
      const proxy = spyOn(NginxService, 'createConfig').mockResolvedValue(undefined);
      const dockerStop = spyOn(DockerService, 'stop').mockResolvedValue(true);
      try {
        const result = await DeployService.activateDeployment(
          'project-next',
          'build-next',
          5123, // Next.js projects keep their port for a later server build.
          'nextjs',
          'static-fixture',
        );
        expect(result).toEqual({ success: true, hosting: 'static' });
        expect(configure).toHaveBeenCalledWith(
          'static-fixture',
          out,
          expect.any(Function),
          undefined,
          'pages',
        );
        expect(order).toEqual(['configure', 'stop next server']);
        expect(start).not.toHaveBeenCalled();
        expect(proxy).not.toHaveBeenCalled();
      } finally {
        for (const spy of [paths, log, configure, probe, stop, retire, start, proxy, dockerStop])
          spy.mockRestore();
      }
    });

    test('a Next.js server build still runs as a process behind the proxy', async () => {
      await mkdir(join(directory, 'next-ssr', 'extracted', '.next'), { recursive: true });
      const paths = spyOn(DeployService, 'getPaths').mockReturnValue({
        projectDir: join(directory, 'next-ssr'),
        extractDir: join(directory, 'next-ssr', 'extracted'),
        artifact: join(directory, 'unused.tar.gz'),
      });
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const staticConfig = spyOn(NginxService, 'createStaticDomainConfig').mockResolvedValue(
        undefined,
      );
      const retire = spyOn(NginxService, 'removeStaticConfig').mockResolvedValue(undefined);
      const kill = spyOn(DeployService, 'killProjectProcess').mockResolvedValue(undefined);
      const startApp = spyOn(DeployService, 'startApplication').mockResolvedValue(undefined);
      const proxy = spyOn(NginxService, 'createConfig').mockResolvedValue(undefined);
      try {
        const result = await DeployService.activateDeployment(
          'project-next',
          'build-ssr',
          5123,
          'nextjs',
          'static-fixture',
        );
        expect(result).toEqual({ success: true, hosting: 'process' });
        expect(staticConfig).not.toHaveBeenCalled();
        expect(startApp).toHaveBeenCalled();
        expect(proxy).toHaveBeenCalledWith('static-fixture', 5123, undefined);
      } finally {
        for (const spy of [paths, log, staticConfig, retire, kill, startApp, proxy])
          spy.mockRestore();
      }
    });

    test('stopping a Next.js export removes its site (there is no process to stop)', async () => {
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const root = spyOn(NginxService, 'getStaticRoot').mockReturnValue('/srv/next/out');
      const remove = spyOn(NginxService, 'removeConfig').mockResolvedValue(undefined);
      const retire = spyOn(NginxService, 'removeStaticConfig').mockResolvedValue(undefined);
      const stop = spyOn(PM0Service, 'delete').mockResolvedValue(true);
      const dockerStop = spyOn(DockerService, 'stop').mockResolvedValue(true);
      try {
        await DeployService.stopDeployment(5123, 'project-next', 'b', 'static-fixture', 'nextjs');
        expect(remove).toHaveBeenCalledWith('static-fixture');
        root.mockReturnValue(null);
        remove.mockClear();
        await DeployService.stopDeployment(5123, 'project-next', 'b', 'static-fixture', 'nextjs');
        expect(remove).not.toHaveBeenCalled();
      } finally {
        for (const spy of [log, root, remove, retire, stop, dockerStop]) spy.mockRestore();
      }
    });

    test('stopping a static site removes its public configuration without requiring a port', async () => {
      const log = spyOn(LogService, 'stream').mockResolvedValue(undefined);
      const remove = spyOn(NginxService, 'removeConfig').mockResolvedValue(undefined);
      const retire = spyOn(NginxService, 'removeStaticConfig').mockResolvedValue(undefined);
      const stop = spyOn(PM0Service, 'delete').mockResolvedValue(true);
      const dockerStop = spyOn(DockerService, 'stop').mockResolvedValue(true);
      try {
        await DeployService.stopDeployment(
          null,
          'project-123',
          'build-123',
          'static-fixture',
          'vite',
        );
        expect(remove).toHaveBeenCalledWith('static-fixture');
      } finally {
        for (const spy of [log, remove, retire, stop, dockerStop]) spy.mockRestore();
      }
    });
  },
);
