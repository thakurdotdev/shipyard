import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';

/**
 * Supported application framework types.
 */
export type AppType = 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia' | 'go';

export interface FrameworkConfig {
  id: AppType;
  displayName: string;
  category: 'frontend' | 'backend';
  /**
   * Whether the framework needs node_modules installed before starting.
   * Static sites (vite dist) don't need this; SSR/backend apps do.
   */
  requiresInstall: boolean;
  /**
   * Returns the command array to start the application on the given port.
   * @param port - The port number to bind to
   * @param cwd - The working directory (extracted artifact path)
   */
  startCommand: (port: number, cwd: string) => string[];
  /**
   * Whether this framework serves static files (needs static-server).
   * If true, we use a built-in static file server instead of the app's start script.
   */
  isStaticBuild: boolean | ((cwd: string) => boolean);
}

/**
 * Framework configurations for the deploy engine.
 * Defines how each framework type is started in production.
 */
export const FRAMEWORKS: Record<AppType, FrameworkConfig> = {
  nextjs: {
    id: 'nextjs',
    displayName: 'Next.js',
    category: 'frontend',
    requiresInstall: true,
    isStaticBuild: (cwd) => existsSync(join(cwd, 'out')),
    startCommand: (port) => ['bun', 'run', 'start', '--', '--port', port.toString()],
  },

  vite: {
    id: 'vite',
    displayName: 'Vite',
    category: 'frontend',
    requiresInstall: false,
    isStaticBuild: true,
    startCommand: () => [], // Handled by static server
  },

  express: {
    id: 'express',
    displayName: 'Express',
    category: 'backend',
    requiresInstall: true,
    isStaticBuild: false,
    // Use bun's native TS support to run start script or entry file directly
    startCommand: () => ['bun', 'run', '--bun', 'start'],
  },

  hono: {
    id: 'hono',
    displayName: 'Hono',
    category: 'backend',
    requiresInstall: true,
    isStaticBuild: false,
    startCommand: () => ['bun', 'run', '--bun', 'start'],
  },

  elysia: {
    id: 'elysia',
    displayName: 'Elysia',
    category: 'backend',
    requiresInstall: true,
    isStaticBuild: false,
    startCommand: () => ['bun', 'run', '--bun', 'start'],
  },

  go: {
    id: 'go',
    displayName: 'Go',
    category: 'backend',
    requiresInstall: false,
    isStaticBuild: false,
    // Go apps are compiled to a native binary that pm0 runs directly.
    startCommand: (_port, cwd) => getGoStartCommand(cwd),
  },
};

export const APP_TYPES = Object.keys(FRAMEWORKS) as AppType[];

export function isValidAppType(type: string): type is AppType {
  return type in FRAMEWORKS;
}

export function isBackendFramework(type: AppType): boolean {
  return FRAMEWORKS[type].category === 'backend';
}

/**
 * Determines if this deployment should use the static file server.
 */
export function shouldUseStaticServer(appType: AppType, cwd: string): boolean {
  const config = FRAMEWORKS[appType];
  if (typeof config.isStaticBuild === 'function') {
    return config.isStaticBuild(cwd);
  }
  return config.isStaticBuild;
}

/**
 * Detects the TypeScript/JavaScript entry file for backend apps.
 * First checks package.json main/start/dev script, then falls back to common patterns.
 */
