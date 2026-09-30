'use client';

import {
  ArrowRight,
  Box,
  Braces,
  CalendarDays,
  GitBranch,
  GitCommit,
  HardDrive,
  Server,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActiveDeploymentCard } from './active-deployment-card';
import { ActivityList } from './activity-list';
import { DomainStatusCard } from './domain-status-card';
import { UptimeOverviewCard } from './uptime-overview-card';

interface OverviewTabProps {
  project: any;
  activeDeployment: any;
  builds: any[];
  onStopDeployment: () => void;
  onTriggerBuild: () => void;
  onActivateBuild: (buildId: string) => void;
  onOpenSettings: () => void;
  onViewDeployments: () => void;
  domainProvision?: any;
  deploymentStatus?: any;
  onRefreshDomain?: () => void;
}

function Detail({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-sm font-medium" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

export function OverviewTab({
  project,
  activeDeployment,
  builds,
  onStopDeployment,
  onTriggerBuild,
  onActivateBuild,
  onOpenSettings,
  onViewDeployments,
  domainProvision,
  deploymentStatus,
  onRefreshDomain,
}: OverviewTabProps) {
  const latestBuild = builds[0];

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {deploymentStatus &&
        deploymentStatus.status &&
        !['active', 'inactive'].includes(deploymentStatus.status) && (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm font-semibold text-blue-300">Deployment in progress</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {deploymentStatus.status_message || deploymentStatus.status.replaceAll('_', ' ')}
            </p>
          </div>
        )}

      <ActiveDeploymentCard
        activeDeployment={activeDeployment}
        project={project}
        onStopDeployment={onStopDeployment}
        onTriggerBuild={onTriggerBuild}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-3 border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Production
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${activeDeployment ? 'bg-emerald-500' : 'bg-muted-foreground'}`}
            />
            <span className="text-lg font-semibold">
              {activeDeployment ? 'Live' : 'Not deployed'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {activeDeployment
              ? `Released ${new Date(activeDeployment.activated_at).toLocaleDateString()}`
              : 'Deploy a successful build to go live'}
          </p>
        </Card>

        <Card className="gap-3 border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Latest build
          </p>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                latestBuild?.status === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : latestBuild?.status === 'failed'
                    ? 'border-red-500/20 bg-red-500/10 text-red-400'
                    : ''
              }
            >
              {latestBuild?.status || 'No builds'}
            </Badge>
            {latestBuild && (
              <span className="font-mono text-sm">#{latestBuild.id.slice(0, 8)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {latestBuild
              ? new Date(latestBuild.created_at).toLocaleString()
              : 'Build history will appear here'}
          </p>
        </Card>

        <Card className="gap-3 border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Source branch
          </p>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{project.github_branch || 'main'}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {project.github_repo_full_name || project.github_url.replace(/^https?:\/\//, '')}
          </p>
        </Card>

        <Card className="gap-3 border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Runtime
          </p>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span>{project.port ? `Port ${project.port}` : 'Auto assigned'}</span>
          </div>
          <p className="text-xs capitalize text-muted-foreground">{project.app_type}</p>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <Card className="gap-0 overflow-hidden border-border bg-card p-0 shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-semibold">Project configuration</h2>
              <p className="mt-1 text-sm text-muted-foreground">Build and source details</p>
            </div>
            <Button variant="ghost" size="sm" className="gap-2" onClick={onOpenSettings}>
              Settings <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-x-8 gap-y-6 p-5 sm:grid-cols-2 sm:p-6">
            <Detail
              icon={GitCommit}
              label="Repository"
              value={project.github_repo_full_name || project.github_url}
            />
            <Detail icon={GitBranch} label="Branch" value={project.github_branch || 'main'} />
            <Detail icon={Braces} label="Build command" value={project.build_command} />
            <Detail
              icon={HardDrive}
              label="Root directory"
              value={project.root_directory || './'}
            />
            <Detail icon={Box} label="Framework" value={project.app_type} />
            <Detail
              icon={CalendarDays}
              label="Created"
              value={new Date(project.created_at).toLocaleDateString()}
            />
          </div>
        </Card>

        <div className="grid gap-4">
          <UptimeOverviewCard projectId={project.id} onOpenSettings={onOpenSettings} />
          {domainProvision?.provisioned ? (
            <DomainStatusCard
              projectId={project.id}
              domainProvision={domainProvision}
              onRefresh={onRefreshDomain || (() => {})}
            />
          ) : (
            <Card className="gap-3 border-border bg-card p-5 shadow-sm">
              <p className="font-medium">Project domain</p>
              <p className="break-all text-sm text-muted-foreground">
                {project.domain || 'No public domain configured'}
              </p>
              <p className="text-xs text-muted-foreground">
                {project.domain
                  ? 'Domain provisioning details will appear after setup.'
                  : 'A public domain is required for automatic uptime checks.'}
              </p>
            </Card>
          )}
        </div>
      </section>

      <ActivityList
        builds={builds}
        activeDeployment={activeDeployment}
        onActivateBuild={onActivateBuild}
        onViewAll={onViewDeployments}
      />
    </div>
  );
}
