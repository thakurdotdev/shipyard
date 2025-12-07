'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Layout } from 'lucide-react';
import { ActiveDeploymentCard } from './active-deployment-card';
import { ActivityList } from './activity-list';

interface OverviewTabProps {
  project: any;
  activeDeployment: any;
  builds: any[];
  onStopDeployment: () => void;
  onTriggerBuild: () => void;
  onActivateBuild: (buildId: string) => void;
}

export function OverviewTab({
  project,
  activeDeployment,
  builds,
  onStopDeployment,
  onTriggerBuild,
  onActivateBuild,
}: OverviewTabProps) {
  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Hero Card - Active Deployment */}
        <div className="md:col-span-2">
          <ActiveDeploymentCard
            activeDeployment={activeDeployment}
            project={project}
            onStopDeployment={onStopDeployment}
            onTriggerBuild={onTriggerBuild}
          />
        </div>

        {/* Project Details */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Framework</div>
              <div className="flex items-center gap-2">
                <Layout className="w-4 h-4 text-muted-foreground" />
                <span className="capitalize">{project.app_type}</span>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Build Command</div>
              <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                {project.build_command}
              </code>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Root Directory</div>
              <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                {project.root_directory || './'}
              </code>
            </div>
          </CardContent>
        </Card>
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
