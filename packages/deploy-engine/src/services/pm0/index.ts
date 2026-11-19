/**
 * PM0 Service - Process Manager
 *
 * Provides PM2-compatible process management for non-Docker deployments.
 * PM0 is a Go-based PM2-compatible process supervisor installed on the server.
 *
 * With SHIPYARD_APP_USER set, apps run in that user's own pm0 daemon (see app-user.ts),
 * so they never inherit the platform user's privileges. Lookups, stops and deletes also
 * check the platform daemon, where apps deployed before isolation still run, so the next
 * activation retires them and frees their port.
 *
 * Uses modular sub-components matching the docker/ service pattern.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  APP_BIND_HOST,
  appUserHome,
  appUserRunDir,
  asAppUser,
  isAppUserEnabled,
  readAppFileTail,
} from '../app-user';
import { defaultDaemon, execPm0, type Pm0Daemon } from './exec';
import {
  getProcessName,
  getProcessProjectId,
  getProcessBuildId,
  matchesProject,
  type PM0ProcessInfo,
} from './types';

// Re-export types
export { getProcessName } from './types';
export type { PM0ProcessInfo } from './types';

/** Daemons that may hold deployed apps, preferred first. */
function appDaemons(): Pm0Daemon[] {
  return isAppUserEnabled() ? ['apps', 'platform'] : ['platform'];
}

async function listDaemon(daemon: Pm0Daemon): Promise<PM0ProcessInfo[] | null> {
  const result = await execPm0(['jlist'], { daemon });
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout) as PM0ProcessInfo[];
  } catch {
    return null;
  }
}

/** Apps that predate isolation run in the platform daemon; never touch platform services there. */
function isDeployedApp(p: PM0ProcessInfo): boolean {
  return Boolean(getProcessProjectId(p)) || Boolean(p.name?.startsWith('deploy-'));
}

