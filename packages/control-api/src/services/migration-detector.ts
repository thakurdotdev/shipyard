/**
 * Works out how a project applies its database migrations, so the create flow
 * can suggest a pre-deploy command. Suggestions only pre-fill the form: nothing
 * runs unless the user saves the command on the project.
 */

export interface MigrationSuggestion {
  command: string;
  /** Why it was suggested, e.g. `"db:migrate" script`. */
  reason: string;
  /** What it runs underneath, e.g. `drizzle-kit migrate`. */
  detail?: string;
}

export interface MigrationDetection {
  /** Best first. */
  suggestions: MigrationSuggestion[];
  /** Things worth knowing, e.g. a dev-only script that was skipped. */
  notes: string[];
}

export interface MigrationInput {
  /** package.json of the app folder, if any. */
  packageJson?: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  /** Every file path inside the app folder, relative to it (node_modules excluded). */
  paths: string[];
  /** go.mod contents for Go modules. */
  goMod?: string | null;
}

/** Commands that apply pending migrations and are safe to run on every deploy. */
const SAFE_MIGRATION_CLIS: Array<{ pattern: RegExp; tool: string }> = [
  { pattern: /\bdrizzle-kit\s+migrate\b/, tool: 'Drizzle' },
  { pattern: /\bprisma\s+migrate\s+deploy\b/, tool: 'Prisma' },
  { pattern: /\bknex\b.*\bmigrate:latest\b/, tool: 'Knex' },
  { pattern: /\btypeorm\b.*\bmigration:run\b/, tool: 'TypeORM' },
  { pattern: /\bsequelize(-cli)?\b.*\bdb:migrate(?!:undo)\b/, tool: 'Sequelize' },
  { pattern: /\bnode-pg-migrate\b(?!.*\bdown\b)/, tool: 'node-pg-migrate' },
  { pattern: /\bmikro-orm\b.*\bmigration:up\b/, tool: 'MikroORM' },
  { pattern: /\bkysely(-ctl)?\b.*\bmigrate\b(?!.*\bdown\b)/, tool: 'Kysely' },
  { pattern: /\bdb-migrate\s+up\b/, tool: 'db-migrate' },
  { pattern: /\bgraphile-migrate\s+migrate\b/, tool: 'Graphile Migrate' },
  { pattern: /\bdbmate\b.*\b(up|migrate)\b/, tool: 'dbmate' },
];

/** Commands that change the schema without migrations, reset data, or need a TTY. */
const UNSAFE_COMMANDS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bdrizzle-kit\s+push\b/, why: 'pushes the schema directly without migrations' },
  { pattern: /\bprisma\s+migrate\s+dev\b/, why: 'is a development command that can reset data' },
  { pattern: /\bprisma\s+migrate\s+reset\b/, why: 'drops the database' },
  { pattern: /\bprisma\s+db\s+push\b/, why: 'pushes the schema directly without migrations' },
  { pattern: /\btypeorm\b.*\bschema:(sync|drop)\b/, why: 'syncs the schema without migrations' },
];

/** Scripts that create or undo migrations rather than apply them. */
const NOT_APPLY =
  /\b(generate|create|make|new|rollback|down|undo|reset|drop|status|studio|check)\b|migrate:make|migration:(generate|create|revert)/;

/** Files that apply migrations when executed, e.g. drizzle-orm's `migrate()` runner. */
const RUNNER_FILE = /(^|\/)(migrate|migrator|run-?migrations?)\.(ts|mts|js|mjs|cjs)$/;

const SCRIPT_NAME_PRIORITY = [
  'db:migrate:deploy',
  'migrate:deploy',
  'db:migrate',
  'migrate',
  'migration:run',
  'migrations:run',
  'db:migrate:prod',
  'migrate:prod',
];

const runnerFor = (file: string) =>
  file.endsWith('.ts') || file.endsWith('.mts') ? `bun run ${file}` : `bun ${file}`;

