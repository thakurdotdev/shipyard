import { spawn } from 'child_process';
import { rm } from 'fs/promises';
import { join } from 'path';
import { ArtifactService } from './artifact-service';
import { GitService } from './git-service';
import { WorkerGitHubService } from './github-service';
import { LogStreamer, LogLevel } from './log-streamer';
import { AppType, isBackendFramework } from '../config/framework-config';

interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: AppType;
  env_vars: Record<string, string>;
}

export const Builder = {
  async execute(job: BuildJob) {
    console.log(`[Builder] Starting execution for build ${job.build_id}`);
    const workDir = join(process.cwd(), 'workspace', job.build_id);
    const controlApiUrl = process.env.CONTROL_API_URL || 'http://localhost:4000';

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

      // 1. Clone
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        `Starting build for ${job.build_id}\n`,
        'info',
      );

      let token: string | undefined;
      // Resolve installation token if installation_id exists
      if ((job as any).installation_id) {
        try {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Authenticating with GitHub App...\n',
            'info',
          );
          token = await WorkerGitHubService.getInstallationToken((job as any).installation_id);
        } catch (e: any) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            `GitHub Auth Failed: ${e.message}\n`,
            'error',
          );
          // Proceed? No build will fail if private.
          throw e;
        }
      }

      await LogStreamer.stream(job.build_id, job.project_id, 'Cloning repository...\n', 'info');
      await GitService.clone(job.github_url, workDir, token);

      const projectDir = join(workDir, job.root_directory);

      // Handle differently based on framework category
      if (isBackendFramework(job.app_type)) {
        // Backend apps: Check if build command does real compilation AND script exists
        const buildCommand = job.build_command.toLowerCase().trim();
        const needsBuild = this.needsCompilationStep(buildCommand);
        const hasBuildScript = await this.hasScript(projectDir, 'build');

        if (needsBuild && hasBuildScript) {
          // TypeScript/compiled backend: Install deps and run build
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'TypeScript backend detected - running build step...\n',
            'info',
          );
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
          // Plain JS/TS backend or no build script: Just package source code
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Backend project detected - skipping build step...\n',
            'info',
          );
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Source code will be packaged and dependencies installed at deploy time.\n',
            'info',
          );
        }
      } else {
        // Frontend apps: Install dependencies and run build command
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

      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        'Creating artifact package...\n',
        'info',
      );
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        'Streaming artifact to Deploy Engine...\n',
        'info',
      );

      await ArtifactService.streamArtifact(job.build_id, projectDir, job.app_type);

      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        'Artifact uploaded successfully!\n',
        'success',
      );

      await updateStatus('success');
    } catch (error: any) {
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        `Build failed: ${error.message}\n`,
        'error',
      );
      await updateStatus('failed');
      throw error;
    } finally {
      await LogStreamer.ensureFlushed(job.build_id);
      try {
        await rm(workDir, { recursive: true, force: true });
        console.log(`Cleaned up workspace: ${workDir}`);
      } catch (e) {
        console.error(`Failed to cleanup workspace: ${workDir}`, e);
      }
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
