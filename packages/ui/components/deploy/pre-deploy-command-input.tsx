'use client';

import { Check, DatabaseZap, Info, Sparkles, Terminal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PreDeploySuggestion {
  command: string;
  reason: string;
  /** What it runs underneath, e.g. the body of the package.json script. */
  detail?: string;
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
  /** Every command detected in the repo, best first (overrides `suggestion`). */
  suggestions?: PreDeploySuggestion[];
  /** Caveats from detection, e.g. an unsafe script that was skipped. */
  notes?: string[];
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
  suggestions,
  notes = [],
  disabled,
  className,
}: PreDeployCommandInputProps) {
  const detected = suggestions ?? (suggestion ? [suggestion] : []);
  const [best, ...others] = detected;
  const current = value.trim();
  const showBest = best && current !== best.command;

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

      {showBest && !disabled && (
        <button
          type="button"
          onClick={() => onChange(best.command)}
          className="group flex w-full items-start gap-2.5 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-800 dark:text-brand-300" />
          <span className="min-w-0 flex-1 text-xs leading-5">
            <span className="block">
              <span className="font-medium text-foreground">Found in your repo:</span>{' '}
              <span className="text-muted-foreground">{best.reason}</span>
            </span>
            <code className="mt-1 block break-all rounded bg-surface-muted px-1.5 py-0.5 font-mono text-foreground">
              {best.command}
            </code>
            {best.detail && (
              <span className="mt-1 block break-all text-muted-foreground">
                runs <code className="font-mono">{best.detail}</code>
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs font-medium text-brand-800 group-hover:underline dark:text-brand-300">
            Use this
          </span>
        </button>
      )}

      {others.length > 0 && !disabled && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {showBest ? 'Also found:' : 'Other commands found in your repo:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {others.map((s) => {
              const selected = current === s.command;
              return (
                <button
                  key={s.command}
                  type="button"
                  onClick={() => onChange(s.command)}
                  title={[s.reason, s.detail && `runs ${s.detail}`].filter(Boolean).join(' · ')}
                  aria-pressed={selected}
                  className={cn(
                    'flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-brand-500/50 bg-brand-500/10 text-foreground'
                      : 'border-border bg-surface-muted/60 text-foreground/80 hover:border-brand-500/40 hover:text-foreground',
                  )}
                >
                  {selected && <Check className="size-3 shrink-0" />}
                  <span className="truncate">{s.command}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!value && !disabled && detected.length === 0 && (
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

      {notes.length > 0 && !disabled && (
        <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
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
