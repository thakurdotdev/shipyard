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
];

/**
 * Detects the framework used in a project based on config files and dependencies
 */
export function detectFramework(
  fileNames: string[],
  packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null,
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
  };

  if (!framework) {
    return { name: 'Unknown', icon: 'folder', color: '#6B7280' };
  }

  return frameworkInfo[framework];
}
