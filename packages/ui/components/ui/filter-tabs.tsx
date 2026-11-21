'use client';

import { cn } from '@/lib/utils';
import { StatusDot, type Tone } from './status';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  tone?: Tone;
}

/** A row of mutually exclusive filters, each with its count. Scrolls sideways on phones. */
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: FilterOption<T>[];
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-muted/50 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-xs ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.tone && <StatusDot tone={option.tone} className="size-1.5" />}
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  active ? 'text-muted-foreground' : 'text-muted-foreground/70',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
