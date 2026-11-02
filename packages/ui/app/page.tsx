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
        const latest = await api.getProjects();
        if (!disposed) setProjects(latest);
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
    <div className="pb-24">
      {/* Sits below the 68px sticky navbar rather than sliding under it. */}
      <header className="sticky top-[68px] z-10 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Overview</h1>
            <div className="flex items-center gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  className="h-9 pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button asChild className="h-9 gap-2">
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Add New...</span>
                  <span className="sm:hidden">New</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted/20 py-24 text-center">
            <div className="mb-4 grid size-14 place-items-center rounded-full border border-border bg-surface-muted">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">No projects found</h3>
            <p className="mb-6 max-w-sm text-muted-foreground">
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
                className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
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
