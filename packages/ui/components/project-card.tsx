import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Github, Globe } from "lucide-react";

export function ProjectCard({ project }: { project: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{project.name}</CardTitle>
        <CardDescription>{project.app_type}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Github className="w-4 h-4" />
            <a
              href={project.github_url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {project.github_url}
            </a>
          </div>
          {project.root_directory && project.root_directory !== "./" && (
            <div className="text-sm text-muted-foreground">
              Root: {project.root_directory}
            </div>
          )}
          {project.domain && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="w-4 h-4" />
              <a
                href={`http://${project.domain}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {project.domain}
              </a>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/projects/${project.id}`}>View Details</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
