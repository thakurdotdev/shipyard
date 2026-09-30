'use client';

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  GitCommit,
  Loader2,
  Terminal,
  XCircle,
} from 'lucide-react';
import { LogViewer } from '@/components/log-viewer/log-viewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

interface ActivityListProps {
  builds: any[];
  activeDeployment: any;
  onActivateBuild: (buildId: string) => void;
  onViewAll: () => void;
}

export function ActivityList({
  builds,
  activeDeployment,
  onActivateBuild,
  onViewAll,
}: ActivityListProps) {
  const recentBuilds = builds.slice(0, 5);

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5 text-muted-foreground" /> Recent activity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">The latest builds for this project</p>
        </div>
        {builds.length > 5 && (
          <Button variant="ghost" size="sm" className="gap-2" onClick={onViewAll}>
            View all <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Card className="gap-0 overflow-hidden border-border bg-card p-0 shadow-sm">
        {recentBuilds.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-medium">No builds yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your project build activity will show here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentBuilds.map((build) => {
              const current = activeDeployment?.build_id === build.id;
              const success = build.status === 'success';
              const failed = build.status === 'failed';
              const summary = build.commit_message?.split('\n')[0] || 'Manual deployment';
              return (
                <div key={build.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                      success
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                        : failed
                          ? 'border-red-500/20 bg-red-500/10 text-red-400'
                          : 'border-blue-500/20 bg-blue-500/10 text-blue-400'
                    }`}
                  >
                    {success ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : failed ? (
                      <XCircle className="h-4 w-4" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                  </span>

                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        Build #{build.id.slice(0, 8)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`h-5 capitalize ${
                          success
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                            : failed
                              ? 'border-red-500/20 bg-red-500/10 text-red-400'
                              : ''
                        }`}
                      >
                        {build.status}
                      </Badge>
                      {current && (
                        <Badge variant="secondary" className="h-5">
                          Current production
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      {build.commit_sha && <GitCommit className="h-3.5 w-3.5 shrink-0" />}
                      {build.commit_sha && (
                        <span className="font-mono">{build.commit_sha.slice(0, 7)}</span>
                      )}
                      <span className="truncate">{summary}</span>
                      <span className="hidden shrink-0 sm:inline">
                        · {new Date(build.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    {success && !current && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => onActivateBuild(build.id)}
                      >
                        Promote
                      </Button>
                    )}
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="View build logs"
                        >
                          <Terminal className="h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="flex w-full flex-col gap-0 border-l p-0 sm:max-w-[800px]">
                        <SheetHeader className="border-b bg-surface-muted/10 p-4">
                          <SheetTitle className="font-mono text-base">
                            Build #{build.id.slice(0, 8)}
                          </SheetTitle>
                          <SheetDescription>Build and deployment logs</SheetDescription>
                        </SheetHeader>
                        <div className="flex-1 overflow-hidden bg-console font-mono text-xs text-console-foreground">
                          <LogViewer buildId={build.id} />
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
