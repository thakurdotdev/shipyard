import { cn } from '@/lib/utils';

/** The status vocabulary used everywhere: a coloured dot, and a label that stays calm. */
export type Tone = 'success' | 'error' | 'progress' | 'warning' | 'neutral';

const DOT: Record<Tone, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  progress: 'bg-amber-400',
  warning: 'bg-amber-500',
  neutral: 'bg-zinc-400 dark:bg-zinc-500',
};

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-emerald-700 dark:text-emerald-400',
  error: 'text-red-700 dark:text-red-400',
  progress: 'text-amber-700 dark:text-amber-400',
  warning: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-muted-foreground',
};

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden="true">
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-60',
            DOT[tone],
          )}
        />
      )}
      <span className={cn('relative inline-flex size-full rounded-full', DOT[tone])} />
    </span>
  );
}

/** Dot plus label. Errors also colour the text so they read without the dot. */
export function StatusLabel({
  tone,
  pulse,
  children,
  className,
  title,
}: {
  tone: Tone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-2 text-sm whitespace-nowrap',
        tone === 'error' ? TONE_TEXT.error : 'text-foreground',
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}
