'use client';

import { ArrowRight, DatabaseZap, FolderGit2, FolderRoot, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FrameworkIcon } from '@/components/ui/framework-icons';
import { RepoFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

export type { RepoFolder };

interface DirectoryStepProps {
  repoName: string;
  folders: RepoFolder[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (folder: RepoFolder) => void;
}

function FolderSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="size-10 animate-pulse rounded-lg bg-surface-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-3 w-48 animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}

/** Pick which app inside the repository to deploy. Monorepos list every package. */
export function DirectoryStep({
  repoName,
  folders,
  loading,
  error,
  onRetry,
  onSelect,
}: DirectoryStepProps) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Which app should we deploy?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We scanned <span className="font-medium text-foreground">{repoName}</span> for apps. Each
          one becomes its own project.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Scanning repository">
          <FolderSkeleton />
          <FolderSkeleton />
          <p className="pt-1 text-center text-xs text-muted-foreground">
            Detecting frameworks and migrations…
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        </div>
      ) : !folders?.length ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <FolderGit2 className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No deployable app found</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            We look for a <code className="font-mono">package.json</code> or{' '}
            <code className="font-mono">go.mod</code> at the root and in common monorepo folders
            (apps/, packages/, services/).
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            <RefreshCw className="size-3.5" /> Scan again
          </Button>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {folders.map((folder) => {
            const isRoot = folder.path === './';
            return (
              <li key={folder.path}>
                <button
                  type="button"
                  onClick={() => onSelect(folder)}
                  className="group flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-foreground/25 hover:bg-surface-muted/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted">
                    {folder.framework ? (
                      <FrameworkIcon icon={folder.frameworkInfo.icon} size={22} />
                    ) : isRoot ? (
                      <FolderRoot className="size-5 text-muted-foreground" />
                    ) : (
                      <FolderGit2 className="size-5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {folder.name}
                      </span>
                      <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {isRoot ? 'repository root' : folder.path}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px]',
                          folder.framework
                            ? 'border-border bg-surface-muted/60 text-foreground/80'
                            : 'border-dashed border-border text-muted-foreground',
                        )}
                        title={folder.detectionReason}
                      >
                        {folder.framework
                          ? (folder.runtimeVersion ?? folder.frameworkInfo.name)
                          : 'Framework not detected'}
                      </span>
                      {folder.preDeploy && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-800 dark:text-brand-300"
                          title={folder.preDeploy.command}
                        >
                          <DatabaseZap className="size-3" /> Migrations
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
