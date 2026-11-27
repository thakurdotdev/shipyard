import { childProcessEnv, config, internalAuthHeaders } from '@shipyard/config';
import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { AppType, isBackendFramework } from '../../config/framework-config';
import { assertSafeId, getBuildExtractDir } from '../../config/paths';
import {
  appUserEnv,
  asAppUser,
  claimForAppUser,
  isAppUserEnabled,
  removeAppTree,
  writeAppFile,
} from '../app-user';
import { isWorkspaceRoot } from '../../utils/workspace';
import {
  GO_BUILD_MARKER,
  GoBuildInfo,
  isExecutableFile,
  parseGoBuildCommand,
} from '../../utils/go';
import { GitService, isCommitSha, isSafeBranchName } from './git-service';
import { WorkerGitHubService } from './github-service';
import { LogStreamer } from './log-streamer';
import { getStaticDirectory } from '../static-site';

/**
 * Build job payload. Must stay in sync with control-api's BuildJobData
 * (packages/control-api/src/queue/build-queue.ts).
 */
export interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: AppType;
  env_vars: Record<string, string>;
  installation_id?: string;
  /** Exact commit to build; absent means the branch head at clone time. */
  commit_sha?: string;
  /** Branch to clone; absent means the repository's default branch. */
  branch?: string;
}

/** Written once a build completes so retries/re-triggers can short-circuit. */
const BUILT_SENTINEL = '.shipyard-built';

