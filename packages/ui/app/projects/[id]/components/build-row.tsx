'use client';

import { useState } from 'react';
import { CheckCircle2, GitCommit, Loader2, Terminal, Trash2, XCircle } from 'lucide-react';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { formatDuration, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const PIPELINE_STATUSES = [
  'dns_creating',
  'dns_created',
  'ssl_issuing',
  'ssl_issued',
  'nginx_configuring',
  'nginx_configured',
  'app_starting',
  'health_checking',
  'pending',
];

export const isPipelineStatus = (status: string) => PIPELINE_STATUSES.includes(status);

const DEPLOY_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  dns_creating: 'DNS setup',
  dns_created: 'DNS ready',
  ssl_issuing: 'SSL issuing',
  ssl_issued: 'SSL ready',
  nginx_configuring: 'Configuring',
  nginx_configured: 'Configured',
  app_starting: 'Starting',
  health_checking: 'Health check',
  active: 'Active',
  inactive: 'Inactive',
  failed: 'Failed',
  activating: 'Activating',
};

export const getDeployStatusLabel = (status: string) =>
  DEPLOY_STATUS_LABELS[status] || status.replaceAll('_', ' ');

/** Deploying an older build than the live one is a rollback, and is labelled as one. */
export function getPromotionLabel(
  build: any,
  builds: any[],
  activeDeployment: any,
): 'Deploy' | 'Rollback' {
  const current = builds.find((item) => item.id === activeDeployment?.build_id);
  return !current || new Date(build.created_at) > new Date(current.created_at)
    ? 'Deploy'
    : 'Rollback';
}

const TONE = {
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  error: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
  progress: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  neutral: 'border-border bg-surface-muted text-muted-foreground',
};

function StatusPill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

function deployTone(status: string): keyof typeof TONE {
  if (status === 'active') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'inactive') return 'neutral';
  return 'progress';
}

interface BuildRowProps {
  build: any;
  isCurrent: boolean;
  promotionLabel: 'Deploy' | 'Rollback';
  promoting?: boolean;
  promoteDisabled?: boolean;
  onPromote: () => void;
  /** Omit where builds can't be deleted from, such as the overview. */
  onDelete?: () => void;
  deleting?: boolean;
  deleteDisabled?: boolean;
  /** Present on lists that support bulk selection. */
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function BuildRow({
  build,
  isCurrent,
  promotionLabel,
  promoting,
  promoteDisabled,
  onPromote,
  onDelete,
  deleting,
  deleteDisabled,
  selected,
  onToggleSelect,
}: BuildRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const shortId = build.id.slice(0, 8);
  const success = build.status === 'success';
  const failed = build.status === 'failed';
  const tone = success ? 'success' : failed ? 'error' : 'progress';
  const deployStatus = build.deployment_status as string | undefined;
  const deployBusy =
    !!deployStatus && (isPipelineStatus(deployStatus) || deployStatus === 'activating');
  const duration = formatDuration(build.created_at, build.completed_at);
  const rollback = promotionLabel === 'Rollback';

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/30 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        {onToggleSelect !== undefined &&
          (onDelete && !isCurrent ? (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              disabled={deleteDisabled}
              aria-label={`Select build ${shortId}`}
              className="mt-2.5 size-4 shrink-0 cursor-pointer rounded border-border accent-brand-500 sm:mt-0"
            />
          ) : (
            // Keeps rows aligned where the build can't be deleted.
            <span className="size-4 shrink-0" aria-hidden="true" />
          ))}
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg border',
            TONE[tone],
          )}
          aria-hidden="true"
        >
          {success ? (
            <CheckCircle2 className="size-4" />
          ) : failed ? (
            <XCircle className="size-4" />
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-medium">#{shortId}</span>
            <StatusPill tone={tone}>
              <span className="capitalize">{build.status}</span>
            </StatusPill>
            {deployStatus &&
              !isCurrent &&
              deployStatus !== 'inactive' &&
              deployStatus !== 'active' && (
                <StatusPill tone={deployTone(deployStatus)}>
                  {deployBusy && <Loader2 className="size-3 animate-spin" />}
                  Deploy {getDeployStatusLabel(deployStatus).toLowerCase()}
                </StatusPill>
              )}
            {isCurrent && (
              <StatusPill tone="success">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                In production
              </StatusPill>
            )}
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {build.commit_sha ? (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                <GitCommit className="size-3 shrink-0" />
                <span className="font-mono">{build.commit_sha.slice(0, 7)}</span>
                {build.commit_message && (
                  <span className="min-w-0 truncate sm:max-w-80" title={build.commit_message}>
                    {build.commit_message.split('\n')[0]}
                  </span>
                )}
              </span>
            ) : (
              <span>Manual deploy</span>
            )}
            <span className="shrink-0 whitespace-nowrap">
              <time dateTime={build.created_at} title={new Date(build.created_at).toLocaleString()}>
                {timeAgo(build.created_at)}
              </time>
              {duration && <span title="Build time"> · built in {duration}</span>}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {onDelete && !isCurrent && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
            aria-label={`Delete build ${shortId}`}
            title="Delete build and free its disk space"
            disabled={deleteDisabled}
            onClick={onDelete}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        )}

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
              <Terminal className="size-3.5" />
              Logs
              <span className="sr-only"> for build {shortId}</span>
            </Button>
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col gap-0 border-l p-0 sm:max-w-[800px]">
            <SheetHeader className="border-b bg-surface-muted/10 p-4">
              <SheetTitle className="font-mono text-base">Build #{shortId}</SheetTitle>
              <SheetDescription>Build and deployment logs</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-hidden bg-console font-mono text-xs text-console-foreground">
              <LogViewer buildId={build.id} />
            </div>
          </SheetContent>
        </Sheet>

        {success && !isCurrent && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={promoteDisabled}
            onClick={() => setConfirmOpen(true)}
          >
            {promoting && <Loader2 className="size-3 animate-spin" />}
            {promotionLabel}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {rollback ? `Roll back to build #${shortId}?` : `Deploy build #${shortId}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rollback
                ? 'Production switches to this older build. You can deploy the newer build again afterwards.'
                : 'Production switches to this build once its deployment steps finish.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onPromote}>
              {rollback ? 'Roll back' : 'Deploy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
