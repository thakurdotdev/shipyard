'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  queryKeys,
  useActiveDeployment,
  useBuilds,
  useDomainStatus,
  useProject,
  type BuildWithDeployment,
} from '@/lib/queries';
import type { Project } from '@/lib/types';
import { setQueryData } from '@/lib/use-query';
import { DeploymentsTab } from './components/deployments-tab';
import { EnvironmentTab } from './components/environment-tab';
import { LogsTab } from './components/logs-tab';
import { OverviewTab } from './components/overview-tab';
import { ProjectHeader } from './components/project-header';
import { ProjectTabs, type ProjectTab, PROJECT_TABS } from './components/project-tabs';
import { SettingsTab } from './components/settings-tab';
import { UptimeTab } from './components/uptime-tab';
import { deriveProjectState, type DeploymentEvent } from './project-state';

/**
 * The dashboard is a static export with one shell page for every project
 * (/projects/_), which Nginx serves for /projects/<id>. The real id therefore
 * comes from the browser's address, not from route params.
 */
function useProjectId(): string | null {
  const pathname = usePathname();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const segment = window.location.pathname.split('/')[2];
    setId(segment && segment !== '_' ? decodeURIComponent(segment) : null);
  }, [pathname]);
  return id;
}

/** Keeps every cached view of this project current from its event stream. */
function useProjectEvents(
  id: string | null,
  handlers: {
    onDeployment: (event: DeploymentEvent | null) => void;
    refresh: {
      builds: () => void;
      deployment: () => void;
      domain: () => void;
      project: () => void;
    };
  },
) {
  const { onDeployment, refresh } = handlers;
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(api.getProjectEventsStreamUrl(id), { withCredentials: true });
    const parse = (event: MessageEvent) => {
      try {
        return JSON.parse(event.data);
      } catch {
        return null;
      }
    };

    const onBuild = (event: MessageEvent) => {
      const build = parse(event) as (BuildWithDeployment & { deleted?: boolean }) | null;
      if (!build) return;
      setQueryData<BuildWithDeployment[]>(queryKeys.builds(id), (prev = []) => {
        // Deletions (manual, bulk, or retention) arrive as { id, deleted: true }.
        if (build.deleted) return prev.filter((b) => b.id !== build.id);
        const exists = prev.some((b) => b.id === build.id);
        // Events carry the build only; keep the deployment fields the list joined in.
        return exists
          ? prev.map((b) => (b.id === build.id ? { ...b, ...build } : b))
          : [build, ...prev];
      });
      if (build.status === 'failed') {
        toast.error('Build failed', {
          description: build.commit_message?.split('\n')[0] ?? `#${build.id.slice(0, 8)}`,
        });
      }
    };

    const onDeploymentEvent = (event: MessageEvent) => {
      const payload = parse(event) as DeploymentEvent | null;
      if (!payload) return;
      refresh.builds();
      refresh.deployment();
      if (payload.status === 'active') {
        onDeployment(null);
        refresh.domain();
        toast.success('Deployment is live');
      } else {
        onDeployment(payload);
        if (payload.status === 'failed') {
          toast.error('Deployment failed', { description: payload.status_message ?? undefined });
        }
      }
    };

    const onUptime = (event: MessageEvent) => {
      const payload = parse(event);
      if (payload?.status) {
        setQueryData<Project | undefined>(queryKeys.project(id), (prev) =>
          prev ? { ...prev, uptime_status: payload.status } : prev,
        );
      }
    };
    const onDomain = () => refresh.domain();

    es.addEventListener('build_updated', onBuild);
    es.addEventListener('deployment_updated', onDeploymentEvent);
    es.addEventListener('domain_status', onDomain);
    es.addEventListener('uptime_updated', onUptime);
    return () => es.close();
    // The refreshers are stable per id; re-subscribing on every render would drop events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

function ProjectDetailsContent() {
  const id = useProjectId();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab') as ProjectTab | null;
  const tab: ProjectTab = requested && PROJECT_TABS.includes(requested) ? requested : 'overview';

  const projectQuery = useProject(id);
  const buildsQuery = useBuilds(id);
  const deploymentQuery = useActiveDeployment(id);
  const domainQuery = useDomainStatus(id);
  const [deploymentEvent, setDeploymentEvent] = useState<DeploymentEvent | null>(null);
  const [starting, setStarting] = useState(false);

  useProjectEvents(id, {
    onDeployment: setDeploymentEvent,
    refresh: {
      builds: () => void buildsQuery.refresh(),
      deployment: () => void deploymentQuery.refresh(),
      domain: () => void domainQuery.refresh(),
      project: () => void projectQuery.refresh(),
    },
  });

  const project = projectQuery.data;
  const builds = buildsQuery.data ?? [];
  const activeDeployment = deploymentQuery.data ?? null;

  const refreshAll = () => {
    void projectQuery.refresh();
    void buildsQuery.refresh();
    void deploymentQuery.refresh();
    void domainQuery.refresh();
  };

  if (!project) {
    if (projectQuery.error) {
      return (
        <div className="page-width flex min-h-[60vh] flex-col items-center justify-center text-center">
          <h1 className="text-lg font-medium">This project isn’t available</h1>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            {projectQuery.error.message}
          </p>
          <Button className="mt-5" variant="outline" asChild>
            <Link href="/">Back to projects</Link>
          </Button>
        </div>
      );
    }
    return <ProjectSkeleton />;
  }

  const state = deriveProjectState({
    project,
    latestBuild: builds[0],
    activeDeployment,
    deploymentEvent,
    starting,
  });

  const deploy = async () => {
    setStarting(true);
    try {
      const build = await api.triggerBuild(project.id);
      setQueryData<BuildWithDeployment[]>(queryKeys.builds(project.id), (prev = []) =>
        prev.some((b) => b.id === build.id) ? prev : [build as BuildWithDeployment, ...prev],
      );
      toast.success('Deploy started', {
        description: `Building the latest commit on ${project.github_branch || 'main'}`,
      });
    } catch (error) {
      toast.error('Could not start the deploy', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setStarting(false);
      void buildsQuery.refresh();
    }
  };

  const activateBuild = async (buildId: string, label = 'Deploying build') => {
    const activation = api.activateBuild(buildId);
    toast.promise(activation, {
      loading: `${label}…`,
      success: 'Deployment started',
      error: (error: Error) => error.message || 'Could not activate the build',
    });
    await activation.catch(() => undefined);
    refreshAll();
  };

  const stopDeployment = async () => {
    const stopping = api.stopDeployment(project.id);
    toast.promise(stopping, {
      loading: 'Stopping production…',
      success: 'Production stopped',
      error: 'Could not stop the deployment',
    });
    await stopping.catch(() => undefined);
    deploymentQuery.mutate(null);
    refreshAll();
  };

  return (
    <div className="pb-20">
      <ProjectHeader
        project={project}
        state={state}
        activeDeployment={activeDeployment}
        onDeploy={deploy}
        onRedeploy={() =>
          activeDeployment && activateBuild(activeDeployment.build_id, 'Redeploying current build')
        }
        onStop={stopDeployment}
      />
      <ProjectTabs projectId={project.id} current={tab} buildCount={builds.length} />

      <div className="page-width pt-6">
        {tab === 'overview' && (
          <OverviewTab
            project={project}
            state={state}
            builds={builds}
            buildsLoading={buildsQuery.isLoading}
            activeDeployment={activeDeployment}
            deploymentEvent={deploymentEvent}
            domain={domainQuery.data}
            onDeploy={deploy}
            onActivateBuild={activateBuild}
            onRefreshDomain={() => void domainQuery.refresh()}
          />
        )}
        {tab === 'deployments' && (
          <DeploymentsTab
            projectId={project.id}
            builds={builds}
            loading={buildsQuery.isLoading}
            activeDeployment={activeDeployment}
            deploymentEvent={deploymentEvent}
            keepBuilds={project.keep_builds}
            onActivateBuild={activateBuild}
          />
        )}
        {tab === 'logs' && <LogsTab project={project} />}
        {tab === 'environment' && (
          <EnvironmentTab
            project={project}
            canRedeploy={!!activeDeployment && !state.busy}
            onRedeploy={() =>
              activeDeployment &&
              activateBuild(activeDeployment.build_id, 'Redeploying current build')
            }
          />
        )}
        {tab === 'uptime' && <UptimeTab project={project} />}
        {tab === 'settings' && (
          <SettingsTab
            project={project}
            hasDeployment={!!activeDeployment}
            onStopDeployment={stopDeployment}
            onProjectChange={refreshAll}
          />
        )}
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading project">
      <div className="page-width pt-6 pb-5">
        <div className="h-3 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="mt-4 flex items-center gap-4">
          <div className="size-11 animate-pulse rounded-lg bg-surface-muted" />
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-64 animate-pulse rounded bg-surface-muted/70" />
          </div>
        </div>
      </div>
      <div className="border-b border-border" />
      <div className="page-width grid gap-4 pt-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}

export default function ProjectDetails() {
  return (
    <Suspense fallback={<ProjectSkeleton />}>
      <ProjectDetailsContent />
    </Suspense>
  );
}
