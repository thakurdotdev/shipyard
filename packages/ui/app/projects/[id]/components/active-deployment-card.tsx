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
  project: any;
  onStopDeployment: () => void;
}

type PreviewState = 'idle' | 'loading' | 'ready' | 'unavailable';

export function ActiveDeploymentCard({
  activeDeployment,
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
              Deploy a build to publish this project and enable its live preview.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden border-border bg-card py-0 shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 rounded-xl border border-border bg-surface-muted p-2.5 text-muted-foreground">
              <Globe className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Current production</h2>
                {project?.uptime_status === 'down' && (
                  <Badge variant="destructive" className="h-5 text-[11px]">
                    Service down
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Released {new Date(activeDeployment.activated_at).toLocaleString()}</span>
                {activeDeployment.build_id && (
                  <span className="font-mono">Build #{activeDeployment.build_id.slice(0, 8)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
              onClick={() => setStopDialogOpen(true)}
            >
              <StopCircle className="h-3.5 w-3.5" /> Stop
            </Button>
          </div>
        </div>

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
                  <Button variant="secondary" size="sm" className="h-8 gap-2">
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
            <div className="relative min-h-[260px] overflow-hidden border-t border-border bg-white sm:min-h-[420px]">
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
                  <span className="mb-3 rounded-xl border border-border bg-card p-3 text-muted-foreground">
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
            <AlertDialogAction onClick={stopDeployment} className="bg-red-600 hover:bg-red-700">
              Stop deployment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
