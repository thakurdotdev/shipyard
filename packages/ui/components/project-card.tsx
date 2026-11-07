'use client';

import { useState } from 'react';
import { Github } from '@/components/icons';
import { CardShell } from '@/components/ui/card-shell';
import { FrameworkIcon } from '@/components/ui/framework-icons';
import { Project } from '@/lib/types';
import { timeAgo } from '@/lib/format';
import { getProjectStatus } from '@/lib/project-status';
import { cn } from '@/lib/utils';
import { ExternalLink, GitBranch } from 'lucide-react';
import Link from 'next/link';

function getDomainHostname(domain: string | null): string | null {
  if (!domain) return null;
  try {
    const normalized =
      domain.startsWith('http://') || domain.startsWith('https://') ? domain : `https://${domain}`;
    return new URL(normalized).hostname;
  } catch {
    return domain
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0];
  }
}

function formatProcessMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const STATUS_BADGE = {
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  error: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
  progress: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  neutral: 'border-border bg-surface-muted text-muted-foreground',
};

const STATUS_DOT = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  progress: 'bg-amber-500',
  neutral: 'bg-zinc-500',
};

export function ProjectCard({ project }: { project: Project }) {
  const status = getProjectStatus(project);
  const pulsing = status.tone === 'progress' || project.uptime_status === 'down';
  // "Ready" means the deployment finished; "Live" also means the monitor reaches it.
  const label = status.label === 'Ready' && project.uptime_status === 'up' ? 'Live' : status.label;
  const [faviconError, setFaviconError] = useState(false);

  const domainHostname = getDomainHostname(project.domain);
  const faviconUrl = domainHostname
    ? `https://icons.duckduckgo.com/ip3/${domainHostname}.ico`
    : null;
  const process = project.managed_process;

  return (
    <CardShell
      className="surface-card-interactive group relative"
      innerClassName="justify-between overflow-hidden"
    >
      <Link
        href={`/projects/${project.id}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View ${project.name}`}
      />

      <div className="flex-1 p-5">
        <div className="flex items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-muted">
            {faviconUrl && !faviconError ? (
              <img
                src={faviconUrl}
                alt=""
                className="size-5 object-contain"
                onError={() => setFaviconError(true)}
              />
            ) : (
              <FrameworkIcon icon={project.app_type} className="text-foreground" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground" title={project.name}>
              {project.name}
            </h3>
            {project.domain ? (
              <a
                href={
                  project.domain.startsWith('http') ? project.domain : `https://${project.domain}`
                }
                target="_blank"
                rel="noreferrer"
                className="relative z-10 mt-0.5 flex w-fit max-w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="truncate">{project.domain}</span>
                <ExternalLink className="size-3 shrink-0 opacity-50" />
              </a>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">No domain yet</p>
            )}
          </div>

          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              STATUS_BADGE[status.tone],
            )}
            title={status.detail}
          >
            <span className="relative flex size-1.5">
              {pulsing && (
                <span
                  className={cn(
                    'absolute inline-flex size-full animate-ping rounded-full opacity-75',
                    STATUS_DOT[status.tone],
                  )}
                />
              )}
              <span
                className={cn(
                  'relative inline-flex size-1.5 rounded-full',
                  STATUS_DOT[status.tone],
                )}
              />
            </span>
            {label}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate font-mono" title={project.github_branch || 'main'}>
            {project.github_branch || 'main'}
          </span>
          {status.timestamp && (
            <>
              <span aria-hidden="true">·</span>
              <time
                className="shrink-0"
                dateTime={status.timestamp}
                title={new Date(status.timestamp).toLocaleString()}
              >
                {timeAgo(status.timestamp)}
              </time>
            </>
          )}
        </div>
      </div>

      <div className="relative flex min-h-11 items-center justify-between gap-3 border-t border-border bg-surface-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        <a
          href={project.github_url}
          target="_blank"
          rel="noreferrer"
          className="relative z-10 inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <Github className="size-3.5 shrink-0" />
          <span className="truncate">{project.github_url.replace('https://github.com/', '')}</span>
        </a>

        {process && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 tabular-nums"
            title={`PM0 process ${process.name}: ${process.status}`}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                process.status === 'online'
                  ? 'bg-emerald-500'
                  : process.status === 'errored'
                    ? 'bg-red-500'
                    : 'bg-amber-500',
              )}
            />
            {process.status === 'online' ? (
              <>
                {process.cpu.toFixed(1)}% · {formatProcessMemory(process.memory)}
              </>
            ) : (
              <span className="capitalize">{process.status}</span>
            )}
          </span>
        )}
      </div>
    </CardShell>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="surface-card h-[157px] animate-pulse rounded-xl border border-border bg-card"
    />
  );
}
