'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  StopCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

interface ActiveDeploymentCardProps {
  activeDeployment: any;
  builds?: any[];
  project: any;
  onStopDeployment: () => void;
}

type PreviewState = 'idle' | 'loading' | 'ready' | 'unavailable';

export function ActiveDeploymentCard({
  activeDeployment,
  builds = [],
  project,
  onStopDeployment,
}: ActiveDeploymentCardProps) {
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [frameLoading, setFrameLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const previewRequest = useRef<{ deploymentId: string; promise: Promise<void> } | null>(null);
  const currentDeploymentId = useRef<string | undefined>(activeDeployment?.id);
  currentDeploymentId.current = activeDeployment?.id;

  const deploymentUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : null;

  const liveBuild = builds.find((build) => build.id === activeDeployment?.build_id);

  useEffect(() => {
    setPreviewUrl(null);
    setPreviewState('idle');
    setFrameLoading(true);
    setFrameKey(0);
    previewRequest.current = null;
    setPreviewOpen(false);
  }, [activeDeployment?.id]);

  const loadPreview = () => {
    if (!activeDeployment || previewState === 'loading' || previewState === 'ready') return;
    const deploymentId = activeDeployment.id;
    const existingRequest = previewRequest.current;
    if (existingRequest && existingRequest.deploymentId === deploymentId) {
      void existingRequest.promise;
      return;
    }

    setPreviewState('loading');
    setFrameLoading(true);
    const request = { deploymentId, promise: Promise.resolve() };
    const promise = api
      .configureProjectPreview(project.id)
      .then((result) => {
        if (currentDeploymentId.current !== deploymentId || previewRequest.current !== request)
          return;
        setPreviewUrl(result.preview_url);
        setPreviewState(result.embeddable && result.preview_url ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (currentDeploymentId.current !== deploymentId || previewRequest.current !== request)
          return;
        setPreviewUrl(null);
        setPreviewState('unavailable');
      });
    request.promise = promise;
    previewRequest.current = request;
  };

  const stopDeployment = () => {
    onStopDeployment();
    setStopDialogOpen(false);
  };

  if (!activeDeployment) {
    return (
      <Card className="flex flex-col gap-4 border-dashed border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-xl border border-border bg-surface-muted p-2.5 text-muted-foreground">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-semibold">No production deployment</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Press Deploy to publish this project and enable its live preview.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden border-border bg-card py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-lg border border-border bg-surface-muted p-2 text-muted-foreground">
              <Globe className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold">Production</h2>
            {project?.uptime_status === 'down' && (
              <Badge variant="destructive" className="h-5 text-[11px]">
                Service down
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
            onClick={() => setStopDialogOpen(true)}
          >
            <StopCircle className="h-3.5 w-3.5" /> Stop
            <span className="-ml-0.5 hidden sm:inline">deployment</span>
          </Button>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-px border-t border-border bg-border">
          <div className="min-w-0 bg-card px-4 py-3 sm:px-5">
            <dt className="text-[11px] text-muted-foreground">Released</dt>
            <dd
              className="mt-0.5 truncate text-sm font-medium"
              title={new Date(activeDeployment.activated_at).toLocaleString()}
            >
              {timeAgo(activeDeployment.activated_at)}
            </dd>
          </div>
          <div className="min-w-0 bg-card px-4 py-3 sm:px-5">
            <dt className="text-[11px] text-muted-foreground">Build</dt>
            <dd className="mt-0.5 flex min-w-0 items-baseline gap-2 text-sm">
              <span className="shrink-0 font-mono font-medium">
                #{activeDeployment.build_id?.slice(0, 8)}
              </span>
              {liveBuild?.commit_message && (
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={liveBuild.commit_message}
                >
                  {liveBuild.commit_message.split('\n')[0]}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <Collapsible
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open);
            if (open) loadPreview();
          }}
        >
          <div className="border-t border-border bg-surface-muted/20 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Live preview</p>
                <p className="text-xs text-muted-foreground">
                  Load an embedded preview when you need it.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {previewOpen && previewState === 'unavailable' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      previewRequest.current = null;
                      setPreviewState('idle');
                      loadPreview();
                    }}
                  >
                    Retry
                  </Button>
                )}
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    {previewOpen ? 'Hide preview' : 'Show preview'}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>

          <CollapsibleContent>
            <div className="relative min-h-[260px] overflow-hidden border-t border-border bg-surface-muted/30 sm:min-h-[420px]">
              {previewState === 'ready' && previewUrl ? (
                <>
                  {frameLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-muted">
                      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <iframe
                    key={frameKey}
                    src={previewUrl}
                    title={`${project.name} live preview`}
                    className="h-[260px] w-full border-0 bg-white sm:h-[420px]"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    referrerPolicy="strict-origin-when-cross-origin"
                    onLoad={() => setFrameLoading(false)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute right-3 top-3 z-20 gap-2 shadow"
                    onClick={() => {
                      setFrameLoading(true);
                      setFrameKey((value) => value + 1);
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center sm:min-h-[420px]">
                  <span className="mb-3 surface-card rounded-xl border border-border bg-card p-3 text-muted-foreground">
                    {previewState === 'loading' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Globe className="h-5 w-5" />
                    )}
                  </span>
                  <h3 className="font-medium text-foreground">
                    {previewState === 'loading' ? 'Preparing preview' : 'Preview unavailable'}
                  </h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    {previewState === 'loading'
                      ? 'Connecting to the secure preview route.'
                      : 'This site cannot be embedded. You can still open it in a new tab.'}
                  </p>
                  {deploymentUrl && previewState === 'unavailable' && (
                    <Button variant="outline" size="sm" className="mt-4 gap-2" asChild>
                      <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">
                        Open live site <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop active deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the running application and make its live URL unavailable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={stopDeployment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop deployment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
