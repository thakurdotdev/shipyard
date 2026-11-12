import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LogService } from './log-service';
import { runPreDeployCommand } from './pre-deploy';

describe('runPreDeployCommand', () => {
  let dir: string;
  const logs: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipyard-predeploy-'));
    logs.length = 0;
    spyOn(LogService, 'stream').mockImplementation(async (_id: string, message: string) => {
      logs.push(message);
    });
  });

  afterEach(() => {
    mock.restore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs in the app directory with the runtime environment', async () => {
    await runPreDeployCommand({
      command: 'echo "$DATABASE_URL $NODE_ENV" && echo done > marker',
      cwd: dir,
      envVars: { DATABASE_URL: 'postgres://db' },
      buildId: 'b1',
    });
    expect(logs).toContain('postgres://db production\n');
    expect(readFileSync(join(dir, 'marker'), 'utf-8').trim()).toBe('done');
  });

  it('fails the deploy when the command exits non-zero', async () => {
    await expect(
      runPreDeployCommand({
        command: 'echo boom >&2 && exit 3',
        cwd: dir,
        envVars: {},
        buildId: 'b1',
      }),
    ).rejects.toThrow('exit code 3');
    expect(logs).toContain('boom\n');
  });

  it('kills a command that runs past the timeout', async () => {
    await expect(
      runPreDeployCommand({
        command: 'sleep 5',
        cwd: dir,
        envVars: {},
        buildId: 'b1',
        timeoutMs: 100,
      }),
    ).rejects.toThrow('timed out');
  });
});
