import { existsSync, mkdirSync } from 'fs';
import { rm, unlink } from 'fs/promises';
import { join } from 'path';
import { NginxService } from './nginx-service';
import { pid } from 'process';

const BASE_DIR = process.env.BASE_DIR || join(process.cwd(), 'apps');
const ARTIFACTS_DIR = join(BASE_DIR, 'artifacts');
const IS_PLATFORM_PROD = process.env.PLATFORM_ENV === 'production';

// Ensure base dirs exist
if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

// Bounded retry with wall-clock timeout
async function retry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; timeoutMs?: number; name?: string } = {},
): Promise<T> {
  const { retries = 3, delayMs = 300, timeoutMs = 5000, name = 'operation' } = opts;

  const start = Date.now();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${name} timed out after ${timeoutMs}ms`);
    }

    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastErr;
}

export const DeployService = {
  async receiveArtifact(buildId: string, stream: ReadableStream<any>) {
    const path = join(ARTIFACTS_DIR, `${buildId}.tar.gz`);
    const buf = await new Response(stream).arrayBuffer();
    await Bun.write(path, buf);
    return { success: true, path };
  },

  serveRequest() {
    return new Response('Deploy Engine Running', { status: 200 });
  },

  async activateDeployment(
    projectId: string,
    buildId: string,
    port: number,
    appType: 'nextjs' | 'vite',
    subdomain: string,
  ) {
    const paths = this.getPaths(projectId, buildId);

    if (!existsSync(paths.artifact)) {
      throw new Error(`Artifact not found: ${paths.artifact}`);
    }

    mkdirSync(paths.extractDir, { recursive: true });

    await retry(() => this.extractArtifact(paths.artifact, paths.extractDir), {
      name: 'artifact extraction',
      timeoutMs: 8000,
    });

    await retry(() => this.updateSymlink(paths.projectDir, paths.extractDir, buildId), {
      name: 'symlink update',
    });

    await this.killProjectProcess(projectId, port);

    await this.startApplication(paths.extractDir, port, appType, paths.projectDir);

    if (IS_PLATFORM_PROD) {
      await retry(() => NginxService.createConfig(subdomain, port), {
        name: `nginx config ${subdomain}`,
        timeoutMs: 6000,
      });
    }

    return { success: true };
  },

  async stopDeployment(port: number, projectId?: string) {
    if (projectId) {
      await this.killProjectProcess(projectId, port);
    } else {
      await this.ensurePortFree(port);
    }
    return { success: true };
  },

  async deleteProject(projectId: string, port?: number, subdomain?: string, buildIds?: string[]) {
    if (port) {
      await this.killProjectProcess(projectId, port);
    }

    const projectDir = join(BASE_DIR, projectId);
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true });
    }

    if (buildIds) {
      for (const id of buildIds) {
        const p = join(ARTIFACTS_DIR, `${id}.tar.gz`);
        if (existsSync(p)) await unlink(p).catch(() => {});
      }
    }

    if (IS_PLATFORM_PROD && subdomain) {
      await retry(() => NginxService.removeConfig(subdomain), {
        name: `nginx cleanup ${subdomain}`,
      });
    }

    return { success: true };
  },

  // -------- helpers --------

  getPaths(projectId: string, buildId: string) {
    const projectDir = join(BASE_DIR, projectId);
    return {
      artifact: join(ARTIFACTS_DIR, `${buildId}.tar.gz`),
      projectDir,
      extractDir: join(projectDir, 'builds', buildId, 'extracted'),
    };
  },

  async extractArtifact(artifact: string, target: string) {
    const p = Bun.spawn(['tar', '-xzf', artifact, '-C', target]);
    await p.exited;
    if (p.exitCode !== 0) throw new Error('tar failed');
  },

  async updateSymlink(projectDir: string, target: string, buildId: string) {
    const current = join(projectDir, 'current');
    const temp = join(projectDir, `.current_tmp_${Date.now()}`);
    const idFile = join(projectDir, 'current_build_id');

    await Bun.write(idFile, buildId);
    await Bun.spawn(['ln', '-sf', target, temp]).exited;
    await Bun.spawn(['mv', '-Tf', temp, current]).exited;
  },

  async killProjectProcess(projectId: string, port: number) {
    const pidFile = join(BASE_DIR, projectId, 'server.pid');

    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(await Bun.file(pidFile).text(), 10);
        process.kill(pid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 300));
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch (e) {
        console.log('Failed to kill process', pid, e);
      }
      await unlink(pidFile).catch(() => {});
    }

    await this.ensurePortFree(port);
  },

  async ensurePortFree(port: number) {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      try {
        await fetch(`http://localhost:${port}`);
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        return;
      }
    }

    throw new Error(`Port ${port} did not free in time`);
  },

  async startApplication(
    cwd: string,
    port: number,
    appType: 'nextjs' | 'vite',
    projectDir: string,
  ) {
    const cmd =
      appType === 'vite'
        ? ['bun', 'run', 'preview', '--port', String(port)]
        : ['bun', 'run', 'start', '--', '--port', String(port)];

    const proc = Bun.spawn(cmd, {
      cwd,
      detached: true,
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, PORT: String(port) },
    });

    await Bun.write(join(projectDir, 'server.pid'), String(proc.pid));
    proc.unref();
  },
};
