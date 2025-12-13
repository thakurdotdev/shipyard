'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { EnvVarForm } from '@/components/env-var-form';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Trash2, AlertTriangle } from 'lucide-react';
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

interface SettingsTabProps {
  project: any;
}

export function SettingsTab({ project }: SettingsTabProps) {
  const [envVars, setEnvVars] = useState<any[]>([]);
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

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
