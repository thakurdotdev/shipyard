'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitBranch, Clock, Terminal, Box } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { LogViewer } from '@/components/log-viewer';

interface DeploymentsTabProps {
  builds: any[];
  onActivateBuild: (buildId: string) => void;
  activeDeployment?: any;
}

export function DeploymentsTab({ builds, onActivateBuild, activeDeployment }: DeploymentsTabProps) {
  if (!builds || builds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg border-dashed">
        <Box className="w-12 h-12 mb-4 opacity-20" />
        <h3 className="text-lg font-medium text-foreground">No Deployments Found</h3>
        <p>Trigger a build to see it appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-500">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deployment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {builds.map((build) => {
              const isActive = activeDeployment?.build_id === build.id;
              return (
                <TableRow key={build.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      Build #{build.id.slice(0, 8)}
                      {isActive && (
                        <Badge variant="default" className="text-[10px] h-5">
                          Current
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`
                                text-[10px] h-5 capitalize
                                ${build.status === 'success' ? 'text-green-600 bg-green-500/10' : ''}
                                ${build.status === 'failed' ? 'text-red-600 bg-red-500/10' : ''}
                                ${build.status === 'building' || build.status === 'pending' ? 'text-blue-600 bg-blue-500/10' : ''}
                            `}
                    >
                      {build.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GitBranch className="w-3 h-3" />
                      <span>main</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(build.created_at).toLocaleString()}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {build.status === 'success' && !isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => onActivateBuild(build.id)}
                        >
                          Rollback
                        </Button>
                      )}
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Terminal className="w-4 h-4" />
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
