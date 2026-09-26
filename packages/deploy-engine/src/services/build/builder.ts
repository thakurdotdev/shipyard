import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { AppType, isBackendFramework } from '../../config/framework-config';
import { getBuildExtractDir } from '../../config/paths';
import { GitService } from './git-service';
import { WorkerGitHubService } from './github-service';
import { LogStreamer } from './log-streamer';

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

    const buildDir = getBuildExtractDir(job.project_id, job.build_id);
    const controlApiUrl = process.env.CONTROL_API_URL || 'http://localhost:4010';
    const sentinelPath = join(buildDir, BUILT_SENTINEL);

    const updateStatus = async (status: 'building' | 'success' | 'failed') => {
      try {
        await fetch(`${controlApiUrl}/builds/${job.build_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      } catch (error) {
        console.error('Failed to update build status:', error);
      }
    };

    try {
      await updateStatus('building');

      // Idempotency guard: never rebuild output that already completed.
      if (existsSync(sentinelPath)) {
        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          'Build output already exists - reusing previous result.\n',
          'info',
        );
        await LogStreamer.ensureFlushed(job.build_id);
        return;
      }

      // 1. Authenticate (only for projects connected through a GitHub App installation)
      let token: string | undefined;
      if (job.installation_id) {
        try {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Authenticating with GitHub App...\n',
            'info',
          );
          token = await WorkerGitHubService.getInstallationToken(job.installation_id);
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
      await LogStreamer.stream(job.build_id, job.project_id, 'Cloning repository...\n', 'info');
      await GitService.clone(job.github_url, buildDir, token);

      const isMonorepo = Boolean(
        job.root_directory &&
          job.root_directory !== '.' &&
          job.root_directory !== './' &&
          job.root_directory.trim() !== '',
      );
      const projectDir = isMonorepo ? join(buildDir, job.root_directory) : buildDir;

      // 3. Monorepos: install workspace dependencies at the repository root first
      if (isMonorepo && existsSync(join(buildDir, 'package.json'))) {
        await LogStreamer.stream(
          job.build_id,
          job.project_id,
          `Monorepo detected: Installing workspace dependencies at root (${buildDir})...\n`,
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

      // 4. Install dependencies once, then build when the app needs compilation
      if (isBackendFramework(job.app_type)) {
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

      // 5. Drop git metadata (not needed at runtime) and mark the build complete
      await rm(join(buildDir, '.git'), { recursive: true, force: true }).catch(() => {});
      mkdirSync(buildDir, { recursive: true });
      await Bun.write(sentinelPath, new Date().toISOString());

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
      await rm(buildDir, { recursive: true, force: true }).catch((e) =>
        console.error(`[Builder] Failed to clean partial build dir ${buildDir}:`, e),
      );
      throw error;
    }
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
      const [cmd, ...args] = bunCommand.split(' ');
      const child = spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, ...envVars },
      });

      // Timeout to prevent indefinite hangs
      const timeout = setTimeout(() => {
        console.error(`[Builder] Command timed out after ${TIMEOUT_MS / 1000}s: ${bunCommand}`);
        LogStreamer.stream(buildId, projectId, `\n❌ Command timed out after 5 minutes\n`, 'error');
        child.kill('SIGTERM');
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
