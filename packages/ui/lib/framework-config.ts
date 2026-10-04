/**
 * Supported application framework types.
 */
export type AppType = 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia' | 'go';

export interface FrameworkOption {
  value: AppType;
  label: string;
  category: 'Frontend' | 'Backend';
  defaultBuildCommand: string;
}

/**
 * Framework options for UI dropdowns and forms.
 * Ordered by category (frontend first) then alphabetically.
 */
export const FRAMEWORK_OPTIONS: FrameworkOption[] = [
  {
    value: 'nextjs',
    label: 'Next.js',
    category: 'Frontend',
    defaultBuildCommand: 'npm run build',
  },
  {
    value: 'vite',
    label: 'Vite / React',
    category: 'Frontend',
    defaultBuildCommand: 'npm run build',
  },
  {
    value: 'elysia',
    label: 'Elysia',
    category: 'Backend',
    defaultBuildCommand: 'bun run build',
  },
  {
    value: 'express',
    label: 'Express',
    category: 'Backend',
    defaultBuildCommand: 'npm run build',
  },
  {
    value: 'go',
    label: 'Go',
    category: 'Backend',
    defaultBuildCommand: 'go build -o app .',
  },
  {
    value: 'hono',
    label: 'Hono',
    category: 'Backend',
    defaultBuildCommand: 'npm run build',
  },
];

export const APP_TYPES = FRAMEWORK_OPTIONS.map((f) => f.value);

export function getFrameworkOption(type: AppType): FrameworkOption | undefined {
  return FRAMEWORK_OPTIONS.find((f) => f.value === type);
}

export function getDefaultBuildCommand(type: AppType): string {
  return getFrameworkOption(type)?.defaultBuildCommand ?? 'npm run build';
}
