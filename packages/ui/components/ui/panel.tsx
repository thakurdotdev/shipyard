import { cn } from '@/lib/utils';

/** A bordered surface with an optional header and footer. The building block of every page. */
export function Panel({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn(
        'surface-card min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        'flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      {children}
    </header>
  );
}

export function PanelBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 py-4 sm:px-5', className)} {...props} />;
}

export function PanelFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-surface-muted/30 px-4 py-2.5 sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

/** Label/value pairs. Values may be text or anything else. */
export function Facts({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; mono?: boolean; title?: string }[];
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-y-2.5 text-sm', className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="grid min-w-0 grid-cols-[minmax(6.5rem,38%)_minmax(0,1fr)] items-baseline gap-3"
        >
          <dt className="truncate text-muted-foreground">{item.label}</dt>
          <dd
            className={cn('min-w-0 truncate text-foreground', item.mono && 'font-mono text-[13px]')}
            title={item.title ?? (typeof item.value === 'string' ? item.value : undefined)}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
