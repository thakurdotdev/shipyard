'use client';

import { useState } from 'react';
import { PM0Process, pm0Api } from '@/lib/pm0-api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Play,
  Square,
  RotateCw,
  RefreshCcw,
  Trash2,
  MoreVertical,
  ScrollText,
  Cpu,
  MemoryStick,
  Clock,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ProcessLogViewer } from './process-log-viewer';

// ── helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatUptime(uptimeMs: number): string {
  if (!uptimeMs) return '—';
  const diff = Date.now() - uptimeMs;
  if (diff < 0) return '—';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function formatExecMode(mode: string): string {
  if (!mode) return 'Fork';
  const label = mode.replace(/_mode$/, '').replace(/-/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type StatusKey = 'online' | 'stopped' | 'errored' | 'launching' | 'stopping' | 'waiting restart';

const statusConfig: Record<StatusKey, { dot: string; text: string; label: string }> = {
  online: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    label: 'Online',
  },
  stopped: {
    dot: 'bg-zinc-400',
    text: 'text-muted-foreground',
    label: 'Stopped',
  },
  errored: {
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    label: 'Errored',
  },
  launching: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    label: 'Starting',
  },
  stopping: {
    dot: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    label: 'Stopping',
  },
  'waiting restart': {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    label: 'Restarting',
  },
};

function getStatusConfig(status: string) {
  return (
    statusConfig[status as StatusKey] ?? {
      dot: 'bg-zinc-400',
      text: 'text-muted-foreground',
      label: status,
    }
  );
}

function RowMetric({ value, muted, danger }: { value: string; muted?: boolean; danger?: boolean }) {
  return (
    <span
      className={cn(
        'truncate font-mono text-xs tabular-nums',
        muted ? 'text-muted-foreground/60' : 'text-foreground',
        danger && 'text-red-600 dark:text-red-400',
      )}
    >
      {value}
    </span>
  );
}

// ── component ────────────────────────────────────────────────────────

interface ProcessTableProps {
  processes: PM0Process[];
  onRefresh: () => void;
  compact?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (pmId: number) => void;
}

