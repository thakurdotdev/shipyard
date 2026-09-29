'use client';

import { useState } from 'react';
import { Search, Loader2, GitFork, Lock, Globe, ArrowRight, Calendar, Code2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface GitRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  updated_at?: string;
  description?: string | null;
  language?: string | null;
}

interface RepositoryListProps {
  repositories: GitRepository[];
  loading: boolean;
  onSelect: (repo: GitRepository) => void;
}

function formatDate(dateString?: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RepositoryList({ repositories, loading, onSelect }: RepositoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRepos = repositories.filter((r) =>
    r.full_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Select Repository
        </h2>
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted/20 p-12">
          <Loader2 className="mb-2 size-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading repositories...</span>
        </div>
      ) : (
        <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2">
          {filteredRepos.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted/20 p-12 text-muted-foreground">
              <span className="text-sm">No repositories found matching "{searchQuery}"</span>
            </div>
          ) : (
            filteredRepos.map((repo) => (
              <div
                key={repo.id}
                className="group flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface-muted/20 p-4 transition-colors duration-200 hover:border-border-strong hover:bg-surface sm:flex-row sm:items-center sm:gap-0"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted">
                    {repo.private ? (
                      <Lock className="size-4 text-muted-foreground" />
                    ) : (
                      <Globe className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-medium text-foreground">
                        {repo.name}
                      </span>
                      {repo.private && (
                        <Badge variant="outline" className="h-4 rounded px-1 text-[10px]">
                          Private
                        </Badge>
                      )}
                    </div>

                    {repo.description && (
                      <p className="max-w-[400px] truncate text-sm text-muted-foreground">
                        {repo.description}
                      </p>
                    )}

                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      {repo.language && (
                        <span className="flex items-center gap-1">
                          <span className="size-2 rounded-full bg-border-strong" />
                          {repo.language}
                        </span>
                      )}

                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDate(repo.updated_at)}
                      </span>

                      {repo.default_branch && (
                        <span className="flex items-center gap-1 rounded-full border border-border bg-surface-muted/60 px-1.5 py-0.5">
                          <GitFork className="size-3" />
                          {repo.default_branch}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full transition-opacity duration-200 sm:w-auto sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  onClick={() => onSelect(repo)}
                >
                  Import <ArrowRight className="size-3.5 opacity-60" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
