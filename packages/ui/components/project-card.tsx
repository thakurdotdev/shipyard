'use client';

import { useState } from 'react';
import { CardShell } from '@/components/ui/card-shell';
import { Project } from '@/lib/types';
import { getProjectStatus } from '@/lib/project-status';
import { cn } from '@/lib/utils';
import { Cpu, ExternalLink, GitBranch, HardDrive } from 'lucide-react';
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

// Framework Icons mapping
const FrameworkIcon = ({ type, className }: { type: string; className?: string }) => {
  // Simple SVG icons representing frameworks
  switch (type) {
    case 'nextjs':
      return (
        <svg
          viewBox="0 0 180 180"
          className={className}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M128.166 180H0V0H180V180H128.166ZM90 28.3333L28.3333 133.333H51.6667L99.1667 52.5V133.333H121.667V28.3333H90ZM121.667 151.667V180H151.667V151.667H121.667Z"
            fill="white"
          />
        </svg>
      );
    case 'vite':
    case 'react':
      return (
        <svg
          viewBox="0 0 256 228"
          className={className}
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid"
        >
          <path
            fill="#00D8FF"
            d="M210.63 227.35l-95.2-166.4-1.12-1.95v168.35H210.63zM45.37 227.35l95.2-166.4 1.12-1.95v168.35L45.37 227.35zM.05 111.36l66.49 116h122.92L128 111.36 .05 111.36zM151.04 0L128 40.09 104.96 0H151.04z"
          />
          <circle cx="128" cy="114" r="23" fill="#FFF" />
        </svg>
      );
    case 'go':
      return (
        <svg viewBox="0 0 32 32" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="8" r="4" fill="#00ADD8" />
          <circle cx="23" cy="8" r="4" fill="#00ADD8" />
          <circle cx="16" cy="18" r="11" fill="#00ADD8" />
          <circle cx="12" cy="16" r="3" fill="#fff" />
          <circle cx="20" cy="16" r="3" fill="#fff" />
          <circle cx="12" cy="16" r="1.2" fill="#111" />
          <circle cx="20" cy="16" r="1.2" fill="#111" />
        </svg>
      );
    default:
      // Default generic code/globe icon
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={className}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 6.75h12a.75.75 0 01.75.75v9a.75.75 0 01-.75.75H6a.75.75 0 01-.75-.75v-9a.75.75 0 01.75-.75z"
          />
        </svg>
      );
  }
};

export function ProjectCard({ project }: { project: Project }) {
  const status = getProjectStatus(project);
  const statusColor = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    progress: 'bg-amber-500',
    neutral: 'bg-zinc-500',
  }[status.tone];
  const [faviconError, setFaviconError] = useState(false);

  const domainHostname = getDomainHostname(project.domain);
  const faviconUrl = domainHostname
    ? `https://icons.duckduckgo.com/ip3/${domainHostname}.ico`
    : null;

  return (
    <CardShell
      className="group relative transition-colors duration-200 hover:border-border-strong"
      innerClassName="justify-between overflow-hidden"
    >
      <Link
        href={`/projects/${project.id}`}
        className="absolute inset-0 z-0"
        aria-label={`View ${project.name}`}
      />

      <div className="flex flex-col h-full">
        <div className="p-5 flex-1">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center bg-surface-muted border border-border overflow-hidden">
              {faviconUrl && !faviconError ? (
                <img
                  src={faviconUrl}
                  alt={`${project.name} favicon`}
                  className="w-5 h-5 object-contain"
                  onError={() => setFaviconError(true)}
                />
              ) : (
                <FrameworkIcon type={project.app_type} className="w-5 h-5 text-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <h3 className="font-semibold text-sm truncate text-foreground pr-2">
                  {project.name}
                </h3>
                {project.uptime_status === 'down' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400 border border-red-500/20 shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    Down
                  </span>
                )}
                {project.uptime_status === 'up' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20 shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Live
                  </span>
                )}
              </div>
              <a
                href={
                  project.domain
                    ? project.domain.startsWith('http')
                      ? project.domain
                      : `https://${project.domain}`
                    : '#'
                }
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!project.domain) e.preventDefault();
                  e.stopPropagation();
                }}
                className={cn(
                  'text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 pointer-events-auto truncate max-w-full',
                  !project.domain && 'cursor-default hover:text-muted-foreground',
                )}
              >
                <span className="truncate">{project.domain || 'Not deployed'}</span>
                {project.domain && <ExternalLink className="w-3 h-3 opacity-50" />}
              </a>
            </div>
          </div>

          {/* Status & Git Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs" title={status.detail}>
              <span className={cn('relative flex h-2 w-2')}>
                {(status.tone === 'progress' || project.uptime_status === 'down') && (
                  <span
                    className={cn(
                      'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                      statusColor,
                    )}
                  />
                )}
                <span
                  className={cn('relative inline-flex rounded-full h-2 w-2', statusColor)}
                ></span>
              </span>
              <span
                className={cn(
                  'font-medium',
                  status.tone === 'error' && project.uptime_status === 'down'
                    ? 'text-red-400'
                    : 'text-foreground',
                )}
              >
                {status.label}
              </span>

              {status.timestamp && (
                <>
                  <span className="text-muted-foreground mx-1">•</span>
                  <time
                    className="text-muted-foreground"
                    dateTime={status.timestamp}
                    title={new Date(status.timestamp).toLocaleString()}
                  >
                    {timeAgo(new Date(status.timestamp))}
                  </time>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1 bg-surface-muted px-2 py-0.5 rounded-full border border-border max-w-[120px]">
                <GitBranch className="w-3 h-3 opacity-70" />
                <span className="font-mono truncate">{project.github_branch || 'main'}</span>
              </div>
              <span className="truncate flex-1">Latest commit from GitHub</span>
            </div>

            {project.managed_process && (
              <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1.5 capitalize">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      project.managed_process.status === 'online'
                        ? 'bg-emerald-500'
                        : project.managed_process.status === 'errored'
                          ? 'bg-red-500'
                          : 'bg-amber-500'
                    }`}
                  />
                  <span className="truncate">PM0 {project.managed_process.status}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="inline-flex items-center gap-1" title="Process CPU usage">
                    <Cpu className="h-3 w-3" /> {project.managed_process.cpu.toFixed(1)}%
                  </span>
                  <span className="inline-flex items-center gap-1" title="Process memory usage">
                    <HardDrive className="h-3 w-3" />
                    {formatProcessMemory(project.managed_process.memory)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="relative z-10 flex items-center justify-between border-t border-border bg-surface-muted/30 px-5 py-3">
          <div className="flex items-center gap-2 hover:text-foreground transition-colors pointer-events-auto text-xs text-muted-foreground">
            <a
              href={project.github_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline truncate max-w-[200px]"
              onClick={(e) => e.stopPropagation()}
            >
              {project.github_url.replace('https://github.com/', '')}
            </a>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function timeAgo(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + 'y ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + 'mo ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + 'd ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + 'h ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + 'm ago';
  return Math.floor(seconds) + 's ago';
}
