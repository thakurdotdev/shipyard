import { GitService } from './git-service';
import { LogStreamer } from './log-streamer';
import { ArtifactService } from './artifact-service';
import { join } from 'path';
import { spawn } from 'child_process';
import { rm } from 'fs/promises';

interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: 'nextjs' | 'vite';
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
      );

      let token: string | undefined;
      // Resolve installation token if installation_id exists
      if ((job as any).installation_id) {
        // Cast to any because we updated interface in control-api but strict types might miss here unless we update build-worker interface too.
        try {
          const { GitHubService } = await import('./github-service');
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            'Authenticating with GitHub App...\n',
          );
          token = await GitHubService.getInstallationToken((job as any).installation_id);
        } catch (e: any) {
          await LogStreamer.stream(
            job.build_id,
            job.project_id,
            `GitHub Auth Failed: ${e.message}\n`,
          );
          // Proceed? No build will fail if private.
          throw e;
        }
      }

      await LogStreamer.stream(job.build_id, job.project_id, 'Cloning repository...\n');
      await GitService.clone(job.github_url, workDir, token);

      // 2. Install
      await LogStreamer.stream(job.build_id, job.project_id, 'Installing dependencies...\n');
      const projectDir = join(workDir, job.root_directory);
      await this.runCommand('bun install', projectDir, job.build_id, job.project_id, job.env_vars);

      // 3. Build
      await LogStreamer.stream(job.build_id, job.project_id, 'Building project...\n');
      await this.runCommand(
        job.build_command,
        projectDir,
        job.build_id,
        job.project_id,
        job.env_vars,
      );

      await LogStreamer.stream(job.build_id, job.project_id, 'Build completed successfully!\n');
      await LogStreamer.stream(job.build_id, job.project_id, 'Creating artifact package...\n');
      await LogStreamer.stream(
        job.build_id,
        job.project_id,
        'Streaming artifact to Deploy Engine...\n',
      );

      await ArtifactService.streamArtifact(job.build_id, projectDir, job.app_type);

      await LogStreamer.stream(job.build_id, job.project_id, 'Artifact uploaded successfully!\n');

      await updateStatus('success');
    } catch (error: any) {
      await LogStreamer.stream(job.build_id, job.project_id, `Build failed: ${error.message}\n`);
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
    return new Promise<void>((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const child = spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, ...envVars },
      });

      child.stdout.on('data', (data) => {
        LogStreamer.stream(buildId, projectId, data.toString());
      });

      child.stderr.on('data', (data) => {
        LogStreamer.stream(buildId, projectId, data.toString());
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  },
};
