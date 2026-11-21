'use client';

import { useState } from 'react';
import type { UptimeCheck } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One mark per uptime check, oldest to newest. Failures are also taller, so the
 * strip doesn't rely on colour alone. Hovering a mark describes that check.
 */
export function CheckStrip({
  history,
  slots = 60,
  compact = false,
}: {
  /** Newest first, as the API returns it. */
  history: UptimeCheck[];
  slots?: number;
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState<UptimeCheck | null>(null);
  const checks = history.slice(0, slots).reverse();
  const passed = checks.filter((check) => check.success).length;
  const failed = checks.length - passed;

  return (
    <div>
      {!compact && (
        <p className="mb-2 min-h-5 truncate text-xs text-muted-foreground" aria-live="off">
          {hovered ? (
            <>
              <span className="font-medium text-foreground">
                {hovered.success
                  ? 'Passed'
                  : hovered.error || (hovered.status_code ? 'Failed' : 'Connection failed')}
              </span>
              {hovered.status_code ? ` · HTTP ${hovered.status_code}` : ''}
              {hovered.latency_ms !== null ? ` · ${hovered.latency_ms} ms` : ''}
              {` · ${new Date(hovered.checked_at).toLocaleString()}`}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {passed} of {checks.length} passed
              </span>
              {failed > 0 ? ` · ${failed} failed` : ''}
            </>
          )}
        </p>
      )}
      <div
        role="img"
        aria-label={`${passed} of the last ${checks.length} checks passed, ${failed} failed`}
        className={cn('flex items-end gap-[2px]', compact ? 'h-5' : 'h-8')}
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: slots - checks.length }, (_, index) => (
          <div key={index} className="h-1 min-w-0 flex-1 rounded-[1px] bg-foreground/10" />
        ))}
        {checks.map((check) => (
          <div
            key={check.id}
            className="flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHovered(check)}
            title={
              compact
                ? `${check.success ? 'Passed' : 'Failed'} · ${new Date(check.checked_at).toLocaleString()}`
                : undefined
            }
          >
            <div
              className={cn(
                'w-full rounded-[1px] transition-opacity',
                check.success ? 'h-3/5 bg-emerald-500/70' : 'h-full bg-red-500',
                hovered && hovered.id !== check.id && 'opacity-40',
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
