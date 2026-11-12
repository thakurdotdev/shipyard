'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SetupStep {
  id: string;
  label: string;
  /** What was chosen in this step, shown once it is done (e.g. the repo name). */
  value?: string;
}

interface SetupStepperProps {
  steps: SetupStep[];
  current: string;
  /** Called for completed steps only, to go back and change the choice. */
  onSelect: (id: string) => void;
}

/**
 * Progress through project setup. Completed steps show what was picked and can
 * be clicked to change it. Phones get a compact "Step 2 of 4" bar instead.
 */
export function SetupStepper({ steps, current, onSelect }: SetupStepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  const active = steps[currentIndex];

  return (
    <nav aria-label="Setup progress">
      {/* Phone */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">
            Step {currentIndex + 1} of {steps.length} · {active.label}
          </span>
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={() => onSelect(steps[currentIndex - 1].id)}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Back
            </button>
          )}
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {steps.map((step, i) => (
            <span
              key={step.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= currentIndex ? 'bg-brand-500' : 'bg-border',
              )}
            />
          ))}
        </div>
        {currentIndex > 0 && (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {steps
              .slice(0, currentIndex)
              .map((s) => s.value)
              .filter(Boolean)
              .join(' / ')}
          </p>
        )}
      </div>

      {/* Tablet & desktop */}
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, i) => {
          const done = i < currentIndex;
          const isCurrent = i === currentIndex;
          const content = (
            <>
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  done && 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-300',
                  isCurrent && 'border-foreground/70 bg-foreground text-background',
                  !done && !isCurrent && 'border-border bg-surface-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 text-left">
                <span
                  className={cn(
                    'block text-sm font-medium',
                    isCurrent || done ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {done && step.value && (
                  <span className="block max-w-[11rem] truncate text-xs text-muted-foreground">
                    {step.value}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-2">
              {done ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  title={`Change ${step.label.toLowerCase()}`}
                  className="flex min-w-0 items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div
                  className="flex min-w-0 items-center gap-2 p-1 pr-2"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {content}
                </div>
              )}
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    'h-px w-6 shrink-0 lg:w-10',
                    done ? 'bg-brand-500/50' : 'bg-border',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
