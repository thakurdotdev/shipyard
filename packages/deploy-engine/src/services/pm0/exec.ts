import { childProcessEnv } from '@shipyard/config';
import { spawn } from 'child_process';
import { asAppUser, isAppUserEnabled } from '../app-user';

/**
 * Execute a pm0 CLI command and return the output.
 * Wraps child_process.spawn for cleaner async/await usage.
 *
 * pm0 is pre-installed on the deployment server at system level.
 */
export type Pm0Daemon = 'apps' | 'platform';

/**
 * Which pm0 daemon a call targets. With SHIPYARD_APP_USER set, deployed apps live in the
 * app user's daemon ('apps', reached through sudo -u); 'platform' is the daemon this
 * engine itself runs under, where apps lived before isolation.
 */
export function defaultDaemon(): Pm0Daemon {
  return isAppUserEnabled() ? 'apps' : 'platform';
}

export async function execPm0(
  args: string[],
  options?: { env?: Record<string, string>; daemon?: Pm0Daemon; input?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const daemon = options?.daemon ?? defaultDaemon();
  // sudo resets the environment; the app daemon is started by systemd, not by this call.
  const argv = daemon === 'apps' ? asAppUser(['pm0', ...args]) : ['pm0', ...args];
  return new Promise((resolve) => {
    const proc = spawn(argv[0], argv.slice(1), {
      shell: false,
      stdio: [options?.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      // If this call has to start the pm0 daemon, deployed apps inherit its environment,
      // so the platform's own secrets are left out.
      env: { ...childProcessEnv(), ...options?.env },
    });
    if (options?.input !== undefined) proc.stdin?.end(options.input);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err) => {
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}
