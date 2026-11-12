import { describe, expect, it } from 'bun:test';
import { detectMigrations, scopePaths } from './migration-detector';

const commands = (r: ReturnType<typeof detectMigrations>) => r.suggestions.map((s) => s.command);

describe('detectMigrations - package.json scripts', () => {
  it('finds a migration script by what it runs, whatever it is called', () => {
    const r = detectMigrations({
      packageJson: { scripts: { 'db:up': 'drizzle-kit migrate', dev: 'bun --watch src/index.ts' } },
      paths: [],
    });
    expect(r.suggestions[0]).toEqual({
      command: 'bun run db:up',
      reason: '"db:up" script',
      detail: 'drizzle-kit migrate',
    });
  });

  it('ranks a real migration CLI above a script that only has a migration-ish name', () => {
    const r = detectMigrations({
      packageJson: {
        scripts: {
          migrate: 'echo see docs',
          'prisma:deploy': 'prisma migrate deploy',
        },
      },
      paths: [],
    });
    expect(commands(r)).toEqual(['bun run prisma:deploy', 'bun run migrate']);
  });

  it('ignores one-off scripts that only have "migrate" in their name', () => {
    const r = detectMigrations({
      packageJson: {
        scripts: { 'migrate:auth': 'tsx --env-file=.env src/scripts/migrate-auth-data.ts' },
      },
      paths: ['src/scripts/migrate-auth-data.ts'],
    });
    expect(r.suggestions).toEqual([]);
  });

  it('recognises scripts that run a migration runner file, flags included', () => {
    const r = detectMigrations({
      packageJson: { scripts: { 'db:apply': 'bun --env-file=.env src/db/migrate.ts' } },
      paths: ['src/db/migrate.ts'],
    });
    // The runner file is already wrapped by a script, so it is not suggested twice.
    expect(commands(r)).toEqual(['bun run db:apply']);
  });

  it('skips generate/rollback scripts and warns about unsafe ones', () => {
    const r = detectMigrations({
      packageJson: {
        scripts: {
          'db:generate': 'drizzle-kit generate',
          'db:push': 'drizzle-kit push',
          'migrate:dev': 'prisma migrate dev',
          'migrate:rollback': 'knex migrate:rollback',
        },
      },
      paths: [],
    });
    expect(r.suggestions).toEqual([]);
    expect(r.notes.join('\n')).toContain('Skipped "db:push"');
    expect(r.notes.join('\n')).toContain('Skipped "migrate:dev"');
  });

  it('notes migrations hidden in the build script instead of suggesting them', () => {
    const r = detectMigrations({
      packageJson: { scripts: { build: 'prisma migrate deploy && next build' } },
      paths: [],
    });
    expect(r.suggestions).toEqual([]);
    expect(r.notes[0]).toContain('"build" script already runs Prisma migrations');
  });
});

describe('detectMigrations - files and ORMs', () => {
  it('suggests an unwired migration runner file', () => {
    const r = detectMigrations({
      packageJson: { dependencies: { 'drizzle-orm': '1' } },
      paths: ['src/index.ts', 'src/db/migrate.ts', 'drizzle/0000_init.sql', 'dist/migrate.js'],
    });
    expect(commands(r)).toEqual(['bun run src/db/migrate.ts']);
  });

  it('does not treat files inside a migrations folder as runners', () => {
    const r = detectMigrations({ packageJson: {}, paths: ['migrations/migrate.ts'] });
    expect(r.suggestions).toEqual([]);
  });

  it('explains when an ORM has no migrations committed yet', () => {
    const r = detectMigrations({
      packageJson: { devDependencies: { 'drizzle-kit': '1' } },
      paths: ['drizzle.config.ts'],
    });
    expect(r.suggestions).toEqual([]);
    expect(r.notes[0]).toContain('no generated migrations');
  });

  it('suggests the TypeORM CLI with its data source', () => {
    const r = detectMigrations({
      packageJson: { dependencies: { typeorm: '0.3' } },
      paths: ['src/data-source.ts'],
    });
    expect(commands(r)).toEqual(['bunx typeorm migration:run -d src/data-source.ts']);
  });
});

