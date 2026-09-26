'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { EnvVarForm } from '@/components/env-var-form';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Trash2, AlertTriangle, GitBranch, Settings2, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Project } from '@/lib/types';
import { FRAMEWORK_OPTIONS, AppType } from '@/lib/framework-config';

interface SettingsTabProps {
  project: Project;
}

export function SettingsTab({ project }: SettingsTabProps) {
  const [envVars, setEnvVars] = useState<any[]>([]);
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(project.auto_deploy ?? true);
  const [updating, setUpdating] = useState(false);

  // Build settings state
  const [buildCommand, setBuildCommand] = useState(project.build_command);
  const [appType, setAppType] = useState<AppType>(project.app_type);
  const [rootDirectory, setRootDirectory] = useState(project.root_directory || './');
  const [port, setPort] = useState(project.port ? String(project.port) : '');
  const [savingBuildSettings, setSavingBuildSettings] = useState(false);

  // Check if build settings have changed
  const buildSettingsChanged =
    buildCommand !== project.build_command ||
    appType !== project.app_type ||
    rootDirectory !== (project.root_directory || './') ||
    port !== (project.port ? String(project.port) : '');

  const handleSaveBuildSettings = async () => {
    setSavingBuildSettings(true);
    try {
      let parsedPort: number | undefined = undefined;
      if (port.trim()) {
        parsedPort = parseInt(port, 10);
        if (isNaN(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
          throw new Error('Port must be between 1024 and 65535');
        }
        if (parsedPort !== project.port) {
          const check = await api.checkPortAvailability(parsedPort);
          if (!check.available) {
            throw new Error(check.reason || `Port ${parsedPort} is not available`);
          }
        }
      }

      await api.updateProject(project.id, {
        build_command: buildCommand,
        app_type: appType,
        root_directory: rootDirectory,
        port: parsedPort,
      });
      toast.success('Build settings saved', {
        description: 'Changes will apply to your next build.',
      });
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to save build settings', {
        description: e.message || 'An unexpected error occurred',
      });
    } finally {
      setSavingBuildSettings(false);
    }
  };

  const handleAutoDeployChange = async (checked: boolean) => {
    setAutoDeploy(checked);
    setUpdating(true);
    try {
      await api.updateProject(project.id, { auto_deploy: checked });
      toast.success('Project settings updated', {
        description: `Auto-deploy is now ${checked ? 'enabled' : 'disabled'}`,
      });
    } catch (e) {
      console.error(e);
      setAutoDeploy(!checked); // Revert on failure
      toast.error('Failed to update settings');
    } finally {
      setUpdating(false);
    }
  };

  const loadData = () => {
    api.getEnvVars(project.id).then(setEnvVars).catch(console.error);
  };

  useEffect(() => {
    loadData();
  }, [project.id]);

  const handleDelete = async () => {
    if (confirmName !== project.name) return;

    setIsDeleting(true);
    try {
      const promise = api.deleteProject(project.id);
      toast.promise(promise, {
        loading: 'Deleting project...',
        success: 'Project deleted successfully',
        error: 'Failed to delete project',
      });

      await promise;
      router.push('/');
    } catch (e) {
      console.error(e);
      // toast handles error
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="grid gap-8">
        {/* Build Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Build Settings
            </CardTitle>
            <CardDescription>Configure how your project is built and deployed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="build-command">Build Command</Label>
                <Input
                  id="build-command"
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  placeholder="npm run build"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">Command to build your application</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-type">Framework</Label>
                <Select value={appType} onValueChange={(v) => setAppType(v as AppType)}>
                  <SelectTrigger id="app-type">
                    <SelectValue placeholder="Select framework" />
                  </SelectTrigger>
                  <SelectContent>
                    {FRAMEWORK_OPTIONS.map((framework) => (
                      <SelectItem key={framework.value} value={framework.value}>
                        <span className="flex items-center gap-2">
                          {framework.label}
                          <span className="text-xs text-muted-foreground">
                            ({framework.category})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Framework used for your project</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="root-directory">Root Directory</Label>
                <Input
                  id="root-directory"
                  value={rootDirectory}
                  onChange={(e) => setRootDirectory(e.target.value)}
                  placeholder="./"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Directory containing your package.json (for monorepos)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="Auto-assigned"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Assigned port on server (1024-65535)
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveBuildSettings}
                disabled={!buildSettingsChanged || savingBuildSettings}
              >
                {savingBuildSettings ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Auto Deploy */}
        {project.github_installation_id && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="w-5 h-5" /> Auto Deploy
                  </CardTitle>
                  <CardDescription>
                    Automatically trigger a new deployment when you push to the connected git
                    branch.
                  </CardDescription>
                </div>
                <Switch
                  checked={autoDeploy}
                  onCheckedChange={handleAutoDeployChange}
                  disabled={updating}
                />
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Environment Variables */}
        <Card>
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>
              Define variables to be injected into your build and runtime environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnvVarForm projectId={project.id} initialVars={envVars} onUpdate={loadData} />
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
                  Permanently remove this project and all of its resources (deployments, builds, and
                  files) from the platform. This action is not reversible.
                </p>
              </div>
              <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                Delete Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              <span className="font-semibold text-foreground"> {project.name} </span>
              project and remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="confirm-name" className="text-xs font-medium text-muted-foreground">
              Type <span className="font-mono font-bold text-foreground">{project.name}</span> to
              confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={project.name}
              className="font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmName('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={confirmName !== project.name || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
