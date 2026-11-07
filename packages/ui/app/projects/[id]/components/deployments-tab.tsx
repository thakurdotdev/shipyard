'use client';

import { useState } from 'react';
import { Box, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
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
import { BuildRow, getPromotionLabel, isPipelineStatus } from './build-row';
import { DeploymentProgress } from './deployment-pipeline';

interface DeploymentsTabProps {
  builds: any[];
  onActivateBuild: (buildId: string) => Promise<void> | void;
  onBuildDeleted?: (buildId: string) => void;
  activeDeployment?: any;
  deploymentStatus?: any;
  /** The project's retention limit, shown so pruned history isn't a surprise. */
  keepBuilds?: number | null;
}

export function DeploymentsTab({
  builds,
  onActivateBuild,
  onBuildDeleted,
  activeDeployment,
  deploymentStatus,
  keepBuilds,
}: DeploymentsTabProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deployingBuildId, setDeployingBuildId] = useState<string | null>(null);
  const [deletingBuildId, setDeletingBuildId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeploy = async (buildId: string) => {
    if (deployingBuildId) return; // Prevent multiple simultaneous deploys
    setDeployingBuildId(buildId);
    try {
      await onActivateBuild(buildId);
    } finally {
      setDeployingBuildId(null);
    }
  };

  const handleDelete = async (buildId: string) => {
    if (deletingBuildId) return;
    setDeletingBuildId(buildId);
    try {
      await api.deleteBuild(buildId);
      toast.success(`Build #${buildId.slice(0, 8)} deleted — disk space freed`);
      onBuildDeleted?.(buildId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete build');
    } finally {
      setDeletingBuildId(null);
      setConfirmDeleteId(null);
    }
  };

  // A build is "busy" (and therefore must not offer delete) while its own
  // build is queued/running, or while any deployment pipeline is live for it:
  // the row's ownDeploy status, or a realtime deployment event for this build.
  const isBuildBusy = (build: any) => {
    if (build.status === 'pending' || build.status === 'building') return true;
    if (deployingBuildId === build.id) return true;
    if (
      build.deployment_status &&
      (build.deployment_status === 'activating' || isPipelineStatus(build.deployment_status))
    ) {
      return true;
    }
    if (
      deploymentStatus?.build_id === build.id &&
      deploymentStatus?.status &&
      (deploymentStatus.status === 'activating' || isPipelineStatus(deploymentStatus.status))
    ) {
      return true;
    }
    return false;
  };

  const isDeletable = (build: any) =>
    activeDeployment?.build_id !== build.id && !isBuildBusy(build);
  const deletableBuilds = (builds ?? []).filter(isDeletable);
  // Selection only ever holds builds that are still deletable.
  const selected = deletableBuilds.filter((build) => selectedIds.has(build.id));
  const allSelected = deletableBuilds.length > 0 && selected.length === deletableBuilds.length;

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    let deleted = 0;
    const failures: string[] = [];
    // One at a time: each delete also asks the deploy engine to free disk.
    for (const build of selected) {
      try {
        await api.deleteBuild(build.id);
        onBuildDeleted?.(build.id);
        deleted++;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : `#${build.id.slice(0, 8)}`);
      }
    }
    if (deleted > 0) {
      toast.success(`${deleted} build${deleted === 1 ? '' : 's'} deleted — disk space freed`);
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} build${failures.length === 1 ? '' : 's'} could not be deleted`,
        {
          description: failures[0],
        },
      );
    }
    setSelectedIds(new Set());
    setBulkDeleting(false);
    setBulkConfirmOpen(false);
  };

  if (!builds || builds.length === 0) {
    return (
      <Card className="flex min-h-72 flex-col items-center justify-center border-dashed bg-card px-6 py-12 text-center">
        <Box className="mb-4 h-10 w-10 text-muted-foreground/50" />
        <h2 className="text-lg font-semibold">No deployment history</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a deployment from the project header to see build progress and history here.
        </p>
      </Card>
    );
  }

  return (
    <section className="space-y-4 animate-in fade-in-50 duration-300">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">
          Deployment history
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            {builds.length} {builds.length === 1 ? 'build' : 'builds'}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {keepBuilds
            ? `Keeping the newest ${keepBuilds} builds after each deploy.`
            : 'Inspect logs, or return production to any successful build.'}
        </p>
      </div>

      <DeploymentProgress deploymentStatus={deploymentStatus} />

      <Card className="gap-0 overflow-hidden border-border bg-card p-0">
        {deletableBuilds.length > 0 && (
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted/30 px-4 py-2 sm:px-5">
            <label className="flex cursor-pointer select-none items-center gap-3 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selected.length > 0 && !allSelected;
                }}
                onChange={() =>
                  setSelectedIds(
                    allSelected ? new Set() : new Set(deletableBuilds.map((build) => build.id)),
                  )
                }
                disabled={bulkDeleting}
                className="size-4 cursor-pointer rounded border-border accent-brand-500"
              />
              {selected.length > 0
                ? `${selected.length} selected`
                : `Select builds to delete (${deletableBuilds.length} eligible)`}
            </label>
            {selected.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkDeleting}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-red-500/30 text-red-700 hover:border-red-500/50 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setBulkConfirmOpen(true)}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Delete {selected.length}
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="divide-y divide-border">
          {builds.map((build) => (
            <BuildRow
              key={build.id}
              build={build}
              isCurrent={activeDeployment?.build_id === build.id}
              promotionLabel={getPromotionLabel(build, builds, activeDeployment)}
              promoting={deployingBuildId === build.id}
              promoteDisabled={deployingBuildId !== null}
              onPromote={() => handleDeploy(build.id)}
              onDelete={isBuildBusy(build) ? undefined : () => setConfirmDeleteId(build.id)}
              deleting={deletingBuildId === build.id}
              deleteDisabled={deletingBuildId !== null || deployingBuildId !== null || bulkDeleting}
              selected={selectedIds.has(build.id)}
              onToggleSelect={() => toggleSelect(build.id)}
            />
          ))}
        </div>
      </Card>

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete build #{confirmDeleteId?.slice(0, 8)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the build record, its logs, and its files on the server (repo
              copy, dependencies, build output) to free disk space. This cannot be undone. The build
              currently serving traffic cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingBuildId !== null}
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
            >
              {deletingBuildId ? 'Deleting…' : 'Delete build'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => !open && !bulkDeleting && setBulkConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.length} build{selected.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes their records, logs, and files on the server to free disk
              space. You won't be able to roll back to them. The live build is never included.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleBulkDelete();
              }}
            >
              {bulkDeleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete {selected.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