export const Builder = {
  /**
   * Runs the full build pipeline for a job.
   *
   * The repository is cloned straight into the deployment directory
   * (`{BASE_DIR}/{projectId}/builds/{buildId}/extracted`) and dependencies are
   * installed exactly once. The deploy engine reuses those `node_modules` when it
   * activates the build, so no artifact copy and no second install are needed.
   */
  async execute(job: BuildJob) {
    console.log(`[Builder] Starting execution for build ${job.build_id}`);

    // Jobs come from Redis; a forged job must not choose paths or leak a clone token.
    assertSafeId('project', job.project_id);
    assertSafeId('build', job.build_id);
    if (job.installation_id) assertGitHubRepoUrl(job.github_url);
    if (job.commit_sha !== undefined && !isCommitSha(job.commit_sha)) {
      throw new Error('Invalid commit SHA in build job');
    }
    if (job.branch !== undefined && !isSafeBranchName(job.branch)) {
      throw new Error('Invalid branch name in build job');
    }

    const buildDir = getBuildExtractDir(job.project_id, job.build_id);
    const controlApiUrl = config.controlApiUrl;
    // The sentinel sits next to the checkout (platform-owned), not inside it: the
    // checkout belongs to the app user, who could otherwise fake a finished build.
    const sentinelPath = join(dirname(buildDir), BUILT_SENTINEL);
    const legacySentinelPath = join(buildDir, BUILT_SENTINEL);

    const updateStatus = async (status: 'building' | 'success' | 'failed') => {
      try {
        await fetch(`${controlApiUrl}/builds/${job.build_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
          body: JSON.stringify({ status }),
        });
      } catch (error) {
        console.error('Failed to update build status:', error);
      }
    };

    try {
      await updateStatus('building');

      // Idempotency guard: never rebuild output that already completed.
      if (existsSync(sentinelPath) || existsSync(legacySentinelPath)) {
        if (job.app_type === 'vite') {
          getStaticDirectory(join(buildDir, job.root_directory || '.'));
        }
        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          'Build output already exists - reusing previous result.\n',
          'info',
        );
        await LogStreamer.ensureFlushed(job.build_id);
        await updateStatus('success');
        return;
      }

      // 1. Authenticate (only for projects connected through a GitHub App installation)
      let token: string | undefined;
      if (job.installation_id) {
        const authStartedAt = performance.now();
        try {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Authenticating with GitHub App...\n',
            'info',
          );
          token = await WorkerGitHubService.getInstallationToken(job.installation_id);
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            `GitHub authentication completed in ${((performance.now() - authStartedAt) / 1000).toFixed(1)}s\n`,
            'info',
          );
        } catch (e: any) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            `GitHub Auth Failed: ${e.message}\n`,
            'error',
          );
          throw e;
        }
      }

      // 2. Clone directly into the final deployment directory (no copy step)
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        `Starting build for ${job.build_id}\n`,
        'info',
      );
      const source = [
        job.branch ? `branch ${job.branch}` : 'default branch',
        job.commit_sha ? `commit ${job.commit_sha.slice(0, 7)}` : 'latest commit',
      ].join(', ');
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        `Cloning repository (${source})...\n`,
        'info',
      );
      await GitService.clone(
        job.github_url,
        buildDir,
        token,
        (message) => {
          void LogStreamer.stream(job.build_id, job.project_id, `${message}\n`, 'info');
        },
        { branch: job.branch, commit: job.commit_sha },
      );
      // From here on, everything in the checkout runs as the unprivileged app user.
      await claimForAppUser(buildDir);

      const isMonorepo = Boolean(
        job.root_directory &&
          job.root_directory !== '.' &&
          job.root_directory !== './' &&
          job.root_directory.trim() !== '',
      );
      const projectDir = isMonorepo ? join(buildDir, job.root_directory) : buildDir;

      if (isMonorepo) {
        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          `Resolved app directory: ${projectDir} (root_directory="${job.root_directory}")\n`,
          'info',
        );
      }

      // 3. Monorepos: only install at the repository root when it actually declares
      //    a workspace (root `workspaces` field or pnpm/turbo/nx/lerna manifest).
      //    This installs hoisted dependencies that workspace members rely on.
      if (isMonorepo && existsSync(join(buildDir, 'package.json')) && isWorkspaceRoot(buildDir)) {
        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          `Workspace root detected (${buildDir}) - installing workspace dependencies...\n`,
          'info',
        );
        await this.runCommand(
          'bun install',
          buildDir,
          job.build_id,
          job.project_id,
          job.env_vars,
        );
      }

      // 3b. Go: compile the binary in the app directory. No dependency install step.
      if (job.app_type === 'go') {
        await this.buildGo(job, projectDir);
      }
      // 4. Install dependencies once, then build when the app needs compilation
      else if (isBackendFramework(job.app_type)) {
        const buildCommand = job.build_command.toLowerCase().trim();
        const needsBuild = this.needsCompilationStep(buildCommand);
        const hasBuildScript = await this.hasScript(projectDir, 'build');

        // Always install for backends so the deploy engine can reuse node_modules.
        if (existsSync(join(projectDir, 'package.json'))) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Installing dependencies in project directory...\n',
            'info',
          );
          await this.runCommand(
            'bun install',
            projectDir,
            job.build_id,
            job.project_id,
            job.env_vars,
          );
        }

        if (needsBuild && hasBuildScript) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'TypeScript backend detected - running build step...\n',
            'info',
          );
          await LogStreamer.stream(job.build_id, job.project_id, 'Building project...\n', 'info');
          await this.runCommand(
            job.build_command,
            projectDir,
            job.build_id,
            job.project_id,
            job.env_vars,
          );
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Build completed successfully!\n',
            'success',
          );
        } else {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Backend project detected - skipping build step...\n',
            'info',
          );
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Dependencies installed and will be reused at deploy time.\n',
            'info',
          );
        }
      } else {
        // Frontend apps: install dependencies and run the build command
        if (existsSync(join(projectDir, 'package.json'))) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Installing dependencies...\n',
            'info',
          );
          await this.runCommand(
            'bun install',
            projectDir,
            job.build_id,
            job.project_id,
            job.env_vars,
          );
        }

        await LogStreamer.stream(job.build_id, job.project_id, 'Building project...\n', 'info');
        await this.runCommand(
          job.build_command,
          projectDir,
          job.build_id,
          job.project_id,
          job.env_vars,
        );

        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          'Build completed successfully!\n',
          'success',
        );
      }

      if (job.app_type === 'vite') getStaticDirectory(projectDir);

      // 5. Drop git metadata (not needed at runtime) and mark the build complete
      await removeAppTree(join(buildDir, '.git')).catch(() => {});
      await unlink(sentinelPath).catch(() => {});
      await writeFile(sentinelPath, new Date().toISOString(), { flag: 'wx' });

      await LogStreamer.ensureFlushed(job.build_id);
      await updateStatus('success');
    } catch (error: any) {
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        `Build failed: ${error.message}\n`,
        'error',
      );
      await LogStreamer.ensureFlushed(job.build_id);
      await updateStatus('failed');

      // Clean the partial build so a retry starts from a clean checkout
      await removeAppTree(buildDir).catch((e) =>
        console.error(`[Builder] Failed to clean partial build dir ${buildDir}:`, e),
      );
      throw error;
    }
  },

  /**
   * Builds a Go application into a runnable binary inside the app directory.
   * The deploy engine starts the resulting binary with pm0 at activation time.
   */
  async buildGo(job: BuildJob, projectDir: string) {
    await LogStreamer.stream(
      job.build_id,
      job.project_id,
      'Go project detected - compiling binary...\n',
      'info',
    );

    // Preflight: the Go toolchain must exist on the build host.
    const goCheck = Bun.spawnSync(['go', 'version']);
    if (goCheck.exitCode !== 0) {
      const msg =
        'Go toolchain not found on the build host. Install Go (https://go.dev/dl/) and ensure `go` is on PATH.\n';
      await LogStreamer.stream(job.build_id, job.project_id, msg, 'error');
      throw new Error('Go toolchain not found (go version failed)');
    }
    await LogStreamer.stream(
      job.build_id,
      job.project_id,
      `${goCheck.stdout.toString().trim()}\n`,
      'info',
    );

    if (existsSync(join(projectDir, 'go.mod'))) {
      await LogStreamer.stream(job.build_id, job.project_id, 'Downloading Go modules...\n', 'info');
      await this.runCommand('go mod download', projectDir, job.build_id, job.project_id, job.env_vars);
    } else {
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        'No go.mod found in the app directory - building without module dependencies.\n',
        'warning',
      );
    }

    const buildCommand = job.build_command?.trim() || 'go build -o app .';
    // Filesystem mtimes can be coarse; allow a little slack when spotting fresh binaries.
    const startedAt = Date.now() - 2000;
    await LogStreamer.stream(job.build_id, job.project_id, 'Building project...\n', 'info');
    await this.runCommand(buildCommand, projectDir, job.build_id, job.project_id, job.env_vars);

    const parsed = parseGoBuildCommand(buildCommand);
    const binary = this.resolveGoBinary(projectDir, parsed.output, startedAt);
    if (!binary) {
      const msg =
        'Go build finished but no executable was found. Make sure the build compiles a `main` package ' +
        'and name the output, e.g. `go build -o app ./cmd/server`.\n';
      await LogStreamer.stream(job.build_id, job.project_id, msg, 'error');
      throw new Error('Go build produced no executable');
    }
    const info: GoBuildInfo = { binary, package: parsed.package };
    await writeAppFile(join(projectDir, GO_BUILD_MARKER), JSON.stringify(info));

    await LogStreamer.stream(
      job.build_id,
      job.project_id,
      `Build completed successfully! Binary: ${binary}\n`,
      'success',
    );
  },

  /**
   * Finds the executable a `go build` just produced, relative to the app directory.
   * Uses the `-o` path when given, otherwise the freshest executable in the app or bin/ directory.
   */
  resolveGoBinary(projectDir: string, output: string | undefined, since: number): string | null {
    const fresh = (dir: string) => {
      const abs = join(projectDir, dir);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
      return readdirSync(abs)
        .map((name) => join(dir, name))
        .filter((rel) => isExecutableFile(join(projectDir, rel)))
        .map((rel) => ({ rel, mtime: statSync(join(projectDir, rel)).mtimeMs }))
        .filter((f) => f.mtime >= since)
        .sort((a, b) => b.mtime - a.mtime)
        .map((f) => f.rel.replace(/^\.\//, ''));
    };

    if (output) {
      const abs = join(projectDir, output);
      if (existsSync(abs) && statSync(abs).isDirectory()) return fresh(output)[0] ?? null;
      return isExecutableFile(abs) ? output.replace(/^\.\//, '') : null;
    }
    return fresh('.')[0] ?? fresh('bin')[0] ?? null;
  },

  async runCommand(
    command: string,
    cwd: string,
    buildId: string,
    projectId: string,
    envVars: Record<string, string> = {},
  ) {
    // Convert npm/yarn/pnpm commands to bun
    const bunCommand = this.convertToBunCommand(command);
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minute timeout

    return new Promise<void>((resolve, reject) => {
      const env = { ...childProcessEnv(), ...envVars };
      let child;
      if (isAppUserEnabled()) {
        // The whole command line (including any `&&` chain) runs as the app user. Our
        // signal cannot reach a process behind sudo, so `timeout` (running as the app
        // user) enforces the limit on the command and everything it started.
        const argv = asAppUser(
          ['timeout', '-k', '10s', `${TIMEOUT_MS / 1000}s`, 'sh', '-c', bunCommand],
          { preserveEnv: true },
        );
        child = spawn(argv[0], argv.slice(1), { cwd, env: appUserEnv(env) });
      } else {
        // Own process group, so a timeout also stops what `sh` started (the actual
        // bundler, its workers...) instead of leaving them running after the build failed.
        child = spawn('sh', ['-c', bunCommand], { cwd, env, detached: true });
      }

      // Timeout to prevent indefinite hangs
      const timeout = setTimeout(() => {
        console.error(`[Builder] Command timed out after ${TIMEOUT_MS / 1000}s: ${bunCommand}`);
        LogStreamer.stream(buildId, projectId, `\n❌ Command timed out after 5 minutes\n`, 'error');
        try {
          if (isAppUserEnabled()) child.kill('SIGTERM');
          else process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        reject(new Error(`Command timed out after 5 minutes: ${bunCommand}`));
      }, TIMEOUT_MS);

      child.stdout.on('data', (data) => {
        LogStreamer.stream(buildId, projectId, data.toString());
      });

      child.stderr.on('data', (data) => {
        LogStreamer.stream(buildId, projectId, data.toString());
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  },

  /**
   * Converts npm/yarn/pnpm commands to their bun equivalents.
   * Users can write familiar npm commands, but bun is used for execution.
   */
  convertToBunCommand(command: string): string {
    // Split by && to handle chained commands
    const parts = command.split('&&').map((part) => part.trim());

    const convertedParts = parts.map((part) => {
      // npm install -> bun install
      if (/^npm\s+install\b/.test(part) || /^npm\s+i\b/.test(part)) {
        return part.replace(/^npm\s+(install|i)\b/, 'bun install');
      }
      // npm run <script> -> bun run <script>
      if (/^npm\s+run\b/.test(part)) {
        return part.replace(/^npm\s+run\b/, 'bun run');
      }
      // npm ci -> bun install
      if (/^npm\s+ci\b/.test(part)) {
        return part.replace(/^npm\s+ci\b/, 'bun install');
      }
      // yarn install -> bun install
      if (/^yarn\s+install\b/.test(part) || part === 'yarn') {
        return part.replace(/^yarn(\s+install)?\b/, 'bun install');
      }
      // yarn <script> (not a known yarn command) -> bun run <script>
      if (/^yarn\s+\w+/.test(part) && !/^yarn\s+(add|remove|install)/.test(part)) {
        return part.replace(/^yarn\s+/, 'bun run ');
      }
      // pnpm install -> bun install
      if (/^pnpm\s+install\b/.test(part) || /^pnpm\s+i\b/.test(part)) {
        return part.replace(/^pnpm\s+(install|i)\b/, 'bun install');
      }
      // npx <bin> -> bunx <bin>
      if (/^npx\s+/.test(part)) {
        return part.replace(/^npx\s+/, 'bunx ');
      }
      // pnpm run <script> -> bun run <script>
      if (/^pnpm\s+run\b/.test(part)) {
        return part.replace(/^pnpm\s+run\b/, 'bun run');
      }

      return part;
    });

    return convertedParts.join(' && ');
  },

  /**
   * Detects if a build command does real compilation (TypeScript, bundling, etc.)
   * vs just installing dependencies or no-op commands.
   */
  needsCompilationStep(buildCommand: string): boolean {
    const cmd = buildCommand.toLowerCase().trim();

    // Skip if build command is just dependency installation
    if (
      cmd === 'npm install' ||
      cmd === 'yarn install' ||
      cmd === 'bun install' ||
      cmd === 'pnpm install' ||
      cmd === 'npm ci' ||
      cmd === ''
    ) {
      return false;
    }

    // Detect common compilation/build tools
    const compilationPatterns = [
      'tsc', // TypeScript compiler
      'esbuild', // esbuild bundler
      'swc', // SWC compiler
      'rollup', // Rollup bundler
      'webpack', // Webpack bundler
      'parcel', // Parcel bundler
      'vite build', // Vite build
      'next build', // Next.js build
      'bun build', // Bun bundler
      'tsup', // tsup bundler
      'unbuild', // unbuild
      'ncc', // ncc compiler
      'go build', // Go compiler
    ];

    // Check if build command contains any compilation pattern
    for (const pattern of compilationPatterns) {
      if (cmd.includes(pattern)) {
        return true;
      }
    }

    // Check for npm run build / bun run build patterns that likely compile
    if (/\b(npm|bun|yarn|pnpm)\s+run\s+build\b/.test(cmd)) {
      return true;
    }

    return false;
  },

  /**
   * Checks if a specific script exists in the project's package.json.
   */
  async hasScript(projectDir: string, scriptName: string): Promise<boolean> {
    try {
      const pkgPath = join(projectDir, 'package.json');
      const pkgContent = await Bun.file(pkgPath).text();
      const pkg = JSON.parse(pkgContent);
      return !!(pkg.scripts && pkg.scripts[scriptName]);
    } catch {
      return false;
    }
  },
};

/** Clone tokens are only ever sent to GitHub over HTTPS. */
function assertGitHubRepoUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid repository URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username) {
    throw new Error(`Refusing to send a GitHub token to ${parsed.protocol}//${parsed.host}`);
  }
}
