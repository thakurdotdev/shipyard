'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  Copy,
  GitBranch,
  Lock,
  MoreHorizontal,
  Play,
  Rocket,
  ScrollText,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Github } from '@/components/icons';
import { ProjectAvatar } from '@/components/projects/project-avatar';
import { Button } from '@/components/ui/button';
import { copyText } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusLabel, TONE_TEXT } from '@/components/ui/status';
import { api } from '@/lib/api';
import { commitTitle, formatBytes, siteUrl, timeAgo } from '@/lib/format';
import { servesStaticFiles } from '@/lib/framework-config';
import type { PM0Process } from '@/lib/pm0-api';
import type { getProjectStatus } from '@/lib/project-status';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

type Status = ReturnType<typeof getProjectStatus>;

/** One project in the list. The whole row opens the project; links and the menu sit above it. */
export function ProjectRow({
  project,
  status,
  process,
  onChanged,
}: {
  project: Project;
  status: Status;
  process: PM0Process | undefined;
  onChanged: () => void;
}) {
  const href = `/projects/${project.id}`;
  const url = siteUrl(project);
  const live = project.latest_deployment?.status === 'active';
  // "Ready" is a finished deployment; "Live" also means the uptime monitor reaches it.
  const label = status.label === 'Ready' && project.uptime_status === 'up' ? 'Live' : status.label;
  const build = project.latest_build;
  const busy = status.tone === 'progress';
  const olderBuildServing = status.label === 'Failed' && live;

  const deploy = () =>
    toast.promise(api.triggerBuild(project.id).then(onChanged), {
      loading: `Starting a deploy of ${project.name}…`,
      success: `${project.name} is building`,
      error: (error: Error) => error.message || 'Could not start the deploy',
    });

  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-muted/40 sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_8rem_minmax(0,1.5fr)_7.5rem_5.5rem_2.25rem]">
      <Link
        href={href}
        aria-label={`Open ${project.name}`}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />

      {/* Project */}
      <div className="flex min-w-0 items-center gap-3">
        <ProjectAvatar domain={project.domain} appType={project.app_type} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
            {/* Phones show status beside the name instead of in a column. */}
            <StatusLabel
              tone={status.tone}
              pulse={busy}
              className="text-xs lg:hidden"
              title={status.detail}
            >
              {label}
            </StatusLabel>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {project.access_protected && (
              <Lock className="size-3 shrink-0" aria-label="Password protected" />
            )}
            {project.domain && url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="relative z-10 truncate hover:text-foreground hover:underline"
              >
                {project.domain}
              </a>
            ) : (
              <span className="truncate">No domain</span>
            )}
          </div>
        </div>
      </div>

      {/* Menu: second grid column on phones, last on desktop. */}
      <div className="relative z-10 row-span-2 self-start lg:order-last lg:row-span-1 lg:self-center">
        <ProjectMenu project={project} url={url} busy={busy} onDeploy={deploy} />
      </div>

      {/* Status (desktop) */}
      <div className="hidden min-w-0 lg:block">
        <StatusLabel tone={status.tone} pulse={busy} title={status.detail}>
          {label}
        </StatusLabel>
      </div>

      {/* Latest commit */}
      <div className="min-w-0 pl-11 text-[13px] lg:pl-0">
        {build ? (
          <>
            <p className="truncate text-foreground/90" title={build.commit_message ?? undefined}>
              {commitTitle(build.commit_message) ?? 'Manual deploy'}
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
              {build.commit_sha && (
                <span className="shrink-0 font-mono">{build.commit_sha.slice(0, 7)}</span>
              )}
              <GitBranch className="size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate font-mono">{project.github_branch || 'main'}</span>
              <span className="shrink-0 lg:hidden">
                · {timeAgo(status.timestamp ?? build.created_at)}
              </span>
            </p>
            {olderBuildServing && (
              <p className={cn('mt-0.5 truncate text-xs', TONE_TEXT.error)}>
                Build failed · production still serves the previous build
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Never deployed</p>
        )}
      </div>

      {/* Runtime */}
      <div className="hidden font-mono text-xs tabular-nums lg:block">
        <Runtime project={project} process={process} />
      </div>

      {/* Updated */}
      <div className="hidden text-right text-[13px] text-muted-foreground lg:block">
        {status.timestamp ? (
          <time dateTime={status.timestamp} title={new Date(status.timestamp).toLocaleString()}>
            {timeAgo(status.timestamp)}
          </time>
        ) : (
          '—'
        )}
      </div>
    </li>
  );
}

function Runtime({ project, process }: { project: Project; process: PM0Process | undefined }) {
  if (!process) {
    return (
      <span className="text-muted-foreground">
        {servesStaticFiles(project) && project.latest_deployment ? 'static' : '—'}
      </span>
    );
  }
  if (process.status !== 'online') {
    return (
      <span className={process.status === 'errored' ? TONE_TEXT.error : 'text-muted-foreground'}>
        {process.status}
      </span>
    );
  }
  return (
    <span className="text-foreground/90" title={`PM0 process ${process.name}`}>
      {process.monit.cpu.toFixed(1)}%<span className="text-muted-foreground"> · </span>
      {formatBytes(process.monit.memory)}
    </span>
  );
}

function ProjectMenu({
  project,
  url,
  busy,
  onDeploy,
}: {
  project: Project;
  url: string | null;
  busy: boolean;
  onDeploy: () => void;
}) {
  const href = `/projects/${project.id}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${project.name}`}
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onDeploy} disabled={busy}>
          <Play />
          {busy ? 'Deploy in progress' : 'Deploy latest commit'}
        </DropdownMenuItem>
        {url && project.latest_deployment?.status === 'active' && (
          <DropdownMenuItem asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ArrowUpRight />
              Visit site
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`${href}?tab=deployments`}>
            <Rocket />
            Deployments
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${href}?tab=logs`}>
            <ScrollText />
            Runtime logs
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${href}?tab=settings`}>
            <Settings2 />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={project.github_url} target="_blank" rel="noreferrer">
            <Github className="size-4" />
            Repository
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(project.id, 'Copied project ID')}>
          <Copy />
          Copy project ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
      <div className="size-8 animate-pulse rounded-lg bg-surface-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="h-2.5 w-28 animate-pulse rounded bg-surface-muted/70" />
      </div>
    </div>
  );
}
