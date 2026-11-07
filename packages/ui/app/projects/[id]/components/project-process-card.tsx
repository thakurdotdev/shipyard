'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FolderOpen, Loader2, RotateCw, Server, Square, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { formatUptime } from '@/lib/format';
import { isStaticFramework } from '@/lib/framework-config';
import { pm0Api, type PM0Process } from '@/lib/pm0-api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProcessLogViewer } from '@/components/process-manager/process-log-viewer';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

function formatMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: string): string {
  if (status === 'online')
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'errored') return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
  return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3 sm:px-5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${
          danger ? 'text-red-700 dark:text-red-400' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function ProjectProcessCard({
  projectId,
  appType,
}: {
  projectId: string;
  appType?: string;
}) {
  const [process, setProcess] = useState<PM0Process | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'restart' | 'stop' | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const processes = await pm0Api.getProcesses();
      const linked = processes
        .filter((candidate) => candidate.project_id === projectId)
        .sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'))[0];
      setProcess(linked ?? null);
      setError(null);
    } catch (err) {
      setProcess(null);
      setError(err instanceof Error ? err.message : 'Unable to load PM0 process');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const runAction = async (nextAction: 'restart' | 'stop') => {
    if (!process) return;
    setAction(nextAction);
    try {
      if (nextAction === 'restart') {
        await pm0Api.restartProcess(String(process.pm_id));
        toast.success(process.status === 'online' ? 'Process restarted' : 'Process started');
      } else {
        await pm0Api.stopProcess(String(process.pm_id));
        toast.success('Process stopped');
        setStopDialogOpen(false);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Unable to ${nextAction} process`);
    } finally {
      setAction(null);
    }
  };

  // Static sites are served by Nginx, so having no process is the normal state.
  if (!loading && !process && !error && appType && isStaticFramework(appType)) return null;

  const online = process?.status === 'online';
  const restartsExhausted =
    !!process && process.max_restarts > 0 && process.restart_time >= process.max_restarts;

  return (
    <>
      <Card className="gap-0 overflow-hidden border-border bg-card p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
              <Server className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Process</h2>
                {process && (
                  <Badge
                    variant="outline"
                    className={`h-5 capitalize ${statusColor(process.status)}`}
                  >
                    {process.status}
                  </Badge>
                )}
              </div>
              {process && (
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {process.name} · #{process.pm_id}
                  {online && process.pid > 0 ? ` · PID ${process.pid}` : ''}
                  {process.status === 'errored' && process.exit_code != null
                    ? ` · exit ${process.exit_code}`
                    : ''}
                </p>
              )}
            </div>
          </div>
          {process && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setLogsOpen(true)}
              >
                <Terminal className="h-3.5 w-3.5" /> Logs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={action !== null}
                onClick={() => void runAction('restart')}
              >
                {action === 'restart' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
                {online ? 'Restart' : 'Start'}
              </Button>
              {online && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
                  disabled={action !== null}
                  onClick={() => setStopDialogOpen(true)}
                >
                  <Square className="h-3 w-3" /> Stop
                </Button>
              )}
            </div>
          )}
        </div>

        {process ? (
          <>
            <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
              <Stat label="CPU" value={online ? `${(process.monit?.cpu ?? 0).toFixed(1)}%` : '—'} />
              <Stat
                label="Memory"
                value={online ? formatMemory(process.monit?.memory ?? 0) : '—'}
              />
              <Stat label="Uptime" value={online ? formatUptime(process.pm_uptime) : '—'} />
              <Stat
                label="Restarts"
                value={
                  process.max_restarts > 0
                    ? `${process.restart_time} of ${process.max_restarts}`
                    : String(process.restart_time)
                }
                danger={restartsExhausted}
              />
            </div>
            {process.cwd && (
              <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 sm:px-5">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <code
                  className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                  title={process.cwd}
                >
                  {process.cwd}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                  title="Copy path"
                  aria-label="Copy working directory path"
                  onClick={() => {
                    navigator.clipboard.writeText(process.cwd);
                    setCopied(true);
                    toast.success('Path copied to clipboard');
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">
            {loading
              ? 'Checking PM0…'
              : error || 'No PM0 process is linked to this project yet. Deploy to start one.'}
          </div>
        )}
      </Card>

      {process && (
        <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
          <SheetContent className="flex w-full flex-col gap-0 border-l p-0 sm:max-w-[800px]">
            <SheetHeader className="border-b bg-surface-muted/10 p-4">
              <SheetTitle>Runtime logs</SheetTitle>
              <SheetDescription className="font-mono">{process.name}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ProcessLogViewer
                target={String(process.pm_id)}
                processName={process.name}
                onClose={() => setLogsOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this process?</AlertDialogTitle>
            <AlertDialogDescription>
              The project will become unavailable until the process is started again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void runAction('stop');
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={action !== null}
            >
              Stop process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
