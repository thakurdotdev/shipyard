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

      <Card className="gap-0 overflow-hidden border-border bg-card p-0 shadow-sm">
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
                            className={`
                                text-[10px] h-5 capitalize
                                ${build.status === 'success' ? 'text-green-600 bg-green-500/10' : ''}
                                ${build.status === 'failed' ? 'text-red-600 bg-red-500/10' : ''}
                                ${build.status === 'building' || build.status === 'pending' ? 'text-blue-600 bg-blue-500/10' : ''}
                            `}
                          >
                            {build.status}
                          </Badge>
                        </div>
                        {build.deployment_status && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Deploy:</span>
                            <Badge
                              variant="secondary"
                              className={`
                                    text-[10px] h-5 capitalize
                                    ${build.deployment_status === 'active' ? 'text-green-600 bg-green-500/10' : ''}
                                    ${build.deployment_status === 'failed' ? 'text-red-600 bg-red-500/10' : ''}
                                    ${isPipelineStatus(build.deployment_status) ? 'text-blue-600 bg-blue-500/10 animate-pulse' : ''}
                                    ${build.deployment_status === 'activating' ? 'text-yellow-600 bg-yellow-500/10 animate-pulse' : ''}
                                    ${build.deployment_status === 'inactive' ? 'text-muted-foreground bg-surface-muted' : ''}
                                `}
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
