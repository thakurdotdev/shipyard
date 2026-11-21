'use client';

import Link from 'next/link';
import { ArrowUpRight, Loader2, Play, RefreshCcw, RotateCw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusLabel, TONE_TEXT } from '@/components/ui/status';
import { formatBytes, formatUptime } from '@/lib/format';
import { processTarget, type PM0Process } from '@/lib/pm0-api';
import { cn } from '@/lib/utils';
import { ProcessLogViewer } from './process-log-viewer';
import {
  execModeLabel,
  processCommand,
  processStatus,
  restartsExhausted,
  restartsLabel,
} from './process-utils';
import type { ProcessAction } from './use-process-actions';

/** Everything about one process, its controls, and its live output, in a side panel. */
export function ProcessInspector({
  process,
  open,
  onOpenChange,
  onAction,
  isPending,
}: {
  process: PM0Process | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: ProcessAction, process: PM0Process) => void;
  isPending: (process: PM0Process, action?: ProcessAction) => boolean;
}) {
  return (
    <Sheet open={open && !!process} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[760px]"
        // Focus the panel, not its first button, so a stray Enter restarts nothing.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {process && <InspectorBody process={process} onAction={onAction} isPending={isPending} />}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({
  process,
  onAction,
  isPending,
}: {
  process: PM0Process;
  onAction: (action: ProcessAction, process: PM0Process) => void;
  isPending: (process: PM0Process, action?: ProcessAction) => boolean;
}) {
  const status = processStatus(process.status);
  const online = process.status === 'online';
  const busy = isPending(process);
  const command = processCommand(process);
  const act = (action: ProcessAction) => onAction(action, process);
  const spinner = (action: ProcessAction, icon: React.ReactNode) =>
    isPending(process, action) ? <Loader2 className="animate-spin" /> : icon;

  const usage = [
    { label: 'CPU', value: online ? `${process.monit.cpu.toFixed(1)}%` : '—' },
    { label: 'Memory', value: online ? formatBytes(process.monit.memory) : '—' },
    { label: 'Uptime', value: online ? formatUptime(process.pm_uptime) : '—' },
    {
      label: 'Restarts',
      value: restartsLabel(process),
      danger: restartsExhausted(process),
    },
  ];

  const facts: { label: string; value: React.ReactNode; copy?: string }[] = [
    { label: 'Command', value: command.full || '—', copy: command.full },
    { label: 'Directory', value: process.cwd || '—', copy: process.cwd },
    { label: 'PID', value: online && process.pid > 0 ? process.pid : '—' },
    {
      label: 'PM0 id',
      value: `${process.pm_id}${process.daemon ? ` · ${process.daemon} daemon` : ''}`,
    },
    {
      label: 'Mode',
      value: `${execModeLabel(process.exec_mode)}${process.instances > 1 ? ` · ${process.instances} instances` : ''}`,
    },
    {
      label: 'Auto-restart',
      value: process.autorestart
        ? `On${process.max_restarts > 0 ? `, up to ${process.max_restarts} times` : ''}`
        : 'Off',
    },
  ];
  if (process.exit_code != null && !online)
    facts.push({ label: 'Last exit', value: `code ${process.exit_code}` });
  if (process.unstable_restarts > 0)
    facts.push({ label: 'Unstable restarts', value: process.unstable_restarts });

  return (
    <>
      <SheetHeader className="gap-3 border-b border-border p-4 pr-12 sm:p-5 sm:pr-12">
        <div className="min-w-0">
          <SheetTitle className="truncate text-base">{process.name}</SheetTitle>
          <SheetDescription asChild>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusLabel tone={status.tone} className="text-[13px]">
                {status.label}
              </StatusLabel>
              <span className="font-mono text-xs">{processTarget(process)}</span>
              {process.project_id && (
                <Link
                  href={`/projects/${process.project_id}`}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                >
                  Open project <ArrowUpRight className="size-3" />
                </Link>
              )}
            </div>
          </SheetDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {online ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('restart')}>
              {spinner('restart', <RotateCw />)}
              Restart
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => act('start')}>
              {spinner('start', <Play />)}
              Start
            </Button>
          )}
          {online && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('reload')}>
              {spinner('reload', <RefreshCcw />)}
              Reload
            </Button>
          )}
          {online && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('stop')}>
              {spinner('stop', <Square className="size-3.5" />)}
              Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
            disabled={busy}
            onClick={() => act('delete')}
          >
            {spinner('delete', <Trash2 />)}
            Delete
          </Button>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-4 border-b border-border">
          {usage.map((item) => (
            <div
              key={item.label}
              className="border-r border-border px-4 py-3 last:border-r-0 sm:px-5"
            >
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd
                className={cn(
                  'mt-0.5 font-mono text-sm tabular-nums',
                  item.danger && TONE_TEXT.error,
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <dl className="grid gap-2 border-b border-border px-4 py-4 text-[13px] sm:px-5">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3"
            >
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="flex min-w-0 items-center gap-1 font-mono text-xs">
                <span
                  className="min-w-0 truncate"
                  title={typeof fact.value === 'string' ? fact.value : undefined}
                >
                  {fact.value}
                </span>
                {fact.copy && <CopyButton value={fact.copy} label={fact.label.toLowerCase()} />}
              </dd>
            </div>
          ))}
        </dl>

        <ProcessLogViewer
          target={processTarget(process)}
          processName={process.name}
          className="h-[max(320px,calc(100svh-26rem))]"
        />
      </div>
    </>
  );
}
