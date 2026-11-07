import * as React from 'react';

import { cn } from '@/lib/utils';

function CardShell({
  children,
  className,
  innerClassName,
  ...props
}: React.ComponentProps<'div'> & { innerClassName?: string }) {
  return (
    <div
      data-slot="card-shell"
      className={cn('surface-card rounded-xl border border-border bg-card', className)}
      {...props}
    >
      <div
        data-slot="card-shell-inner"
        className={cn('flex h-full flex-col rounded-xl bg-card', innerClassName)}
      >
        {children}
      </div>
    </div>
  );
}

export { CardShell };
