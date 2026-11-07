'use client';

import { useState } from 'react';
import { Braces, CalendarDays, ChevronDown, HardDrive, Settings2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ActiveDeploymentCard } from './active-deployment-card';
import { ActivityList } from './activity-list';
import { DeploymentProgress } from './deployment-pipeline';
import { DomainStatusCard } from './domain-status-card';
import { ProjectProcessCard } from './project-process-card';
import { UptimeOverviewCard } from './uptime-overview-card';

interface OverviewTabProps {
  project: any;
  activeDeployment: any;
  builds: any[];
  onStopDeployment: () => void;
  onActivateBuild: (buildId: string) => void;
  onOpenSettings: () => void;
  onOpenUptime?: () => void;
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

function DisclosureIcon({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
    />
  );
}

export function OverviewTab({
  project,
  activeDeployment,
  builds,
  onStopDeployment,
  onActivateBuild,
  onOpenSettings,
  onOpenUptime,
  onViewDeployments,
  domainProvision,
  deploymentStatus,
  onRefreshDomain,
}: OverviewTabProps) {
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-300">
      <DeploymentProgress deploymentStatus={deploymentStatus} />

      <ActiveDeploymentCard
        activeDeployment={activeDeployment}
        builds={builds}
        project={project}
        onStopDeployment={onStopDeployment}
      />

      <ProjectProcessCard projectId={project.id} appType={project.app_type} />

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <Collapsible open={configurationOpen} onOpenChange={setConfigurationOpen}>
          <Card className="gap-0 overflow-hidden border-border bg-card p-0">
            <CollapsibleTrigger asChild>
              <button className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left outline-none transition-colors hover:bg-surface-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
                    <Settings2 className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Build configuration</span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                      {project.build_command}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-xs text-muted-foreground sm:inline">Details</span>
                  <DisclosureIcon open={configurationOpen} />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-x-8 gap-y-5 border-t border-border p-4 sm:grid-cols-2 sm:p-5">
                <Detail icon={Braces} label="Build command" value={project.build_command} />
                <Detail
                  icon={HardDrive}
                  label="Root directory"
                  value={project.root_directory || './'}
                />
                <Detail
                  icon={CalendarDays}
                  label="Created"
                  value={new Date(project.created_at).toLocaleDateString()}
                />
              </div>
              <div className="flex justify-end border-t border-border px-4 py-2.5 sm:px-5">
                <Button variant="ghost" size="sm" className="gap-2" onClick={onOpenSettings}>
                  Edit settings <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={healthOpen} onOpenChange={setHealthOpen}>
          <Card className="gap-0 overflow-hidden border-border bg-card p-0">
            <CollapsibleTrigger asChild>
              <button className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left outline-none transition-colors hover:bg-surface-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Health & domain</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      Uptime checks, DNS and SSL
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {project.uptime_status === 'down' && (
                    <span className="text-xs font-medium text-red-700 dark:text-red-400">
                      Service down
                    </span>
                  )}
                  {project.uptime_status === 'up' && (
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Up
                    </span>
                  )}
                  <DisclosureIcon open={healthOpen} />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-3 border-t border-border p-3 sm:p-4">
                <UptimeOverviewCard
                  projectId={project.id}
                  onOpenUptime={onOpenUptime}
                  onOpenSettings={onOpenSettings}
                />
                {domainProvision?.provisioned ? (
                  <DomainStatusCard
                    projectId={project.id}
                    domainProvision={domainProvision}
                    onRefresh={onRefreshDomain || (() => {})}
                  />
                ) : (
                  <Card className="gap-2 border-border bg-surface-muted/20 p-4 shadow-none">
                    <p className="text-sm font-medium">Project domain</p>
                    <p className="break-all text-sm text-muted-foreground">
                      {project.domain || 'No public domain configured'}
                    </p>
                    {!project.domain && (
                      <p className="text-xs text-muted-foreground">
                        Add a domain in project settings to publish this app.
                      </p>
                    )}
                  </Card>
                )}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      <ActivityList
        builds={builds}
        activeDeployment={activeDeployment}
        onActivateBuild={onActivateBuild}
        onViewAll={onViewDeployments}
      />
    </div>
  );
}
