import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The signature surface: a double ring.
 *
 * An outer rounded shell with a hairline border and a thin gutter, wrapping an
 * inner surface that carries its own hairline border. The gap between the two
 * reads as a soft inner frame.
 *
 * Radii are concentric — the inner radius is the outer radius minus the shell
 * padding (28 − 6 = 22). Never give both rings the same radius, and never take
 * border alpha above ~20%: the look is editorial, not skeuomorphic.
 */
function CardShell({
  children,
  className,
  innerClassName,
  ...props
}: React.ComponentProps<'div'> & { innerClassName?: string }) {
  return (
    <div
      data-slot="card-shell"
      className={cn('rounded-[28px] border border-border bg-surface-muted/40 p-1.5', className)}
      {...props}
    >
      <div
        data-slot="card-shell-inner"
        className={cn(
          'flex h-full flex-col rounded-[22px] border border-border bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_32px_-16px_rgba(0,0,0,0.7)]',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export { CardShell };