export function detectEntryFile(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      // Helper to extract entry from script
      const extractEntryFromScript = (script: string): string | null => {
        // Match patterns like: bun/node/tsx/ts-node/nodemon [run] <file.ts|js>
        const match = script.match(
          /(?:bun|node|tsx|ts-node|nodemon)\s+(?:run\s+)?(?:watch\s+)?(\S+\.(?:ts|js))/,
        );
        if (match?.[1]) {
          return match[1].replace(/^\.\//, '');
        }
        return null;
      };

      // Priority 1: Check dev script for TypeScript entry (most reliable for source)
      const devScript = pkg.scripts?.dev;
      if (devScript) {
        const entry = extractEntryFromScript(devScript);
        if (entry && existsSync(join(cwd, entry))) {
          console.log(`[detectEntryFile] Using dev script entry: ${entry}`);
          return entry;
        }
      }

      // Priority 2: Check main field - if it exists directly, use it
      if (pkg.main && existsSync(join(cwd, pkg.main))) {
        console.log(`[detectEntryFile] Using package.json main: ${pkg.main}`);
        return pkg.main;
      }

      // Priority 3: If main points to dist/, try to find source equivalent
      if (pkg.main && pkg.main.includes('dist/')) {
        const srcEntry = pkg.main.replace('dist/', 'src/').replace('.js', '.ts');
        if (existsSync(join(cwd, srcEntry))) {
          console.log(`[detectEntryFile] Using source equivalent of main: ${srcEntry}`);
          return srcEntry;
        }
      }

      // Priority 4: Check start script entry
      const startScript = pkg.scripts?.start;
      if (startScript) {
        const entry = extractEntryFromScript(startScript);
        if (entry) {
          // If points to dist/, try source equivalent
          if (entry.includes('dist/')) {
            const srcEntry = entry.replace('dist/', 'src/').replace('.js', '.ts');
            if (existsSync(join(cwd, srcEntry))) {
              console.log(`[detectEntryFile] Using source equivalent of start: ${srcEntry}`);
              return srcEntry;
            }
          }
          if (existsSync(join(cwd, entry))) {
            console.log(`[detectEntryFile] Using start script entry: ${entry}`);
            return entry;
          }
        }
      }
    } catch (e) {
      console.log(`[detectEntryFile] Failed to parse package.json:`, e);
    }
  }

  // Fall back to common entry file patterns
  const commonEntries = [
    'src/index.ts',
    'src/index.js',
    'src/server.ts',
    'src/server.js',
    'index.ts',
    'index.js',
    'server.ts',
    'server.js',
    'src/app.ts', // Moved lower - usually app.ts is a factory, not entry
    'src/app.js',
    'app.ts',
    'app.js',
    'api/index.ts',
    'api/index.js',
  ];

  for (const entry of commonEntries) {
    if (existsSync(join(cwd, entry))) {
      console.log(`[detectEntryFile] Using common pattern: ${entry}`);
      return entry;
    }
  }

  return null;
}

/** Candidate binary names for compiled Go apps, checked in priority order. */
const GO_BINARY_CANDIDATES = ['app', 'server', 'main'];

/**
 * Resolves the start command for a compiled Go binary.
 *
 * The default build command is `go build -o app .`, so `app` is checked first.
 * Falls back to a binary named after the app directory, then to `go run .`.
 */
export function getGoStartCommand(cwd: string): string[] {
  const candidates = [...GO_BINARY_CANDIDATES, 'bin/app', basename(cwd)];

  for (const name of candidates) {
    const binaryPath = join(cwd, name);
    if (existsSync(binaryPath)) {
      console.log(`[getGoStartCommand] Found Go binary: ${binaryPath}`);
      return [binaryPath];
    }
  }

  // No compiled binary found - fall back to running the source directly.
  console.log(`[getGoStartCommand] No compiled binary found in ${cwd}, falling back to "go run ."`);
  return ['go', 'run', '.'];
}

/**
 * Gets the start command for a backend app, preferring direct entry file execution.
 * Go apps resolve to their compiled binary; everything else uses the bun runtime.
 */
export function getBackendStartCommand(cwd: string, appType?: AppType): string[] {
  if (appType === 'go') {
    return getGoStartCommand(cwd);
  }

  const entryFile = detectEntryFile(cwd);

  if (entryFile) {
    // Run TypeScript/JavaScript directly with bun
    return ['bun', 'run', entryFile];
  }

  // Fallback to npm start (will work if project has proper build output)
  return ['bun', 'run', 'start'];
}
