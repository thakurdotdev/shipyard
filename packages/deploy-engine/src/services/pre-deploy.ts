import { spawn } from 'child_process';
import { delimiter, join } from 'path';
import { Builder } from './build/builder';
import { LogService } from './log-service';

/** Migrations can be slow, but a hung command must never block deploys forever. */
export const PRE_DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;

export interface PreDeployOptions {
  command: string;
  cwd: string;
  envVars: Record<string, string>;
  buildId: string;
  timeoutMs?: number;
}

/**
 * Runs the project's pre-deploy command (database migrations, seeding, cache
 * warmup...) inside the new build's directory, with the runtime environment.
 *
 * Called before the previous deployment is stopped: if it fails, activation
 * aborts and the old version keeps serving traffic.
 */
export async function runPreDeployCommand({
  command,
  cwd,
  envVars,
  buildId,
  timeoutMs = PRE_DEPLOY_TIMEOUT_MS,
}: PreDeployOptions): Promise<void> {
  const resolved = Builder.convertToBunCommand(command.trim());
  await LogService.step(buildId, 'Running pre-deploy command');
  await LogService.detail(buildId, `$ ${resolved}`);

  const startedAt = performance.now();
  // Own process group, so a timeout also kills children of `sh` (e.g. a
  // migration CLI) instead of leaving them holding the output pipes open.
  const child = spawn('sh', ['-c', resolved], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: 'production',
      PLATFORM_ENV: 'production',
      // Lets commands call locally installed CLIs (drizzle-kit, prisma...) directly.
      PATH: [join(cwd, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(delimiter),
    },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, timeoutMs);

  // Forward output line by line, in order, without blocking the process.
  let logChain = Promise.resolve();
  const forward = (stream: NodeJS.ReadableStream) => {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        logChain = logChain.then(() => LogService.stream(buildId, `${line}\n`, 'info'));
      }
    });
    stream.on('end', () => {
      if (pending)
        logChain = logChain.then(() => LogService.stream(buildId, `${pending}\n`, 'info'));
    });
  };
  forward(child.stdout!);
  forward(child.stderr!);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  }).finally(() => clearTimeout(timer));
  await logChain;

  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  if (timedOut) {
    throw new Error(`Pre-deploy command timed out after ${timeoutMs / 1000}s`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `Pre-deploy command failed with exit code ${exitCode} after ${seconds}s. The previous deployment is still live.`,
    );
  }
  await LogService.success(buildId, `Pre-deploy command finished in ${seconds}s`);
}
