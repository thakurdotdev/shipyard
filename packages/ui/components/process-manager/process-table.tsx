'use client';

import { useState } from 'react';
import { PM0Process } from '@/lib/pm0-api';
import { pm0Api } from '@/lib/pm0-api';
import { Badge } from '@/components/ui/badge';
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

type StatusKey = 'online' | 'stopped' | 'errored' | 'launching' | 'stopping' | 'waiting restart';

const statusConfig: Record<StatusKey, { color: string; bg: string; dot: string; label: string }> = {
  online: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    dot: 'bg-emerald-400',
    label: 'Online',
  },
  stopped: {
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10 border-zinc-500/20',
    dot: 'bg-zinc-400',
    label: 'Stopped',
  },
  errored: {
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    dot: 'bg-red-400',
    label: 'Errored',
  },
  launching: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-400',
    label: 'Launching',
  },
  stopping: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    dot: 'bg-orange-400',
    label: 'Stopping',
  },
  'waiting restart': {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-400 animate-pulse',
    label: 'Restarting',
  },
};

function getStatusConfig(status: string) {
  return (
    statusConfig[status as StatusKey] ?? {
      color: 'text-zinc-400',
      bg: 'bg-zinc-500/10 border-zinc-500/20',
      dot: 'bg-zinc-400',
      label: status,
    }
  );
}

// ── component ────────────────────────────────────────────────────────

interface ProcessTableProps {
  processes: PM0Process[];
  onRefresh: () => void;
}

export function ProcessTable({ processes, onRefresh }: ProcessTableProps) {
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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted/20 py-20 text-center">
        <div className="mb-4 grid size-14 place-items-center rounded-full border border-border bg-surface-muted">
          <Terminal className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight">No processes</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          The PM0 daemon has no supervised processes. Start one with{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            pm0 start app.js
          </code>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {processes.map((proc) => {
          const sc = getStatusConfig(proc.status);
          const isOnline = proc.status === 'online';
          const isLoading = (a: string) => actionLoading === `${a}-${proc.pm_id}`;
          const logsOpen = expandedLogs === String(proc.pm_id);

          return (
            <div key={proc.pm_id} className="group">
              {/* Process card */}
              <div
                className={`relative overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:border-border-strong ${
                  logsOpen ? 'rounded-b-none border-b-0' : ''
                }`}
              >
                <div className="flex items-center gap-4 p-4">
                  {/* Status dot */}
                  <div className="relative flex shrink-0 items-center justify-center">
                    <span className={`size-2.5 rounded-full ${sc.dot}`} />
                    {isOnline && (
                      <span
                        className={`absolute size-2.5 animate-ping rounded-full ${sc.dot} opacity-50`}
                      />
                    )}
                  </div>

                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="truncate font-semibold tracking-tight text-foreground">
                        {proc.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`border text-[10px] font-medium uppercase tracking-wider ${sc.bg} ${sc.color}`}
                      >
                        {sc.label}
                      </Badge>
                      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                        id:{proc.pm_id}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 font-mono">
                        <Terminal className="size-3 opacity-60" />
                        {proc.interpreter}{' '}
                        <span className="max-w-[180px] truncate opacity-70" title={proc.script}>
                          {proc.script?.split('/').pop()}
                        </span>
                      </span>
                      {isOnline && proc.pid > 0 && (
                        <span className="tabular-nums">PID {proc.pid}</span>
                      )}
                      <span className="capitalize">{proc.exec_mode?.replace('_mode', '')}</span>
                    </div>
                  </div>

                  {/* Metrics (only when online) */}
                  <div className="hidden items-center gap-5 lg:flex">
                    {isOnline && (
                      <>
                        <div className="flex flex-col items-end">
                          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <Cpu className="size-3" /> CPU
                          </span>
                          <span className="font-mono text-sm tabular-nums text-foreground">
                            {proc.monit.cpu.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <MemoryStick className="size-3" /> MEM
                          </span>
                          <span className="font-mono text-sm tabular-nums text-foreground">
                            {formatBytes(proc.monit.memory)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <Clock className="size-3" /> Uptime
                          </span>
                          <span className="font-mono text-sm tabular-nums text-foreground">
                            {formatUptime(proc.pm_uptime)}
                          </span>
                        </div>
                      </>
                    )}
                    {proc.restart_time > 0 && (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Restarts
                        </span>
                        <span
                          className={`font-mono text-sm tabular-nums ${
                            proc.restart_time >= proc.max_restarts
                              ? 'text-red-400'
                              : 'text-foreground'
                          }`}
                        >
                          {proc.restart_time}
                          <span className="text-muted-foreground">/{proc.max_restarts}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* Logs toggle */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={`text-muted-foreground hover:text-foreground ${logsOpen ? 'bg-accent text-foreground' : ''}`}
                      onClick={() => setExpandedLogs(logsOpen ? null : String(proc.pm_id))}
                      title="View logs"
                    >
                      <ScrollText className="size-4" />
                    </Button>

                    {/* Quick actions */}
                    {isOnline ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => runAction('stop', proc)}
                        disabled={!!isLoading('stop')}
                        title="Stop"
                      >
                        <Square className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-emerald-400"
                        onClick={() => runAction('restart', proc)}
                        disabled={!!isLoading('restart')}
                        title="Start"
                      >
                        <Play className="size-3.5" />
                      </Button>
                    )}

                    {/* More menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
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
                </div>

                {/* Mobile metrics row */}
                {isOnline && (
                  <div className="flex items-center gap-4 border-t border-border px-4 py-2 lg:hidden">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Cpu className="size-3" />
                      <span className="font-mono tabular-nums">{proc.monit.cpu.toFixed(1)}%</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MemoryStick className="size-3" />
                      <span className="font-mono tabular-nums">
                        {formatBytes(proc.monit.memory)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      <span className="font-mono tabular-nums">{formatUptime(proc.pm_uptime)}</span>
                    </span>
                    {proc.restart_time > 0 && (
                      <span className="text-xs text-muted-foreground">↺ {proc.restart_time}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded log viewer */}
              {logsOpen && (
                <div className="overflow-hidden rounded-b-xl border border-t-0 border-console-border">
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
