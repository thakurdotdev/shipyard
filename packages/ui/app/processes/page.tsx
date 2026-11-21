'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ProcessInspector } from '@/components/process-manager/process-inspector';
import {
  ProcessTable,
  type SortKey,
  type SortState,
} from '@/components/process-manager/process-table';
import { attentionRank, restartsLabel } from '@/components/process-manager/process-utils';
import {
  refreshProcesses,
  useProcessActions,
} from '@/components/process-manager/use-process-actions';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Meter } from '@/components/ui/meter';
import { Panel } from '@/components/ui/panel';
import { SearchField } from '@/components/ui/search-field';
import { StatusDot, TONE_TEXT } from '@/components/ui/status';
import { formatBytes } from '@/lib/format';
import { pm0Api, processTarget, type PM0Process, type PM0SystemStats } from '@/lib/pm0-api';
import { useProcessList } from '@/lib/queries';
import { useQuery } from '@/lib/use-query';
import { useUrlState } from '@/lib/use-url-state';
import { cn } from '@/lib/utils';

const POLL_MS = 5000;
const FILTERS = ['all', 'online', 'stopped', 'errored'] as const;
type Filter = (typeof FILTERS)[number];
type BulkAction = 'stop' | 'restart' | 'delete';

const SORT_VALUE: Record<Exclude<SortKey, 'attention' | 'name'>, (p: PM0Process) => number> = {
  cpu: (p) => (p.status === 'online' ? p.monit.cpu : -1),
  memory: (p) => (p.status === 'online' ? p.monit.memory : -1),
  uptime: (p) => (p.status === 'online' && p.pm_uptime ? Date.now() - p.pm_uptime : -1),
  restarts: (p) => p.restart_time,
};

