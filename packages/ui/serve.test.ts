import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveStatic } from './serve';

const root = mkdtempSync(join(tmpdir(), 'shipyard-ui-out-'));
for (const file of [
  'index.html',
  'login.html',
  'projects/_.html',
  'projects/_.txt',
  'projects/_/__next._tree.txt',
  'projects/new.html',
  'projects/new.txt',
  '_next/static/app.js',
  '404.html',
]) {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), file);
}
afterAll(() => rmSync(root, { recursive: true }));

const resolve = (path: string) => {
  const found = resolveStatic(path, root);
  return found ? found.slice(root.length) : null;
};

describe('static dashboard routing', () => {
  it('maps pages to their exported html', () => {
    expect(resolve('/')).toBe('/index.html');
    expect(resolve('/login')).toBe('/login.html');
    expect(resolve('/_next/static/app.js')).toBe('/_next/static/app.js');
  });

  it('serves the shared project page for any project id', () => {
    expect(resolve('/projects/3f2a-uuid')).toBe('/projects/_.html');
    expect(resolve('/projects/3f2a-uuid.txt')).toBe('/projects/_.txt');
    expect(resolve('/projects/3f2a-uuid/__next._tree.txt')).toBe('/projects/_/__next._tree.txt');
  });

  it('keeps real pages under /projects', () => {
    expect(resolve('/projects/new')).toBe('/projects/new.html');
    expect(resolve('/projects/new.txt')).toBe('/projects/new.txt');
  });

  it('refuses missing files and path traversal', () => {
    expect(resolve('/nope')).toBeNull();
    expect(resolve('/../../etc/passwd')).toBeNull();
    expect(resolve('/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolve('/%E0%A4%A')).toBeNull();
  });
});
