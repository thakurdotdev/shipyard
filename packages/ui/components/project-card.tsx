import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, GitBranch, Github } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from './ui/badge';

export function ProjectCard({ project }: { project: any }) {
  const faviconUrl = project.domain
    ? `https://www.google.com/s2/favicons?domain=${project.domain}&sz=128`
    : `https://www.google.com/s2/favicons?domain=localhost&sz=128`;

  const isReady = !!project.domain;

  const FrameworkBadge = ({ type }: { type: string }) => {
    if (type === 'nextjs')
      return (
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal tracking-wide">
          Next.js
        </Badge>
      );
    if (type === 'vite')
      return (
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal tracking-wide">
          Vite
        </Badge>
      );
    return (
      <Badge
        variant="secondary"
        className="text-[10px] h-5 px-1.5 font-normal tracking-wide uppercase"
      >
        {type}
      </Badge>
    );
  };

  return (
    <Card className="group relative flex flex-col justify-between overflow-hidden border bg-background text-foreground h-full hover:border-foreground/20 transition-all duration-200 hover:shadow-lg">
      <Link
        href={`/projects/${project.id}`}
        className="absolute inset-0 z-0"
        aria-label={`View ${project.name}`}
      />

      <CardHeader className="flex flex-row items-start justify-between space-y-0 p-5 relative z-10 pointer-events-none">
        <div className="flex items-center gap-4 pointer-events-auto">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border bg-muted/20 p-1.5 shadow-sm">
            <Image
              src={faviconUrl}
              alt={project.name}
              width={40}
              height={40}
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="flex flex-col">
            <CardTitle className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">
              {project.name}
            </CardTitle>
            <a
              href={
                project.domain
                  ? project.domain.startsWith('http')
                    ? project.domain
                    : `https://${project.domain}`
                  : '#'
              }
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (!project.domain) e.preventDefault();
                e.stopPropagation();
              }}
              className={`text-xs text-muted-foreground font-mono mt-1.5 hover:text-foreground transition-colors flex items-center gap-1 ${!project.domain && 'cursor-default hover:text-muted-foreground'}`}
            >
              {project.domain || 'Not deployed'}
            </a>
          </div>
        </div>
        <div className="pointer-events-auto">
          <FrameworkBadge type={project.app_type} />
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 relative z-10 pointer-events-none">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className={`relative flex h-2 w-2`}>
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${isReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
              ></span>
            </span>
            <span className={`font-medium ${isReady ? 'text-foreground' : ''}`}>
              {isReady ? 'Ready' : 'Building'}
            </span>
          </div>
          <span>•</span>
          <span>{timeAgo(new Date(project.created_at))}</span>
        </div>
      </CardContent>

      <CardFooter className="bg-muted/20 p-3 text-xs text-muted-foreground flex justify-between items-center border-t border-border/40 relative z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 hover:text-foreground transition-colors pointer-events-auto">
            <Github className="h-3.5 w-3.5" />
            <a
              href={project.github_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline truncate max-w-[140px]"
              onClick={(e) => e.stopPropagation()}
            >
              {project.github_url.split('/').slice(-2).join('/')}
            </a>
          </div>
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono">main</span>
          </div>
        </div>

        {project.domain && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5 pointer-events-auto hover:bg-background border border-transparent hover:border-border/50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(
                project.domain.startsWith('http') ? project.domain : `https://${project.domain}`,
                '_blank',
              );
            }}
          >
            Visit <ArrowRight className="h-3 w-3 opacity-50" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function timeAgo(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + 'y ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + 'mo ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + 'd ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + 'h ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + 'm ago';
  return Math.floor(seconds) + 's ago';
}
