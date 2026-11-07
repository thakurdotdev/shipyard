'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ProjectCard, ProjectCardSkeleton } from '@/components/project-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { AlertTriangle, Plus, Rocket, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/lib/types';
import { getProjectStatus } from '@/lib/project-status';
import { pm0Api } from '@/lib/pm0-api';
import { cn } from '@/lib/utils';

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [latest, processes] = await Promise.all([
          api.getProjects(),
          pm0Api.getProcesses().catch(() => []),
        ]);
        if (!disposed) {
          setLoadFailed(false);
          setProjects(
            latest.map((project) => {
              const process = processes
                .filter((candidate) => candidate.project_id === project.id)
                .sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'))[0];
              return {
                ...project,
                managed_process: process
                  ? {
                      name: process.name,
                      pm_id: process.pm_id,
                      status: process.status,
                      cpu: process.monit?.cpu ?? 0,
                      memory: process.monit?.memory ?? 0,
                    }
                  : null,
              };
            }),
          );
        }
      } catch (error) {
        console.error(error);
        if (!disposed) setLoadFailed(true);
      } finally {
        refreshing = false;
        if (!disposed) setLoading(false);
      }
    };
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const interval = window.setInterval(refreshVisible, 5000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);

  const filteredProjects = projects
    .filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aRunning = getProjectStatus(a).tone === 'progress';
      const bRunning = getProjectStatus(b).tone === 'progress';
      if (aRunning !== bRunning) return aRunning ? -1 : 1;

      const aLatest =
        a.latest_build?.created_at ?? a.latest_deployment?.activated_at ?? a.created_at;
      const bLatest =
        b.latest_build?.created_at ?? b.latest_deployment?.activated_at ?? b.created_at;
      return Date.parse(bLatest) - Date.parse(aLatest);
    });
  const countByTone = (tone: ReturnType<typeof getProjectStatus>['tone']) =>
    projects.filter((project) => getProjectStatus(project).tone === tone).length;
  const summary = [
    { label: 'ready', count: countByTone('success'), dot: 'bg-emerald-500', pulse: false },
    { label: 'in progress', count: countByTone('progress'), dot: 'bg-amber-500', pulse: true },
    {
      label: countByTone('error') === 1 ? 'needs attention' : 'need attention',
      count: countByTone('error'),
      dot: 'bg-red-500',
      pulse: false,
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="page-width space-y-7 pb-16 pt-8 sm:space-y-8 sm:pt-10">
      <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-heading">Projects</h1>
          {projects.length > 0 ? (
            <p
              role="status"
              className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
            >
              <span>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
              {summary.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-2">
                  <span className="relative flex size-2">
                    {item.pulse && (
                      <span
                        className={cn(
                          'absolute inline-flex size-full animate-ping rounded-full opacity-60',
                          item.dot,
                        )}
                      />
                    )}
                    <span className={cn('relative inline-flex size-2 rounded-full', item.dot)} />
                  </span>
                  {item.count} {item.label}
                </span>
              ))}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Your apps, builds, and production services in one place.
            </p>
          )}
        </div>
        {projects.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects"
              aria-label="Search projects"
              className="h-10 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </header>

      {loading ? (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          role="status"
          aria-label="Loading projects"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      ) : loadFailed && projects.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="size-5 text-muted-foreground" />}
          title="Couldn't load your projects"
          description="We couldn't reach the Shipyard API. This page keeps retrying."
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Rocket className="size-5 text-muted-foreground" />}
          title="Deploy your first project"
          description="Connect a GitHub repository or a Git URL, then review the build settings before it goes live."
          action={
            <Button asChild>
              <Link href="/projects/new">
                <Plus className="size-4" />
                New project
              </Link>
            </Button>
          }
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5 text-muted-foreground" />}
          title="No matching projects"
          description={`Nothing matches "${search}".`}
          action={
            <Button variant="outline" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-5 py-20 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-lg border border-border bg-surface-muted">
        {icon}
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
