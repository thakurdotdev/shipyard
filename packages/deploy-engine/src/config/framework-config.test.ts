import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import {
  FRAMEWORKS,
  getBackendStartCommand,
  getGoStartCommand,
  isBackendFramework,
} from './framework-config';

describe('Go framework config', () => {
  const dirs: string[] = [];

  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-go-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('registers go as a backend framework without an install step', () => {
    expect(isBackendFramework('go')).toBe(true);
    expect(FRAMEWORKS.go.requiresInstall).toBe(false);
    expect(FRAMEWORKS.go.isStaticBuild).toBe(false);
  });

  it('resolves the default `app` binary', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'app'), '');
    expect(getGoStartCommand(dir)).toEqual([join(dir, 'app')]);
  });

  it('falls back to a binary named after the app directory', () => {
    const dir = makeDir();
    writeFileSync(join(dir, basename(dir)), '');
    expect(getGoStartCommand(dir)).toEqual([join(dir, basename(dir))]);
  });

  it('falls back to `go run .` when no binary exists', () => {
    const dir = makeDir();
    expect(getGoStartCommand(dir)).toEqual(['go', 'run', '.']);
  });

  it('routes go through getBackendStartCommand to the compiled binary', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'app'), '');
    expect(getBackendStartCommand(dir, 'go')).toEqual([join(dir, 'app')]);
  });
});

describe('Bun framework config', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('registers bun as a backend that needs its dependencies', () => {
    expect(isBackendFramework('bun')).toBe(true);
    expect(FRAMEWORKS.bun.requiresInstall).toBe(true);
  });

  it('finds the entry file behind runtime flags such as --watch and --hot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-bun-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'server', 'main.ts'), '');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'bun --watch --hot server/main.ts' } }),
    );
    expect(getBackendStartCommand(dir, 'bun')).toEqual(['bun', 'run', 'server/main.ts']);
  });
});