export const PM0Service = {
  /**
   * Find a managed process by projectId (checks DEPLOY_PROJECT_ID env var, then legacy names).
   */
  async findProcessByProjectId(
    projectId: string,
  ): Promise<{ name: string; pm_id: number; daemon: Pm0Daemon } | null> {
    for (const daemon of appDaemons()) {
      const processes = await listDaemon(daemon);
      const proc = processes?.find((p) => matchesProject(p, projectId));
      if (proc) return { name: proc.name, pm_id: proc.pm_id, daemon };
    }
    return null;
  },

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
    projectName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { projectId, buildId, startCmd, cwd, port, envVars, projectName } = options;
    const processName = getProcessName(projectId, projectName);

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
              // Servers that honour these (Next.js, Nuxt, most frameworks, apps written
              // against process.env.HOST) listen on loopback only; Nginx is the way in.
              HOST: APP_BIND_HOST,
              HOSTNAME: APP_BIND_HOST,
              DEPLOY_PROJECT_ID: projectId,
              DEPLOY_PROJECT_NAME: projectName || processName,
              DEPLOY_BUILD_ID: buildId,
            },
          },
        ],
      },
      null,
      2,
    )};`;

    // The file holds the project's secrets. As the app user it lives in that user's
    // private run directory; otherwise in /tmp, readable only by this user.
    const configPath = isAppUserEnabled()
      ? join(appUserRunDir(), `pm0-${processName}-${Date.now()}.config.js`)
      : `/tmp/pm0-${processName}-${Date.now()}.config.js`;

    try {
      if (isAppUserEnabled()) {
        const written = await execAsAppUser(
          ['sh', '-c', 'umask 077 && cat > "$1"', 'sh', configPath],
          ecosystemConfig,
        );
        if (written !== 0) {
          return { success: false, error: `Could not write pm0 config in ${appUserRunDir()}` };
        }
      } else {
        await Bun.write(configPath, ecosystemConfig, { mode: 0o600 });
      }

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
      if (isAppUserEnabled()) {
        await execAsAppUser(['rm', '-f', '--', configPath]);
      } else {
        await Bun.file(configPath)
          .delete()
          .catch(() => {});
      }
    }
  },

  /**
   * Stop a managed process (keeps pm0 entry for restart).
   */
  async stop(projectId: string, projectName?: string): Promise<boolean> {
    const existing = await this.findProcessByProjectId(projectId);
    const target = existing ? String(existing.pm_id) : getProcessName(projectId, projectName);
    const daemon = existing?.daemon ?? defaultDaemon();
    console.log(`[PM0Service] Stopping process: ${target} (${daemon} daemon)`);

    const result = await execPm0(['stop', target], { daemon });

    if (result.exitCode === 0) {
      console.log(`[PM0Service] Process stopped: ${target}`);
      return true;
    }

    // Process might not exist, which is fine
    console.log(`[PM0Service] Process ${target} not found or already stopped`);
    return false;
  },

  /**
   * Delete a managed process (stop + forget — frees the pm_id).
   * Removes the project's process from every daemon that has one, so a legacy copy in
   * the platform daemon cannot keep holding the port or be resurrected on boot.
   */
  async delete(projectId: string, projectName?: string): Promise<boolean> {
    let deleted = false;
    for (const daemon of appDaemons()) {
      const processes = await listDaemon(daemon);
      const existing = processes?.find((p) => matchesProject(p, projectId));
      if (!existing && daemon !== defaultDaemon()) continue;
      if (existing && !isDeployedApp(existing)) continue;

      const target = existing ? String(existing.pm_id) : getProcessName(projectId, projectName);
      console.log(`[PM0Service] Deleting process: ${target} (${daemon} daemon)`);

      const result = await execPm0(['delete', target], { daemon });
      if (result.exitCode === 0) {
        console.log(`[PM0Service] Process deleted: ${target}`);
        await this.save(daemon);
        deleted = true;
      } else {
        console.log(`[PM0Service] Process ${target} not found or already deleted`);
      }
    }
    return deleted;
  },

  /**
   * Ensure a process is stopped and removed before re-deploying.
   */
  async ensureProcessStopped(projectId: string, projectName?: string): Promise<void> {
    await this.delete(projectId, projectName);
  },

  /**
   * Check if a project's process is running.
   */
  async isRunning(projectId: string): Promise<boolean> {
    for (const daemon of appDaemons()) {
      const processes = await listDaemon(daemon);
      if (
        processes?.some(
          (p: PM0ProcessInfo) => matchesProject(p, projectId) && p.pm2_env?.status === 'online',
        )
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * Get logs from a project's process.
   * Reads directly from pm0 log files to avoid `pm0 logs` following forever.
   */
  async getLogs(projectId: string, tail: number = 100): Promise<string> {
    const existing = await this.findProcessByProjectId(projectId);
    const processName = existing ? existing.name : getProcessName(projectId);
    const daemon = existing?.daemon ?? defaultDaemon();
    const pm0Home =
      daemon === 'apps'
        ? join(appUserHome(), '.pm0')
        : process.env.PM0_HOME || join(process.env.HOME || '/root', '.pm0');

    const readTail = async (file: string): Promise<string> => {
      // The app daemon's logs are private to the app user.
      if (daemon === 'apps') return readAppFileTail(file, tail);
      if (!existsSync(file)) return '';
      try {
        const proc = Bun.spawn(['tail', '-n', tail.toString(), file]);
        const text = await new Response(proc.stdout).text();
        await proc.exited;
        return text;
      } catch {
        return '';
      }
    };

    let output = await readTail(join(pm0Home, 'logs', `${processName}-out.log`));
    const errOutput = await readTail(join(pm0Home, 'logs', `${processName}-error.log`));
    if (errOutput.trim()) {
      output += '\n--- stderr ---\n' + errOutput;
    }

    return output || 'No logs available';
  },

  /**
   * List all deploy-managed processes.
   * Filters pm0 process list by DEPLOY_PROJECT_ID or the `deploy-` name prefix.
   */
  async list(): Promise<
    Array<{ name: string; projectId: string; buildId: string; status: string }>
  > {
    const out: Array<{ name: string; projectId: string; buildId: string; status: string }> = [];
    for (const daemon of appDaemons()) {
      const processes = await listDaemon(daemon);
      for (const p of processes ?? []) {
        if (!isDeployedApp(p)) continue;
        out.push({
          name: p.name,
          projectId: getProcessProjectId(p) || '',
          buildId: getProcessBuildId(p) || '',
          status: p.pm2_env?.status || 'unknown',
        });
      }
    }
    return out;
  },

  /**
   * Save pm0 process state to ~/.pm0/dump.json for recovery after restart.
   */
  async save(daemon: Pm0Daemon = defaultDaemon()): Promise<void> {
    const result = await execPm0(['save'], { daemon });
    if (result.exitCode === 0) {
      console.log(`[PM0Service] Process state saved (${daemon} daemon)`);
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
        const res = await fetch(`http://127.0.0.1:${port}`);
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

/** Run a short command as the app user, optionally feeding stdin; returns the exit code. */
async function execAsAppUser(argv: string[], input?: string): Promise<number> {
  const proc = Bun.spawn(asAppUser(argv), {
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[PM0Service] ${argv[0]} failed:`, await new Response(proc.stderr).text());
  }
  return code;
}
