'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ProjectCard } from '@/components/project-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/lib/types';
import { getProjectStatus } from '@/lib/project-status';
import { pm0Api } from '@/lib/pm0-api';

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
  const runningProjects = filteredProjects.filter(
    (project) => getProjectStatus(project).tone === 'progress',
  );

  return (
    <div className="page-width space-y-7 pb-16 pt-8 sm:space-y-8 sm:pt-10">
      <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2">Deployment workspace</p>
          <h1 className="page-heading">Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your apps, builds, and production services in one place.
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects"
              aria-label="Search projects"
              className="h-10 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button asChild className="h-10 shrink-0 gap-2 px-3 sm:px-4">
            <Link href="/projects/new">
              <Plus className="size-4" />
              <span className="hidden sm:inline">New project</span>
              <span className="sm:hidden">New</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-5 py-20 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface-muted">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">No projects found</h3>
            <p className="mb-6 mt-1 max-w-sm text-sm text-muted-foreground">
              {search
                ? `No projects matching "${search}"`
                : 'Get started by creating your first project.'}
            </p>
            {search ? (
              <Button variant="outline" onClick={() => setSearch('')}>
                Clear Search
              </Button>
            ) : (
              <Button asChild>
                <Link href="/projects/new">Create Project</Link>
              </Button>
            )}
          </div>
        ) : (
          <>
            {runningProjects.length > 0 && (
              <div
                role="status"
                className="flex items-center gap-3 rounded-xl border border-brand-500/25 bg-brand-500/5 px-4 py-3"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-40" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {runningProjects.length === 1
                    ? 'A build or deployment is currently running'
                    : `${runningProjects.length} builds or deployments are currently running`}
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
