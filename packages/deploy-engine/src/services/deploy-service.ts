import { existsSync, mkdirSync } from 'fs';
import { rm, unlink, symlink, rename } from 'fs/promises';
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
import { isWorkspaceRoot } from '../utils/workspace';
import { ARTIFACTS_DIR, BASE_DIR, getBuildExtractDir, getProjectDir } from '../config/paths';
import { getStaticDirectory } from './static-site';
import { isPortAvailable } from '../utils/port';
import { requestNginxOrigin } from './nginx-health';
import { runPreDeployCommand } from './pre-deploy';

const IS_PLATFORM_PROD =
  process.env.PLATFORM_ENV === 'production' || process.env.NODE_ENV === 'production';

/**
 * Feature flag for Docker deployments.
 * Set USE_DOCKER=true to enable containerized deployments.
 */
const USE_DOCKER = process.env.USE_DOCKER === 'true';

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

  serveRequest(_req?: Request) {
    return new Response('Deploy Engine Running', { status: 200 });
  },

  async activateDeployment(
    projectId: string,
    buildId: string,
    port: number | null,
    appType: AppType,
    subdomain: string,
    envVars: Record<string, string> = {},
    rootDirectory?: string,
    projectName?: string,
    gated?: boolean,
    preDeployCommand?: string | null,
  ) {
    const paths = this.getPaths(projectId, buildId);
    const directStatic = appType === 'vite' && IS_PLATFORM_PROD;
    if (!directStatic && !port) throw new Error('Runtime applications require an assigned port');

    // Step 1: Verify artifact exists (pre-built fast path directory or remote tarball)
    await LogService.step(buildId, 'Starting deployment activation');
    await LogService.detail(buildId, `Project: ${projectId}`);
    await LogService.detail(buildId, `Framework: ${appType}`);
    await LogService.detail(
      buildId,
      directStatic ? 'Hosting: static files on the domain (no application port)' : `Port: ${port}`,
    );

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

    // Resolve app directory if monorepo / subfolder deployment
    const isMonorepo = Boolean(
      rootDirectory &&
      rootDirectory !== '.' &&
      rootDirectory !== './' &&
      rootDirectory.trim() !== '',
    );
    const effectiveAppDir = isMonorepo
      ? join(effectiveExtractDir, rootDirectory!)
      : effectiveExtractDir;

    // Validate before stopping the live deployment or changing any routing.
    const staticDir = appType === 'vite' ? getStaticDirectory(effectiveAppDir) : null;

    if (isMonorepo) {
      await LogService.detail(
        buildId,
        `Monorepo setup: Application located at "${rootDirectory}" with access to root repository`,
      );
    }

    // Runs before anything touches the live deployment, so a failed migration
    // leaves the previous version serving traffic.
    if (preDeployCommand?.trim()) {
      try {
        await runPreDeployCommand({
          command: preDeployCommand,
          cwd: effectiveAppDir,
          envVars,
          buildId,
        });
      } catch (e: any) {
        await LogService.error(buildId, e.message);
        throw e;
      }
    }

    let domainConfigured = false;
    const configureDomain = async () => {
      if (!IS_PLATFORM_PROD) return;
      await LogService.step(buildId, 'Configuring domain routing');
      await LogService.detail(buildId, `Subdomain: ${subdomain}`);
      try {
        await retry(() => NginxService.createConfig(subdomain, port, gated), {
          name: `nginx config ${subdomain}`,
          timeoutMs: 6000,
        });
        domainConfigured = true;
        await LogService.success(buildId, 'Domain configured successfully');
      } catch (e: any) {
        await LogService.error(buildId, `Domain configuration failed: ${e.message}`);
        throw e;
      }
    };

    // Step 4: Start application (Docker or direct)
    if (staticDir && directStatic) {
      await LogService.step(buildId, 'Serving Vite build as static files with Nginx');
      await LogService.detail(buildId, `Static root: ${staticDir}`);
      await NginxService.createStaticDomainConfig(
        subdomain,
        staticDir,
        async () => {
          await LogService.step(buildId, 'Checking static site readiness');
          await this.performHealthCheck(
            443,
            buildId,
            true,
            await Bun.file(join(staticDir, 'index.html')).text(),
            15000,
            NginxService.domainForSubdomain(subdomain),
          );
        },
        gated,
      );
      domainConfigured = true;
      await LogService.success(buildId, 'Static domain configured and responding');
      // Retire the older per-project listener only after the domain serves the new build.
      await LogService.detail(
        buildId,
        'Removing legacy application process and static listener if present',
      );
      await PM0Service.delete(projectId);
      await NginxService.removeStaticConfig(projectId);
      if (USE_DOCKER) await DockerService.stop(projectId);
    } else if (USE_DOCKER) {
      if (IS_PLATFORM_PROD) await NginxService.removeStaticConfig(projectId);
      await LogService.step(buildId, 'Starting containerized deployment');
      await LogService.detail(buildId, 'Using Docker for isolation');

      const result = await DockerService.deploy(
        projectId,
        buildId,
        effectiveAppDir,
        port!,
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
      if (IS_PLATFORM_PROD) await NginxService.removeStaticConfig(projectId);
      await this.killProjectProcess(projectId, port!);

      // Start the application
      await LogService.step(buildId, `Starting ${appType} application`);
      await this.startApplication(
        effectiveAppDir,
        port!,
        appType,
        paths.projectDir,
        buildId,
        envVars,
        projectId,
        effectiveExtractDir,
        projectName || subdomain,
      );
    }

    // Step 5: Configure domain (production only)
    if (!domainConfigured) await configureDomain();

    // Only track a build as current after serving and domain configuration succeed.
    await retry(() => this.updateSymlink(paths.projectDir, effectiveExtractDir, buildId), {
      name: 'symlink update',
    });

    // Final success
    await LogService.step(buildId, 'Deployment complete');
    await LogService.success(buildId, 'Your application is now live! 🎉');

    return { success: true };
  },

  async stopDeployment(
    port: number | null,
    projectId?: string,
    buildId?: string,
    subdomain?: string,
    appType?: AppType,
  ) {
    if (buildId) {
      await LogService.step(buildId, 'Stopping deployment');
    }

    if (projectId) {
      if (IS_PLATFORM_PROD && appType === 'vite') {
        if (!subdomain) throw new Error('Static deployment stop requires its subdomain');
        await NginxService.removeConfig(subdomain);
      }
      if (IS_PLATFORM_PROD) await NginxService.removeStaticConfig(projectId);
      if (USE_DOCKER) {
        if (buildId) await LogService.detail(buildId, 'Stopping Docker container');
        await DockerService.stop(projectId, buildId);
      } else {
        if (buildId) await LogService.detail(buildId, 'Stopping managed process via pm0');
        await PM0Service.delete(projectId);
      }
    } else {
      if (!port) throw new Error('Stopping a deployment requires a project ID or port');
      await this.ensurePortFree(port);
    }

    if (buildId) {
      await LogService.success(buildId, 'Deployment stopped successfully');
    }
    return { success: true };
  },

  async deleteProject(projectId: string, port?: number, subdomain?: string, buildIds?: string[]) {
    if (IS_PLATFORM_PROD) await NginxService.removeStaticConfig(projectId);
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

  /**
   * Deletes ONE build's on-disk footprint: its output directory
   * (`builds/<buildId>`, which holds the cloned repo, node_modules and build
   * output) plus the legacy artifact tarball. Never deletes the whole project.
   */
  async deleteBuild(projectId: string, buildId: string) {
    const paths = this.getPaths(projectId, buildId);

    // Never remove the build currently serving traffic. The `current` symlink
    // points at the active output; the control-api also blocks active builds,
    // so this is a second layer of defense.
    const currentTarget = await this.resolveCurrentTarget(paths.projectDir);
    if (currentTarget) {
      const buildsRoot = join(paths.projectDir, 'builds', buildId);
      if (currentTarget === buildsRoot || currentTarget.startsWith(buildsRoot + '/')) {
        throw new Error('Cannot delete the currently active build');
      }
    }

    // Remove the build output directory (cloned repo + node_modules + dist).
    // This is where almost all per-build disk usage lives.
    const buildDir = join(paths.projectDir, 'builds', buildId);
    if (existsSync(buildDir)) {
      await rm(buildDir, { recursive: true, force: true });
    }

    // Remove any stale direct-extract fallback path for very old builds.
    if (existsSync(paths.extractDir)) {
      await rm(paths.extractDir, { recursive: true, force: true });
    }

    // Remove the legacy artifact tarball, if any.
    if (existsSync(paths.artifact)) {
      await unlink(paths.artifact).catch(() => {});
    }

    return { success: true };
  },

  /** Best-effort read of the `current -> builds/<id>/extracted` symlink target. */
  async resolveCurrentTarget(projectDir: string): Promise<string | null> {
    try {
      const proc = Bun.spawn(['readlink', '-f', join(projectDir, 'current')], {
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const text = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      return text || null;
    } catch {
      return null;
    }
  },

  // -------- helpers --------

  getPaths(projectId: string, buildId: string) {
    const projectDir = getProjectDir(projectId);
    return {
      artifact: join(ARTIFACTS_DIR, `${buildId}.tar.gz`),
      projectDir,
      extractDir: getBuildExtractDir(projectId, buildId),
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

    try {
      await symlink(target, temp);
      await rename(temp, current);
      await Bun.write(idFile, buildId);
    } finally {
      await unlink(temp).catch(() => {});
    }
  },

  async killProjectProcess(projectId: string, port: number) {
    // Use PM0 to stop and delete the managed process
    await PM0Service.delete(projectId);

    // A port still held by an old process is a deployment failure, not success.
    await this.ensurePortFree(port);
  },

  async ensurePortFree(port: number, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await isPortAvailable(port)) return;
      await new Promise((r) => setTimeout(r, Math.min(300, Math.max(0, deadline - Date.now()))));
    }

    throw new Error(
      `Port ${port} is still in use after stopping the previous deployment. ` +
        'A legacy pm0 process or another service may still own the port; Nginx cannot take it over.',
    );
  },

  async startApplication(
    cwd: string,
    port: number,
    appType: AppType,
    projectDir: string,
    buildId?: string,
    envVars: Record<string, string> = {},
    projectId?: string,
    repoRootDir?: string,
    projectName?: string,
  ) {
    const framework = FRAMEWORKS[appType];
    const useStaticServer = shouldUseStaticServer(appType, cwd);

    let startCmd: string[];
    let workingDir: string;

    if (useStaticServer) {
      if (buildId) {
        await LogService.detail(buildId, 'Detected static site - using static file server');
      }
      const bundledServer = join(import.meta.dir, 'static-server.js');
      const serverScript = existsSync(bundledServer)
        ? bundledServer
        : join(import.meta.dir, '..', 'static-server.ts');
      const distDir = getStaticDirectory(cwd, appType === 'nextjs' ? 'out' : 'dist');
      startCmd = ['bun', 'run', serverScript, distDir, port.toString()];
      workingDir = process.cwd();
    } else {
      if (framework.requiresInstall) {
        if (buildId) {
          await LogService.step(buildId, 'Installing production dependencies');
        }
        // In monorepos: only install workspace deps at the repo root when the root
        // is an actual workspace (declares `workspaces` or a workspace manifest).
        if (
          repoRootDir &&
          repoRootDir !== cwd &&
          existsSync(join(repoRootDir, 'package.json')) &&
          isWorkspaceRoot(repoRootDir)
        ) {
          if (buildId) {
            await LogService.detail(buildId, 'Installing workspace root dependencies...');
          }
          await this.ensureDependenciesInstalled(repoRootDir, buildId);
        }
        await this.ensureDependenciesInstalled(cwd, buildId);
        if (buildId) {
          await LogService.success(buildId, 'Dependencies installed');
        }
      }
      startCmd = isBackendFramework(appType)
        ? getBackendStartCommand(cwd, appType)
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
      projectName,
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
      await this.performHealthCheck(port, buildId, useStaticServer);
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
    const nodeModulesPath = join(cwd, 'node_modules');

    console.log(`[DeployService] ensureDependenciesInstalled called with cwd: ${cwd}`);

    // Builds run in-place, so dependencies were already installed during the build.
    // Reusing them avoids a second install (and the downtime it used to cause).
    if (existsSync(nodeModulesPath)) {
      console.log(`[DeployService] node_modules already present in ${cwd}, skipping install`);
      if (buildId) {
        await LogService.detail(
          buildId,
          'Dependencies already installed (built in place), skipping install',
        );
      }
      return;
    }

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

  async performHealthCheck(
    port: number,
    buildId?: string,
    requireSuccess = false,
    expectedBody?: string,
    timeoutMs = 15000,
    domain?: string,
  ) {
    console.log(`[DeployService] Waiting for health check on port ${port}...`);

    const maxWaitMs = timeoutMs;
    const intervalMs = 500;
    const deadline = Date.now() + maxWaitMs;
    let attempts = 0;
    let lastResult = 'No response received';
    let lastReportedResult = '';

    while (Date.now() < deadline) {
      attempts++;
      try {
        const res = domain
          ? await requestNginxOrigin(domain)
          : await fetch(`http://127.0.0.1:${port}/`, {
              signal: AbortSignal.timeout(1000),
            });
        const matchesBuild = expectedBody === undefined || (await res.text()) === expectedBody;
        if (expectedBody === undefined) await res.body?.cancel();
        lastResult = `HTTP ${res.status}${res.headers.get('server') ? ` from ${res.headers.get('server')}` : ''}`;
        if (res.ok && !matchesBuild) {
          lastResult +=
            "; response does not match this build's index.html (an old process or stale Nginx config may be serving the port)";
        } else if (res.status === 403) {
          lastResult +=
            '; check Nginx worker read/traverse permissions on the static root and parent directories';
        } else if (res.status === 404) {
          lastResult += '; the listener is not serving the expected static root/index.html';
        }
        console.log(`[DeployService] Health check response: ${res.status}`);
        if (matchesBuild && (res.ok || (!requireSuccess && res.status < 500))) {
          console.log(`[DeployService] Health check passed after ${attempts} attempts.`);
          return;
        }
      } catch (error) {
        lastResult = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (buildId && lastResult !== lastReportedResult) {
        await LogService.progress(
          buildId,
          `Readiness probe ${domain ? `for ${domain}` : `on port ${port}`}: ${lastResult}`,
        );
        lastReportedResult = lastResult;
      }

      await new Promise((r) =>
        setTimeout(r, Math.min(intervalMs, Math.max(0, deadline - Date.now()))),
      );
    }

    throw new Error(
      `Health check failed on ${domain ? `https://${domain}/ (local Nginx)` : `http://127.0.0.1:${port}/`} within ${maxWaitMs}ms. Last result: ${lastResult}`,
    );
  },
};
