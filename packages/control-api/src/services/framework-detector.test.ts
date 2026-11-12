import { describe, expect, it } from 'bun:test';
import { detectFramework, inspectGoProject, suggestPreDeployCommand } from './framework-detector';

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

describe('suggestPreDeployCommand', () => {
  it('prefers an explicit migration script', () => {
    expect(
      suggestPreDeployCommand(['drizzle.config.ts'], {
        scripts: { migrate: 'bun run src/db/migrate.ts', 'db:push': 'drizzle-kit push' },
      })?.command,
    ).toBe('bun run migrate');
  });

  it('falls back to the ORM CLI when migrations exist', () => {
    expect(
      suggestPreDeployCommand(['drizzle.config.ts'], {}, [
        'drizzle.config.ts',
        'drizzle/meta/_journal.json',
      ])?.command,
    ).toBe('bunx drizzle-kit migrate');
    expect(
      suggestPreDeployCommand([], { dependencies: { '@prisma/client': '6' } }, [
        'prisma/schema.prisma',
        'prisma/migrations/20240101_init/migration.sql',
      ])?.command,
    ).toBe('bunx prisma migrate deploy');
    expect(suggestPreDeployCommand(['knexfile.ts'], { dependencies: { knex: '3' } })?.command).toBe(
      'bunx knex migrate:latest',
    );
  });

  it('suggests nothing for apps without a database toolchain', () => {
    expect(suggestPreDeployCommand(['index.ts'], { dependencies: { hono: '4' } })).toBeNull();
    expect(suggestPreDeployCommand([], null)).toBeNull();
  });
});

describe('inspectGoProject', () => {
  it('builds the module root when main.go lives there', () => {
    const info = inspectGoProject(['go.mod', 'main.go'], [], 'module x\n\ngo 1.23.4\n');
    expect(info.version).toBe('1.23');
    expect(info.buildCommand).toBe('go build -o app .');
    expect(info.preDeploy).toBeNull();
  });

  it('targets the server under cmd/ and suggests the migrate command', () => {
    const info = inspectGoProject(
      ['go.mod', 'cmd', 'internal'],
      ['migrate', 'worker', 'api'],
      null,
    );
    expect(info.buildCommand).toBe('go build -o app ./cmd/api');
    expect(info.preDeploy?.command).toBe('go run ./cmd/migrate');
  });

  it('falls back to the first cmd/ entry', () => {
    expect(inspectGoProject(['go.mod'], ['mytool'], null).buildCommand).toBe(
      'go build -o app ./cmd/mytool',
    );
  });
});
