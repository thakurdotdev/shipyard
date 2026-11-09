'use client';

import Link from 'next/link';
import { Github } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getFrameworkOption } from '@/lib/framework-config';
import {
  ArrowLeft,
  ArrowUpRight,
  Code2,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  Play,
} from 'lucide-react';
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
    // The full message is on the progress card; the badge keeps to the step name.
    const step = getDeployStatusLabel(deploymentStatus.status);
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
          className="h-6 gap-1.5 border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
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

  const meta = 'inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground';

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur lg:sticky lg:top-16 lg:z-30">
      <div className="page-width py-3">
        <Link
          href="/"
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> All projects
        </Link>

        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {project.name}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
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
              <span>{isBusy ? 'Deploying' : 'Deploy'}</span>
            </Button>
          </div>
        </div>

        {/* One line of facts; the address is the only link to the live site. */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {statusBadge}
          {project.domain &&
            (activeDeployment && liveUrl ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${meta} max-w-64 font-medium text-foreground hover:underline`}
              >
                <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{project.domain}</span>
                <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <span className={`${meta} max-w-64`}>
                <Globe className="size-3.5 shrink-0" />
                <span className="truncate">{project.domain}</span>
              </span>
            ))}
          <span className={meta}>
            <Code2 className="size-3.5" />
            {getFrameworkOption(project.app_type)?.label ?? project.app_type}
          </span>
          {project.access_protected && (
            <span className={meta} title="Visitors must enter a password to open this site">
              <Lock className="size-3.5" />
              Password protected
            </span>
          )}
          {project.github_branch && (
            <span className={`${meta} max-w-40`}>
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate">{project.github_branch}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
