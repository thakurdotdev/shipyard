'use client';

import Link from 'next/link';
import { Github } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowUpRight, Code2, GitBranch, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectHeaderProps {
  project: any;
  activeDeployment: any;
  deploymentStatus?: any;
  latestBuild?: any;
  isDeploying: boolean;
  onTriggerBuild: () => Promise<void>;
}

const getDeployStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: 'Pending',
    dns_creating: 'DNS setup',
    dns_created: 'DNS ready',
    ssl_issuing: 'SSL issuing',
    ssl_issued: 'SSL ready',
    nginx_configuring: 'Configuring',
    nginx_configured: 'Configured',
    app_starting: 'Starting app',
    health_checking: 'Health check',
    active: 'Active',
    inactive: 'Inactive',
    failed: 'Failed',
    activating: 'Activating',
  };
  return labels[status] || status.replace(/_/g, ' ');
};

export function ProjectHeader({
  project,
  activeDeployment,
  deploymentStatus,
  latestBuild,
  isDeploying,
  onTriggerBuild,
}: ProjectHeaderProps) {
  const liveUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : null;

  const isPipelineActive =
    deploymentStatus?.status && !['active', 'inactive', 'failed'].includes(deploymentStatus.status);
  const isBuilding =
    isDeploying || latestBuild?.status === 'building' || latestBuild?.status === 'pending';
  const isDeployFailed = deploymentStatus?.status === 'failed' || latestBuild?.status === 'failed';
  const failureLabel =
    deploymentStatus?.status === 'failed' ? 'Deployment failed' : 'Latest build failed';
  const isBusy = isDeploying || isBuilding || isPipelineActive;

  let statusBadge;
  if (isBuilding) {
    statusBadge = (
      <Badge
        variant="outline"
        className="h-6 gap-1.5 border-brand-500/25 bg-brand-500/5 text-brand-800 dark:text-brand-300"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Building{latestBuild?.id ? ` #${latestBuild.id.slice(0, 7)}` : ''}
      </Badge>
    );
  } else if (isPipelineActive) {
    const step = deploymentStatus.status_message || getDeployStatusLabel(deploymentStatus.status);
    statusBadge = (
      <Badge
        variant="outline"
        className="h-6 gap-1.5 border-brand-500/25 bg-brand-500/5 text-brand-800 dark:text-brand-300"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Deploying · {step}
      </Badge>
    );
  } else if (isDeployFailed && !activeDeployment) {
    statusBadge = (
      <Badge variant="destructive" className="h-6">
        {failureLabel}
      </Badge>
    );
  } else if (activeDeployment && project.uptime_status === 'down') {
    statusBadge = (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="destructive" className="h-6">
          Service down
        </Badge>
        {isDeployFailed && (
          <Badge variant="destructive" className="h-6">
            {failureLabel}
          </Badge>
        )}
      </span>
    );
  } else if (activeDeployment) {
    statusBadge = (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="h-6 gap-1.5 border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Production live
        </Badge>
        {isDeployFailed && (
          <Badge variant="destructive" className="h-6">
            {failureLabel}
          </Badge>
        )}
      </span>
    );
  } else {
    statusBadge = (
      <Badge variant="secondary" className="h-6 text-muted-foreground">
        Not deployed
      </Badge>
    );
  }

  return (
    <header className="sticky top-16 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="min-w-0">
          <Link
            href="/"
            className="mb-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> All projects
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="max-w-full truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {project.name}
            </h1>
            {statusBadge}
            <span className="inline-flex items-center gap-1.5 text-xs capitalize text-muted-foreground">
              <Code2 className="size-3.5" /> {project.app_type}
            </span>
            {project.github_branch && (
              <span className="inline-flex max-w-40 items-center gap-1.5 truncate text-xs text-muted-foreground">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="truncate">{project.github_branch}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 lg:shrink-0">
          <Button variant="outline" size="icon" className="size-9" asChild>
            <a
              href={project.github_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open GitHub repository"
              title="Open GitHub repository"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>
          {activeDeployment && liveUrl && (
            <Button variant="outline" size="sm" className="h-9 gap-2" asChild>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer">
                Open site <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            onClick={() =>
              toast.promise(onTriggerBuild(), {
                loading: 'Starting deployment...',
                success: 'Deployment started',
                error: 'Failed to start deployment',
              })
            }
            disabled={isBusy}
            className="h-9 gap-2 px-3 sm:px-4"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span>{isBusy ? 'Working' : 'Deploy'}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
