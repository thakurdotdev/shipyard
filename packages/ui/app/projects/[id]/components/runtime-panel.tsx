'use client';

import Link from 'next/link';
import { Loader2, Play, RotateCw, ScrollText } from 'lucide-react';
import { ProcessMenu } from '@/components/process-manager/process-table';
import {
  processStatus,
  restartsExhausted,
  restartsLabel,
} from '@/components/process-manager/process-utils';
import { useProcessActions } from '@/components/process-manager/use-process-actions';
import { Button } from '@/components/ui/button';
import { Panel, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { StatusLabel, TONE_TEXT } from '@/components/ui/status';
import { formatBytes, formatUptime } from '@/lib/format';
import { servesStaticFiles } from '@/lib/framework-config';
import { projectProcess, useProcessList } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The PM0 process serving this project: usage and the controls you reach for most. */
export function RuntimePanel({ project }: { project: Project }) {
  const { data, error, isLoading } = useProcessList(10_000);
  const process = projectProcess(data?.processes, project.id);
  const actions = useProcessActions();
  const staticSite = servesStaticFiles(project);

  if (!process) {
    return (
      <Panel>
        <PanelHeader title="Runtime" />
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          {isLoading
            ? 'Checking PM0…'
            : error
              ? 'PM0 isn’t responding, so runtime figures are unavailable.'
              : staticSite
                ? 'Static files served directly by Nginx. There is no process to supervise.'
                : 'No process yet. Deploying starts one.'}
        </p>
      </Panel>
    );
  }

  const status = processStatus(process.status);
  const online = process.status === 'online';
  const pending = actions.isPending(process);
  const stats = [
    { label: 'CPU', value: online ? `${process.monit.cpu.toFixed(1)}%` : '—' },
    { label: 'Memory', value: online ? formatBytes(process.monit.memory) : '—' },
    { label: 'Uptime', value: online ? formatUptime(process.pm_uptime) : '—' },
    { label: 'Restarts', value: restartsLabel(process), danger: restartsExhausted(process) },
  ];

  return (
    <Panel>
      <PanelHeader
        title="Runtime"
        actions={
          <StatusLabel
            tone={status.tone}
            pulse={status.tone === 'progress'}
            className="text-[13px]"
          >
            {status.label}
          </StatusLabel>
        }
      />
      <dl className="grid grid-cols-2 border-b border-border">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={cn(
              'px-4 py-3 sm:px-5',
              index % 2 === 0 && 'border-r border-border',
              index < 2 && 'border-b border-border',
            )}
          >
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd
              className={cn(
                'mt-0.5 font-mono text-sm tabular-nums',
                stat.danger && TONE_TEXT.error,
              )}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <p
        className="truncate px-4 py-2.5 font-mono text-[11.5px] text-muted-foreground sm:px-5"
        title={process.cwd}
      >
        {process.name} · #{process.pm_id}
        {online && process.pid > 0 && ` · pid ${process.pid}`}
        {process.status === 'errored' &&
          process.exit_code != null &&
          ` · exit ${process.exit_code}`}
      </p>
      <PanelFooter className="justify-start gap-1.5">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${project.id}?tab=logs`} scroll={false}>
            <ScrollText />
            Logs
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => actions.request(online ? 'restart' : 'start', process)}
        >
          {pending ? <Loader2 className="animate-spin" /> : online ? <RotateCw /> : <Play />}
          {online ? 'Restart' : 'Start'}
        </Button>
        <div className="ml-auto">
          <ProcessMenu
            process={process}
            onAction={(action) => actions.request(action, process)}
            busy={pending}
            showProjectLink={false}
          />
        </div>
      </PanelFooter>
      {actions.dialog}
    </Panel>
  );
}
