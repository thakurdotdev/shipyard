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
      className={cn('rounded-xl border border-border bg-card transition-colors', className)}
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
