'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { Activity, KeyRound, LayoutDashboard, Loader2, Rocket, Settings2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DeploymentsTab } from './components/deployments-tab';
import { EnvironmentTab } from './components/environment-tab';
import { OverviewTab } from './components/overview-tab';
import { ProjectHeader } from './components/project-header';
import { SettingsTab } from './components/settings-tab';
import { UptimeTab } from './components/uptime-tab';

const VALID_TABS = ['overview', 'deployments', 'environment', 'uptime', 'settings'] as const;
type TabType = (typeof VALID_TABS)[number];

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

function ProjectDetailsContent() {
  const id = useProjectId() as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const currentTab: TabType = VALID_TABS.includes(requestedTab as TabType)
    ? (requestedTab as TabType)
    : 'overview';

  const [project, setProject] = useState<any>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [builds, setBuilds] = useState<any[]>([]);
  const [activeDeployment, setActiveDeployment] = useState<any>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [domainProvision, setDomainProvision] = useState<any>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<any>(null);

  const refreshData = () => {
    if (!id) return;
    api
      .getProject(id)
      .then((result) => {
        setProject(result);
        setPageError(null);
      })
      .catch((error) => {
        console.error(error);
        setPageError(error instanceof Error ? error.message : 'Unable to load this project');
      });
    api.getBuilds(id).then(setBuilds).catch(console.error);
    api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);
    api.getDomainStatus(id).then(setDomainProvision).catch(console.error);
  };

  useEffect(() => {
    if (!id) return;
    refreshData();

    const streamUrl = api.getProjectEventsStreamUrl(id);
    const es = new EventSource(streamUrl, { withCredentials: true });

    es.onopen = () => {
      console.log(`[Project] Connected to SSE for project: ${id}`);
    };

    const handleBuildUpdated = (e: MessageEvent) => {
      try {
        const updatedBuild = JSON.parse(e.data);
        // Deletions (manual, bulk, or retention) arrive as { id, deleted: true }.
        if (updatedBuild.deleted) {
          setBuilds((prev) => prev.filter((b) => b.id !== updatedBuild.id));
          return;
        }
        setBuilds((prev) => {
          const exists = prev.find((b) => b.id === updatedBuild.id);
          if (exists) {
            return prev.map((b) => (b.id === updatedBuild.id ? updatedBuild : b));
          }
          return [updatedBuild, ...prev];
        });
        if (updatedBuild.status === 'success') {
          api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);
          toast.success(`Build #${updatedBuild.id.slice(0, 8)} succeeded`);
        } else if (updatedBuild.status === 'failed') {
          toast.error(`Build #${updatedBuild.id.slice(0, 8)} failed`);
        }
      } catch (err) {
        console.error('[Project] Failed to parse build_updated SSE:', err);
      }
    };

    const handleDeploymentUpdated = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setDeploymentStatus(payload);

        api.getBuilds(id).then(setBuilds).catch(console.error);
        api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);

        if (payload?.status === 'active') {
          toast.success('Deployment activated');
          setDeploymentStatus(null);
          api.getDomainStatus(id).then(setDomainProvision).catch(console.error);
        } else if (payload?.status === 'failed') {
          toast.error(payload?.status_message || 'Deployment failed');
        } else if (payload?.status === 'dns_creating') {
          toast.info('Setting up DNS...');
        } else if (payload?.status === 'ssl_issuing') {
          toast.info('Issuing SSL certificate...');
        } else if (payload?.status === 'app_starting') {
          toast.info('Starting application...');
        }
      } catch (err) {
        console.error('[Project] Failed to parse deployment_updated SSE:', err);
      }
    };

    const handleDomainStatus = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('Domain status update:', payload);
        api.getDomainStatus(id).then(setDomainProvision).catch(console.error);
      } catch (err) {
        console.error('[Project] Failed to parse domain_status SSE:', err);
      }
    };

    const handleUptimeUpdated = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload?.status) {
          setProject((prev: any) => (prev ? { ...prev, uptime_status: payload.status } : prev));
        }
      } catch (err) {
        console.error('[Project] Failed to parse uptime_updated SSE:', err);
      }
    };

    es.addEventListener('build_updated', handleBuildUpdated);
    es.addEventListener('deployment_updated', handleDeploymentUpdated);
    es.addEventListener('domain_status', handleDomainStatus);
    es.addEventListener('uptime_updated', handleUptimeUpdated);

    es.onerror = (err) => {
      console.warn('[Project] SSE connection error, reconnecting automatically:', err);
    };

    return () => {
      es.removeEventListener('build_updated', handleBuildUpdated);
      es.removeEventListener('deployment_updated', handleDeploymentUpdated);
      es.removeEventListener('domain_status', handleDomainStatus);
      es.removeEventListener('uptime_updated', handleUptimeUpdated);
      es.close();
    };
  }, [id]);

  const triggerBuild = async () => {
    try {
      setIsDeploying(true);
      await api.triggerBuild(id);
      refreshData();
      return Promise.resolve();
    } catch (error) {
      console.error(error);
      return Promise.reject(error);
    } finally {
      setIsDeploying(false);
    }
  };

  const activateBuild = async (buildId: string) => {
    const activation = api.activateBuild(buildId);
    toast.promise(activation, {
      loading: 'Activating build...',
      success: () => {
        refreshData();
        return 'Build activated';
      },
      error: 'Failed to activate build',
    });
    // The toast reports failures; callers only need to know when it has settled.
    await activation.catch(console.error);
  };

  const stopDeployment = async () => {
    try {
      toast.promise(
        (async () => {
          await api.stopDeployment(id);
          refreshData();
          setActiveDeployment(null);
        })(),
        {
          loading: 'Stopping deployment...',
          success: 'Deployment stopped',
          error: 'Failed to stop deployment',
        },
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleTabChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', value);
    router.push(`?${newParams.toString()}`);
  };

  if (!project) {
    if (pageError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
          <h1 className="text-xl font-semibold">Project unavailable</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{pageError}</p>
          <Button className="mt-5" variant="outline" onClick={() => router.push('/')}>
            Back to projects
          </Button>
        </div>
      );
    }
    return (
      <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background pb-20">
      <ProjectHeader
        project={project}
        activeDeployment={activeDeployment}
        deploymentStatus={deploymentStatus}
        latestBuild={builds[0]}
        isDeploying={isDeploying}
        onTriggerBuild={triggerBuild}
      />

      <div className="page-width space-y-6 py-6 sm:py-8">
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-5 surface-card rounded-xl border border-border bg-card p-1 sm:inline-flex sm:w-fit sm:self-start">
            <TabsTrigger
              value="overview"
              className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-medium leading-none sm:flex-row sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger
              value="deployments"
              className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-medium leading-none sm:flex-row sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              <Rocket className="h-4 w-4 shrink-0" />
              <span className="sm:hidden">Deploys</span>
              <span className="hidden sm:inline">Deployments</span>
            </TabsTrigger>
            <TabsTrigger
              value="environment"
              className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-medium leading-none sm:flex-row sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="sm:hidden">Env</span>
              <span className="hidden sm:inline">Environment</span>
            </TabsTrigger>
            <TabsTrigger
              value="uptime"
              className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-medium leading-none sm:flex-row sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              <Activity className="h-4 w-4 shrink-0" />
              <span>Uptime</span>
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-medium leading-none sm:flex-row sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span>Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            <OverviewTab
              project={project}
              activeDeployment={activeDeployment}
              builds={builds}
              onStopDeployment={stopDeployment}
              onActivateBuild={activateBuild}
              onOpenSettings={() => handleTabChange('settings')}
              onOpenUptime={() => handleTabChange('uptime')}
              onViewDeployments={() => handleTabChange('deployments')}
              domainProvision={domainProvision}
              deploymentStatus={deploymentStatus}
              onRefreshDomain={refreshData}
            />
          </TabsContent>

          <TabsContent value="deployments" className="mt-6">
            <DeploymentsTab
              builds={builds}
              onActivateBuild={activateBuild}
              onBuildDeleted={(buildId) =>
                setBuilds((prev) => prev.filter((b) => b.id !== buildId))
              }
              activeDeployment={activeDeployment}
              deploymentStatus={deploymentStatus}
              keepBuilds={project.keep_builds}
            />
          </TabsContent>

          <TabsContent value="environment" className="mt-6">
            <EnvironmentTab project={project} />
          </TabsContent>

          <TabsContent value="uptime" className="mt-6">
            <UptimeTab project={project} />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <SettingsTab
              project={project}
              onProtectionChange={(enabled) =>
                setProject((prev: any) => (prev ? { ...prev, access_protected: enabled } : prev))
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function ProjectDetails() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ProjectDetailsContent />
    </Suspense>
  );
}
