import { afterEach, describe, expect, test } from 'bun:test';
import { assertSafeId, getBuildExtractDir } from '../config/paths';
import { gitAuthEnv } from './build/git-service';
import { appUserEnv, asAppUser, isAppUserEnabled } from './app-user';

const previous = process.env.SHIPYARD_APP_USER;
afterEach(() => {
  if (previous === undefined) delete process.env.SHIPYARD_APP_USER;
  else process.env.SHIPYARD_APP_USER = previous;
});

describe('running deployed code as the app user', () => {
  test('is a pass-through when isolation is off', () => {
    delete process.env.SHIPYARD_APP_USER;
    expect(isAppUserEnabled()).toBe(false);
    expect(asAppUser(['bun', 'install'])).toEqual(['bun', 'install']);
  });

  test('wraps commands in sudo -u, passing env through sudo rather than argv', () => {
    process.env.SHIPYARD_APP_USER = 'shipyard-apps';
    expect(asAppUser(['pm0', 'jlist'])).toEqual([
      'sudo',
      '-n',
      '-H',
      '-u',
      'shipyard-apps',
      '--',
      'pm0',
      'jlist',
    ]);
    const argv = asAppUser(['sh', '-c', 'bun run build'], { preserveEnv: true });
    expect(argv.slice(0, 7)).toEqual(['sudo', '-n', '-H', '-E', '-u', 'shipyard-apps', '--']);
    expect(argv).toContain('PATH=/usr/local/bin:/usr/bin:/bin');
    expect(argv.join(' ')).not.toContain('SECRET');
  });

  test('drops platform-home paths from the environment it passes on', () => {
    expect(
      appUserEnv({
        HOME: '/home/ubuntu',
        PATH: '/home/ubuntu/.nvm/bin:/usr/bin',
        NVM_DIR: '/home/ubuntu/.nvm',
        PM0_HOME: '/home/ubuntu/.pm0',
        DATABASE_URL: 'postgres://app',
        EMPTY: undefined,
      }),
    ).toEqual({ DATABASE_URL: 'postgres://app' });
  });
});

describe('deployment paths', () => {
  test('accept plain ids and reject traversal', () => {
    expect(assertSafeId('build', '3f1c2a7e-0d5b-4b8e-9a51-6f0c2d9e1b44')).toBeTruthy();
    for (const bad of ['..', '../etc', 'a/b', '', '.hidden', 'a b']) {
      expect(() => assertSafeId('project', bad)).toThrow();
    }
    expect(() => getBuildExtractDir('project-1', '../../../../tmp')).toThrow();
  });
});

describe('authenticated clones', () => {
  test('send the token as a header for the repo host only, never in the URL', () => {
    const env = gitAuthEnv('https://github.com/acme/app.git', 'tok123');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `AUTHORIZATION: basic ${Buffer.from('x-access-token:tok123').toString('base64')}`,
    );
    expect(() => gitAuthEnv('http://github.com/acme/app.git', 'tok123')).toThrow();
  });
});
