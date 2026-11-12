import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Builder } from './builder';
import { getGoStartCommand } from '../../config/framework-config';
import { GO_BUILD_MARKER } from '../../utils/go';

describe('Go binary resolution', () => {
  const dirs: string[] = [];
  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipyard-gobin-'));
    dirs.push(dir);
    return dir;
  };
  const exe = (path: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
    chmodSync(path, 0o755);
  };
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('uses the -o path, including a directory output', () => {
    const dir = makeDir();
    exe(join(dir, 'bin', 'server'));
    expect(Builder.resolveGoBinary(dir, 'bin/server', 0)).toBe('bin/server');
    expect(Builder.resolveGoBinary(dir, './bin/', 0)).toBe('bin/server');
    expect(Builder.resolveGoBinary(dir, 'missing', 0)).toBeNull();
  });

  it('finds a fresh executable when no -o was given, ignoring older files', () => {
    const dir = makeDir();
    exe(join(dir, 'old-tool'));
    utimesSync(join(dir, 'old-tool'), new Date(0), new Date(0));
    writeFileSync(join(dir, 'main.go'), 'package main');
    exe(join(dir, 'myservice'));
    expect(Builder.resolveGoBinary(dir, undefined, Date.now() - 60_000)).toBe('myservice');
  });

  it('starts the binary recorded by the builder', () => {
    const dir = makeDir();
    exe(join(dir, 'out', 'api'));
    writeFileSync(
      join(dir, GO_BUILD_MARKER),
      JSON.stringify({ binary: 'out/api', package: './cmd/api' }),
    );
    expect(getGoStartCommand(dir)).toEqual([join(dir, 'out', 'api')]);
  });
});
