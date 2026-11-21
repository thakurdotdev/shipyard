'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { commitTitle, formatDuration, siteUrl, timeAgo } from '@/lib/format';
import type { ActiveDeployment, BuildWithDeployment } from '@/lib/queries';
import type { Project } from '@/lib/types';

type PreviewState = 'idle' | 'loading' | 'ready' | 'unavailable';

/** What production serves right now, with a live preview loaded only on request. */
export function ProductionPanel({
  project,
  activeDeployment,
  liveBuild,
  busy,
  onDeploy,
  onLogs,
}: {
  project: Project;
  activeDeployment: ActiveDeployment | null;
  liveBuild: BuildWithDeployment | undefined;
  busy: boolean;
  onDeploy: () => void;
  onLogs: (build: BuildWithDeployment) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [frameLoading, setFrameLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const requestFor = useRef<string | null>(null);
  const url = siteUrl(project);

  // A new deployment or a protection change invalidates the preview.
  useEffect(() => {
    setPreviewOpen(false);
    setPreviewUrl(null);
    setPreviewState('idle');
    requestFor.current = null;
  }, [activeDeployment?.id, project.access_protected]);

  const loadPreview = () => {
    if (!activeDeployment || previewState === 'loading' || previewState === 'ready') return;
    const deploymentId = activeDeployment.id;
    requestFor.current = deploymentId;
    setPreviewState('loading');
    setFrameLoading(true);
    api
      .configureProjectPreview(project.id)
      .then((result) => {
        if (requestFor.current !== deploymentId) return;
        setPreviewUrl(result.preview_url);
        setPreviewState(result.embeddable && result.preview_url ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (requestFor.current === deploymentId) setPreviewState('unavailable');
      });
  };

  if (!activeDeployment) {
    return (
      <Panel>
        <PanelHeader title="Production" />
        <EmptyState
          title="Nothing is deployed"
          description="Deploy builds the latest commit and puts it live. You can watch every step here."
          action={
            <Button onClick={onDeploy} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Play />}
              {busy ? 'Deploying' : 'Deploy now'}
            </Button>
          }
        />
      </Panel>
    );
  }

  const title = commitTitle(liveBuild?.commit_message);
  const duration = liveBuild && formatDuration(liveBuild.created_at, liveBuild.completed_at);

  return (
    <Panel>
      <PanelHeader
        title="Production"
        actions={
          <time
            className="text-xs text-muted-foreground"
            dateTime={activeDeployment.activated_at}
            title={new Date(activeDeployment.activated_at).toLocaleString()}
          >
            Released {timeAgo(activeDeployment.activated_at)}
          </time>
        }
      />

      <div className="space-y-3 px-4 py-4 sm:px-5">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-1.5 text-base font-medium text-foreground"
          >
            {project.access_protected && (
              <Lock
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Password protected"
              />
            )}
            <span className="truncate group-hover:underline">
              {project.domain ?? url.replace(/^https?:\/\//, '')}
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        )}
        <div className="min-w-0">
          <p
            className="truncate text-sm text-foreground/90"
            title={liveBuild?.commit_message ?? undefined}
          >
            {title ?? 'Manual deploy'}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {liveBuild?.commit_sha && (
              <span className="inline-flex items-center gap-1">
                <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
                <span className="font-mono">{liveBuild.commit_sha.slice(0, 7)}</span>
              </span>
            )}
            <span className="font-mono">build {activeDeployment.build_id.slice(0, 8)}</span>
            {duration && <span>built in {duration}</span>}
          </p>
        </div>
      </div>

      {previewOpen && (
        <div className="relative border-t border-border bg-surface-muted/30">
          {previewState === 'ready' && previewUrl ? (
            <>
              {frameLoading && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-surface-muted">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              <iframe
                key={frameKey}
                src={previewUrl}
                title={`${project.name} live preview`}
                className="block aspect-[16/10] max-h-[520px] w-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setFrameLoading(false)}
              />
            </>
          ) : (
            <div className="grid aspect-[16/10] max-h-[420px] w-full place-items-center px-6 text-center">
              <div>
                {previewState === 'loading' ? (
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <p className="text-sm font-medium">Preview isn’t available</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      {project.access_protected
                        ? 'The site is password protected, so it can’t be embedded here.'
                        : 'This site doesn’t allow being embedded.'}{' '}
                      Open it in a new tab instead.
                    </p>
                    {url && (
                      <Button variant="outline" size="sm" className="mt-4" asChild>
                        <a href={url} target="_blank" rel="noreferrer">
                          Open site <ArrowUpRight />
                        </a>
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <PanelFooter className="justify-start gap-1.5">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={previewOpen}
          onClick={() => {
            setPreviewOpen((open) => !open);
            if (!previewOpen) loadPreview();
          }}
        >
          {previewOpen ? <EyeOff /> : <Eye />}
          {previewOpen ? 'Hide preview' : 'Preview'}
        </Button>
        {previewOpen && previewState === 'ready' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrameLoading(true);
              setFrameKey((key) => key + 1);
            }}
          >
            <RefreshCw />
            Reload
          </Button>
        )}
        {previewOpen && previewState === 'unavailable' && (
          <Button variant="ghost" size="sm" onClick={loadPreview}>
            Try again
          </Button>
        )}
        {liveBuild && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={() => onLogs(liveBuild)}
          >
            <ScrollText />
            Build logs
          </Button>
        )}
      </PanelFooter>
    </Panel>
  );
}
