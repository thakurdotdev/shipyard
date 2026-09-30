'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ExternalLink,
  GitBranch,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
  StopCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  onTriggerBuild: () => void;
}

export function ActiveDeploymentCard({
  activeDeployment,
  project,
  onStopDeployment,
  onTriggerBuild,
}: ActiveDeploymentCardProps) {
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [frameLoading, setFrameLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);

  const deploymentUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : null;

  useEffect(() => {
    let cancelled = false;
    if (!activeDeployment) {
      setPreviewState('unavailable');
      return;
    }

    setPreviewState('loading');
    setFrameLoading(true);
    api
      .configureProjectPreview(project.id)
      .then((result) => {
        if (cancelled) return;
        setPreviewUrl(result.preview_url);
        setPreviewState(result.embeddable && result.preview_url ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewUrl(null);
        setPreviewState('unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [activeDeployment?.id, project.id]);

  const stopDeployment = () => {
    onStopDeployment();
    setStopDialogOpen(false);
  };

  if (!activeDeployment) {
    return (
      <Card className="overflow-hidden border-dashed bg-card">
        <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-muted text-muted-foreground">
            <Activity className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">No production deployment</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Build and deploy this project to bring its live status, domain, and preview here.
          </p>
          <Button onClick={onTriggerBuild} className="mt-5 gap-2">
            <RefreshCw className="h-4 w-4" /> Deploy project
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden border-border bg-card shadow-sm">
        <div className="flex flex-col border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Production</h2>
                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/10">
                  Live
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Released {new Date(activeDeployment.activated_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 sm:mt-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => {
                setFrameLoading(true);
                setFrameKey((value) => value + 1);
              }}
              disabled={previewState !== 'ready'}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh preview
            </Button>
            {deploymentUrl && (
              <Button variant="secondary" size="sm" className="h-8 gap-2" asChild>
                <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">
                  Visit live <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.8fr)]">
          <div className="relative min-h-[300px] overflow-hidden bg-white sm:min-h-[390px]">
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
                  className="absolute inset-0 h-full min-h-[300px] w-full border-0 bg-white sm:min-h-[390px]"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={() => setFrameLoading(false)}
                />
              </>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center sm:min-h-[390px]">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
                  {previewState === 'loading' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Globe className="h-5 w-5" />
                  )}
                </div>
                <h3 className="font-medium text-foreground">
                  {previewState === 'loading'
                    ? 'Preparing live preview'
                    : 'Preview is not available'}
                </h3>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  {previewState === 'loading'
                    ? 'Connecting this project to the secure preview route.'
                    : 'This domain cannot be embedded. Open the live site in a new tab instead.'}
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

          <aside className="flex flex-col justify-between border-t border-border bg-surface-muted/20 p-5 lg:border-l lg:border-t-0 lg:p-6">
            <div className="space-y-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Deployment URL
                </p>
                <a
                  href={deploymentUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-2 break-all text-sm font-medium hover:text-primary"
                >
                  {project.domain || `localhost:${project.port}`}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Branch</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    {project.github_branch || 'main'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Framework</p>
                  <p className="mt-1 capitalize text-sm">{project.app_type}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-3.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Deployment health check passed
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Runtime uptime monitoring and alerts are managed in Settings.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">
                Build #{activeDeployment.build_id?.slice(0, 8)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                onClick={() => setStopDialogOpen(true)}
              >
                <StopCircle className="h-3.5 w-3.5" /> Stop
              </Button>
            </div>
          </aside>
        </div>
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
