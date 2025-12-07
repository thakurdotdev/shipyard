'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Globe, GitBranch, Clock, Box } from 'lucide-react';
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
import { useState } from 'react';

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

  const handleStop = () => {
    onStopDeployment();
    setStopDialogOpen(false);
  };

  return (
    <>
      <Card className="h-full flex flex-col overflow-hidden border-border/50 shadow-sm relative group">
        <CardHeader className="border-b bg-muted/30 pb-4">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Production Deployment
                <Badge
                  variant={activeDeployment ? 'default' : 'secondary'}
                  className="ml-2 font-normal"
                >
                  {activeDeployment ? 'Active' : 'Idle'}
                </Badge>
              </CardTitle>
              <CardDescription>The current live version of your application.</CardDescription>
            </div>
            {activeDeployment && (
              <Button
                variant="destructive"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setStopDialogOpen(true)}
              >
                Stop
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          {activeDeployment ? (
            <div className="flex flex-col md:flex-row h-full">
              <div className="flex-1 p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Domain
                    </span>
                    <div className="flex items-center gap-2 font-mono text-sm">
                      <Globe className="w-4 h-4 text-primary" />
                      {project.domain || `localhost:${project.port}`}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </span>
                    <div className="flex items-center gap-2 text-sm text-green-500 font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Ready
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Source
                    </span>
                    <div className="flex items-center gap-2 text-sm">
                      <GitBranch className="w-4 h-4 text-muted-foreground" />
                      main
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Created
                    </span>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      {new Date(activeDeployment.activated_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-muted/30 border-l w-full md:w-48 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
                Preview Unavailable
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Box className="w-10 h-10 mb-3 opacity-20" />
              <p>No active deployment</p>
              <Button variant="link" onClick={onTriggerBuild}>
                Deploy now
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Active Deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the currently running deployment for <strong>{project.name}</strong>.
              The application will no longer be accessible until a new deployment is promoted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop Deployment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
