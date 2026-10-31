'use client';

import { useEffect, useState, useCallback } from 'react';
import { pm0Api, PM0Process, PM0Health, PM0SystemStats } from '@/lib/pm0-api';
import { ProcessTable } from '@/components/process-manager/process-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';
import {
  Search,
  Loader2,
  Save,
  RefreshCw,
  AlertTriangle,
  List,
  LayoutGrid,
  Square,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

type KpiTone = 'default' | 'warning' | 'danger';

const barTone: Record<KpiTone, string> = {
  default: 'bg-foreground/25',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

function getPressureTone(pct: number): KpiTone {
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warning';
  return 'default';
}

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: KpiTone;
  progress?: number | null;
}

function MetricCard({ label, value, unit, hint, tone = 'default', progress }: MetricCardProps) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress));

  return (
    <div className="min-w-0 bg-card px-4 py-3.5">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground tabular-nums">
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <p className="mt-1.5 min-h-4 truncate text-xs text-muted-foreground" title={hint}>
        {hint}
      </p>
      {pct !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', barTone[tone])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function DaemonFact({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

type StatusFilter = 'all' | 'online' | 'stopped' | 'errored';

const filterDot: Record<StatusFilter, string | null> = {
  all: null,
  online: 'bg-emerald-500',
  stopped: 'bg-zinc-400',
  errored: 'bg-red-500',
};

export default function ProcessesPage() {
  const [processes, setProcesses] = useState<PM0Process[]>([]);
  const [health, setHealth] = useState<PM0Health | null>(null);
  const [system, setSystem] = useState<PM0SystemStats | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [compact, setCompact] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'stop' | 'restart' | 'delete' | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [daemonDown, setDaemonDown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [list, h] = await Promise.all([pm0Api.getProcessesWithSystem(), pm0Api.getHealth()]);
      setProcesses(list.processes);
      setSystem(list.system);
      setHealth(h);
      setDaemonDown(false);
    } catch {
      setDaemonDown(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Drop selections for processes that no longer exist.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(processes.map((p) => p.pm_id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [processes]);

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

  const searchedProcesses = processes.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      String(p.pm_id).includes(search) ||
      p.status.toLowerCase().includes(search.toLowerCase()),
  );

  const filterCounts: Record<StatusFilter, number> = {
    all: searchedProcesses.length,
    online: searchedProcesses.filter((p) => p.status === 'online').length,
    stopped: searchedProcesses.filter((p) => p.status === 'stopped').length,
    errored: searchedProcesses.filter((p) => p.status === 'errored').length,
  };

  const filteredProcesses =
    statusFilter === 'all'
      ? searchedProcesses
      : searchedProcesses.filter((p) => p.status === statusFilter);

  const selectedProcesses = processes.filter((p) => selectedIds.has(p.pm_id));
  const allVisibleSelected =
    filteredProcesses.length > 0 && filteredProcesses.every((p) => selectedIds.has(p.pm_id));

  const toggleSelect = (pmId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pmId)) next.delete(pmId);
      else next.add(pmId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProcesses.map((p) => p.pm_id)));
    }
  };

  const runBulkAction = async (action: 'stop' | 'restart' | 'delete') => {
    const targets =
      action === 'stop'
        ? selectedProcesses.filter((p) => p.status === 'online')
        : selectedProcesses;

    if (targets.length === 0) {
      toast.error(action === 'stop' ? 'No running processes selected' : 'No processes selected');
      return;
    }

    setBulkAction(action);
    const results = await Promise.allSettled(
      targets.map((p) =>
        action === 'stop'
          ? pm0Api.stopProcess(String(p.pm_id))
          : action === 'restart'
            ? pm0Api.restartProcess(String(p.pm_id))
            : pm0Api.deleteProcess(String(p.pm_id)),
      ),
    );

    const failed = results.filter((result) => result.status === 'rejected').length;
    const succeeded = results.length - failed;
    const verb = action === 'stop' ? 'stopped' : action === 'restart' ? 'restarted' : 'deleted';

    if (succeeded > 0) {
      toast.success(`${succeeded} process${succeeded === 1 ? '' : 'es'} ${verb}`);
    }
    if (failed > 0) {
      toast.error(`${failed} process${failed === 1 ? '' : 'es'} failed to ${action}`);
    }

    setSelectedIds(new Set());
    setBulkAction(null);
    setBulkDeleteOpen(false);
    fetchData();
  };

  // Aggregated stats
  const onlineCount = processes.filter((p) => p.status === 'online').length;
  const stoppedCount = processes.filter((p) => p.status === 'stopped').length;
  const erroredCount = processes.filter((p) => p.status === 'errored').length;
  const totalCpu = processes.reduce((sum, p) => sum + (p.monit?.cpu ?? 0), 0);
  const totalMem = processes.reduce((sum, p) => sum + (p.monit?.memory ?? 0), 0);

  const processMemPct =
    system?.has_memory && system.memory_total_bytes > 0
      ? (totalMem / system.memory_total_bytes) * 100
      : null;

  const hostLoadPct =
    system?.has_load && system.cpu_cores > 0 ? (system.load_1 / system.cpu_cores) * 100 : null;

  const statusSummary = [
    onlineCount > 0 && `${onlineCount} online`,
    stoppedCount > 0 && `${stoppedCount} stopped`,
    erroredCount > 0 && `${erroredCount} errored`,
  ]
    .filter(Boolean)
    .join(' · ');

  const overall = daemonDown
    ? { label: 'Daemon offline', dot: 'bg-red-500', text: 'text-red-500 dark:text-red-400' }
    : erroredCount > 0
      ? {
          label: `${erroredCount} process${erroredCount === 1 ? '' : 'es'} errored`,
          dot: 'bg-red-500',
          text: 'text-red-500 dark:text-red-400',
        }
      : stoppedCount > 0
        ? {
            label: `${stoppedCount} process${stoppedCount === 1 ? '' : 'es'} stopped`,
            dot: 'bg-amber-500',
            text: 'text-amber-500 dark:text-amber-400',
          }
        : processes.length > 0
          ? {
              label: 'All processes healthy',
              dot: 'bg-emerald-500',
              text: 'text-foreground',
            }
          : {
              label: 'No processes',
              dot: 'bg-muted-foreground',
              text: 'text-muted-foreground',
            };

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'online', label: 'Online' },
    { key: 'stopped', label: 'Stopped' },
    { key: 'errored', label: 'Errored' },
  ];

  return (
    <div className="pb-24">
      {/* Page header */}
      <header className="sticky top-[68px] z-10 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">Processes</h1>
                {daemonDown && (
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-red-500/30 font-normal text-red-500 dark:text-red-400"
                  >
                    <AlertTriangle className="size-3" />
                    Offline
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Monitor and control services supervised by PM0.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search processes"
                  className="h-8 pl-8 text-sm"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedIds(new Set());
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                onClick={fetchData}
                disabled={refreshing}
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
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

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {loading ? (
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-xl border border-border bg-card" />
            <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
          </div>
        ) : daemonDown ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center sm:py-20">
            <div className="mb-4 grid size-11 place-items-center rounded-lg border border-border bg-surface-muted">
              <AlertTriangle className="size-5 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">PM0 daemon is unreachable</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Make sure the PM0 daemon is running with the HTTP API enabled on{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                127.0.0.1:9615
              </code>
            </p>
            <Button variant="outline" size="sm" className="mt-5" onClick={fetchData}>
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* System summary */}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={cn('size-2 rounded-full', overall.dot)} />
                  <span className={cn('text-sm font-medium', overall.text)}>{overall.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {processes.length > 0 ? `${processes.length} supervised` : 'Nothing running'}
                  </span>
                </div>
                {health && (
                  <span className="text-xs text-muted-foreground">
                    pm0 <span className="font-mono text-foreground">v{health.version}</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
                <MetricCard
                  label="Processes"
                  value={processes.length}
                  hint={statusSummary || 'No supervised processes'}
                />
                <MetricCard
                  label="Process CPU"
                  value={totalCpu.toFixed(1)}
                  unit="%"
                  hint={`${onlineCount} running`}
                />
                <MetricCard
                  label="Process memory"
                  value={formatBytes(totalMem)}
                  hint={
                    processMemPct === null
                      ? 'Resident memory used'
                      : `${processMemPct.toFixed(1)}% of host memory`
                  }
                  tone={processMemPct === null ? 'default' : getPressureTone(processMemPct)}
                  progress={processMemPct}
                />
                <MetricCard
                  label="Host load"
                  value={system?.has_load ? system.load_1.toFixed(2) : '—'}
                  unit={system?.has_load ? '1m' : undefined}
                  hint={
                    system?.has_load
                      ? `${system.cpu_cores} cores · 5m ${system.load_5.toFixed(2)}`
                      : 'Load unavailable'
                  }
                  tone={hostLoadPct === null ? 'default' : getPressureTone(hostLoadPct)}
                  progress={hostLoadPct}
                />
                <MetricCard
                  label="Host memory"
                  value={system?.has_memory ? system.memory_used_pct.toFixed(1) : '—'}
                  unit={system?.has_memory ? '%' : undefined}
                  hint={
                    system?.has_memory
                      ? `${formatBytes(system.memory_used_bytes)} / ${formatBytes(system.memory_total_bytes)}`
                      : 'Memory unavailable'
                  }
                  tone={system?.has_memory ? getPressureTone(system.memory_used_pct) : 'default'}
                  progress={system?.has_memory ? system.memory_used_pct : null}
                />
              </div>

              {health && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Daemon online
                  </span>
                  <DaemonFact label="PID" value={health.pid} />
                  <DaemonFact
                    label="Version"
                    value={`v${health.version}${health.commit ? ` · ${health.commit.slice(0, 7)}` : ''}`}
                  />
                  <DaemonFact label="Kill mode" value={health.kill_mode} />
                  <DaemonFact label="Kernel" value={health.kernel_release} />
                </div>
              )}

              {health?.cgroup_warning && (
                <div className="flex items-start gap-1.5 border-t border-border px-4 py-2 text-xs text-amber-500 dark:text-amber-400">
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span>{health.cgroup_warning}</span>
                </div>
              )}
            </section>

            {/* Process list */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-foreground">Supervised processes</h2>
                  <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {filteredProcesses.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {filteredProcesses.length > 0 && (
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={handleSelectAll}
                        aria-label="Select all visible processes"
                        className="size-3.5 cursor-pointer rounded border-border bg-surface-muted accent-brand-500"
                      />
                      <span className="hidden sm:inline">Select all</span>
                    </label>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => setCompact((value) => !value)}
                    title="Toggle row density"
                  >
                    {compact ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                    <span className="hidden sm:inline">{compact ? 'Comfortable' : 'Compact'}</span>
                  </Button>
                </div>
              </div>

              <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted/50 p-0.5">
                {statusFilters.map((filter) => {
                  const active = statusFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => {
                        setStatusFilter(filter.key);
                        setSelectedIds(new Set());
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {filterDot[filter.key] && (
                        <span className={cn('size-1.5 rounded-full', filterDot[filter.key])} />
                      )}
                      {filter.label}
                      <span
                        className={cn(
                          'font-mono text-[10px] tabular-nums',
                          active ? 'text-muted-foreground' : 'text-muted-foreground/70',
                        )}
                      >
                        {filterCounts[filter.key]}
                      </span>
                    </button>
                  );
                })}
              </div>

              <ProcessTable
                processes={filteredProcesses}
                onRefresh={fetchData}
                compact={compact}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />

              {selectedIds.size > 0 && (
                <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur">
                  <span className="mr-auto text-xs font-medium text-foreground">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => runBulkAction('stop')}
                    disabled={!!bulkAction}
                    title="Stop selected"
                  >
                    {bulkAction === 'stop' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Square className="size-3.5" />
                    )}
                    <span className="hidden sm:inline">Stop</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => runBulkAction('restart')}
                    disabled={!!bulkAction}
                    title="Restart selected"
                  >
                    {bulkAction === 'restart' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCw className="size-3.5" />
                    )}
                    <span className="hidden sm:inline">Restart</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={!!bulkAction}
                    title="Delete selected"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelectedIds(new Set())}
                    title="Clear selection"
                    aria-label="Clear selection"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} process{selectedIds.size === 1 ? '' : 'es'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will stop and remove the selected processes from PM0. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAction === 'delete'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkAction === 'delete'}
              onClick={(event) => {
                event.preventDefault();
                void runBulkAction('delete');
              }}
            >
              {bulkAction === 'delete' && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
