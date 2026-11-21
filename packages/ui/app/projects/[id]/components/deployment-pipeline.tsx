'use client';

import { Check, Loader2 } from 'lucide-react';
import { Panel } from '@/components/ui/panel';
import { TONE_TEXT } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { deployStepLabel, PIPELINE_STEPS, type DeploymentEvent } from '../project-state';

function activeStepIndex(status: string): number {
  return PIPELINE_STEPS.findIndex((step) => (step.statuses as readonly string[]).includes(status));
}

/**
 * The release in flight as a row of steps, or where the last one failed.
 * Nothing renders while no release is running.
 */
export function DeploymentProgress({ event }: { event: DeploymentEvent | null | undefined }) {
  const status = event?.status;
  if (!status || status === 'active' || status === 'inactive') return null;
  const failed = status === 'failed';
  const current = activeStepIndex(status);

  return (
    <Panel
      role="status"
      aria-live="polite"
      className={cn(failed ? 'border-red-500/30' : 'border-amber-500/25')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3.5 sm:px-5">
        <p className={cn('text-sm font-medium', failed ? TONE_TEXT.error : 'text-foreground')}>
          {failed ? 'Release failed' : 'Releasing build'}{' '}
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {event.build_id.slice(0, 8)}
          </span>
        </p>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {event.status_message || deployStepLabel(status)}
        </p>
      </div>

      {failed ? (
        <p className="px-4 pt-1 pb-3.5 text-[13px] text-muted-foreground sm:px-5">
          Production keeps serving the previous deployment. Open the build’s logs for details.
        </p>
      ) : (
        <ol className="grid grid-cols-5 gap-1.5 px-4 pt-3 pb-3.5 sm:px-5">
          {PIPELINE_STEPS.map((step, index) => {
            const done = current > index;
            const active = current === index;
            return (
              <li key={step.key} className="min-w-0">
                <div
                  className={cn(
                    'h-1 rounded-full',
                    done
                      ? 'bg-emerald-500/70'
                      : active
                        ? 'animate-pulse bg-amber-400'
                        : 'bg-foreground/10',
                  )}
                />
                <p
                  className={cn(
                    'mt-1.5 flex items-center gap-1 truncate text-[11px]',
                    done || active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {done && <Check className="size-3 shrink-0 text-emerald-500" />}
                  {active && <Loader2 className="size-3 shrink-0 animate-spin text-amber-400" />}
                  <span className="truncate">{step.label}</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
