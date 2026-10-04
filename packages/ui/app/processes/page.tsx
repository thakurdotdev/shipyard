'use client';

import { useEffect, useState, useCallback } from 'react';
import { pm0Api, PM0Process, PM0Health } from '@/lib/pm0-api';
import { ProcessTable } from '@/components/process-manager/process-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Search,
  Loader2,
  Save,
  RefreshCw,
  Activity,
  Cpu,
  MemoryStick,
  Server,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export default function ProcessesPage() {
  const [processes, setProcesses] = useState<PM0Process[]>([]);
  const [health, setHealth] = useState<PM0Health | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [daemonDown, setDaemonDown] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [procs, h] = await Promise.all([pm0Api.getProcesses(), pm0Api.getHealth()]);
      setProcesses(procs);
      setHealth(h);
      setDaemonDown(false);
    } catch {
      setDaemonDown(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await pm0Api.saveDump();
      toast.success(`Saved ${result.saved_count} process(es) to dump`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const filteredProcesses = processes.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      String(p.pm_id).includes(search) ||
      p.status.toLowerCase().includes(search.toLowerCase()),
  );

  // Aggregated stats
  const onlineCount = processes.filter((p) => p.status === 'online').length;
  const stoppedCount = processes.filter((p) => p.status === 'stopped').length;
  const erroredCount = processes.filter((p) => p.status === 'errored').length;
  const totalCpu = processes.reduce((sum, p) => sum + (p.monit?.cpu ?? 0), 0);
  const totalMem = processes.reduce((sum, p) => sum + (p.monit?.memory ?? 0), 0);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  return (
    <div className="pb-24">
      {/* Sticky header */}
      <header className="sticky top-[68px] z-10 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Processes</h1>
              {health && (
                <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                  pm0 v{health.version}
                </Badge>
              )}
              {daemonDown && (
                <Badge variant="destructive" className="gap-1.5 text-xs">
                  <AlertTriangle className="size-3" />
                  Daemon offline
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search processes..."
                  className="h-9 pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={fetchData}
                title="Refresh"
              >
                <RefreshCw className="size-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleSave}
                disabled={saving || processes.length === 0}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                <span className="hidden sm:inline">Save</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* Stats cards */}
        {!loading && !daemonDown && processes.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Server className="size-3.5" />
                Total
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {processes.length}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-400/80">
                <Activity className="size-3.5" />
                Online
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {onlineCount}
                {(stoppedCount > 0 || erroredCount > 0) && (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    {stoppedCount > 0 && (
                      <span className="text-zinc-400">{stoppedCount} stopped</span>
                    )}
                    {stoppedCount > 0 && erroredCount > 0 && ', '}
                    {erroredCount > 0 && (
                      <span className="text-red-400">{erroredCount} errored</span>
                    )}
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Cpu className="size-3.5" />
                CPU
              </div>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {totalCpu.toFixed(1)}
                <span className="text-sm font-normal text-muted-foreground">%</span>
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <MemoryStick className="size-3.5" />
                Memory
              </div>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {formatBytes(totalMem)}
              </p>
            </div>
            {health && (
              <div className="col-span-2 rounded-xl border border-border bg-card p-3.5 sm:col-span-4 lg:col-span-1">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Server className="size-3.5" />
                  Daemon
                </div>
                <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
                  PID {health.pid}
                </p>
                <p className="text-xs text-muted-foreground">
                  {health.kill_mode} · {health.kernel_release}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Process list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : daemonDown ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 py-20 text-center">
            <div className="mb-4 grid size-14 place-items-center rounded-full border border-destructive/30 bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">PM0 daemon is unreachable</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Make sure the PM0 daemon is running with the HTTP API enabled on{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                127.0.0.1:9615
              </code>
            </p>
            <Button variant="outline" className="mt-6" onClick={fetchData}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        ) : (
          <ProcessTable processes={filteredProcesses} onRefresh={fetchData} />
        )}
      </div>
    </div>
  );
}
