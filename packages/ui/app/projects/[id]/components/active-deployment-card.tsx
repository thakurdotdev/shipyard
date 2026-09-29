'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Globe,
  GitBranch,
  Clock,
  ExternalLink,
  StopCircle,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
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
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { AppType } from '@/lib/framework-config';

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
  const deploymentUrl = project.domain
    ? `https://${project.domain}`
    : `http://localhost:${project.port}`;

  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const isLoadedRef = useRef(false);

  // Reset states when URL changes
  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
    isLoadedRef.current = false;

    // If loading takes too long (e.g. 15s), show fallback
    const timer = setTimeout(() => {
      if (!isLoadedRef.current) {
        setIframeLoading(false);
        setIframeError(true);
      }
    }, 10000);

    return () => clearTimeout(timer);
  }, [deploymentUrl]);

  const handleIframeLoad = () => {
    // Only update if not already error-ed out
    if (!isLoadedRef.current) {
      isLoadedRef.current = true;
      setIframeLoading(false);
    }
  };

  const handleIframeError = () => {
    isLoadedRef.current = false;
    setIframeLoading(false);
    setIframeError(true);
  };

  const handleStop = () => {
    onStopDeployment();
    setStopDialogOpen(false);
  };

  if (!activeDeployment) {
    return (
      <Card className="border-dashed bg-surface-muted/40">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <div className="w-12 h-12 rounded-full bg-surface-muted flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 opacity-50" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No Active Deployment</h3>
          <p className="max-w-xs mx-auto mb-6 text-sm">
            Your project hasn't been deployed yet. Trigger a build to get your application live.
          </p>
          <Button onClick={onTriggerBuild} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Deploy Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Production Deployment</h2>

        <Card className="overflow-hidden border-border bg-surface">
          <div className="flex flex-col md:flex-row h-auto md:min-h-80 box-border">
            {/* Left: Preview */}
            <div className="w-full md:w-[60%] bg-surface-muted/50 relative group border-b md:border-b-0 md:border-r border-border min-h-[320px] md:min-h-0">
              <div className="w-full h-full relative overflow-hidden">
                {/* Fallback State (Error) */}
                {iframeError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface z-20 text-center p-6">
                    <div className="h-12 w-12 rounded-full bg-surface-muted flex items-center justify-center mb-3">
                      <Globe className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-medium text-foreground mb-1">
                      Preview Unavailable
                    </h3>
                    <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
                      The deployment could not be embedded or failed to load.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 h-8 text-xs border-border bg-surface-muted text-foreground/90 hover:bg-surface-muted hover:text-foreground"
                      asChild
                    >
                      <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">
                        Open Website <ExternalLink className="w-3 h-3" />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Loading State */}
                    {iframeLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-surface border-border z-10">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {/* Iframe Preview */}
                    <div
                      className={`w-[200%] h-[200%] origin-top-left transform scale-50 select-none absolute inset-0 ${iframeLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
                    >
                      {/* The preview frame is intentionally a white canvas: it renders a
                          real deployed website, not app chrome. */}
                      <iframe
                        src={deploymentUrl}
                        className="w-full h-full border-0 bg-white pointer-events-none"
                        title="Preview"
                        sandbox="allow-scripts allow-same-origin"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                      />
                    </div>

                    {/* Overlay for interaction */}
                    {!iframeLoading && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center z-20">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 gap-2 shadow-lg"
                          asChild
                        >
                          <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">
                            Visit Live <ExternalLink className="w-3 h-3" />
                          </a>
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right: Details */}
            <div className="w-full md:w-[40%] p-5 flex flex-col justify-between bg-surface-muted/40">
              <div className="space-y-4">
                {/* Deployment Info */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.14em]">
                    Deployment
                  </span>
                  <a
                    href={deploymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-foreground hover:underline truncate transition-colors"
                  >
                    {deploymentUrl.replace(/^https?:\/\//, '')}
                  </a>
                </div>

                {/* Domains */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.14em]">
                    Domains
                  </span>
                  <div className="flex items-center gap-2">
                    <a
                      href={deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 group/link"
                    >
                      <span className="text-sm text-foreground/90 font-mono truncate group-hover/link:text-foreground group-hover/link:underline transition-colors">
                        {project.domain || `localhost:${project.port}`}
                      </span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground group-hover/link:text-muted-foreground transition-colors" />
                    </a>
                  </div>
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.14em]">
                    Status
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </div>
                    <span className="text-sm font-medium text-emerald-400">Ready</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {Math.floor(
                        (Date.now() - new Date(activeDeployment.activated_at).getTime()) /
                          (1000 * 60),
                      )}
                      m ago
                    </span>
                  </div>
                </div>

                {/* Source */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.14em]">
                    Source
                  </span>
                  <div className="flex items-center gap-2 text-sm text-foreground/90">
                    <GitBranch className="w-4 h-4 text-muted-foreground" />
                    <span className="font-mono">{project.github_branch || 'main'}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 mt-4 border-t border-border flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-8 text-xs gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setStopDialogOpen(true);
                  }}
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  Stop
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Active Deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the currently running deployment. The application will no longer be
              accessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStop}
              className="bg-red-600 text-foreground hover:bg-red-700"
            >
              Stop Deployment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
