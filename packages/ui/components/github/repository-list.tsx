'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, GitBranch, Lock, RefreshCw, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GitRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  updated_at?: string;
  pushed_at?: string;
  description?: string | null;
  language?: string | null;
}

interface RepositoryListProps {
  repositories: GitRepository[];
  loading: boolean;
  onSelect: (repo: GitRepository) => void;
  onRefresh?: () => void;
  onManageAccess?: () => void;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Go: '#00ADD8',
  Python: '#3572A5',
  Rust: '#dea584',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  MDX: '#fcb32c',
};

function relativeTime(dateString?: string) {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RepoSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="h-3 w-64 max-w-full animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}

export function RepositoryList({
  repositories,
  loading,
  onSelect,
  onRefresh,
  onManageAccess,
}: RepositoryListProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search, as on GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? repositories.filter(
          (r) => r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
        )
      : [...repositories];
    return list.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : new Date(b.pushed_at ?? b.updated_at ?? 0).getTime() -
          new Date(a.pushed_at ?? a.updated_at ?? 0).getTime(),
    );
  }, [repositories, query, sort]);

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Pick a repository</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? 'Loading repositories…'
              : `${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'} available`}
          </p>
        </div>
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Reload repositories"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Reload</span>
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search repositories"
            className="pl-9 pr-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length === 1) onSelect(filtered[0]);
              if (e.key === 'Escape') setQuery('');
            }}
            aria-label="Search repositories"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-muted px-1.5 text-[10px] text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Sort repositories"
          className="inline-flex shrink-0 rounded-xl border border-border bg-surface-muted p-0.5 text-xs"
        >
          {(['recent', 'name'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sort === value}
              onClick={() => setSort(value)}
              className={cn(
                'rounded-lg px-2.5 font-medium transition-colors',
                sort === value
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'recent' ? 'Recent' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <RepoSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-foreground">
              {query ? `No repositories match “${query}”` : 'No repositories yet'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Missing one? The GitHub App may not have access to it.
            </p>
            {onManageAccess && (
              <Button variant="outline" size="sm" className="mt-4" onClick={onManageAccess}>
                Manage repository access
              </Button>
            )}
          </div>
        ) : (
          <ul className="max-h-none divide-y divide-border sm:max-h-[min(560px,60vh)] sm:overflow-y-auto">
            {filtered.map((repo) => (
              <li key={repo.id}>
                <button
                  type="button"
                  onClick={() => onSelect(repo)}
                  className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none active:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {repo.name}
                      </span>
                      {repo.private && (
                        <Lock
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Private"
                        />
                      )}
                    </span>
                    {repo.description && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {repo.description}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {repo.language && (
                        <span className="flex items-center gap-1">
                          <span
                            className="size-2 rounded-full"
                            style={{
                              background: LANGUAGE_COLORS[repo.language] ?? 'var(--border-strong)',
                            }}
                          />
                          {repo.language}
                        </span>
                      )}
                      {repo.default_branch && (
                        <span className="flex items-center gap-1">
                          <GitBranch className="size-3" />
                          {repo.default_branch}
                        </span>
                      )}
                      {(repo.pushed_at || repo.updated_at) && (
                        <span>Updated {relativeTime(repo.pushed_at ?? repo.updated_at)}</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
