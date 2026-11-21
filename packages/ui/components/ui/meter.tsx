import { cn } from '@/lib/utils';

/** Thin usage bar. Turns amber at 75% and red at 90%. */
export function Meter({
  value,
  className,
  label,
}: {
  /** Percentage, 0–100. */
  value: number;
  className?: string;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 overflow-hidden rounded-full bg-foreground/8', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-foreground/40',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
