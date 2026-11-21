'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Facts, Panel, PanelHeader } from '@/components/ui/panel';
import { TONE_TEXT } from '@/components/ui/status';
import { commitTitle, timeAgo } from '@/lib/format';
import { getFrameworkOption, servesStaticFiles } from '@/lib/framework-config';
import type { ActiveDeployment, BuildWithDeployment, DomainProvision } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { DeploymentEvent, ProjectState } from '../project-state';
import { DeploymentProgress } from './deployment-pipeline';
import { BuildLogsSheet, DeploymentRow, isRollback } from './deployment-list';
import { DomainPanel, MonitoringPanel } from './health-panels';
import { ProductionPanel } from './production-panel';
import { RuntimePanel } from './runtime-panel';

const RECENT = 5;

export function OverviewTab({
  project,
  state,
  builds,
  buildsLoading,
  activeDeployment,
  deploymentEvent,
  domain,
  onDeploy,
  onActivateBuild,
  onRefreshDomain,
}: {
  project: Project;
  state: ProjectState;
  builds: BuildWithDeployment[];
  buildsLoading: boolean;
  activeDeployment: ActiveDeployment | null;
  deploymentEvent: DeploymentEvent | null;
  domain: DomainProvision | undefined;
  onDeploy: () => void;
  onActivateBuild: (buildId: string, label?: string) => Promise<void>;
  onRefreshDomain: () => void;
}) {
  const [logsFor, setLogsFor] = useState<BuildWithDeployment | null>(null);
  const liveBuild = builds.find((build) => build.id === activeDeployment?.build_id);
  const recent = builds.slice(0, RECENT);
  const base = `/projects/${project.id}`;
  const attempt = state.failedAttempt;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <DeploymentProgress event={deploymentEvent} />

        {attempt && (
          <Panel className="border-red-500/30" role="alert">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0 text-sm">
                <p className={cn('font-medium', TONE_TEXT.error)}>
                  {attempt.kind === 'build'
                    ? 'The latest build failed'
                    : 'The latest release failed'}
                </p>
                <p className="mt-0.5 truncate text-muted-foreground">
                  {attempt.kind === 'build' && attempt.build
                    ? `“${commitTitle(attempt.build.commit_message) ?? 'Manual deploy'}” · ${timeAgo(attempt.build.created_at)}. `
                    : attempt.message
                      ? `${attempt.message}. `
                      : ''}
                  Production still serves the previous deployment.
                </p>
              </div>
              {attempt.build && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setLogsFor(attempt.build!)}
                >
                  View logs
                </Button>
              )}
            </div>
          </Panel>
        )}

        <ProductionPanel
          project={project}
          activeDeployment={activeDeployment}
          liveBuild={liveBuild}
          busy={state.busy}
          onDeploy={onDeploy}
          onLogs={setLogsFor}
        />

        <Panel>
          <PanelHeader
            title="Recent deployments"
            actions={
              builds.length > 0 && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                  <Link href={`${base}?tab=deployments`} scroll={false}>
                    View all {builds.length}
                    <ArrowRight />
                  </Link>
                </Button>
              )
            }
          />
          {buildsLoading ? (
            <div className="h-40 animate-pulse bg-surface-muted/30" />
          ) : recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Builds appear here as soon as you deploy.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((build) => (
                <DeploymentRow
                  key={build.id}
                  compact
                  build={build}
                  isLive={activeDeployment?.build_id === build.id}
                  rollback={isRollback(build, builds, activeDeployment)}
                  deploymentEvent={deploymentEvent}
                  onLogs={() => setLogsFor(build)}
                  onPromote={() =>
                    void onActivateBuild(
                      build.id,
                      isRollback(build, builds, activeDeployment)
                        ? 'Rolling back'
                        : 'Promoting build',
                    )
                  }
                  promoteDisabled={state.busy}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <aside className="min-w-0 space-y-4" aria-label="Project health">
        <RuntimePanel project={project} />
        <MonitoringPanel projectId={project.id} />
        <DomainPanel
          projectId={project.id}
          domain={project.domain}
          provision={domain}
          onRefresh={onRefreshDomain}
        />
        <Panel>
          <PanelHeader
            title="Configuration"
            actions={
              <Link
                href={`${base}?tab=settings`}
                scroll={false}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </Link>
            }
          />
          <div className="px-4 py-4 sm:px-5">
            <Facts
              items={[
                {
                  label: 'Framework',
                  value: getFrameworkOption(project.app_type)?.label ?? project.app_type,
                },
                { label: 'Build', value: project.build_command, mono: true },
                ...(project.pre_deploy_command
                  ? [{ label: 'Pre-deploy', value: project.pre_deploy_command, mono: true }]
                  : []),
                { label: 'Root', value: project.root_directory || './', mono: true },
                ...(servesStaticFiles(project)
                  ? [{ label: 'Serving', value: 'Static files' }]
                  : [
                      {
                        label: 'Port',
                        value: project.port ? String(project.port) : 'Auto',
                        mono: true,
                      },
                    ]),
                {
                  label: 'Auto-deploy',
                  value: project.auto_deploy
                    ? `On push to ${project.github_branch || 'main'}`
                    : 'Off',
                },
              ]}
            />
          </div>
        </Panel>
      </aside>

      <BuildLogsSheet build={logsFor} onOpenChange={(open) => !open && setLogsFor(null)} />
    </div>
  );
}
