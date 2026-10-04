/**
 * Supported application framework types for the platform.
 */
export type AppType = 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia' | 'go';

export interface FrameworkConfig {
  id: AppType;
  displayName: string;
  category: 'frontend' | 'backend';
  defaultBuildCommand: string;
}

/**
 * Framework configurations used by control-api for project creation and validation.
 */
export const FRAMEWORKS: Record<AppType, FrameworkConfig> = {
  nextjs: {
    id: 'nextjs',
    displayName: 'Next.js',
    category: 'frontend',
    defaultBuildCommand: 'npm run build',
  },
  vite: {
    id: 'vite',
    displayName: 'Vite',
    category: 'frontend',
    defaultBuildCommand: 'npm run build',
  },
  express: {
    id: 'express',
    displayName: 'Express',
    category: 'backend',
    defaultBuildCommand: 'npm run build',
  },
  hono: {
    id: 'hono',
    displayName: 'Hono',
    category: 'backend',
    defaultBuildCommand: 'npm run build',
  },
  elysia: {
    id: 'elysia',
    displayName: 'Elysia',
    category: 'backend',
    defaultBuildCommand: 'bun run build',
  },
  go: {
    id: 'go',
    displayName: 'Go',
    category: 'backend',
    defaultBuildCommand: 'go build -o app .',
  },
};

export const APP_TYPES = Object.keys(FRAMEWORKS) as AppType[];

export function isValidAppType(type: string): type is AppType {
  return type in FRAMEWORKS;
}

export function isBackendFramework(type: AppType): boolean {
  return FRAMEWORKS[type].category === 'backend';
}
