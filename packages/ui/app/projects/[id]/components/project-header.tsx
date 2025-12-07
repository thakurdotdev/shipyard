'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Github, Play, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectHeaderProps {
  project: any;
  activeDeployment: any;
  isDeploying: boolean;
  onTriggerBuild: () => void;
}

export function ProjectHeader({
  project,
  activeDeployment,
  isDeploying,
  onTriggerBuild,
}: ProjectHeaderProps) {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Projects
              </Link>
              <ChevronRight className="w-4 h-4" />
              <span className="font-semibold text-foreground flex items-center gap-2">
                {project.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={project.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  <Github className="w-4 h-4" />
                  <span className="hidden sm:inline">Repository</span>
                </a>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  toast.promise(onTriggerBuild(), {
                    loading: 'Starting deployment...',
                    success: 'Deployment started',
                    error: 'Failed to start deployment',
                  });
                }}
                disabled={isDeploying}
                className="gap-2"
              >
                {isDeploying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Deploy
              </Button>
            </div>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
              <Badge variant="outline" className="font-mono text-xs">
                {project.app_type}
              </Badge>
            </div>

            <div className="flex gap-2">
              {activeDeployment && (
                <Button variant="secondary" size="sm" asChild className="gap-2 text-xs">
                  <a
                    href={
                      project.domain
                        ? `https://${project.domain}`
                        : `http://localhost:${project.port}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Visit <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
