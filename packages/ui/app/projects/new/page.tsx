"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Eye, EyeOff } from "lucide-react";

export default function NewProject() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    github_url: "",
    build_command: "npm run build",
    app_type: "nextjs",
    root_directory: "",
    domain: "",
  });

  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [showValues, setShowValues] = useState(false);

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const removeEnvVar = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const updateEnvVar = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    const newVars = [...envVars];
    newVars[index][field] = value;
    setEnvVars(newVars);
  };

  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    const text = e.clipboardData.getData("text");
    // Check if it looks like bulk env vars (multiline or contains =)
    if (text.includes("\n") || text.includes("=")) {
      e.preventDefault();
      const newVars: { key: string; value: string }[] = [];

      // Parse pasted text
      text.split("\n").forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          newVars.push({ key: match[1].trim(), value: match[2].trim() });
        }
      });

      if (newVars.length > 0) {
        // If pasting into an empty row, replace it. Otherwise append.
        const currentVars = [...envVars];
        const isCurrentRowEmpty =
          !currentVars[index].key && !currentVars[index].value;

        if (isCurrentRowEmpty) {
          currentVars.splice(index, 1, ...newVars);
        } else {
          currentVars.splice(index + 1, 0, ...newVars);
        }
        setEnvVars(currentVars);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent, deploy: boolean = false) => {
    e.preventDefault();
    setLoading(true);
    try {
      const envVarsRecord = envVars.reduce((acc, curr) => {
        if (curr.key) acc[curr.key] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      const project = await api.createProject({
        ...formData,
        env_vars: envVarsRecord,
      });

      if (deploy) {
        await api.triggerBuild(project.id);
      }
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error(error);
      alert("Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-10 max-w-4xl space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Create New Project
        </h1>
        <p className="text-muted-foreground">
          Deploy your GitHub repository with a few clicks.
        </p>
      </div>

      <form className="space-y-8">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Project Details */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>
                Configure your project source and build settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  placeholder="my-awesome-app"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="github_url">GitHub URL</Label>
                <Input
                  id="github_url"
                  placeholder="https://github.com/user/repo"
                  value={formData.github_url}
                  onChange={(e) =>
                    setFormData({ ...formData, github_url: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="app_type">Framework Preset</Label>
                <Select
                  value={formData.app_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, app_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select framework" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nextjs">Next.js</SelectItem>
                    <SelectItem value="vite">Vite / React</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="root_directory">Root Directory</Label>
                <Input
                  id="root_directory"
                  placeholder="./"
                  value={formData.root_directory}
                  onChange={(e) =>
                    setFormData({ ...formData, root_directory: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="build_command">Build Command</Label>
                <Input
                  id="build_command"
                  placeholder="npm run build"
                  value={formData.build_command}
                  onChange={(e) =>
                    setFormData({ ...formData, build_command: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="domain">Custom Domain (Optional)</Label>
                <Input
                  id="domain"
                  placeholder="app.example.com"
                  value={formData.domain}
                  onChange={(e) =>
                    setFormData({ ...formData, domain: e.target.value })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>
                Configure environment variables for your deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Label>Variables</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setShowValues(!showValues)}
                    >
                      {showValues ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEnvVar}
                    className="h-8"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {envVars.map((env, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <Input
                        placeholder="KEY"
                        value={env.key}
                        onChange={(e) =>
                          updateEnvVar(index, "key", e.target.value)
                        }
                        onPaste={(e) => handlePaste(e, index)}
                        className="font-mono text-xs"
                      />
                      <Input
                        placeholder="VALUE"
                        value={env.value}
                        onChange={(e) =>
                          updateEnvVar(index, "value", e.target.value)
                        }
                        onPaste={(e) => handlePaste(e, index)}
                        className="font-mono text-xs"
                        type={showValues ? "text" : "password"}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        onClick={() => removeEnvVar(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {envVars.length === 0 && (
                    <div
                      className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-lg cursor-text hover:bg-muted/50 transition-colors"
                      onClick={addEnvVar}
                    >
                      Click to add or paste .env content here
                    </div>
                  )}
                  {/* Invisible input to catch paste events on the empty state area */}
                  {envVars.length === 0 && (
                    <textarea
                      className="absolute opacity-0 w-0 h-0"
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        const newVars: { key: string; value: string }[] = [];
                        text.split("\n").forEach((line) => {
                          const match = line.match(/^([^=]+)=(.*)$/);
                          if (match)
                            newVars.push({
                              key: match[1].trim(),
                              value: match[2].trim(),
                            });
                        });
                        if (newVars.length > 0) setEnvVars(newVars);
                      }}
                      autoFocus
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-4 justify-end pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => router.push("/")}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={(e) => handleSubmit(e, false)}
          >
            Create Project
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={(e) => handleSubmit(e, true)}
          >
            Create & Deploy
          </Button>
        </div>
      </form>
    </div>
  );
}
