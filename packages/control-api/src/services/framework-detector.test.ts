import { describe, expect, it } from 'bun:test';
import { detectFramework } from './framework-detector';

describe('detectFramework - Bun', () => {
  it('detects a plain Bun server from its lockfile', () => {
    const result = detectFramework(['package.json', 'bun.lock', 'index.ts'], {
      scripts: { start: 'node index.js' },
    });
    expect(result.framework).toBe('bun');
    expect(result.confidence).toBe('high');
  });

  it('detects Bun from @types/bun or a bun start script', () => {
    expect(
      detectFramework(['package.json'], { devDependencies: { '@types/bun': '1' } }).framework,
    ).toBe('bun');
    expect(
      detectFramework(['package.json'], { scripts: { start: 'bun run src/index.ts' } }).framework,
    ).toBe('bun');
  });

  it('uses a lockfile at the repository root for monorepo members', () => {
    const result = detectFramework(['package.json'], { dependencies: {} }, ['bun.lock']);
    expect(result.framework).toBe('bun');
    expect(result.confidence).toBe('low');
  });

  it('prefers a real framework over the Bun runtime', () => {
    expect(
      detectFramework(['package.json', 'bun.lock'], { dependencies: { elysia: '1' } }).framework,
    ).toBe('elysia');
    expect(detectFramework(['vite.config.ts', 'bun.lock'], {}).framework).toBe('vite');
    expect(
      detectFramework(['package.json', 'bun.lockb'], { dependencies: { hono: '4' } }).framework,
    ).toBe('hono');
  });

  it('does not report Bun without a package.json', () => {
    expect(detectFramework(['bun.lock'], null).framework).toBeNull();
  });
});