describe('detectMigrations - Go', () => {
  const goMod = (requires: string) =>
    `module example.com/api\n\ngo 1.23\n\nrequire (\n${requires}\n)\n`;

  it('prefers a cmd/migrate program', () => {
    const r = detectMigrations({
      goMod: goMod('\tgithub.com/pressly/goose/v3 v3.21.1'),
      paths: ['cmd/migrate/main.go', 'db/migrations/001_init.sql'],
    });
    expect(commands(r)[0]).toBe('go run ./cmd/migrate');
  });

  it('builds a pinned goose command with the detected driver and folder', () => {
    const r = detectMigrations({
      goMod: goMod('\tgithub.com/pressly/goose/v3 v3.21.1\n\tgithub.com/jackc/pgx/v5 v5.7.1'),
      paths: [
        'main.go',
        'internal/db/migrations/00001_users.sql',
        'internal/db/migrations/00002_posts.sql',
      ],
    });
    expect(commands(r)).toEqual([
      'go run github.com/pressly/goose/v3/cmd/goose@v3.21.1 -dir internal/db/migrations postgres "$DATABASE_URL" up',
    ]);
  });

  it('builds a golang-migrate command for MySQL', () => {
    const r = detectMigrations({
      goMod: goMod(
        '\tgithub.com/golang-migrate/migrate/v4 v4.18.1\n\tgithub.com/go-sql-driver/mysql v1.8.1',
      ),
      paths: ['migrations/1_init.up.sql', 'migrations/1_init.down.sql'],
    });
    expect(commands(r)).toEqual([
      'go run -tags mysql github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.1 -path migrations -database "$DATABASE_URL" up',
    ]);
  });

  it('suggests nothing without a migration library or program', () => {
    expect(
      detectMigrations({ goMod: goMod('\tgithub.com/go-chi/chi/v5 v5.1.0'), paths: ['main.go'] })
        .suggestions,
    ).toEqual([]);
  });
});

describe('suggestions pass pre-deploy validation', () => {
  it('produces commands the API accepts', async () => {
    const { SecurityService } = await import('./security-service');
    const goMod =
      'module x\n\nrequire (\n\tgithub.com/pressly/goose/v3 v3.21.1\n\tgithub.com/golang-migrate/migrate/v4 v4.18.1\n)\n';
    const all = [
      ...detectMigrations({ goMod, paths: ['cmd/migrate/main.go', 'migrations/1_a.up.sql'] })
        .suggestions,
      ...detectMigrations({
        packageJson: {
          scripts: { 'db:up': 'drizzle-kit migrate' },
          dependencies: { typeorm: '1' },
        },
        paths: ['src/db/migrate.ts', 'src/data-source.ts', 'scripts/run-migrations.js'],
      }).suggestions,
    ];
    expect(all.length).toBeGreaterThan(5);
    for (const s of all) expect(SecurityService.validatePreDeployCommand(s.command)).toBe(true);
  });
});

describe('scopePaths', () => {
  const repo = [
    'package.json',
    'scripts/migrate.ts',
    'packages/api/package.json',
    'packages/api/src/db/migrate.ts',
    'packages/api/tools/package.json',
    'packages/api/tools/migrate.ts',
    'services/go-svc/go.mod',
    'services/go-svc/cmd/migrate/main.go',
  ];

  it('keeps a monorepo root to its own files', () => {
    expect(scopePaths(repo, './')).toEqual(['package.json', 'scripts/migrate.ts']);
  });

  it('returns a package relative to itself, without nested projects', () => {
    expect(scopePaths(repo, 'packages/api')).toEqual(['package.json', 'src/db/migrate.ts']);
    expect(scopePaths(repo, 'services/go-svc')).toEqual(['go.mod', 'cmd/migrate/main.go']);
  });
});
