'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ProcessLogViewer } from '@/components/process-manager/process-log-viewer';
import { processStatus } from '@/components/process-manager/process-utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusLabel } from '@/components/ui/status';
import { servesStaticFiles } from '@/lib/framework-config';
import { processTarget } from '@/lib/pm0-api';
import { projectProcess, useProcessList } from '@/lib/queries';
import type { Project } from '@/lib/types';

/** Live output of the process serving this project. */
export function LogsTab({ project }: { project: Project }) {
  const { data, error, isLoading } = useProcessList(10_000);
  const process = projectProcess(data?.processes, project.id);

  if (isLoading)
    return <div className="h-[480px] animate-pulse rounded-xl border border-border bg-card" />;

  if (!process) {
    const staticSite = servesStaticFiles(project);
    return (
      <Panel>
        <EmptyState
          title={
            error
              ? 'PM0 isn’t responding'
              : staticSite
                ? 'Static sites have no runtime logs'
                : 'No running process'
          }
          description={
            error
              ? 'Runtime logs come from the PM0 daemon, which didn’t answer.'
              : staticSite
                ? 'Nginx serves the built files directly. Build output is on each deployment.'
                : 'Logs appear here once a deployment starts the app.'
          }
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${project.id}?tab=deployments`} scroll={false}>
                Build logs
              </Link>
            </Button>
          }
        />
      </Panel>
    );
  }

  const status = processStatus(process.status);
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-3">
            Runtime logs
            <StatusLabel tone={status.tone} className="text-xs font-normal">
              {status.label}
            </StatusLabel>
          </span>
        }
        description={
          <span className="font-mono">
            {process.name} · #{process.pm_id}
          </span>
        }
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link href={`/processes?process=${encodeURIComponent(processTarget(process))}`}>
              Open in Processes
              <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <ProcessLogViewer
        key={processTarget(process)}
        target={processTarget(process)}
        processName={process.name}
        className="h-[calc(100svh-22rem)] min-h-[360px]"
      />
    </Panel>
  );
}
