import { describe, expect, spyOn, test } from 'bun:test';
import * as exec from './exec';
import { PM0Service } from './index';
import {
  getProcessBuildId,
  getProcessProjectId,
  matchesProject,
  type PM0ProcessInfo,
} from './types';

const process: PM0ProcessInfo = {
  name: 'syncvibe',
  pm_id: 7,
  monit: { memory: 0, cpu: 0 },
  pm2_env: {
    status: 'online',
    pm_uptime: 0,
    restart_time: 0,
    pm_cwd: '/var/lib/shipyard/apps/example',
    env: { DEPLOY_PROJECT_ID: 'project-123', DEPLOY_BUILD_ID: 'build-456', PORT: '5001' },
  },
};

describe('pm0 project ownership and static migration', () => {
  test('finds a name-based application using pm0 nested environment variables', () => {
    expect(getProcessProjectId(process)).toBe('project-123');
    expect(getProcessBuildId(process)).toBe('build-456');
    expect(matchesProject(process, 'project-123')).toBe(true);
    expect(matchesProject(process, 'another-project')).toBe(false);
  });

  test('retains flattened PM2 and legacy process-name compatibility', () => {
    const flattened = {
      ...process,
      pm2_env: { ...process.pm2_env, env: undefined, DEPLOY_PROJECT_ID: 'project-123' },
    };
    expect(matchesProject(flattened, 'project-123')).toBe(true);
    const legacy = {
      ...process,
      name: 'deploy-project-',
      pm2_env: { ...process.pm2_env, env: undefined },
    };
    expect(matchesProject(legacy, 'project-123')).toBe(true);
    expect(matchesProject({ ...process, name: 'deploy-another-' }, 'another-project')).toBe(false);
  });

  test('deletes the actual named process by ID before handing its port to Nginx', async () => {
    const command = spyOn(exec, 'execPm0').mockImplementation(async (args) => ({
      exitCode: 0,
      stdout: args[0] === 'jlist' ? JSON.stringify([process]) : '',
      stderr: '',
    }));
    try {
      expect(await PM0Service.findProcessByProjectId('project-123')).toEqual({
        name: 'syncvibe',
        pm_id: 7,
        daemon: 'platform',
      });
      expect(await PM0Service.isRunning('project-123')).toBe(true);
      expect(await PM0Service.list()).toEqual([
        { name: 'syncvibe', projectId: 'project-123', buildId: 'build-456', status: 'online' },
      ]);
      expect(await PM0Service.delete('project-123')).toBe(true);
      expect(command).toHaveBeenCalledWith(['delete', '7'], { daemon: 'platform' });
      expect(command).toHaveBeenCalledWith(['save'], { daemon: 'platform' });
    } finally {
      command.mockRestore();
    }
  });

  test('with an app user, retires the legacy copy in the platform daemon too', async () => {
    const previous = globalThis.process.env.SHIPYARD_APP_USER;
    globalThis.process.env.SHIPYARD_APP_USER = 'shipyard-apps';
    const appProcess = { ...process, pm_id: 3 };
    const platformService = {
      ...process,
      name: 'control-api',
      pm_id: 0,
      pm2_env: { ...process.pm2_env, env: { PORT: '4010' } },
    };
    const command = spyOn(exec, 'execPm0').mockImplementation(async (args, options) => ({
      exitCode: 0,
      stdout:
        args[0] === 'jlist'
          ? JSON.stringify(options?.daemon === 'apps' ? [appProcess] : [process, platformService])
          : '',
      stderr: '',
    }));
    try {
      expect(await PM0Service.findProcessByProjectId('project-123')).toEqual({
        name: 'syncvibe',
        pm_id: 3,
        daemon: 'apps',
      });
      // Platform services (no DEPLOY_PROJECT_ID) are never listed as deployments.
      expect((await PM0Service.list()).map((p) => p.name)).toEqual(['syncvibe', 'syncvibe']);
      expect(await PM0Service.delete('project-123')).toBe(true);
      expect(command).toHaveBeenCalledWith(['delete', '3'], { daemon: 'apps' });
      expect(command).toHaveBeenCalledWith(['delete', '7'], { daemon: 'platform' });
      expect(command).not.toHaveBeenCalledWith(['delete', '0'], { daemon: 'platform' });
      expect(command).toHaveBeenCalledWith(['save'], { daemon: 'platform' });
    } finally {
      command.mockRestore();
      if (previous === undefined) delete globalThis.process.env.SHIPYARD_APP_USER;
      else globalThis.process.env.SHIPYARD_APP_USER = previous;
    }
  });
});
