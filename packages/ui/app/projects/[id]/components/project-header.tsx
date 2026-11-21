'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronRight,
  Copy,
  GitBranch,
  Loader2,
  Lock,
  MoreHorizontal,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { Github } from '@/components/icons';
import { ProjectAvatar } from '@/components/projects/project-avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { copyText } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusLabel } from '@/components/ui/status';
import { siteUrl } from '@/lib/format';
import { getFrameworkOption } from '@/lib/framework-config';
import type { ActiveDeployment } from '@/lib/queries';
import type { Project } from '@/lib/types';
import type { ProjectState } from '../project-state';

export function ProjectHeader({
  project,
  state,
  activeDeployment,
  onDeploy,
  onRedeploy,
  onStop,
}: {
  project: Project;
  state: ProjectState;
  activeDeployment: ActiveDeployment | null;
  onDeploy: () => void;
  onRedeploy: () => void;
  onStop: () => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const url = siteUrl(project);
  const framework = getFrameworkOption(project.app_type)?.label ?? project.app_type;
  const meta = 'inline-flex min-w-0 items-center gap-1.5';

  return (
    <div className="page-width pt-5 pb-5 sm:pt-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-[13px] text-muted-foreground"
      >
        <Link href="/" className="rounded-sm hover:text-foreground">
          Projects
        </Link>
        <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
        <span className="truncate text-foreground/80" aria-current="page">
          {project.name}
        </span>
      </nav>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <ProjectAvatar domain={project.domain} appType={project.app_type} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {project.name}
            </h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
              <StatusLabel tone={state.tone} pulse={state.busy} className="text-[13px]">
                {state.label}
              </StatusLabel>
              {project.domain &&
                (state.live && url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={`${meta} max-w-72 text-foreground/90 hover:underline`}
                  >
                    <span className="truncate">{project.domain}</span>
                    <ArrowUpRight className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className={`${meta} max-w-72`}>
                    <span className="truncate">{project.domain}</span>
                  </span>
                ))}
              <span className={meta}>
                <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono text-xs">
                  {project.github_branch || 'main'}
                </span>
              </span>
              <span className="hidden sm:inline">{framework}</span>
              {project.access_protected && (
                <span className={meta} title="Visitors need a password to open the site">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Protected
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {url && state.live && (
            <Button variant="outline" asChild className="flex-1 sm:flex-none">
              <a href={url} target="_blank" rel="noreferrer">
                Visit
                <ArrowUpRight />
              </a>
            </Button>
          )}
          <Button onClick={onDeploy} disabled={state.busy} className="flex-1 sm:flex-none">
            {state.busy ? <Loader2 className="animate-spin" /> : <Play />}
            {state.busy ? 'Deploying' : 'Deploy'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More project actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {activeDeployment && (
                <DropdownMenuItem
                  disabled={state.busy}
                  onSelect={onRedeploy}
                  className="items-start"
                >
                  <RotateCcw className="mt-0.5" />
                  <div>
                    <p>Redeploy current build</p>
                    <p className="text-xs text-muted-foreground">
                      No rebuild. Picks up environment changes.
                    </p>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href={project.github_url} target="_blank" rel="noreferrer">
                  <Github className="size-4" />
                  Open repository
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText(project.id, 'Copied project ID')}>
                <Copy />
                Copy project ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {activeDeployment && (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmStop(true)}>
                  <Square />
                  Stop production
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" asChild>
                <Link href={`/projects/${project.id}?tab=settings#danger`}>
                  <Trash2 />
                  Delete project…
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop production for {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app stops and {project.domain ?? 'its address'} stops answering until you deploy
              again. Builds and settings are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onStop}
            >
              Stop production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
