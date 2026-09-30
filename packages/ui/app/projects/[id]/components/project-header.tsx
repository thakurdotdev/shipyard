'use client';

import Link from 'next/link';
import { Activity, ArrowUpRight, Code2, GitBranch, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Github } from '@/components/icons';

interface ProjectHeaderProps {
  project: any;
  activeDeployment: any;
  isDeploying: boolean;
  onTriggerBuild: () => Promise<void>;
}

export function ProjectHeader({
  project,
  activeDeployment,
  isDeploying,
  onTriggerBuild,
}: ProjectHeaderProps) {
  const liveUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : null;

  return (
    <header className="sticky top-[68px] z-20 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <nav className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/" className="transition-colors hover:text-foreground">
                Projects
              </Link>
              <span aria-hidden="true">/</span>
              <span className="truncate text-foreground/80">{project.name}</span>
            </nav>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {project.name}
              </h1>
              <Badge variant="outline" className="gap-1.5 font-normal capitalize">
                <Code2 className="h-3 w-3" /> {project.app_type}
              </Badge>
              <Badge
                variant="outline"
                className={
                  activeDeployment
                    ? 'gap-1.5 border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'gap-1.5 text-muted-foreground'
                }
              >
                <Activity className="h-3 w-3" />
                {activeDeployment ? 'Production live' : 'Not deployed'}
              </Badge>
              {project.github_branch && (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
                  <GitBranch className="h-3.5 w-3.5" /> {project.github_branch}
                </span>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={project.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-2"
              >
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">Repository</span>
              </a>
            </Button>
            {activeDeployment && liveUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                  Visit <ArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() =>
                toast.promise(onTriggerBuild(), {
                  loading: 'Starting deployment...',
                  success: 'Deployment started',
                  error: 'Failed to start deployment',
                })
              }
              disabled={isDeploying}
              className="gap-2"
            >
              {isDeploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Deploy</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
