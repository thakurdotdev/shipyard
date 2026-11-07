'use client';

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BuildRow, getPromotionLabel } from './build-row';

interface ActivityListProps {
  builds: any[];
  activeDeployment: any;
  onActivateBuild: (buildId: string) => void;
  onViewAll: () => void;
}

export function ActivityList({
  builds,
  activeDeployment,
  onActivateBuild,
  onViewAll,
}: ActivityListProps) {
  const recentBuilds = builds.slice(0, 3);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Recent builds</h2>
        {builds.length > recentBuilds.length && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onViewAll}>
            View all {builds.length} <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>

      <Card className="gap-0 overflow-hidden border-border bg-card p-0">
        {recentBuilds.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-medium">No builds yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Press Deploy to run the first build for this project.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentBuilds.map((build) => (
              <BuildRow
                key={build.id}
                build={build}
                isCurrent={activeDeployment?.build_id === build.id}
                promotionLabel={getPromotionLabel(build, builds, activeDeployment)}
                onPromote={() => onActivateBuild(build.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