export default function ProcessesPage() {
  const list = useProcessList(POLL_MS);
  const health = useQuery('pm0:health', () => pm0Api.getHealth(), { refreshInterval: 30_000 });
  const processes = list.data?.processes;
  const [query, setQuery] = useUrlState('q', '');
  const [filter, setFilter] = useUrlState<Filter>('status', 'all', FILTERS);
  const [inspecting, setInspecting] = useUrlState('process', '');
  const [sort, setSort] = useState<SortState>({ key: 'attention', desc: false });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState<BulkAction | null>(null);
  const [saving, setSaving] = useState(false);
  const actions = useProcessActions();

  // A failed poll keeps the last good list on screen, marked as stale.
  const offline = !!list.error && !processes;
  const stale = !!list.error && !!processes;

  // Drop selections for processes that no longer exist.
  useEffect(() => {
    if (!processes) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(processes.map(processTarget));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [processes]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (processes ?? []).filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        String(p.pm_id) === needle ||
        p.script?.toLowerCase().includes(needle) ||
        p.cwd?.toLowerCase().includes(needle),
    );
  }, [processes, query]);

  const counts: Record<Filter, number> = {
    all: searched.length,
    online: searched.filter((p) => p.status === 'online').length,
    stopped: searched.filter((p) => p.status === 'stopped').length,
    errored: searched.filter((p) => p.status === 'errored').length,
  };

  const visible = useMemo(() => {
    const rows = searched.filter((p) => filter === 'all' || p.status === filter);
    const direction = sort.desc ? -1 : 1;
    return rows.sort((a, b) => {
      if (sort.key === 'attention')
        return attentionRank(a.status) - attentionRank(b.status) || a.pm_id - b.pm_id;
      if (sort.key === 'name') return direction * a.name.localeCompare(b.name);
      return direction * (SORT_VALUE[sort.key](a) - SORT_VALUE[sort.key](b)) || a.pm_id - b.pm_id;
    });
  }, [searched, filter, sort]);

  const groups = [
    {
      key: 'apps',
      title: 'Apps',
      processes: visible.filter((p) => p.daemon !== 'platform'),
    },
    {
      key: 'platform',
      title: 'Platform',
      note: 'Shipyard’s own services',
      processes: visible.filter((p) => p.daemon === 'platform'),
    },
  ].filter((group) => group.processes.length > 0);

  const allSelected = visible.length > 0 && visible.every((p) => selectedIds.has(processTarget(p)));
  const selected = (processes ?? []).filter((p) => selectedIds.has(processTarget(p)));
  const inspected = processes?.find((p) => processTarget(p) === inspecting);
  const crashed = (processes ?? []).filter((p) => p.status === 'errored');

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? prev.desc
          ? { key: 'attention', desc: false } // Third click returns to the default order.
          : { key, desc: true }
        : { key, desc: key !== 'name' },
    );

  const toggleSelect = (target: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });

  const runBulk = async (action: BulkAction) => {
    const targets = action === 'stop' ? selected.filter((p) => p.status === 'online') : selected;
    if (targets.length === 0) {
      toast.error('None of the selected processes are running');
      setBulkConfirm(null);
      return;
    }
    setBulkRunning(action);
    const results = await Promise.allSettled(
      targets.map((p) =>
        action === 'stop'
          ? pm0Api.stopProcess(processTarget(p))
          : action === 'restart'
            ? pm0Api.restartProcess(processTarget(p))
            : pm0Api.deleteProcess(processTarget(p)),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = results.length - failed;
    const verb = { stop: 'stopped', restart: 'restarted', delete: 'deleted' }[action];
    if (done) toast.success(`${done} process${done === 1 ? '' : 'es'} ${verb}`);
    if (failed) toast.error(`${failed} process${failed === 1 ? '' : 'es'} could not be ${verb}`);
    setSelectedIds(new Set());
    setBulkRunning(null);
    setBulkConfirm(null);
    void refreshProcesses();
  };

  const saveList = async () => {
    setSaving(true);
    try {
      const result = await pm0Api.saveDump();
      toast.success(`Saved ${result.saved_count} processes`, {
        description: 'PM0 restores this list when the server reboots.',
      });
    } catch (err) {
      toast.error('Could not save the process list', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-width pt-7 pb-16 sm:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-heading">Processes</h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
            {offline ? (
              <>
                <StatusDot tone="error" /> PM0 is not responding
              </>
            ) : stale ? (
              <>
                <StatusDot tone="warning" /> Connection lost, showing the last known state
              </>
            ) : (
              <>
                <StatusDot tone="success" pulse={!list.isLoading} />
                Supervised by PM0
                {health.data && <span className="font-mono text-xs">v{health.data.version}</span>}
                <span className="hidden sm:inline">· refreshes every {POLL_MS / 1000}s</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void list.refresh()}
            disabled={list.isValidating}
          >
            <RefreshCw className={cn(list.isValidating && 'animate-spin')} />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More process actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                disabled={saving || !processes?.length}
                onSelect={() => void saveList()}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                <div>
                  <p>Save process list</p>
                  <p className="text-xs text-muted-foreground">Restored by PM0 after a reboot</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {list.isLoading ? (
        <div className="mt-6 space-y-4" role="status" aria-label="Loading processes">
          <div className="h-[92px] animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      ) : offline ? (
        <Panel className="mt-6">
          <EmptyState
            title="Can't reach the PM0 daemon"
            description={
              <>
                Check that PM0 is running with its HTTP API on a Unix socket (
                <code className="font-mono text-xs">PM0_HTTP_ADDR=unix:~/.pm0/http.sock</code>) and
                that the Control API&apos;s <code className="font-mono text-xs">PM0_API_URL</code>{' '}
                points at it.
              </>
            }
            action={
              <Button variant="outline" size="sm" onClick={() => void list.refresh()}>
                <RefreshCw /> Try again
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <HostSummary
            processes={processes ?? []}
            system={list.data?.system ?? null}
            warning={health.data?.cgroup_warning}
          />

          {crashed.length > 0 && (
            <Panel className="mt-4 border-red-500/30" role="alert">
              <ul className="divide-y divide-border">
                {crashed.map((process) => (
                  <li
                    key={processTarget(process)}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <p className="flex min-w-0 flex-1 items-baseline gap-3 text-sm">
                      <StatusDot tone="error" className="translate-y-[-1px]" />
                      <span className="min-w-0">
                        <span className="font-medium">{process.name}</span>{' '}
                        <span className="text-muted-foreground">
                          crashed
                          {process.exit_code != null && ` with exit code ${process.exit_code}`}
                          {process.restart_time > 0 && ` after ${restartsLabel(process)} restarts`}.
                        </span>
                      </span>
                    </p>
                    <div className="flex shrink-0 gap-2 pl-5 sm:pl-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setInspecting(processTarget(process))}
                      >
                        View logs
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actions.isPending(process)}
                        onClick={() => actions.request('start', process)}
                      >
                        {actions.isPending(process) ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Play />
                        )}
                        Start
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterTabs
              label="Filter processes by status"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setSelectedIds(new Set());
              }}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'online', label: 'Online', count: counts.online, tone: 'success' },
                { value: 'stopped', label: 'Stopped', count: counts.stopped, tone: 'neutral' },
                { value: 'errored', label: 'Errored', count: counts.errored, tone: 'error' },
              ]}
            />
            <SearchField
              className="sm:w-64"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setSelectedIds(new Set());
              }}
              onSubmit={() => {
                if (visible.length === 1) setInspecting(processTarget(visible[0]));
              }}
              placeholder="Search name, id, path"
              label="Search processes"
            />
          </div>

          <Panel className="mt-3">
            {visible.length === 0 ? (
              processes?.length ? (
                <EmptyState
                  title="No processes match"
                  description="Nothing matches this search and status filter."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing is running"
                  description={
                    <>
                      Deploy a project, or start a process on the server with{' '}
                      <code className="font-mono text-xs">pm0 start app.js</code>.
                    </>
                  }
                />
              )
            ) : (
              <ProcessTable
                groups={groups}
                sort={sort}
                onSort={toggleSort}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                allSelected={allSelected}
                onToggleAll={() =>
                  setSelectedIds(allSelected ? new Set() : new Set(visible.map(processTarget)))
                }
                onOpen={(process) => setInspecting(processTarget(process))}
                onAction={actions.request}
                isPending={actions.isPending}
              />
            )}
          </Panel>

          {selected.length > 0 && (
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mx-auto mt-3 flex w-full max-w-xl items-center gap-1.5 rounded-xl border border-border-strong bg-popover px-3 py-2 shadow-xl animate-in fade-in slide-in-from-bottom-2 sm:bottom-4">
              <span className="mr-auto pl-1 text-sm font-medium">{selected.length} selected</span>
              {(
                [
                  ['restart', RotateCw, 'Restart'],
                  ['stop', Square, 'Stop'],
                ] as const
              ).map(([action, Icon, label]) => (
                <Button
                  key={action}
                  variant="outline"
                  size="sm"
                  disabled={!!bulkRunning}
                  onClick={() => setBulkConfirm(action)}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                disabled={!!bulkRunning}
                onClick={() => setBulkConfirm('delete')}
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedIds(new Set())}
                aria-label="Clear selection"
              >
                <X />
              </Button>
            </div>
          )}
        </>
      )}

      <ProcessInspector
        process={inspected}
        open={!!inspecting}
        onOpenChange={(open) => !open && setInspecting('')}
        onAction={actions.request}
        isPending={actions.isPending}
      />
      {actions.dialog}

      <AlertDialog
        open={bulkConfirm !== null}
        onOpenChange={(open) => !open && !bulkRunning && setBulkConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'delete' ? 'Delete' : bulkConfirm === 'stop' ? 'Stop' : 'Restart'}{' '}
              {selected.length} process{selected.length === 1 ? '' : 'es'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === 'delete'
                ? 'They stop and are removed from PM0.'
                : bulkConfirm === 'stop'
                  ? 'Anything they serve is unavailable until you start them again.'
                  : 'They restart at once, so anything they serve may briefly drop requests.'}
              {selected.some((p) => p.daemon === 'platform') &&
                ' The selection includes Shipyard’s own services.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                bulkConfirm === 'restart'
                  ? undefined
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }
              disabled={!!bulkRunning}
              onClick={(event) => {
                event.preventDefault();
                if (bulkConfirm) void runBulk(bulkConfirm);
              }}
            >
              {bulkRunning && <Loader2 className="animate-spin" />}
              {bulkConfirm === 'delete' ? 'Delete' : bulkConfirm === 'stop' ? 'Stop' : 'Restart'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HostSummary({
  processes,
  system,
  warning,
}: {
  processes: PM0Process[];
  system: PM0SystemStats | null;
  warning?: string;
}) {
  const online = processes.filter((p) => p.status === 'online');
  const stopped = processes.filter((p) => p.status === 'stopped').length;
  const errored = processes.filter((p) => p.status === 'errored').length;
  const cpu = processes.reduce((sum, p) => sum + (p.monit?.cpu ?? 0), 0);
  const memory = processes.reduce((sum, p) => sum + (p.monit?.memory ?? 0), 0);
  const loadPct =
    system?.has_load && system.cpu_cores > 0 ? (system.load_1 / system.cpu_cores) * 100 : null;

  const cell = 'min-w-0 px-4 py-3.5 sm:px-5';
  const value = 'mt-1 font-mono text-lg leading-none font-medium tracking-tight tabular-nums';
  const sub = 'mt-1.5 truncate text-xs text-muted-foreground';

  return (
    <Panel className="mt-6">
      <dl className="grid grid-cols-2 lg:grid-cols-3">
        <div
          className={cn(
            cell,
            'col-span-2 border-b border-border lg:col-span-1 lg:border-r lg:border-b-0',
          )}
        >
          <dt className="text-xs text-muted-foreground">Processes</dt>
          <dd className={value}>
            {online.length}
            <span className="text-sm text-muted-foreground"> / {processes.length} online</span>
          </dd>
          <dd className={sub}>
            {stopped + errored === 0 ? (
              'All running'
            ) : (
              <>
                {stopped > 0 && `${stopped} stopped`}
                {stopped > 0 && errored > 0 && ' · '}
                {errored > 0 && <span className={TONE_TEXT.error}>{errored} errored</span>}
              </>
            )}
            {` · ${cpu.toFixed(1)}% CPU, ${formatBytes(memory)}`}
          </dd>
        </div>
        <div className={cn(cell, 'border-r border-border')}>
          <dt className="text-xs text-muted-foreground">Host load</dt>
          <dd className={value}>
            {system?.has_load ? system.load_1.toFixed(2) : '—'}
            {system?.has_load && (
              <span className="text-sm text-muted-foreground"> / {system.cpu_cores} cores</span>
            )}
          </dd>
          {loadPct !== null && <Meter value={loadPct} label="Host load" className="mt-2.5" />}
        </div>
        <div className={cell}>
          <dt className="text-xs text-muted-foreground">Host memory</dt>
          <dd className={value}>
            {system?.has_memory ? `${system.memory_used_pct.toFixed(0)}%` : '—'}
            {system?.has_memory && (
              <span className="text-sm text-muted-foreground">
                {' '}
                {formatBytes(system.memory_used_bytes)} of {formatBytes(system.memory_total_bytes)}
              </span>
            )}
          </dd>
          {system?.has_memory && (
            <Meter value={system.memory_used_pct} label="Host memory" className="mt-2.5" />
          )}
        </div>
      </dl>
      {warning && (
        <p className={cn('border-t border-border px-4 py-2 text-xs sm:px-5', TONE_TEXT.warning)}>
          {warning}
        </p>
      )}
    </Panel>
  );
}