export function ProcessTable({
  processes,
  onRefresh,
  compact = false,
  selectedIds,
  onToggleSelect,
}: ProcessTableProps) {
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PM0Process | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const runAction = async (
    action: 'stop' | 'restart' | 'reload' | 'delete',
    process: PM0Process,
  ) => {
    const key = `${action}-${process.pm_id}`;
    setActionLoading(key);
    try {
      switch (action) {
        case 'stop':
          await pm0Api.stopProcess(String(process.pm_id));
          toast.success(`Stopped ${process.name}`);
          break;
        case 'restart':
          await pm0Api.restartProcess(String(process.pm_id));
          toast.success(`Restarted ${process.name}`);
          break;
        case 'reload':
          await pm0Api.reloadProcess(String(process.pm_id));
          toast.success(`Reloaded ${process.name}`);
          break;
        case 'delete':
          await pm0Api.deleteProcess(String(process.pm_id));
          toast.success(`Deleted ${process.name}`);
          break;
      }
      onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to ${action} ${process.name}: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (processes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center sm:py-20">
        <div className="mb-4 grid size-11 place-items-center rounded-lg border border-border bg-surface-muted">
          <Terminal className="size-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold tracking-tight">No processes to show</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Nothing matched your filters, or the PM0 daemon has no supervised processes. Start one
          with{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            pm0 start app.js
          </code>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Column header */}
        <div className="hidden items-center gap-4 border-b border-border bg-surface-muted/40 px-4 py-2 lg:flex">
          <div className="flex flex-1 items-center pl-[46px] text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Process
          </div>
          <div className="grid w-[340px] shrink-0 grid-cols-4 gap-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>CPU</span>
            <span>Memory</span>
            <span>Uptime</span>
            <span>Restarts</span>
          </div>
          <span className="w-[132px] shrink-0 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Actions
          </span>
        </div>

        <div className="divide-y divide-border">
          {processes.map((proc) => {
            const sc = getStatusConfig(proc.status);
            const isOnline = proc.status === 'online';
            const isLoading = (a: string) => actionLoading === `${a}-${proc.pm_id}`;
            const logsOpen = expandedLogs === String(proc.pm_id);

            const scriptName = proc.script?.split('/').pop() || proc.script || '—';
            const interpreter =
              proc.interpreter && proc.interpreter !== 'none' ? `${proc.interpreter} ` : '';
            const args = proc.args?.length ? ` ${proc.args.join(' ')}` : '';
            const command = `${interpreter}${scriptName}${args}`;
            const commandTitle = `${proc.interpreter} ${proc.script}${args}`.trim();

            const restartDanger = proc.max_restarts > 0 && proc.restart_time >= proc.max_restarts;
            const restartValue =
              proc.max_restarts > 0
                ? `${proc.restart_time}/${proc.max_restarts}`
                : String(proc.restart_time);

            const selectBox = onToggleSelect ? (
              <input
                type="checkbox"
                checked={selectedIds?.has(proc.pm_id) ?? false}
                onChange={() => onToggleSelect(proc.pm_id)}
                aria-label={`Select ${proc.name}`}
                className="mt-0.5 size-3.5 shrink-0 cursor-pointer rounded border-border bg-surface-muted accent-brand-500 lg:mt-0"
              />
            ) : null;

            const actions = (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground',
                    logsOpen && 'bg-accent text-foreground',
                  )}
                  onClick={() => setExpandedLogs(logsOpen ? null : String(proc.pm_id))}
                  title={logsOpen ? 'Hide logs' : 'View logs'}
                >
                  <ScrollText className="size-3.5" />
                  <span className={cn(compact ? 'hidden' : 'hidden md:inline')}>
                    {logsOpen ? 'Hide' : 'Logs'}
                  </span>
                </Button>

                {isOnline ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => runAction('stop', proc)}
                    disabled={!!isLoading('stop')}
                    title="Stop"
                  >
                    {isLoading('stop') ? (
                      <RotateCw className="size-3.5 animate-spin" />
                    ) : (
                      <Square className="size-3.5" />
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
                    onClick={() => runAction('restart', proc)}
                    disabled={!!isLoading('restart')}
                    title="Start"
                  >
                    {isLoading('restart') ? (
                      <RotateCw className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`More actions for ${proc.name}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => runAction('restart', proc)}
                      disabled={!!isLoading('restart')}
                    >
                      <RotateCw className="mr-2 size-4" />
                      Restart
                    </DropdownMenuItem>
                    {isOnline && (
                      <DropdownMenuItem
                        onClick={() => runAction('reload', proc)}
                        disabled={!!isLoading('reload')}
                      >
                        <RefreshCcw className="mr-2 size-4" />
                        Reload (graceful)
                      </DropdownMenuItem>
                    )}
                    {isOnline && (
                      <DropdownMenuItem
                        onClick={() => runAction('stop', proc)}
                        disabled={!!isLoading('stop')}
                      >
                        <Square className="mr-2 size-4" />
                        Stop
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteTarget(proc)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );

            const logPanel = logsOpen ? (
              <div className="border-t border-border">
                <ProcessLogViewer
                  target={String(proc.pm_id)}
                  processName={proc.name}
                  onClose={() => setExpandedLogs(null)}
                />
              </div>
            ) : null;

            return (
              <div
                key={proc.pm_id}
                className={cn(selectedIds?.has(proc.pm_id) && 'bg-surface-muted/50')}
              >
                <div
                  className={cn(
                    'flex items-start gap-3 px-4 transition-colors hover:bg-surface-muted/40 lg:items-center lg:gap-4',
                    compact ? 'py-2' : 'py-3',
                  )}
                >
                  {selectBox}
                  <span
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full lg:mt-0', sc.dot)}
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {proc.name}
                      </span>
                      <span className={cn('text-[11px] font-medium', sc.text)}>{sc.label}</span>
                      <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                        #{proc.pm_id}
                      </span>
                    </div>

                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span
                        className="inline-flex min-w-0 max-w-[260px] items-center gap-1 font-mono"
                        title={commandTitle}
                      >
                        <Terminal className="size-3 shrink-0 opacity-60" />
                        <span className="truncate">{command}</span>
                      </span>
                      {isOnline && proc.pid > 0 && (
                        <span className="tabular-nums">PID {proc.pid}</span>
                      )}
                      <span>{formatExecMode(proc.exec_mode)}</span>
                      {proc.instances > 1 && <span>{proc.instances} instances</span>}
                      {proc.status === 'errored' && proc.exit_code != null && (
                        <span className="text-red-600 dark:text-red-400">
                          exit {proc.exit_code}
                        </span>
                      )}
                      {proc.unstable_restarts > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {proc.unstable_restarts} unstable restart
                          {proc.unstable_restarts === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>

                    {/* Inline metrics for narrow screens */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground lg:hidden">
                      <span className="flex items-center gap-1" title="CPU">
                        <Cpu className="size-3" />
                        <span className="font-mono text-foreground tabular-nums">
                          {isOnline ? `${proc.monit.cpu.toFixed(1)}%` : '—'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1" title="Memory">
                        <MemoryStick className="size-3" />
                        <span className="font-mono text-foreground tabular-nums">
                          {isOnline ? formatBytes(proc.monit.memory) : '—'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1" title="Uptime">
                        <Clock className="size-3" />
                        <span className="font-mono text-foreground tabular-nums">
                          {isOnline ? formatUptime(proc.pm_uptime) : '—'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1" title="Restarts">
                        <RotateCw className="size-3" />
                        <span
                          className={cn(
                            'font-mono tabular-nums',
                            restartDanger ? 'text-red-600 dark:text-red-400' : 'text-foreground',
                          )}
                        >
                          {restartValue}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Desktop metrics */}
                  <div className="hidden w-[340px] shrink-0 grid-cols-4 items-center gap-4 lg:grid">
                    <RowMetric
                      value={isOnline ? `${proc.monit.cpu.toFixed(1)}%` : '—'}
                      muted={!isOnline}
                    />
                    <RowMetric
                      value={isOnline ? formatBytes(proc.monit.memory) : '—'}
                      muted={!isOnline}
                    />
                    <RowMetric
                      value={isOnline ? formatUptime(proc.pm_uptime) : '—'}
                      muted={!isOnline}
                    />
                    <RowMetric
                      value={restartValue}
                      muted={proc.restart_time === 0}
                      danger={restartDanger}
                    />
                  </div>

                  <div className="flex w-auto shrink-0 items-center justify-end lg:w-[132px]">
                    {actions}
                  </div>
                </div>
                {logPanel}
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete process</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop <strong>{deleteTarget?.name}</strong> and remove it from PM0. Its pm_id
              may be reused. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) runAction('delete', deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
