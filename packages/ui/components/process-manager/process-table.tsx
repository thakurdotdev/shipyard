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
  ExternalLink,
  Terminal,
  FolderOpen,
  Copy,
  Check,
} from 'lucide-react';
import { formatUptime } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
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
  /** True when a search or status filter is hiding processes. */
  filtered?: boolean;
  onClearFilters?: () => void;
}

export function ProcessTable({
  processes,
  onRefresh,
  compact = false,
  selectedIds,
  onToggleSelect,
  filtered = false,
  onClearFilters,
}: ProcessTableProps) {
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'stop' | 'delete';
    process: PM0Process;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

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
      <div className="surface-card flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center sm:py-20">
        <div className="mb-4 grid size-11 place-items-center rounded-lg border border-border bg-surface-muted">
          <Terminal className="size-5 text-muted-foreground" />
        </div>
        {filtered ? (
          <>
            <h3 className="text-base font-semibold tracking-tight">No matching processes</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Nothing matches your search and status filter.
            </p>
            {onClearFilters && (
              <Button variant="outline" size="sm" className="mt-5" onClick={onClearFilters}>
                Clear filters
              </Button>
            )}
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold tracking-tight">No supervised processes</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Deploy a project, or start a process with{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                pm0 start app.js
              </code>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="surface-card overflow-hidden rounded-xl border border-border bg-card">
        {/* Column header */}
        <div className="hidden items-center gap-4 border-b border-border bg-surface-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground lg:flex">
          <div className="flex-1 pl-14">Process</div>
          <div className="grid w-[340px] shrink-0 grid-cols-4 gap-4">
            <span>CPU</span>
            <span>Memory</span>
            <span>Uptime</span>
            <span>Restarts</span>
          </div>
          <span className="w-[132px] shrink-0 text-right">
            <span className="sr-only">Actions</span>
          </span>
        </div>

        <div className="divide-y divide-border">
          {processes.map((proc) => {
            const sc = getStatusConfig(proc.status);
            const isOnline = proc.status === 'online';
            const isErrored = proc.status === 'errored';
            const isLoading = (a: string) => actionLoading === `${a}-${proc.pm_id}`;
            const logsOpen = expandedLogs === String(proc.pm_id);
            const selected = selectedIds?.has(proc.pm_id) ?? false;

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
            const metrics = [
              {
                label: 'CPU',
                value: isOnline ? `${proc.monit.cpu.toFixed(1)}%` : '—',
                muted: !isOnline,
              },
              {
                label: 'Memory',
                value: isOnline ? formatBytes(proc.monit.memory) : '—',
                muted: !isOnline,
              },
              {
                label: 'Uptime',
                value: isOnline ? formatUptime(proc.pm_uptime) : '—',
                muted: !isOnline,
              },
              {
                label: 'Restarts',
                value: restartValue,
                muted: proc.restart_time === 0,
                danger: restartDanger,
              },
            ];

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
                  aria-label={`${logsOpen ? 'Hide' : 'View'} logs for ${proc.name}`}
                  aria-expanded={logsOpen}
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
                    onClick={() => setConfirmTarget({ action: 'stop', process: proc })}
                    disabled={isLoading('stop')}
                    title="Stop"
                    aria-label={`Stop ${proc.name}`}
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
                    disabled={isLoading('restart')}
                    title="Start"
                    aria-label={`Start ${proc.name}`}
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
                    {proc.project_id && (
                      <>
                        <DropdownMenuItem asChild>
                          <Link href={`/projects/${proc.project_id}`}>
                            <ExternalLink className="mr-2 size-4" />
                            Open project
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      onClick={() => runAction('restart', proc)}
                      disabled={isLoading('restart')}
                    >
                      <RotateCw className="mr-2 size-4" />
                      {isOnline ? 'Restart' : 'Start'}
                    </DropdownMenuItem>
                    {isOnline && (
                      <DropdownMenuItem
                        onClick={() => runAction('reload', proc)}
                        disabled={isLoading('reload')}
                      >
                        <RefreshCcw className="mr-2 size-4" />
                        Reload (graceful)
                      </DropdownMenuItem>
                    )}
                    {isOnline && (
                      <DropdownMenuItem
                        onClick={() => setConfirmTarget({ action: 'stop', process: proc })}
                        disabled={isLoading('stop')}
                      >
                        <Square className="mr-2 size-4" />
                        Stop
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setConfirmTarget({ action: 'delete', process: proc })}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );

            const metaLine = (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span
                  className="inline-flex min-w-0 max-w-[260px] items-center gap-1 font-mono"
                  title={commandTitle}
                >
                  <Terminal className="size-3 shrink-0 opacity-60" />
                  <span className="truncate">{command}</span>
                </span>
                {isOnline && proc.pid > 0 && <span className="tabular-nums">PID {proc.pid}</span>}
                <span>{formatExecMode(proc.exec_mode)}</span>
                {proc.instances > 1 && <span>{proc.instances} instances</span>}
                {isErrored && proc.exit_code != null && (
                  <span className="text-red-600 dark:text-red-400">exit {proc.exit_code}</span>
                )}
                {proc.unstable_restarts > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {proc.unstable_restarts} unstable restart
                    {proc.unstable_restarts === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            );

            const cwdLine = proc.cwd && (
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <FolderOpen className="size-3 shrink-0 opacity-60" />
                <code className="min-w-0 truncate font-mono" title={proc.cwd}>
                  {proc.cwd}
                </code>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer rounded p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  title="Copy path"
                  aria-label={`Copy working directory of ${proc.name}`}
                  onClick={() => {
                    navigator.clipboard.writeText(proc.cwd);
                    setCopiedId(proc.pm_id);
                    toast.success('Path copied');
                    setTimeout(() => setCopiedId((v) => (v === proc.pm_id ? null : v)), 2000);
                  }}
                >
                  {copiedId === proc.pm_id ? (
                    <Check className="size-3 text-emerald-700 dark:text-emerald-400" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </button>
              </div>
            );

            // Phones get one plain-language usage line instead of a labelled grid.
            const usageLine = (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                {isOnline ? (
                  <>
                    <span>
                      <span className="font-medium text-foreground">
                        {proc.monit.cpu.toFixed(1)}%
                      </span>{' '}
                      CPU
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        {formatBytes(proc.monit.memory)}
                      </span>
                    </span>
                    <span>up {formatUptime(proc.pm_uptime)}</span>
                  </>
                ) : (
                  isErrored &&
                  proc.exit_code != null && (
                    <span className="text-red-600 dark:text-red-400">exit {proc.exit_code}</span>
                  )
                )}
                {(proc.restart_time > 0 || restartDanger) && (
                  <span className={cn(restartDanger && 'text-red-600 dark:text-red-400')}>
                    {restartValue} restarts
                  </span>
                )}
              </p>
            );

            return (
              <div
                key={proc.pm_id}
                className={cn(isErrored && 'bg-red-500/[0.04]', selected && 'bg-surface-muted/50')}
              >
                <div
                  className={cn(
                    'px-4 transition-colors hover:bg-surface-muted/40',
                    compact ? 'py-2' : 'py-3',
                  )}
                >
                  <div className="flex items-center gap-3 lg:gap-4">
                    {onToggleSelect && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect(proc.pm_id)}
                        aria-label={`Select ${proc.name}`}
                        className="size-4 shrink-0 cursor-pointer rounded border-border bg-surface-muted accent-brand-500"
                      />
                    )}
                    <span className={cn('size-2 shrink-0 rounded-full', sc.dot)} aria-hidden />

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                        {proc.project_id ? (
                          <Link
                            href={`/projects/${proc.project_id}`}
                            className="max-w-full truncate rounded-sm text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {proc.name}
                          </Link>
                        ) : (
                          <span className="max-w-full truncate text-sm font-medium text-foreground">
                            {proc.name}
                          </span>
                        )}
                        <span className={cn('shrink-0 text-[11px] font-medium', sc.text)}>
                          {sc.label}
                        </span>
                        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
                          #{proc.pm_id}
                        </span>
                      </div>
                      {!compact && (
                        <div className="mt-1 hidden space-y-1 lg:block">
                          {metaLine}
                          {cwdLine}
                        </div>
                      )}
                    </div>

                    {/* Desktop metrics */}
                    <div className="hidden w-[340px] shrink-0 grid-cols-4 items-center gap-4 lg:grid">
                      {metrics.map((metric) => (
                        <RowMetric
                          key={metric.label}
                          value={metric.value}
                          muted={metric.muted}
                          danger={metric.danger}
                        />
                      ))}
                    </div>

                    <div className="flex w-auto shrink-0 items-center justify-end lg:w-[132px]">
                      {actions}
                    </div>
                  </div>

                  {/* Below lg: usage and folder sit under the name, aligned with it. */}
                  <div
                    className={cn('mt-1 space-y-1 lg:hidden', onToggleSelect ? 'pl-12' : 'pl-5')}
                  >
                    {usageLine}
                    {!compact && cwdLine}
                  </div>
                </div>

                {logsOpen && (
                  <div className="border-t border-border">
                    <ProcessLogViewer
                      target={String(proc.pm_id)}
                      processName={proc.name}
                      onClose={() => setExpandedLogs(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stopping or deleting takes a service down, so both ask first. */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.action === 'delete'
                ? `Delete ${confirmTarget.process.name}?`
                : `Stop ${confirmTarget?.process.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.action === 'delete'
                ? 'This stops the process and removes it from PM0. Its ID may be reused. This cannot be undone.'
                : 'Anything it serves becomes unavailable until you start it again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmTarget) runAction(confirmTarget.action, confirmTarget.process);
                setConfirmTarget(null);
              }}
            >
              {confirmTarget?.action === 'delete' ? 'Delete' : 'Stop process'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
