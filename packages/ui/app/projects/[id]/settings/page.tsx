"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { EnvVarForm } from "@/components/env-var-form";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { ArrowLeft, Trash2, Github, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export default function ProjectSettings() {
  const { id } = useParams() as { id: string };
  const [project, setProject] = useState<any>(null);
  const [envVars, setEnvVars] = useState<any[]>([]);
  const router = useRouter();

  const loadData = () => {
    api.getProject(id).then(setProject).catch(console.error);
    api.getEnvVars(id).then(setEnvVars).catch(console.error);
  };

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this project? This action cannot be undone.",
      )
    )
      return;

    try {
      await api.deleteProject(id);
      router.push("/");
    } catch (e) {
      console.error(e);
      alert("Failed to delete project");
    }
  };

  if (!project)
    return <div className="p-10 text-center animate-pulse">Loading...</div>;

  return (
    <div className="container mx-auto py-10 px-4 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-8">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="-ml-3 h-8 w-8"
            >
              <Link href={`/projects/${id}`}>
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">
              Project Settings
            </h1>
          </div>
          <p className="text-muted-foreground ml-7">
            Manage your project configuration and variables.
          </p>
        </div>
      </div>

      <div className="grid gap-8">
        {/* Environment Variables */}
        <Card>
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>
              Define variables to be injected into your build and runtime
              environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnvVarForm
              projectId={id}
              initialVars={envVars}
              onUpdate={loadData}
            />
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-500/20 bg-red-500/5 overflow-hidden">
          <CardHeader className="border-b border-red-500/10 bg-red-500/10">
            <CardTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-medium">Delete Project</h4>
                <p className="text-sm text-muted-foreground max-w-md">
                  Permanently remove this project and all of its resources
                  (deployments, builds, and files) from the platform. This
                  action is not reversible.
                </p>
              </div>
              <Button variant="destructive" onClick={handleDelete}>
                Delete Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
