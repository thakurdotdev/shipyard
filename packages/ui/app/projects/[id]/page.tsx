"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { io } from "socket.io-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LogViewer } from "@/components/log-viewer";
import {
  GitBranch,
  ExternalLink,
  Play,
  Github,
  CheckCircle2,
  Clock,
  AlertCircle,
  Terminal,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export default function ProjectDetails() {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<any>(null);
  const [builds, setBuilds] = useState<any[]>([]);
  const [activeDeployment, setActiveDeployment] = useState<any>(null);
  const [tab, setTab] = useState<"overview" | "deployments">("overview");

  const refreshData = () => {
    if (!id) return;
    api.getProject(id).then(setProject).catch(console.error);
    api.getBuilds(id).then(setBuilds).catch(console.error);
    api.getActiveDeployment(id).then(setActiveDeployment).catch(console.error);
  };

  useEffect(() => {
    refreshData();
    const socket = io(
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
    );

    socket.on("connect", () => {
      console.log("Socket Connected to Project Room");
      socket.emit("subscribe_project", id);
    });

    socket.on("build_updated", (updatedBuild: any) => {
      setBuilds((prev) => {
        const exists = prev.find((b) => b.id === updatedBuild.id);
        if (exists) {
          return prev.map((b) => (b.id === updatedBuild.id ? updatedBuild : b));
        }
        return [updatedBuild, ...prev];
      });
    });

    return () => {
      socket.emit("unsubscribe_project", id);
      socket.disconnect();
    };
  }, [id]);

  const triggerBuild = async () => {
    try {
      await api.triggerBuild(id);
      refreshData();
    } catch (error) {
      console.error(error);
    }
  };

  const activateBuild = async (buildId: string) => {
    try {
      await api.activateBuild(buildId);
      refreshData();
    } catch (e) {
      console.error(e);
      alert("Failed to activate build");
    }
  };

  if (!project)
    return <div className="p-10 text-center animate-pulse">Loading...</div>;

  return (
    <div className="container mx-auto py-10 px-4 space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b pb-8">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold tracking-tight">
              {project.name}
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {project.app_type}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
            <a
              href={project.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Github className="w-4 h-4" />
              {project.github_url.split("/").slice(-2).join("/")}
            </a>
            {project.domain && (
              <a
                href={`http://${project.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {project.domain}
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={triggerBuild}
            size="default"
            className="gap-2 shadow-lg hover:shadow-xl transition-all"
          >
            <Play className="h-4 w-4" /> Deploy
          </Button>
          {activeDeployment && (
            <Button variant="secondary" asChild className="gap-2">
              <a
                href={`http://${project.domain || "localhost"}:${project.port}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visit App <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button variant="outline" size="icon" asChild>
            <Link href={`/projects/${id}/settings`}>
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Active Deployment Card */}
          <Card className="bg-gradient-to-br from-card to-muted/20 border-primary/10 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div
                  className={`w-2 h-2 rounded-full ${
                    activeDeployment
                      ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                      : "bg-gray-400"
                  }`}
                />
                Production Deployment
              </CardTitle>
              {activeDeployment && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs shadow-sm hover:shadow-md transition-all z-10"
                  onClick={(e) => {
                    // Prevent event bubbling if any
                    e.stopPropagation();
                    if (
                      !confirm("Are you sure you want to stop this deployment?")
                    )
                      return;

                    api
                      .stopDeployment(id)
                      .then(() => {
                        // Refresh data immediately
                        refreshData();
                        // Also clear local state to give instant feedback
                        setActiveDeployment(null);
                      })
                      .catch((e) => {
                        console.error(e);
                        alert("Failed to stop deployment");
                      });
                  }}
                >
                  Stop
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {activeDeployment ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg border">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">
                        Deployed
                      </div>
                      <div className="font-medium flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        {new Date(
                          activeDeployment.activated_at,
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Source
                      </div>
                      <div className="font-medium flex items-center gap-2 justify-end">
                        <GitBranch className="w-4 h-4 text-muted-foreground" />
                        main
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground space-y-2">
                  <AlertCircle className="w-8 h-8 opacity-50" />
                  <p>No active deployment</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">
              Recent Activity
            </h2>
            <div className="space-y-3">
              {builds.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
                  No builds yet
                </div>
              ) : (
                builds.map((build) => (
                  <div
                    key={build.id}
                    className="group flex items-center justify-between p-4 rounded-xl border bg-card hover:border-primary/20 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`p-2 rounded-full bg-muted/50 ${
                          build.status === "success"
                            ? "text-green-500"
                            : build.status === "failed"
                            ? "text-red-500"
                            : "text-blue-500 animate-pulse"
                        }`}
                      >
                        {build.status === "success" ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : build.status === "failed" ? (
                          <AlertCircle className="w-5 h-5" />
                        ) : (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            Build #{build.id.slice(0, 8)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-5"
                          >
                            {build.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />{" "}
                            {new Date(build.created_at).toLocaleTimeString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> main
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {build.status === "success" &&
                        (!activeDeployment ||
                          activeDeployment.build_id !== build.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => activateBuild(build.id)}
                          >
                            Promote
                          </Button>
                        )}
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-2"
                          >
                            <Terminal className="w-3 h-3" /> Logs
                          </Button>
                        </SheetTrigger>
                        <SheetContent className="sm:max-w-[900px] w-full p-0 gap-0">
                          <SheetHeader className="p-6 border-b">
                            <SheetTitle className="font-mono">
                              Build #{build.id.slice(0, 8)}
                            </SheetTitle>
                            <SheetDescription>
                              {new Date(build.created_at).toLocaleString()}
                            </SheetDescription>
                          </SheetHeader>
                          <div className="flex-1 h-[calc(100vh-100px)]">
                            <LogViewer buildId={build.id} initialLogs="" />
                          </div>
                        </SheetContent>
                      </Sheet>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Project Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">Framework</span>
                <span className="font-medium capitalize">
                  {project.app_type}
                </span>
              </div>
              <div className="space-y-1.5 py-2 border-b border-border/50">
                <span className="text-muted-foreground block mb-1">
                  Build Command
                </span>
                <code className="block w-full bg-muted/50 px-2.5 py-1.5 rounded text-xs font-mono break-all">
                  {project.build_command}
                </code>
              </div>
              <div className="space-y-1.5 py-2">
                <span className="text-muted-foreground block mb-1">
                  Root Directory
                </span>
                <code className="block w-full bg-muted/50 px-2.5 py-1.5 rounded text-xs font-mono">
                  {project.root_directory || "./"}
                </code>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground text-center">
            Project ID: <span className="font-mono">{project.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Loader2({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
