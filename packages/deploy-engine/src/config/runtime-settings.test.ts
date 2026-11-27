import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetEngineSettingsForTests,
  applyEngineSettings,
  clampConcurrency,
  engineSettings,
  onEngineSettingsChange,
  settingsFromEnv,
} from './runtime-settings';

afterEach(() => _resetEngineSettingsForTests({}));

describe('engine runtime settings', () => {
  it('starts from the environment with safe defaults', () => {
    expect(settingsFromEnv({})).toEqual({
      useDocker: false,
      buildConcurrency: 1,
      certbotEmail: undefined,
    });
    expect(
      settingsFromEnv({ USE_DOCKER: 'true', BUILD_CONCURRENCY: '3', CERTBOT_EMAIL: ' a@b.co ' }),
    ).toEqual({ useDocker: true, buildConcurrency: 3, certbotEmail: 'a@b.co' });
  });

  it('keeps builds at a time between 1 and 4', () => {
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(9)).toBe(4);
    expect(clampConcurrency('2')).toBe(2);
    expect(clampConcurrency('abc')).toBe(1);
  });

  it('applies dashboard values, keeps missing ones and tells listeners', () => {
    _resetEngineSettingsForTests({ CERTBOT_EMAIL: 'env@example.com' });
    const seen: number[] = [];
    onEngineSettingsChange((next, previous) =>
      seen.push(previous.buildConcurrency, next.buildConcurrency),
    );
    applyEngineSettings({ use_docker: true, build_concurrency: 2 });
    expect(engineSettings()).toEqual({
      useDocker: true,
      buildConcurrency: 2,
      certbotEmail: 'env@example.com',
    });
    expect(seen).toEqual([1, 2]);
    applyEngineSettings({ certbot_email: null });
    expect(engineSettings().certbotEmail).toBeUndefined();
  });
});
