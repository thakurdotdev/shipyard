import { LogLevel } from '@/lib/types';

// Log level styling configuration.
// warning/error/success are SEMANTIC — they encode severity, not brand. Keep
// them; only the search highlight borrows the brand tint.
export const logLevelConfig: Record<LogLevel, { bg: string; text: string }> = {
  info: { bg: '', text: 'text-console-foreground' },
  warning: { bg: 'bg-amber-950/30', text: 'text-amber-300' },
  error: { bg: 'bg-red-950/50', text: 'text-red-400' },
  success: { bg: '', text: 'text-emerald-400' },
  deploy: { bg: '', text: '' },
};

export function getLogLineStyle(level: LogLevel, isHighlighted: boolean): string {
  if (isHighlighted) {
    return 'bg-brand-500/30 text-console-foreground';
  }
  const config = logLevelConfig[level];
  return `${config.bg} ${config.text}`;
}
