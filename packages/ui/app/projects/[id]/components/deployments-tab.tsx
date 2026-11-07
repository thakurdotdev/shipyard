'use client';

import { useState } from 'react';
import { Box } from 'lucide-react';
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
}

export function DeploymentsTab({
  builds,
  onActivateBuild,
  onBuildDeleted,
  activeDeployment,
  deploymentStatus,
}: DeploymentsTabProps) {
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
          Inspect logs, or return production to any successful build.
        </p>
      </div>

      <DeploymentProgress deploymentStatus={deploymentStatus} />

      <Card className="gap-0 overflow-hidden border-border bg-card p-0">
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
              deleteDisabled={deletingBuildId !== null || deployingBuildId !== null}
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
    </section>
  );
}
