'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { EmptyState } from '@/components/ui/empty-state';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Panel } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { dayLabel } from '@/lib/format';
import { queryKeys, type ActiveDeployment, type BuildWithDeployment } from '@/lib/queries';
import { setQueryData } from '@/lib/use-query';
import { useUrlState } from '@/lib/use-url-state';
import { buildStatus, type DeploymentEvent } from '../project-state';
import { DeploymentProgress } from './deployment-pipeline';
import { BuildLogsSheet, DeploymentRow, isRollback } from './deployment-list';

const FILTERS = ['all', 'ready', 'failed'] as const;
type Filter = (typeof FILTERS)[number];

export function DeploymentsTab({
  projectId,
  builds,
  loading,
  activeDeployment,
  deploymentEvent,
  keepBuilds,
  onActivateBuild,
}: {
  projectId: string;
  builds: BuildWithDeployment[];
  loading: boolean;
  activeDeployment: ActiveDeployment | null;
  deploymentEvent: DeploymentEvent | null;
  keepBuilds?: number | null;
  onActivateBuild: (buildId: string, label?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useUrlState<Filter>('builds', 'all', FILTERS);
  const [logsFor, setLogsFor] = useState<BuildWithDeployment | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<BuildWithDeployment[] | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const removeLocally = (id: string) =>
    setQueryData<BuildWithDeployment[]>(queryKeys.builds(projectId), (prev = []) =>
      prev.filter((build) => build.id !== id),
    );

  const deletable = (build: BuildWithDeployment) =>
    activeDeployment?.build_id !== build.id &&
    !buildStatus(build, deploymentEvent).busy &&
    promoting !== build.id;

  const visible = useMemo(
    () =>
      builds.filter((build) => {
        if (filter === 'all') return true;
        const tone = buildStatus(build, deploymentEvent).tone;
        return filter === 'failed' ? tone === 'error' : build.status === 'success';
      }),
    [builds, filter, deploymentEvent],
  );

  const groups = useMemo(() => {
    const byDay = new Map<string, BuildWithDeployment[]>();
    visible.forEach((build) => {
      const day = dayLabel(build.created_at);
      byDay.set(day, [...(byDay.get(day) ?? []), build]);
    });
    return [...byDay.entries()];
  }, [visible]);

  const selected = builds.filter((build) => selectedIds.has(build.id) && deletable(build));
  const selectableVisible = visible.filter(deletable);
  const failedCount = builds.filter((b) => buildStatus(b, deploymentEvent).tone === 'error').length;

  const promote = async (build: BuildWithDeployment) => {
    setPromoting(build.id);
    try {
      await onActivateBuild(
        build.id,
        isRollback(build, builds, activeDeployment) ? 'Rolling back' : 'Promoting build',
      );
    } finally {
      setPromoting(null);
    }
  };

  const runDelete = async (targets: BuildWithDeployment[]) => {
    setConfirmDelete(null);
    setDeleting(new Set(targets.map((b) => b.id)));
    const failures: string[] = [];
    // One at a time: each delete also asks the deploy engine to free disk.
    for (const build of targets) {
      try {
        await api.deleteBuild(build.id);
        removeLocally(build.id);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `#${build.id.slice(0, 8)}`);
      }
    }
    const done = targets.length - failures.length;
    if (done)
      toast.success(`Deleted ${done} build${done === 1 ? '' : 's'}`, {
        description: 'Their files were removed from the server.',
      });
    if (failures.length)
      toast.error(
        `${failures.length} build${failures.length === 1 ? '' : 's'} could not be deleted`,
        {
          description: failures[0],
        },
      );
    setDeleting(new Set());
    setSelectedIds(new Set());
    setSelecting(false);
  };

  if (loading) {
    return <div className="h-80 animate-pulse rounded-xl border border-border bg-card" />;
  }

  if (builds.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No deployments yet"
          description="Every build shows up here with its logs, so you can promote or roll back to any of them."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <DeploymentProgress event={deploymentEvent} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Filter builds"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: builds.length },
            {
              value: 'ready',
              label: 'Ready',
              count: builds.filter((b) => b.status === 'success').length,
              tone: 'success',
            },
            { value: 'failed', label: 'Failed', count: failedCount, tone: 'error' },
          ]}
        />
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-muted-foreground lg:block">
            {keepBuilds ? (
              <>
                Keeping the newest {keepBuilds} builds ·{' '}
                <Link
                  href={`/projects/${projectId}?tab=settings#builds`}
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  change
                </Link>
              </>
            ) : (
              'Every build is kept'
            )}
          </p>
          {selecting ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (setSelecting(false), setSelectedIds(new Set()))}
            >
              <X />
              Done
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setSelecting(true)}
              disabled={builds.filter(deletable).length === 0}
            >
              Select
            </Button>
          )}
        </div>
      </div>

      <Panel>
        {selecting && (
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border bg-surface-muted/40 px-5 py-1.5">
            <label className="flex cursor-pointer items-center gap-3 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-brand-500"
                checked={
                  selectableVisible.length > 0 &&
                  selectableVisible.every((b) => selectedIds.has(b.id))
                }
                onChange={(event) =>
                  setSelectedIds(
                    event.target.checked ? new Set(selectableVisible.map((b) => b.id)) : new Set(),
                  )
                }
              />
              {selected.length ? `${selected.length} selected` : 'Select all deletable builds'}
            </label>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-400"
              disabled={selected.length === 0 || deleting.size > 0}
              onClick={() => setConfirmDelete(selected)}
            >
              {deleting.size > 0 ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete{selected.length ? ` ${selected.length}` : ''}
            </Button>
          </div>
        )}

        {groups.length === 0 ? (
          <EmptyState
            title={filter === 'failed' ? 'No failed builds' : 'No ready builds'}
            action={
              <Button variant="outline" size="sm" onClick={() => setFilter('all')}>
                Show all builds
              </Button>
            }
          />
        ) : (
          groups.map(([day, dayBuilds]) => (
            <section key={day} aria-label={day}>
              <h3 className="border-b border-border bg-surface-muted/20 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5">
                {day}
              </h3>
              <ul className="divide-y divide-border border-b border-border">
                {dayBuilds.map((build) => (
                  <DeploymentRow
                    key={build.id}
                    build={build}
                    isLive={activeDeployment?.build_id === build.id}
                    rollback={isRollback(build, builds, activeDeployment)}
                    deploymentEvent={deploymentEvent}
                    onLogs={() => setLogsFor(build)}
                    onPromote={() => void promote(build)}
                    promoteDisabled={promoting !== null}
                    onDelete={() => setConfirmDelete([build])}
                    deleting={deleting.has(build.id)}
                    selection={
                      selecting
                        ? {
                            selected: selectedIds.has(build.id),
                            disabled: !deletable(build),
                            onToggle: () =>
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(build.id)) next.delete(build.id);
                                else next.add(build.id);
                                return next;
                              }),
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </Panel>

      <BuildLogsSheet build={logsFor} onOpenChange={(open) => !open && setLogsFor(null)} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.length === 1
                ? `Delete build ${confirmDelete[0].id.slice(0, 8)}?`
                : `Delete ${confirmDelete?.length} builds?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their records, logs and files on the server (repository copy, dependencies, build
              output) are removed to free disk space. You can’t roll back to a deleted build.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && void runDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
