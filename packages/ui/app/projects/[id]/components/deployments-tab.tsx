'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GitBranch, GitCommit, Clock, Terminal, Box, Loader2, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
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
import { LogViewer } from '@/components/log-viewer/log-viewer';
import { DeploymentPipeline } from './deployment-pipeline';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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

  // Helper to check if a status is a pipeline in-progress status
  const isPipelineStatus = (status: string) => {
    return [
      'dns_creating',
      'dns_created',
      'ssl_issuing',
      'ssl_issued',
      'nginx_configuring',
      'nginx_configured',
      'app_starting',
      'health_checking',
      'pending',
    ].includes(status);
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

  // Get display label for deployment status
  const getDeployStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      dns_creating: 'DNS Setup',
      dns_created: 'DNS Ready',
      ssl_issuing: 'SSL Issuing',
      ssl_issued: 'SSL Ready',
      nginx_configuring: 'Configuring',
      nginx_configured: 'Configured',
      app_starting: 'Starting',
      health_checking: 'Health Check',
      active: 'Active',
      inactive: 'Inactive',
      failed: 'Failed',
      activating: 'Activating',
    };
    return labels[status] || status;
  };

  const getBuildStatusClass = (status: string) =>
    status === 'success'
      ? 'text-emerald-800 bg-emerald-500/10 dark:text-emerald-300'
      : status === 'failed'
        ? 'text-red-800 bg-red-500/10 dark:text-red-300'
        : 'text-brand-800 bg-brand-500/10 dark:text-brand-300';

  const getDeploymentStatusClass = (status: string) =>
    status === 'active'
      ? 'text-emerald-800 bg-emerald-500/10 dark:text-emerald-300'
      : status === 'failed'
        ? 'text-red-800 bg-red-500/10 dark:text-red-300'
        : status === 'inactive'
          ? 'text-muted-foreground bg-surface-muted'
          : status === 'activating'
            ? 'text-amber-800 bg-amber-500/10 dark:text-amber-300'
            : 'text-brand-800 bg-brand-500/10 dark:text-brand-300';

  const getPromotionLabel = (build: any) => {
    const currentDeploymentBuild = builds.find((item) => item.id === activeDeployment?.build_id);
    const isNewerThanCurrent =
      !currentDeploymentBuild ||
      new Date(build.created_at) > new Date(currentDeploymentBuild.created_at);
    return isNewerThanCurrent ? 'Deploy' : 'Rollback';
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
    <section className="space-y-5 animate-in fade-in-50 duration-300">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Deployment history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review build results, inspect logs, or promote a previous successful build.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <GitBranch className="h-3.5 w-3.5" /> {builds.length} builds
        </Badge>
      </div>

      {deploymentStatus &&
        deploymentStatus.status &&
        !['active', 'inactive'].includes(deploymentStatus.status) && (
          <Card className="border-blue-500/20 bg-blue-500/5 p-5">
            <p className="text-sm font-medium text-blue-300">Deployment in progress</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {deploymentStatus.status_message || getDeployStatusLabel(deploymentStatus.status)}
            </p>
            <div className="mt-5">
              <DeploymentPipeline
                status={deploymentStatus.status}
                statusMessage={deploymentStatus.status_message}
              />
            </div>
          </Card>
        )}

      <div className="space-y-3 xl:hidden">
        {builds.map((build) => {
          const isActive = activeDeployment?.build_id === build.id;
          const isDeploying = deployingBuildId === build.id;

          return (
            <Card key={build.id} className="gap-0 border-border bg-card p-4 shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">Build #{build.id.slice(0, 8)}</span>
                  {isActive && (
                    <Badge variant="default" className="h-5 text-[10px]">
                      Current
                    </Badge>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  {new Date(build.created_at).toLocaleDateString()}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`h-5 text-[10px] capitalize ${getBuildStatusClass(build.status)}`}
                >
                  {build.status}
                </Badge>
                {build.deployment_status && (
                  <Badge
                    variant="secondary"
                    className={`h-5 gap-1 text-[10px] capitalize ${getDeploymentStatusClass(build.deployment_status)}`}
                  >
                    {(isPipelineStatus(build.deployment_status) ||
                      build.deployment_status === 'activating') && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    {getDeployStatusLabel(build.deployment_status)}
                  </Badge>
                )}
              </div>

              <div className="mt-3 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <GitBranch className="size-3.5 shrink-0" />
                <span>main</span>
                {build.commit_sha ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-xs">{build.commit_sha.slice(0, 7)}</span>
                    {build.commit_message && (
                      <span className="truncate text-xs" title={build.commit_message}>
                        {build.commit_message.split('\n')[0]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="truncate text-xs italic">Manual deploy</span>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
                {!isActive && !isBuildBusy(build) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-red-500"
                    aria-label={`Delete build ${build.id.slice(0, 8)}`}
                    title="Delete build and free its disk space"
                    disabled={deletingBuildId !== null || deployingBuildId !== null}
                    onClick={() => setConfirmDeleteId(build.id)}
                  >
                    {deletingBuildId === build.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                )}
                {build.status === 'success' && !isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={deployingBuildId !== null}
                    onClick={() => handleDeploy(build.id)}
                  >
                    {isDeploying && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {getPromotionLabel(build)}
                  </Button>
                )}
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`View logs for build ${build.id.slice(0, 8)}`}
                    >
                      <Terminal className="size-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="flex w-full flex-col gap-0 border-l p-0 sm:max-w-[800px]">
                    <SheetHeader className="border-b bg-surface-muted/10 p-4">
                      <SheetTitle className="font-mono text-base">
                        Build #{build.id.slice(0, 8)}
                      </SheetTitle>
                      <SheetDescription>Logs for build execution</SheetDescription>
                    </SheetHeader>
                    <div className="flex-1 overflow-hidden bg-console font-mono text-xs text-console-foreground">
                      <LogViewer buildId={build.id} />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="hidden gap-0 overflow-hidden border-border bg-card p-0 shadow-sm xl:flex">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deployment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {builds.map((build) => {
                const isActive = activeDeployment?.build_id === build.id;
                return (
                  <TableRow key={build.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        Build #{build.id.slice(0, 8)}
                        {isActive && (
                          <Badge variant="default" className="text-[10px] h-5">
                            Current
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Build:</span>
                          <Badge
                            variant="secondary"
                            className={`h-5 text-[10px] capitalize ${getBuildStatusClass(build.status)}`}
                          >
                            {build.status}
                          </Badge>
                        </div>
                        {build.deployment_status && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Deploy:</span>
                            <Badge
                              variant="secondary"
                              className={`h-5 text-[10px] capitalize ${getDeploymentStatusClass(build.deployment_status)}`}
                            >
                              {(isPipelineStatus(build.deployment_status) ||
                                build.deployment_status === 'activating') && (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              )}
                              {getDeployStatusLabel(build.deployment_status)}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <GitBranch className="w-3 h-3" />
                          <span>main</span>
                        </div>
                        {build.commit_sha ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                            <GitCommit className="w-3 h-3" />
                            <span className="font-mono">{build.commit_sha.slice(0, 7)}</span>
                            {build.commit_message && (
                              <span className="truncate max-w-[200px]" title={build.commit_message}>
                                {build.commit_message.split('\n')[0].slice(0, 50)}
                                {build.commit_message.length > 50 ? '...' : ''}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/70 italic">
                            Manual Deploy
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(build.created_at).toLocaleString()}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isActive && !isBuildBusy(build) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-500"
                            title="Delete build and free its disk space"
                            disabled={deletingBuildId !== null || deployingBuildId !== null}
                            onClick={() => setConfirmDeleteId(build.id)}
                          >
                            {deletingBuildId === build.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        {build.status === 'success' &&
                          !isActive &&
                          (() => {
                            // Determine if this is a newer or older build than the current deployment
                            const currentDeploymentBuild = builds.find(
                              (b) => b.id === activeDeployment?.build_id,
                            );
                            const isNewerThanCurrent =
                              !currentDeploymentBuild ||
                              new Date(build.created_at) >
                                new Date(currentDeploymentBuild.created_at);
                            const isDeploying = deployingBuildId === build.id;

                            return (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                disabled={deployingBuildId !== null}
                                onClick={() => handleDeploy(build.id)}
                              >
                                {isDeploying && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                {isNewerThanCurrent ? 'Deploy' : 'Rollback'}
                              </Button>
                            );
                          })()}
                        <Sheet>
                          <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Terminal className="w-4 h-4" />
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="sm:max-w-[800px] w-full p-0 flex flex-col gap-0 border-l">
                            <SheetHeader className="p-4 border-b bg-surface-muted/10">
                              <SheetTitle className="font-mono text-base">
                                Build #{build.id.slice(0, 8)}
                              </SheetTitle>
                              <SheetDescription>Logs for build execution</SheetDescription>
                            </SheetHeader>
                            <div className="flex-1 bg-console text-console-foreground font-mono text-xs overflow-hidden">
                              <LogViewer buildId={build.id} />
                            </div>
                          </SheetContent>
                        </Sheet>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
