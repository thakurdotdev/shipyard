'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, Activity } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { DeploymentsTab } from './components/deployments-tab';
import { OverviewTab } from './components/overview-tab';
import { ProjectHeader } from './components/project-header';
import { SettingsTab } from './components/settings-tab';

function ProjectDetailsContent() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';

  const [project, setProject] = useState<any>(null);
  const [builds, setBuilds] = useState<any[]>([]);
  const [activeDeployment, setActiveDeployment] = useState<any>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  const refreshData = () => {
    if (!id) return;
    api.getProject(id).then(setProject).catch(console.error);
    api.getBuilds(id).then(setBuilds).catch(console.error);
    api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);
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

    socket.on('deployment_updated', () => {
      api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);
      toast.info('Deployment updated');
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
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <ProjectHeader
        project={project}
        activeDeployment={activeDeployment}
        isDeploying={isDeploying}
        onTriggerBuild={triggerBuild}
      />

      <div className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="mb-8 w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="deployments"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Deployments
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          <Activity mode={currentTab === 'overview' ? 'visible' : 'hidden'}>
            <OverviewTab
              project={project}
              activeDeployment={activeDeployment}
              builds={builds}
              onStopDeployment={stopDeployment}
              onTriggerBuild={triggerBuild}
              onActivateBuild={activateBuild}
            />
          </Activity>

          <Activity mode={currentTab === 'deployments' ? 'visible' : 'hidden'}>
            <DeploymentsTab
              builds={builds}
              onActivateBuild={activateBuild}
              activeDeployment={activeDeployment}
            />
          </Activity>

          <Activity mode={currentTab === 'settings' ? 'visible' : 'hidden'}>
            <SettingsTab project={project} />
          </Activity>
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
