'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Layout, Server } from 'lucide-react';
import { ActiveDeploymentCard } from './active-deployment-card';
import { ActivityList } from './activity-list';
import { DomainStatusCard } from './domain-status-card';
import { DeploymentPipeline } from './deployment-pipeline';

interface OverviewTabProps {
  project: any;
  activeDeployment: any;
  builds: any[];
  onStopDeployment: () => void;
  onTriggerBuild: () => void;
  onActivateBuild: (buildId: string) => void;
  domainProvision?: any;
  deploymentStatus?: any;
  onRefreshDomain?: () => void;
}

export function OverviewTab({
  project,
  activeDeployment,
  builds,
  onStopDeployment,
  onTriggerBuild,
  onActivateBuild,
  domainProvision,
  deploymentStatus,
  onRefreshDomain,
}: OverviewTabProps) {
  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      {/* Deployment Pipeline — shows during active deployment */}
      {deploymentStatus &&
        deploymentStatus.status &&
        deploymentStatus.status !== 'active' &&
        deploymentStatus.status !== 'inactive' && (
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-400 uppercase tracking-wider">
                Deployment Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeploymentPipeline
                status={deploymentStatus.status}
                statusMessage={deploymentStatus.status_message}
              />
            </CardContent>
          </Card>
        )}

      {/* Hero Card - Active Deployment */}
      <ActiveDeploymentCard
        activeDeployment={activeDeployment}
        project={project}
        onStopDeployment={onStopDeployment}
        onTriggerBuild={onTriggerBuild}
      />

      {/* Project Specs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50 shadow-sm bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Framework
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Layout className="w-5 h-5 text-zinc-400" />
              <span className="capitalize font-semibold text-lg">{project.app_type}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Port
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <code className="bg-black/50 border border-zinc-800 px-3 py-1.5 rounded text-sm font-mono text-zinc-300">
                {project.port ? `:${project.port}` : 'Auto'}
              </code>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Build Command
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="bg-black/50 border border-zinc-800 px-3 py-1.5 rounded text-sm font-mono text-zinc-300 truncate block">
              {project.build_command}
            </code>
          </CardContent>
        </Card>

        {/* Domain Status Card (replaces Root Directory if domain exists) */}
        {domainProvision && domainProvision.provisioned ? (
          <DomainStatusCard
            projectId={project.id}
            domainProvision={domainProvision}
            onRefresh={onRefreshDomain || (() => {})}
          />
        ) : (
          <Card className="border-border/50 shadow-sm bg-muted/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Root Directory
              </CardTitle>
            </CardHeader>
            <CardContent>
              <code className="bg-black/50 border border-zinc-800 px-3 py-1.5 rounded text-sm font-mono text-zinc-300 truncate block">
                {project.root_directory || './'}
              </code>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Activity List */}
      <ActivityList
        builds={builds}
        activeDeployment={activeDeployment}
        onActivateBuild={onActivateBuild}
      />
    </div>
  );
}
