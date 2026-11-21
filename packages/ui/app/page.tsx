'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, Plus } from 'lucide-react';
import { ProjectRow, ProjectRowSkeleton } from '@/components/projects/project-row';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Panel } from '@/components/ui/panel';
import { SearchField } from '@/components/ui/search-field';
import { getProjectStatus } from '@/lib/project-status';
import { projectProcess, useProcessList, useProjects } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { useUrlState } from '@/lib/use-url-state';

const FILTERS = ['all', 'live', 'deploying', 'issues', 'idle'] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ['activity', 'name'] as const;
type Sort = (typeof SORTS)[number];

const TONE_FILTER: Record<ReturnType<typeof getProjectStatus>['tone'], Filter> = {
  success: 'live',
  progress: 'deploying',
  error: 'issues',
  neutral: 'idle',
};

/** In-flight work first, then problems, then everything by latest activity. */
const ATTENTION: Record<Filter, number> = { deploying: 0, issues: 1, live: 2, idle: 3, all: 4 };

function lastActivity(project: Project): number {
  return Date.parse(
    project.latest_build?.created_at ??
      project.latest_deployment?.activated_at ??
      project.created_at,
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const projectsQuery = useProjects();
  // Failing to reach PM0 only hides runtime figures; it never blocks the list.
  const { data: pm0 } = useProcessList();
  const [query, setQuery] = useUrlState('q', '');
  const [filter, setFilter] = useUrlState<Filter>('status', 'all', FILTERS);
  const [sort, setSort] = useUrlState<Sort>('sort', 'activity', SORTS);

  const projects = projectsQuery.data;
  const rows = useMemo(
    () =>
      (projects ?? []).map((project) => {
        const status = getProjectStatus(project);
        return { project, status, group: TONE_FILTER[status.tone] };
      }),
    [projects],
  );

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: rows.length,
      live: 0,
      deploying: 0,
      issues: 0,
      idle: 0,
    };
    rows.forEach((row) => result[row.group]++);
    return result;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => filter === 'all' || row.group === filter)
      .filter(
        ({ project }) =>
          !needle ||
          [project.name, project.domain, project.github_repo_full_name, project.github_branch]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(needle)),
      )
      .sort((a, b) =>
        sort === 'name'
          ? a.project.name.localeCompare(b.project.name)
          : ATTENTION[a.group] - ATTENTION[b.group] ||
            lastActivity(b.project) - lastActivity(a.project),
      );
  }, [rows, filter, query, sort]);

  const filtered = query.trim() !== '' || filter !== 'all';
  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <div className="page-width pt-7 pb-16 sm:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-heading">Projects</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {projects
              ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} on this server`
              : 'Your apps, builds and production services.'}
          </p>
        </div>
      </header>

      {projectsQuery.isLoading ? (
        <Panel className="mt-6" role="status" aria-label="Loading projects">
          {Array.from({ length: 5 }, (_, index) => (
            <ProjectRowSkeleton key={index} />
          ))}
        </Panel>
      ) : !projects ? (
        <Panel className="mt-6">
          <EmptyState
            title="Couldn't load your projects"
            description="The Shipyard API didn't answer. This page keeps retrying in the background."
            action={
              <Button variant="outline" size="sm" onClick={() => void projectsQuery.refresh()}>
                Try again
              </Button>
            }
          />
        </Panel>
      ) : projects.length === 0 ? (
        <Panel className="mt-6">
          <EmptyState
            title="No projects yet"
            description="Connect a GitHub repository or a Git URL. You review the build settings before anything goes live."
            action={
              <Button asChild>
                <Link href="/projects/new">
                  <Plus className="size-4" />
                  New project
                </Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterTabs
              label="Filter projects by status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'live', label: 'Live', count: counts.live, tone: 'success' },
                {
                  value: 'deploying',
                  label: 'Deploying',
                  count: counts.deploying,
                  tone: 'progress',
                },
                { value: 'issues', label: 'Issues', count: counts.issues, tone: 'error' },
                { value: 'idle', label: 'Idle', count: counts.idle, tone: 'neutral' },
              ]}
            />
            <div className="flex items-center gap-2">
              <SearchField
                className="min-w-0 flex-1 sm:w-64 sm:flex-none"
                value={query}
                onChange={setQuery}
                onSubmit={() => {
                  if (visible.length === 1) router.push(`/projects/${visible[0].project.id}`);
                }}
                placeholder="Search name, domain, repo"
                label="Search projects"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Sort projects" title="Sort">
                    <ArrowDownUp className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Sort by
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                    <DropdownMenuRadioItem value="activity">Needs attention</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Panel className="mt-3">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1.5fr)_8rem_minmax(0,1.5fr)_7.5rem_5.5rem_2.25rem] items-center gap-4 border-b border-border bg-surface-muted/40 px-5 py-2 text-xs text-muted-foreground lg:grid"
            >
              <span>Project</span>
              <span>Status</span>
              <span>Latest commit</span>
              <span>Runtime</span>
              <span className="text-right">Updated</span>
              <span />
            </div>
            {visible.length === 0 ? (
              <EmptyState
                title="No projects match"
                description={
                  query
                    ? `Nothing matches “${query}” with this filter.`
                    : 'Nothing has this status.'
                }
                action={
                  filtered && (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {visible.map(({ project, status }) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    status={status}
                    process={projectProcess(pm0?.processes, project.id)}
                    onChanged={() => void projectsQuery.refresh()}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
