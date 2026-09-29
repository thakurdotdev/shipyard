'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ProjectCard } from '@/components/project-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function Home() {
  const [projects, setProjects] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()),
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
