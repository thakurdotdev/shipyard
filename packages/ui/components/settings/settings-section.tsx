'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { TONE_TEXT } from '@/components/ui/status';
import { cn } from '@/lib/utils';

/**
 * One group of settings. Every section saves on its own through its footer, so
 * nothing changes until you press Save, and leaving with unsaved edits warns.
 */
export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
  footer,
  tone,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  /** Sits beside the title, e.g. an on/off switch for the whole section. */
  aside?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: 'danger';
  className?: string;
}) {
  return (
    <Panel
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('scroll-mt-32', tone === 'danger' && 'border-red-500/30', className)}
    >
      <header className="flex items-start justify-between gap-4 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className={cn('text-[15px] font-medium', tone === 'danger' && TONE_TEXT.error)}
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0 pt-0.5">{aside}</div>}
      </header>
      {children ? (
        <div className="space-y-5 px-4 pt-4 pb-5 sm:px-5">{children}</div>
      ) : (
        <div className="h-4 sm:h-5" />
      )}
      {footer}
    </Panel>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
        {optional && <span className="font-normal text-muted-foreground">optional</span>}
      </Label>
      {children}
      {(error || hint) && (
        <p className={cn('text-xs leading-5', error ? TONE_TEXT.error : 'text-muted-foreground')}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

/** Footer with the section's state on the left and Reset/Save on the right. */
export function SaveFooter({
  dirty,
  saving,
  canSave = true,
  onSave,
  onReset,
  note,
  saveLabel = 'Save',
}: {
  dirty: boolean;
  saving: boolean;
  /** False while the input is invalid; dirty sections can't save until it's fixed. */
  canSave?: boolean;
  onSave: () => void;
  onReset?: () => void;
  /** Shown when nothing is pending, e.g. when the change takes effect. */
  note?: React.ReactNode;
  saveLabel?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-13 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5 transition-colors sm:px-5',
        dirty ? 'border-brand-500/25 bg-brand-500/[0.06]' : 'border-border bg-surface-muted/30',
      )}
    >
      <p className="min-w-0 text-xs text-muted-foreground">
        {dirty ? <span className="font-medium text-foreground">Unsaved changes</span> : note}
      </p>
      <div className="ml-auto flex items-center gap-2">
        {dirty && onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
            Reset
          </Button>
        )}
        {(dirty || saving) && (
          <Button size="sm" onClick={onSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? 'Saving' : saveLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Asks before closing or reloading the tab while something is unsaved. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/** A labelled switch row: the label and its explanation on the left, the switch on the right. */
export function ToggleRow({
  id,
  label,
  description,
  control,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-muted/30 px-3.5 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        {description && (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}
