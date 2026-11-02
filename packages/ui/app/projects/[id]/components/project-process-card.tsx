'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, HardDrive, Loader2, RotateCw, Server, Square, Terminal } from 'lucide-react';
import { toast } from 'sonner';
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
  if (status === 'online') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400';
  if (status === 'errored') return 'border-red-500/20 bg-red-500/10 text-red-400';
  return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
}

export function ProjectProcessCard({ projectId }: { projectId: string }) {
  const [process, setProcess] = useState<PM0Process | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'restart' | 'stop' | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

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
        toast.success('Process restarted');
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

  return (
    <>
      <Card className="gap-0 overflow-hidden border-border bg-card p-0 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
              <Server className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Managed process</h2>
                {process && (
                  <Badge
                    variant="outline"
                    className={`h-5 capitalize ${statusColor(process.status)}`}
                  >
                    {process.status}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {process?.name ?? (loading ? 'Checking PM0…' : 'PM0')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {process && (
              <>
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
                  {process.status === 'online' ? 'Restart' : 'Start'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                  disabled={action !== null || process.status !== 'online'}
                  onClick={() => setStopDialogOpen(true)}
                >
                  <Square className="h-3 w-3" /> Stop
                </Button>
              </>
            )}
          </div>
        </div>

        {process ? (
          <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-3">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-[11px] text-muted-foreground">CPU</p>
                <p className="text-sm font-semibold tabular-nums">
                  {(process.monit?.cpu ?? 0).toFixed(1)}%
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-[11px] text-muted-foreground">Memory</p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatMemory(process.monit?.memory ?? 0)}
                </p>
              </div>
            </div>
            <div className="col-span-2 flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:col-span-1 sm:border-l sm:border-t-0 sm:px-5">
              Process ID <span className="font-mono text-foreground">{process.pm_id}</span>
              {process.pid > 0 && (
                <>
                  <span>·</span> PID{' '}
                  <span className="font-mono text-foreground">{process.pid}</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
            {loading
              ? 'Loading process status and resource usage…'
              : error || 'No PM0 process is linked to this project.'}
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
              className="bg-red-600 hover:bg-red-700"
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
