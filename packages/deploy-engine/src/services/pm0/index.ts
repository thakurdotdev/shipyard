/**
 * PM0 Service - Process Manager
 *
 * Provides PM2-compatible process management for non-Docker deployments.
 * PM0 is a Go-based PM2-compatible process supervisor installed on the server.
 *
 * Uses modular sub-components matching the docker/ service pattern.
 */

import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { execPm0 } from './exec';
import { getProcessName } from './types';

// Re-export types
export { getProcessName } from './types';
export type { PM0ProcessInfo } from './types';

export const PM0Service = {
  /**
   * Start an application as a managed pm0 process.
   * Generates a temporary ecosystem config and starts it via `pm0 start`.
   */
  async start(options: {
    projectId: string;
    buildId: string;
    startCmd: string[];
    cwd: string;
    port: number;
    envVars: Record<string, string>;
  }): Promise<{ success: boolean; error?: string }> {
    const { projectId, buildId, startCmd, cwd, port, envVars } = options;
    const processName = getProcessName(projectId);

    // Build PM2-compatible ecosystem config
    const script = startCmd[0];
    const args = startCmd.slice(1).join(' ');

    const ecosystemConfig = `module.exports = ${JSON.stringify(
      {
        apps: [
          {
            name: processName,
            script,
            args: args || undefined,
            interpreter: 'none',
            cwd,
            max_memory_restart: '512M',
            env: {
              ...envVars,
              PORT: port.toString(),
              DEPLOY_PROJECT_ID: projectId,
              DEPLOY_BUILD_ID: buildId,
            },
          },
        ],
      },
      null,
      2,
    )};`;

    const configPath = `/tmp/pm0-${processName}-${Date.now()}.config.js`;

    try {
      await Bun.write(configPath, ecosystemConfig);

      console.log(`[PM0Service] Starting process: ${processName}`);
      console.log(`[PM0Service] Command: ${startCmd.join(' ')}`);
      console.log(`[PM0Service] Working dir: ${cwd}`);

      const result = await execPm0(['start', configPath]);

      if (result.exitCode !== 0) {
        console.error(`[PM0Service] Start failed:`, result.stderr);
        return {
          success: false,
          error: result.stderr || result.stdout || 'pm0 start failed',
        };
      }

      console.log(`[PM0Service] Process started: ${processName}`);
      return { success: true };
    } finally {
      // Cleanup temp ecosystem config
      await unlink(configPath).catch(() => {});
    }
  },

  /**
   * Stop a managed process (keeps pm0 entry for restart).
   */
  async stop(projectId: string): Promise<boolean> {
    const processName = getProcessName(projectId);
    console.log(`[PM0Service] Stopping process: ${processName}`);

    const result = await execPm0(['stop', processName]);

    if (result.exitCode === 0) {
      console.log(`[PM0Service] Process stopped: ${processName}`);
      return true;
    }

    // Process might not exist, which is fine
    console.log(`[PM0Service] Process ${processName} not found or already stopped`);
    return false;
  },

  /**
   * Delete a managed process (stop + forget — frees the pm_id).
   */
  async delete(projectId: string): Promise<boolean> {
    const processName = getProcessName(projectId);
    console.log(`[PM0Service] Deleting process: ${processName}`);

    const result = await execPm0(['delete', processName]);

    if (result.exitCode === 0) {
      console.log(`[PM0Service] Process deleted: ${processName}`);
      await this.save();
      return true;
    }

    console.log(`[PM0Service] Process ${processName} not found or already deleted`);
    return false;
  },

  /**
   * Ensure a process is stopped and removed before re-deploying.
   */
  async ensureProcessStopped(projectId: string): Promise<void> {
    await this.delete(projectId);
  },

  /**
   * Check if a project's process is running.
   */
  async isRunning(projectId: string): Promise<boolean> {
    const processName = getProcessName(projectId);

    const result = await execPm0(['jlist']);
    if (result.exitCode !== 0) return false;

    try {
      const processes: any[] = JSON.parse(result.stdout);
      return processes.some((p: any) => p.name === processName && p.pm2_env?.status === 'online');
    } catch {
      return false;
    }
  },

  /**
   * Get logs from a project's process.
   * Reads directly from pm0 log files to avoid `pm0 logs` following forever.
   */
  async getLogs(projectId: string, tail: number = 100): Promise<string> {
    const processName = getProcessName(projectId);
    const pm0Home = process.env.PM0_HOME || join(process.env.HOME || '/root', '.pm0');

    let output = '';

    // Read stdout log
    const outLog = join(pm0Home, 'logs', `${processName}-out.log`);
    try {
      if (existsSync(outLog)) {
        const proc = Bun.spawn(['tail', '-n', tail.toString(), outLog]);
        output += await new Response(proc.stdout).text();
        await proc.exited;
      }
    } catch {
      // Log file might not exist yet
    }

    // Read stderr log
    const errLog = join(pm0Home, 'logs', `${processName}-error.log`);
    try {
      if (existsSync(errLog)) {
        const proc = Bun.spawn(['tail', '-n', tail.toString(), errLog]);
        const errOutput = await new Response(proc.stdout).text();
        await proc.exited;
        if (errOutput.trim()) {
          output += '\n--- stderr ---\n' + errOutput;
        }
      }
    } catch {
      // Log file might not exist yet
    }

    return output || 'No logs available';
  },

  /**
   * List all deploy-managed processes.
   * Filters pm0 process list by the `deploy-` name prefix.
   */
  async list(): Promise<
    Array<{ name: string; projectId: string; buildId: string; status: string }>
  > {
    const result = await execPm0(['jlist']);
    if (result.exitCode !== 0) return [];

    try {
      const processes: any[] = JSON.parse(result.stdout);
      return processes
        .filter((p: any) => p.name?.startsWith('deploy-'))
        .map((p: any) => ({
          name: p.name,
          projectId: p.pm2_env?.DEPLOY_PROJECT_ID || '',
          buildId: p.pm2_env?.DEPLOY_BUILD_ID || '',
          status: p.pm2_env?.status || 'unknown',
        }));
    } catch {
      return [];
    }
  },

  /**
   * Save pm0 process state to ~/.pm0/dump.json for recovery after restart.
   */
  async save(): Promise<void> {
    const result = await execPm0(['save']);
    if (result.exitCode === 0) {
      console.log('[PM0Service] Process state saved');
    }
  },

  /**
   * Recover saved processes on startup.
   * Calls `pm0 resurrect` to restore previously saved process state.
   */
  async recoverProcesses(): Promise<void> {
    console.log('[PM0Service] Recovering saved processes...');
    const result = await execPm0(['resurrect']);

    if (result.exitCode === 0) {
      console.log('[PM0Service] Processes recovered successfully');
    } else {
      console.log('[PM0Service] No saved processes to recover (or already running)');
    }

    // Log current state
    const processes = await this.list();
    console.log(`[PM0Service] ${processes.length} deploy processes active`);
  },

  /**
   * Wait for process to become healthy (respond to HTTP).
   * Same probe used by DockerService for consistency.
   */
  async waitForHealthy(port: number, timeoutMs: number = 10000): Promise<boolean> {
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${port}`);
        if (res.ok || res.status < 500) {
          return true;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    return false;
  },
};
