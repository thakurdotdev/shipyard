'use client';

import { DatabaseZap, Sparkles, Terminal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PreDeploySuggestion {
  command: string;
  reason: string;
}

const PRESETS = [
  { label: 'Script', command: 'bun run db:migrate' },
  { label: 'Drizzle', command: 'bunx drizzle-kit migrate' },
  { label: 'Prisma', command: 'bunx prisma migrate deploy' },
];

interface PreDeployCommandInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestion?: PreDeploySuggestion | null;
  disabled?: boolean;
  className?: string;
}

/**
 * Optional command that runs in the new build right before it goes live,
 * typically database migrations. Shared by the create flows and project settings.
 */
export function PreDeployCommandInput({
  id = 'pre-deploy-command',
  value,
  onChange,
  suggestion,
  disabled,
  className,
}: PreDeployCommandInputProps) {
  const showSuggestion = suggestion && value.trim() !== suggestion.command;

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="relative">
        <Terminal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="bun run db:migrate"
          spellCheck={false}
          autoComplete="off"
          className="pl-9 pr-9 font-mono text-sm"
          aria-describedby={`${id}-help`}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear pre-deploy command"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {showSuggestion && !disabled && (
        <button
          type="button"
          onClick={() => onChange(suggestion.command)}
          className="group flex w-full items-start gap-2.5 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-800 dark:text-brand-300" />
          <span className="min-w-0 flex-1 text-xs leading-5">
            <span className="font-medium text-foreground">{suggestion.reason}.</span>{' '}
            <span className="text-muted-foreground">Use </span>
            <code className="break-all rounded bg-surface-muted px-1 py-0.5 font-mono text-foreground">
              {suggestion.command}
            </code>
          </span>
          <span className="shrink-0 text-xs font-medium text-brand-800 group-hover:underline dark:text-brand-300">
            Apply
          </span>
        </button>
      )}

      {!value && !disabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Quick pick:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.command}
              type="button"
              onClick={() => onChange(preset.command)}
              title={preset.command}
              className="rounded-full border border-border bg-surface-muted/60 px-2.5 py-0.5 text-xs text-foreground/80 transition-colors hover:border-brand-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <p
        id={`${id}-help`}
        className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"
      >
        <DatabaseZap className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {disabled
            ? 'Static sites have no runtime, so there is nothing to run before they go live.'
            : 'Runs with your environment variables after the build and before the new version goes live. If it fails, the current deployment keeps serving.'}
        </span>
      </p>
    </div>
  );
}
