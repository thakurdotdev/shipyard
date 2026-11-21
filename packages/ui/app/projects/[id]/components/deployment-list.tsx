'use client';

import { useState } from 'react';
import {
  Copy,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Trash2,
  Upload,
} from 'lucide-react';
import { LogViewer } from '@/components/log-viewer/log-viewer';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusDot, TONE_TEXT } from '@/components/ui/status';
import { commitTitle, formatDuration, timeAgo } from '@/lib/format';
import type { ActiveDeployment, BuildWithDeployment } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { buildStatus, type DeploymentEvent } from '../project-state';

/** Deploying an older build than the live one is a rollback, and is labelled as one. */
export function isRollback(
  build: BuildWithDeployment,
  builds: BuildWithDeployment[],
  activeDeployment: ActiveDeployment | null,
): boolean {
  const live = builds.find((item) => item.id === activeDeployment?.build_id);
  return !!live && Date.parse(build.created_at) < Date.parse(live.created_at);
}

export interface DeploymentRowProps {
  build: BuildWithDeployment;
  isLive: boolean;
  rollback: boolean;
  deploymentEvent?: DeploymentEvent | null;
  onLogs: () => void;
  onPromote: () => void;
  promoteDisabled?: boolean;
  /** Omitted where builds can't be deleted from, such as the overview. */
  onDelete?: () => void;
  deleting?: boolean;
  selection?: { selected: boolean; disabled: boolean; onToggle: () => void };
  compact?: boolean;
}

export function DeploymentRow({
  build,
  isLive,
  rollback,
  deploymentEvent,
  onLogs,
  onPromote,
  promoteDisabled,
  onDelete,
  deleting,
  selection,
  compact,
}: DeploymentRowProps) {
  const [confirmPromote, setConfirmPromote] = useState(false);
  const status = buildStatus(build, deploymentEvent);
  const shortId = build.id.slice(0, 8);
  const title = commitTitle(build.commit_message);
  const duration = formatDuration(build.created_at, build.completed_at);
  const canPromote = build.status === 'success' && !isLive && !status.busy;

  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 transition-colors hover:bg-surface-muted/30 sm:px-5 md:grid-cols-[7.5rem_minmax(0,1fr)_auto]',
        compact ? 'py-2.5' : 'py-3',
        selection && 'md:grid-cols-[1rem_7.5rem_minmax(0,1fr)_auto]',
      )}
    >
      {selection && (
        <input
          type="checkbox"
          checked={selection.selected}
          disabled={selection.disabled}
          onChange={selection.onToggle}
          aria-label={`Select build ${shortId}`}
          className="hidden size-3.5 cursor-pointer accent-brand-500 disabled:cursor-not-allowed disabled:opacity-30 md:block"
        />
      )}

      <div className="order-2 col-span-2 flex items-center gap-2 md:order-none md:col-span-1">
        <span
          className={cn(
            'inline-flex items-center gap-2 text-[13px]',
            status.tone === 'error' ? TONE_TEXT.error : 'text-foreground',
          )}
        >
          <StatusDot tone={status.tone} pulse={status.busy} />
          {status.label}
        </span>
        {isLive && (
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-px text-[11px] font-medium text-emerald-700 md:hidden dark:text-emerald-400">
            Production
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm text-foreground" title={build.commit_message ?? undefined}>
            {title ?? 'Manual deploy'}
          </p>
          {isLive && (
            <span className="hidden shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-px text-[11px] font-medium text-emerald-700 md:inline dark:text-emerald-400">
              Production
            </span>
          )}
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-x-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          {build.commit_sha && (
            <>
              <GitCommitHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="font-mono">{build.commit_sha.slice(0, 7)}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <time dateTime={build.created_at} title={new Date(build.created_at).toLocaleString()}>
            {timeAgo(build.created_at)}
          </time>
          {duration && (
            <span className="truncate" title="Build time">
              · {duration}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onLogs}
          aria-label={`Logs for build ${shortId}`}
        >
          <ScrollText />
          <span className="hidden sm:inline">Logs</span>
        </Button>
        {canPromote && (
          <Button
            variant="outline"
            size="sm"
            disabled={promoteDisabled}
            onClick={() => setConfirmPromote(true)}
            className="hidden sm:inline-flex"
          >
            {rollback ? <RotateCcw /> : <Upload />}
            {rollback ? 'Roll back' : 'Promote'}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground data-[state=open]:bg-accent"
              aria-label={`More actions for build ${shortId}`}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canPromote && (
              <DropdownMenuItem disabled={promoteDisabled} onSelect={() => setConfirmPromote(true)}>
                {rollback ? <RotateCcw /> : <Upload />}
                {rollback ? 'Roll back to this build' : 'Promote to production'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void copyText(build.id, 'Copied build ID')}>
              <Copy />
              Copy build ID
            </DropdownMenuItem>
            {build.commit_sha && (
              <DropdownMenuItem
                onSelect={() => void copyText(build.commit_sha!, 'Copied commit SHA')}
              >
                <GitCommitHorizontal />
                Copy commit SHA
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isLive || status.busy || deleting}
                  onSelect={onDelete}
                >
                  <Trash2 />
                  {isLive ? 'Live build can’t be deleted' : 'Delete build'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {rollback ? 'Roll back production?' : 'Promote this build to production?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {title ? `“${title}”` : `Build #${shortId}`}{' '}
              {rollback
                ? 'replaces the current deployment. The newer build stays available to promote again.'
                : 'replaces the current deployment once its release steps finish.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onPromote}>
              {rollback ? 'Roll back' : 'Promote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** One log sheet for a whole list; rows only say which build to show. */
export function BuildLogsSheet({
  build,
  onOpenChange,
}: {
  build: BuildWithDeployment | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!build} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[820px]">
        {build && (
          <>
            <SheetHeader className="border-b border-border p-4 pr-12 sm:p-5 sm:pr-12">
              <SheetTitle className="truncate text-base">
                {commitTitle(build.commit_message) ?? 'Manual deploy'}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                build {build.id.slice(0, 8)}
                {build.commit_sha && ` · commit ${build.commit_sha.slice(0, 7)}`} ·{' '}
                {new Date(build.created_at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden bg-console font-mono text-xs text-console-foreground">
              <LogViewer buildId={build.id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
