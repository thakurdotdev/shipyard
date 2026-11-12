import { AppType } from '../config/framework-config';

/**
 * Framework detection result for a folder
 */
export interface DetectedFramework {
  framework: AppType | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Framework detection rules - ordered by priority
 */
const FRAMEWORK_RULES: Array<{
  framework: AppType;
  configFiles: string[];
  dependencies: string[];
}> = [
  {
    framework: 'nextjs',
    configFiles: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
    dependencies: ['next'],
  },
  {
    framework: 'vite',
    configFiles: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    dependencies: ['vite'],
  },
  {
    framework: 'elysia',
    configFiles: [],
    dependencies: ['elysia'],
  },
  {
    framework: 'hono',
    configFiles: [],
    dependencies: ['hono'],
  },
  {
    framework: 'express',
    configFiles: [],
    dependencies: ['express'],
  },
  {
    framework: 'go',
    configFiles: ['go.mod'],
    dependencies: [],
  },
];

/** Files that mark a project as using the Bun runtime / package manager. */
const BUN_MARKER_FILES = ['bun.lock', 'bun.lockb', 'bunfig.toml'];
/** Packages that only make sense in a Bun project. */
const BUN_MARKER_DEPENDENCIES = ['@types/bun', 'bun-types'];

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/**
 * Detects a plain Bun server (Bun.serve, no web framework).
 * Only consulted after every framework rule failed, so Bun-based Elysia, Hono,
 * Vite or Next.js projects still resolve to their framework.
 */
function detectBun(
  fileNames: string[],
  packageJson: PackageJsonLike | null,
  repoRootFiles: string[],
): DetectedFramework | null {
  if (!packageJson) return null;

  const marker = BUN_MARKER_FILES.find((f) => fileNames.includes(f));
  if (marker) return { framework: 'bun', confidence: 'high', reason: `Found ${marker}` };

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const dep = BUN_MARKER_DEPENDENCIES.find((d) => d in allDeps);
  if (dep) return { framework: 'bun', confidence: 'medium', reason: `Found dependency: ${dep}` };

  for (const name of ['start', 'dev']) {
    const script = packageJson.scripts?.[name];
    if (script && /^\s*bun(x)?\s/.test(script)) {
      return { framework: 'bun', confidence: 'medium', reason: `"${name}" script runs with bun` };
    }
  }

  // Monorepo member: the lockfile lives at the repository root.
  const rootMarker = BUN_MARKER_FILES.find((f) => repoRootFiles.includes(f));
  if (rootMarker) {
    return {
      framework: 'bun',
      confidence: 'low',
      reason: `Found ${rootMarker} at repository root`,
    };
  }

  return null;
}

/**
 * Detects the framework used in a project based on config files and dependencies
 */
export function detectFramework(
  fileNames: string[],
  packageJson: PackageJsonLike | null,
  repoRootFiles: string[] = [],
): DetectedFramework {
  const allDeps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  // Check each framework rule
  for (const rule of FRAMEWORK_RULES) {
    // Check config files first (high confidence)
    for (const configFile of rule.configFiles) {
      if (fileNames.includes(configFile)) {
        return {
          framework: rule.framework,
          confidence: 'high',
          reason: `Found ${configFile}`,
        };
      }
    }

    // Check dependencies (medium confidence)
    for (const dep of rule.dependencies) {
      if (dep in allDeps) {
        return {
          framework: rule.framework,
          confidence: 'medium',
          reason: `Found dependency: ${dep}`,
        };
      }
    }
  }

  const bun = detectBun(fileNames, packageJson, repoRootFiles);
  if (bun) return bun;

  return {
    framework: null,
    confidence: 'low',
    reason: 'No framework detected',
  };
}

/**
 * Get display info for a framework
 */
export function getFrameworkDisplayInfo(framework: AppType | null): {
  name: string;
  icon: string;
  color: string;
} {
  const frameworkInfo: Record<AppType, { name: string; icon: string; color: string }> = {
    nextjs: { name: 'Next.js', icon: 'nextjs', color: '#000000' },
    vite: { name: 'Vite', icon: 'vite', color: '#646CFF' },
    express: { name: 'Express', icon: 'express', color: '#000000' },
    hono: { name: 'Hono', icon: 'hono', color: '#E36002' },
    elysia: { name: 'Elysia', icon: 'elysia', color: '#7C3AED' },
    bun: { name: 'Bun', icon: 'bun', color: '#FBF0DF' },
    go: { name: 'Go', icon: 'go', color: '#00ADD8' },
  };

  if (!framework) {
    return { name: 'Unknown', icon: 'folder', color: '#6B7280' };
  }

  return frameworkInfo[framework];
}

export interface PreDeploySuggestion {
  command: string;
  reason: string;
}

/** package.json scripts that conventionally apply pending migrations, by priority. */
const MIGRATION_SCRIPTS = [
  'db:migrate:deploy',
  'migrate:deploy',
  'db:migrate',
  'migrate',
  'migration:run',
  'migrations:run',
];

/**
 * Suggests a pre-deploy command that applies database migrations.
 * Only ever used to pre-fill the form; Shipyard never runs a detected command
 * unless the user saves it on the project.
 */
export function suggestPreDeployCommand(
  fileNames: string[],
  packageJson: PackageJsonLike | null,
): PreDeploySuggestion | null {
  const script = MIGRATION_SCRIPTS.find((name) => packageJson?.scripts?.[name]);
  if (script) {
    return { command: `bun run ${script}`, reason: `Found "${script}" script in package.json` };
  }

  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  const hasDrizzleConfig = fileNames.some((f) => /^drizzle\.config\.(ts|js|mjs|cjs|json)$/.test(f));
  if (hasDrizzleConfig || 'drizzle-kit' in deps) {
    return { command: 'bunx drizzle-kit migrate', reason: 'Drizzle ORM detected' };
  }
  if ('prisma' in deps || '@prisma/client' in deps || fileNames.includes('prisma')) {
    return { command: 'bunx prisma migrate deploy', reason: 'Prisma detected' };
  }
  if ('knex' in deps && fileNames.some((f) => /^knexfile\.(ts|js|mjs|cjs)$/.test(f))) {
    return { command: 'bunx knex migrate:latest', reason: 'Knex detected' };
  }
  return null;
}
