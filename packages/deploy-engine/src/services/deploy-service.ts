import { existsSync, mkdirSync } from 'fs';
import { rm, unlink } from 'fs/promises';
import { basename, join } from 'path';
import {
  AppType,
  FRAMEWORKS,
  getBackendStartCommand,
  isBackendFramework,
  shouldUseStaticServer,
} from '../config/framework-config';
import { LogService } from './log-service';
import { NginxService } from './nginx-service';
import { DockerService } from './docker';
import { PM0Service } from './pm0';

const BASE_DIR = process.env.BASE_DIR || join(process.cwd(), 'apps');
const ARTIFACTS_DIR = join(BASE_DIR, 'artifacts');
const IS_PLATFORM_PROD = process.env.PLATFORM_ENV === 'production';

/**
 * Feature flag for Docker deployments.
 * Set USE_DOCKER=true to enable containerized deployments.
 */
const USE_DOCKER = process.env.USE_DOCKER === 'true';

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
    appType: AppType,
    subdomain: string,
    envVars: Record<string, string> = {},
  ) {
    const paths = this.getPaths(projectId, buildId);

    // Step 1: Verify artifact exists (pre-built fast path directory or remote tarball)
    await LogService.step(buildId, 'Starting deployment activation');
    await LogService.detail(buildId, `Project: ${projectId}`);
    await LogService.detail(buildId, `Framework: ${appType}`);
    await LogService.detail(buildId, `Port: ${port}`);

    let effectiveExtractDir = paths.extractDir;
    let hasExtractedDir = existsSync(paths.extractDir);
    if (!hasExtractedDir) {
      const directBuildDir = join(paths.projectDir, 'builds', buildId);
      if (existsSync(directBuildDir)) {
        hasExtractedDir = true;
        effectiveExtractDir = directBuildDir;
      }
    }
    const hasArtifactTar = existsSync(paths.artifact);

    if (!hasExtractedDir && !hasArtifactTar) {
      await LogService.error(buildId, `Artifact not found: ${paths.artifact}`);
      throw new Error(`Artifact not found: ${paths.artifact}`);
    }

    if (hasExtractedDir) {
      await LogService.detail(
        buildId,
        'Pre-built artifact directory verified (fast path - zero-tar)',
      );
    } else {
      // Step 2: Extract artifact (fallback for remote upload)
      await LogService.step(buildId, 'Extracting build artifact');
      mkdirSync(paths.extractDir, { recursive: true });

      try {
        await retry(() => this.extractArtifact(paths.artifact, paths.extractDir), {
          name: 'artifact extraction',
          timeoutMs: 8000,
        });
        await LogService.success(buildId, 'Artifact extracted successfully');
      } catch (e: any) {
        await LogService.error(buildId, `Failed to extract artifact: ${e.message}`);
        throw e;
      }
    }

    // Step 3: Update symlink for tracking
    await LogService.step(buildId, 'Updating deployment symlinks');
    try {
      await retry(() => this.updateSymlink(paths.projectDir, effectiveExtractDir, buildId), {
        name: 'symlink update',
      });
      await LogService.detail(buildId, 'Symlinks updated');
    } catch (e: any) {
      await LogService.error(buildId, `Failed to update symlinks: ${e.message}`);
      throw e;
    }

    // Step 4: Start application (Docker or direct)
    if (USE_DOCKER) {
      await LogService.step(buildId, 'Starting containerized deployment');
      await LogService.detail(buildId, 'Using Docker for isolation');

      const result = await DockerService.deploy(
        projectId,
        buildId,
        effectiveExtractDir,
        port,
        appType,
        envVars,
      );

      if (!result.success) {
        await LogService.error(buildId, `Docker deployment failed: ${result.error}`);
        throw new Error(`Docker deployment failed: ${result.error}`);
      }
      await LogService.success(buildId, 'Container started successfully');
    } else {
      // PM0 managed process execution
      await LogService.step(buildId, 'Preparing application environment');
      await LogService.detail(buildId, 'Using pm0 process manager');

      // Stop any existing process
      await LogService.detail(buildId, 'Stopping previous deployment if exists');
      await this.killProjectProcess(projectId, port);

      // Start the application
      await LogService.step(buildId, `Starting ${appType} application`);
      await this.startApplication(
        effectiveExtractDir,
        port,
        appType,
        paths.projectDir,
        buildId,
        envVars,
        projectId,
      );
    }

    // Step 5: Configure domain (production only)
    if (IS_PLATFORM_PROD) {
      await LogService.step(buildId, 'Configuring domain routing');
      await LogService.detail(buildId, `Subdomain: ${subdomain}`);
      try {
        await retry(() => NginxService.createConfig(subdomain, port), {
          name: `nginx config ${subdomain}`,
          timeoutMs: 6000,
        });
        await LogService.success(buildId, 'Domain configured successfully');
      } catch (e: any) {
        await LogService.warning(buildId, `Domain configuration warning: ${e.message}`);
        // Don't fail deployment for nginx issues
      }
    }

    // Final success
    await LogService.step(buildId, 'Deployment complete');
    await LogService.success(buildId, 'Your application is now live! 🎉');

    return { success: true };
  },

  async stopDeployment(port: number, projectId?: string, buildId?: string) {
    if (buildId) {
      await LogService.step(buildId, 'Stopping deployment');
    }

    if (projectId) {
      if (USE_DOCKER) {
        if (buildId) await LogService.detail(buildId, 'Stopping Docker container');
        await DockerService.stop(projectId, buildId);
      } else {
        if (buildId) await LogService.detail(buildId, 'Stopping managed process via pm0');
        await PM0Service.delete(projectId);
      }
    } else {
      await this.ensurePortFree(port);
    }

    if (buildId) {
      await LogService.success(buildId, 'Deployment stopped successfully');
    }
    return { success: true };
  },

  async deleteProject(projectId: string, port?: number, subdomain?: string, buildIds?: string[]) {
    // Stop and cleanup Docker resources
    if (USE_DOCKER) {
      await DockerService.cleanup(projectId, buildIds);
    } else {
      await PM0Service.delete(projectId);
    }

    // Cleanup filesystem
    const projectDir = join(BASE_DIR, projectId);
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true });
    }

    // Cleanup artifacts
    if (buildIds) {
      for (const id of buildIds) {
        const p = join(ARTIFACTS_DIR, `${id}.tar.gz`);
        if (existsSync(p)) await unlink(p).catch(() => {});
      }
    }

    // Cleanup nginx
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
    // Use PM0 to stop and delete the managed process
    await PM0Service.delete(projectId);

    // Safety net: ensure port is actually freed after pm0 delete
    try {
      await this.ensurePortFree(port);
    } catch {
      // Port might already be free, that's fine
    }
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
    appType: AppType,
    projectDir: string,
    buildId?: string,
    envVars: Record<string, string> = {},
    projectId?: string,
  ) {
    const framework = FRAMEWORKS[appType];
    const useStaticServer = shouldUseStaticServer(appType, cwd);

    let startCmd: string[];
    let workingDir: string;

    if (useStaticServer) {
      if (buildId) {
        await LogService.detail(buildId, 'Detected static site - using static file server');
      }
      const serverScript = join(process.cwd(), 'src', 'static-server.ts');
      const distDir = join(cwd, appType === 'nextjs' ? 'out' : 'dist');
      startCmd = ['bun', 'run', serverScript, distDir, port.toString()];
      workingDir = process.cwd();
    } else {
      if (framework.requiresInstall) {
        if (buildId) {
          await LogService.step(buildId, 'Installing production dependencies');
        }
        await this.ensureDependenciesInstalled(cwd, buildId);
        if (buildId) {
          await LogService.success(buildId, 'Dependencies installed');
        }
      }
      startCmd = isBackendFramework(appType)
        ? getBackendStartCommand(cwd)
        : framework.startCommand(port, cwd);
      workingDir = cwd;
    }

    if (buildId) {
      await LogService.detail(buildId, `Starting server on port ${port}`);
    }

    console.log(`[DeployService] Starting app with command: ${startCmd.join(' ')}`);
    console.log(`[DeployService] Working directory: ${workingDir}`);

    const resolvedProjectId = projectId || basename(projectDir);

    const startResult = await PM0Service.start({
      projectId: resolvedProjectId,
      buildId: buildId || '',
      startCmd,
      cwd: workingDir,
      port,
      envVars: {
        ...envVars,
        NODE_ENV: 'production',
        PLATFORM_ENV: 'production',
      },
    });

    if (!startResult.success) {
      if (buildId) {
        await LogService.error(buildId, `Process start failed: ${startResult.error}`);
      }
      throw new Error(`PM0 start failed: ${startResult.error}`);
    }

    // Save pm0 state for recovery on restart
    await PM0Service.save();

    if (buildId) {
      await LogService.step(buildId, 'Performing health check');
      await LogService.progress(buildId, 'Waiting for application to become ready...');
    }

    try {
      await this.performHealthCheck(port, buildId);
      console.log(`[DeployService] Health check completed successfully for port ${port}`);
      if (buildId) {
        await LogService.success(buildId, 'Health check passed - application is responding');
      }
    } catch (e: any) {
      console.error(`[DeployService] Health check failed for port ${port}:`, e);
      if (buildId) {
        await LogService.error(buildId, `Health check failed: ${e.message}`);
      }
      throw e;
    }
  },

  async ensureDependenciesInstalled(cwd: string, buildId?: string) {
    const packageJsonPath = join(cwd, 'package.json');

    console.log(`[DeployService] ensureDependenciesInstalled called with cwd: ${cwd}`);

    // Check if package.json exists
    if (!existsSync(packageJsonPath)) {
      console.log(`[DeployService] No package.json found, skipping install`);
      if (buildId) {
        await LogService.detail(buildId, 'No package.json found, skipping dependency install');
      }
      return;
    }

    console.log(`[DeployService] Running: bun install in ${cwd}`);
    if (buildId) {
      await LogService.detail(buildId, 'Running bun install...');
    }

    const installProc = Bun.spawn(['bun', 'install', '--production'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Capture and log install output
    const captureOutput = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return '';
      const reader = stream.getReader();
      let output = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output += new TextDecoder().decode(value);
        }
      } catch (e) {
        console.error(`[DeployService] Error reading install output:`, e);
      }
      return output;
    };

    const [stdout, stderr] = await Promise.all([
      captureOutput(installProc.stdout),
      captureOutput(installProc.stderr),
    ]);

    await installProc.exited;

    console.log(`[DeployService] bun install exited with code: ${installProc.exitCode}`);
    if (stdout) console.log(`[DeployService] bun install stdout: ${stdout}`);
    if (stderr) console.log(`[DeployService] bun install stderr: ${stderr}`);

    if (installProc.exitCode !== 0) {
      console.error(`[DeployService] bun install failed with exit code ${installProc.exitCode}`);
      if (buildId) {
        await LogService.error(buildId, `Dependency installation failed`);
      }
      throw new Error('Dependency install failed');
    }

    console.log(`[DeployService] Dependencies installed successfully`);
  },

  async performHealthCheck(port: number, buildId?: string) {
    console.log(`[DeployService] Waiting for health check on port ${port}...`);

    const maxWaitMs = 15000; // 15 seconds wait time
    const intervalMs = 500;
    const deadline = Date.now() + maxWaitMs;
    let attempts = 0;

    while (Date.now() < deadline) {
      attempts++;
      try {
        const res = await fetch(`http://localhost:${port}`);
        console.log(`[DeployService] Health check response: ${res.status}`);
        if (res.ok || res.status < 500) {
          console.log(`[DeployService] Health check passed after ${attempts} attempts.`);
          return;
        }
      } catch {
        // service not up yet - log every 5th attempt
        if (attempts % 5 === 0 && buildId) {
          await LogService.progress(buildId, `Still waiting... (attempt ${attempts})`);
        }
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(
      `Health check failed: application did not become ready on port ${port} within ${maxWaitMs}ms`,
    );
  },
};