export function detectMigrations(input: MigrationInput): MigrationDetection {
  const scored: Array<MigrationSuggestion & { score: number }> = [];
  const notes: string[] = [];
  const add = (s: MigrationSuggestion, score: number) => {
    if (!scored.some((x) => x.command === s.command)) scored.push({ ...s, score });
  };

  const scripts = input.packageJson?.scripts ?? {};
  const deps = {
    ...input.packageJson?.dependencies,
    ...input.packageJson?.devDependencies,
  };
  const paths = input.paths.filter(
    (p) => !/(^|\/)(node_modules|dist|build|\.next|out|vendor)\//.test(p),
  );

  // 1. package.json scripts: judge each by what it runs, not just its name.
  for (const [name, body] of Object.entries(scripts)) {
    const unsafe = UNSAFE_COMMANDS.find((u) => u.pattern.test(body));
    const safe = SAFE_MIGRATION_CLIS.find((c) => c.pattern.test(body));
    const nameLooksLikeMigration = /migrat/i.test(name) && !NOT_APPLY.test(name);

    if (/^(build|postinstall|prebuild|postbuild)$/.test(name) && safe) {
      notes.push(
        `Your "${name}" script already runs ${safe.tool} migrations. Moving that to the pre-deploy command means a failed migration stops the release instead of the build.`,
      );
      continue;
    }
    if (unsafe) {
      if (nameLooksLikeMigration || /migrat|push/i.test(name)) {
        notes.push(
          `Skipped "${name}": \`${body}\` ${unsafe.why}, so it is not safe on every deploy.`,
        );
      }
      continue;
    }
    if (NOT_APPLY.test(name)) continue;

    const priority = SCRIPT_NAME_PRIORITY.indexOf(name);
    const nameBonus = priority === -1 ? 0 : (SCRIPT_NAME_PRIORITY.length - priority) / 100;
    const runsRunnerFile = body.split(/\s+/).some((token) => RUNNER_FILE.test(token));

    if (safe) {
      add({ command: `bun run ${name}`, reason: `"${name}" script`, detail: body }, 3 + nameBonus);
    } else if (runsRunnerFile) {
      add(
        { command: `bun run ${name}`, reason: `"${name}" script`, detail: body },
        2.5 + nameBonus,
      );
    } else if (priority !== -1) {
      // Only conventional names on their own: "migrate:auth" running a one-off data
      // script must not be re-run on every deploy just because of its name.
      add({ command: `bun run ${name}`, reason: `"${name}" script`, detail: body }, 2 + nameBonus);
    }
  }

  // 2. Migration runner files that no script points at yet.
  for (const file of paths) {
    if (!RUNNER_FILE.test(file)) continue;
    // Files inside a migrations folder are migrations, not runners.
    if (/(^|\/)migrations?\/.+\//.test(file) || /(^|\/)migrations?\/[^/]+$/.test(file)) continue;
    if (Object.values(scripts).some((body) => body.includes(file))) continue;
    add({ command: runnerFor(file), reason: `Migration runner ${file}` }, 1.5);
  }

  // 3. ORM CLIs, when their config or migrations exist but no script wraps them.
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  if (has(/^drizzle\.config\.(ts|js|mjs|cjs|json)$/) || 'drizzle-kit' in deps) {
    const hasMigrations = has(/(^|\/)meta\/_journal\.json$/);
    if (hasMigrations) {
      add({ command: 'bunx drizzle-kit migrate', reason: 'Drizzle migrations folder' }, 1.2);
    } else {
      notes.push(
        'Drizzle is set up but no generated migrations were found. Run `drizzle-kit generate` and commit the output before using `drizzle-kit migrate`.',
      );
    }
  }
  if ('prisma' in deps || '@prisma/client' in deps || has(/(^|\/)schema\.prisma$/)) {
    if (has(/(^|\/)prisma\/migrations\/.+\/migration\.sql$/)) {
      add({ command: 'bunx prisma migrate deploy', reason: 'Prisma migrations folder' }, 1.2);
    } else {
      notes.push(
        'Prisma is set up but prisma/migrations is empty. Create migrations with `prisma migrate dev` locally, then deploy them with `prisma migrate deploy`.',
      );
    }
  }
  if ('knex' in deps && has(/^knexfile\.(ts|js|mjs|cjs)$/)) {
    add({ command: 'bunx knex migrate:latest', reason: 'knexfile' }, 1.1);
  }
  if ('typeorm' in deps && has(/(^|\/)(data-?source|ormconfig)\.(ts|js)$/)) {
    const ds = paths.find((p) => /(^|\/)data-?source\.(ts|js)$/.test(p));
    if (ds) {
      add(
        { command: `bunx typeorm migration:run -d ${ds}`, reason: `TypeORM data source ${ds}` },
        1.1,
      );
    }
  }

  // 4. Go modules.
  if (input.goMod) {
    for (const s of detectGoMigrations(input.goMod, paths))
      add(s, s.command.includes('./cmd/') ? 2.8 : 2);
  }

  scored.sort((a, b) => b.score - a.score);
  return { suggestions: scored.map(({ score: _score, ...s }) => s), notes };
}

/** Go: a cmd/migrate program, or the goose / golang-migrate CLIs at the module's pinned version. */
function detectGoMigrations(goMod: string, paths: string[]): MigrationSuggestion[] {
  const out: MigrationSuggestion[] = [];
  const cmdMigrate = paths
    .map((p) => p.match(/^cmd\/(migrate|migration|migrations|migrator|dbmigrate)\/[^/]+\.go$/)?.[1])
    .find(Boolean);
  if (cmdMigrate) {
    out.push({ command: `go run ./cmd/${cmdMigrate}`, reason: `cmd/${cmdMigrate} program` });
  }

  const require = (mod: string) =>
    goMod.match(
      new RegExp(`^\\s*(?:require\\s+)?${mod.replace(/[./]/g, '\\$&')}\\s+(v[\\w.\\-+]+)`, 'm'),
    )?.[1];
  const driver = /github\.com\/(jackc\/pgx|lib\/pq)/.test(goMod)
    ? 'postgres'
    : /github\.com\/go-sql-driver\/mysql/.test(goMod)
      ? 'mysql'
      : /(mattn\/go-sqlite3|modernc\.org\/sqlite)/.test(goMod)
        ? 'sqlite3'
        : null;
  // The directory holding .sql migrations (shallowest wins).
  const sqlDir = paths
    .filter((p) => p.endsWith('.sql') && /migrat/i.test(p))
    .map((p) => p.slice(0, p.lastIndexOf('/')))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];

  const goose = require('github.com/pressly/goose/v3');
  if (goose && sqlDir) {
    out.push({
      command: `go run github.com/pressly/goose/v3/cmd/goose@${goose} -dir ${sqlDir} ${driver ?? 'postgres'} "$DATABASE_URL" up`,
      reason: `goose ${goose} with migrations in ${sqlDir}/`,
      detail: driver
        ? undefined
        : 'Driver guessed as postgres; change it if you use another database.',
    });
  }
  const golangMigrate = require('github.com/golang-migrate/migrate/v4');
  if (golangMigrate && sqlDir) {
    const tag = driver === 'sqlite3' ? 'sqlite3' : (driver ?? 'postgres');
    out.push({
      command: `go run -tags ${tag} github.com/golang-migrate/migrate/v4/cmd/migrate@${golangMigrate} -path ${sqlDir} -database "$DATABASE_URL" up`,
      reason: `golang-migrate ${golangMigrate} with migrations in ${sqlDir}/`,
      detail: driver
        ? undefined
        : 'Driver guessed as postgres; change it if you use another database.',
    });
  }
  return out;
}

/**
 * File paths of one project folder, relative to it, from a whole-repo listing.
 * Subfolders with their own package.json or go.mod are separate projects and left out,
 * so a monorepo root does not claim its packages' migration files.
 */
export function scopePaths(repoPaths: string[], folder: string): string[] {
  const clean = folder.replace(/^\.\/?/, '').replace(/\/$/, '');
  const prefix = clean ? `${clean}/` : '';
  const nested = repoPaths
    .filter((p) => /(^|\/)(package\.json|go\.mod)$/.test(p) && !/(^|\/)node_modules\//.test(p))
    .map((p) => p.slice(0, p.lastIndexOf('/') + 1))
    .filter((root) => root !== prefix && root.startsWith(prefix));
  return repoPaths
    .filter((p) => p.startsWith(prefix) && !nested.some((root) => p.startsWith(root)))
    .map((p) => p.slice(prefix.length));
}
