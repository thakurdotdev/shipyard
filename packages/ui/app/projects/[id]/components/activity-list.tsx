'use client';

import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, GitBranch, Terminal, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { LogViewer } from '@/components/log-viewer';

interface ActivityListProps {
  builds: any[];
  activeDeployment: any;
  onActivateBuild: (buildId: string) => void;
}

export function ActivityList({ builds, activeDeployment, onActivateBuild }: ActivityListProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5" /> Recent Activity
      </h3>
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <ScrollArea className="h-[400px]">
          <div className="divide-y">
            {builds.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No recent activity</div>
            ) : (
              builds.map((build) => (
                <div
                  key={build.id}
                  className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <StatusIcon status={build.status} />
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        Build #{build.id.slice(0, 8)}
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                          {build.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" /> main
                        </span>
                        <span>•</span>
                        <span>{new Date(build.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {build.status === 'success' &&
                      (!activeDeployment || activeDeployment.build_id !== build.id) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => onActivateBuild(build.id)}
                        >
                          Promote
                        </Button>
                      )}
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Terminal className="w-4 h-4" />
                          <span className="sr-only">Logs</span>
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="sm:max-w-[800px] w-full p-0 flex flex-col gap-0 border-l">
                        <SheetHeader className="p-4 border-b bg-muted/10">
                          <SheetTitle className="font-mono text-base">
                            Build #{build.id.slice(0, 8)}
                          </SheetTitle>
                          <SheetDescription>Logs for build execution</SheetDescription>
                        </SheetHeader>
                        <div className="flex-1 bg-black text-white font-mono text-xs overflow-hidden">
                          <LogViewer buildId={build.id} />
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') {
    return (
      <div className="p-1.5 rounded-full bg-green-500/10 text-green-600">
        <CheckCircle2 className="w-4 h-4" />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="p-1.5 rounded-full bg-red-500/10 text-red-600">
        <XCircle className="w-4 h-4" />
      </div>
    );
  }
  return (
    <div className="p-1.5 rounded-full bg-blue-500/10 text-blue-600 animate-spin">
      <Loader2 className="w-4 h-4" />
    </div>
  );
}
