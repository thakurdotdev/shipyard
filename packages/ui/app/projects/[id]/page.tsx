'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DeploymentsTab } from './components/deployments-tab';
import { OverviewTab } from './components/overview-tab';
import { ProjectHeader } from './components/project-header';
import { SettingsTab } from './components/settings-tab';

function ProjectDetailsContent() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const currentTab = ['overview', 'deployments', 'settings'].includes(requestedTab || '')
    ? requestedTab!
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
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');

    socket.on('connect', () => {
      console.log('Socket Connected to Project Room');
      socket.emit('subscribe_project', id);
    });

    socket.on('build_updated', (updatedBuild: any) => {
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
    });

    socket.on('deployment_updated', (payload: any) => {
      // Track real-time deployment status for pipeline visualization
      setDeploymentStatus(payload);

      // Refresh builds to get updated deployment status (now included via JOIN)
      api.getBuilds(id).then(setBuilds).catch(console.error);
      api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);

      // Show appropriate toast based on deployment status
      if (payload?.status === 'active') {
        toast.success('Deployment activated');
        setDeploymentStatus(null); // Clear pipeline once active
        // Refresh domain status too
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
    });

    socket.on('domain_status', (payload: any) => {
      // Update domain provision status in real-time
      console.log('Domain status update:', payload);
      api.getDomainStatus(id).then(setDomainProvision).catch(console.error);
    });

    return () => {
      socket.emit('unsubscribe_project', id);
      socket.disconnect();
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
    try {
      toast.promise(api.activateBuild(buildId), {
        loading: 'Activating build...',
        success: () => {
          refreshData();
          return 'Build activated';
        },
        error: 'Failed to activate build',
      });
    } catch (e) {
      console.error(e);
    }
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <ProjectHeader
        project={project}
        activeDeployment={activeDeployment}
        isDeploying={isDeploying}
        onTriggerBuild={triggerBuild}
      />

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3 justify-start rounded-xl border border-border bg-card p-1 sm:w-[min(100%,560px)]">
            <TabsTrigger
              value="overview"
              className="h-9 rounded-lg px-3 data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="deployments"
              className="h-9 rounded-lg px-3 data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              Deployments
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="h-9 rounded-lg px-3 data-[state=active]:bg-surface-muted data-[state=active]:text-foreground"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5">
            <OverviewTab
              project={project}
              activeDeployment={activeDeployment}
              builds={builds}
              onStopDeployment={stopDeployment}
              onTriggerBuild={triggerBuild}
              onActivateBuild={activateBuild}
              onOpenSettings={() => handleTabChange('settings')}
              onViewDeployments={() => handleTabChange('deployments')}
              domainProvision={domainProvision}
              deploymentStatus={deploymentStatus}
              onRefreshDomain={refreshData}
            />
          </TabsContent>

          <TabsContent value="deployments" className="mt-5">
            <DeploymentsTab
              builds={builds}
              onActivateBuild={activateBuild}
              activeDeployment={activeDeployment}
              deploymentStatus={deploymentStatus}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-5">
            <SettingsTab project={project} />
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
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ProjectDetailsContent />
    </Suspense>
  );
}
