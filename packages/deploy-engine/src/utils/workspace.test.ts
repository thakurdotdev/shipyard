import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isWorkspaceRoot } from './workspace';

describe('isWorkspaceRoot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipyard-ws-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects an array-style `workspaces` field', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    expect(isWorkspaceRoot(dir)).toBe(true);
  });

  it('detects a yarn-style `workspaces.packages` field', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
    );
    expect(isWorkspaceRoot(dir)).toBe(true);
  });

  it('ignores an empty `workspaces` array', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: [] }));
    expect(isWorkspaceRoot(dir)).toBe(false);
  });

  it('does not treat a workspace-less package.json as a workspace root', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'root', dependencies: { left: '^1.0.0' } }),
    );
    expect(isWorkspaceRoot(dir)).toBe(false);
  });

  it('detects pnpm/turbo/nx/lerna manifests', () => {
    for (const manifest of ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json']) {
      writeFileSync(join(dir, manifest), '');
      expect(isWorkspaceRoot(dir)).toBe(true);
      rmSync(join(dir, manifest), { force: true });
    }
  });

  it('returns false for an empty directory', () => {
    expect(isWorkspaceRoot(dir)).toBe(false);
  });

  it('ignores a malformed package.json', () => {
    writeFileSync(join(dir, 'package.json'), '{ not valid json');
    expect(isWorkspaceRoot(dir)).toBe(false);
  });
});
