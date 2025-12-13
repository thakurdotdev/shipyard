'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EnvVarEditor, EnvVar } from './env-var-editor';

export function ManualProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    github_url: '',
    build_command: 'npm run build',
    app_type: 'nextjs' as 'nextjs' | 'vite',
    root_directory: '',
    domain: '',
  });

  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  const [subdomainStatus, setSubdomainStatus] = useState<
    'idle' | 'loading' | 'available' | 'unavailable'
  >('idle');
  const [subdomainError, setSubdomainError] = useState('');

  const checkSubdomain = async (): Promise<boolean> => {
    if (!formData.domain) return true;
    setSubdomainStatus('loading');
    setSubdomainError('');
    try {
      const { available } = await api.checkDomainAvailability(formData.domain);
      setSubdomainStatus(available ? 'available' : 'unavailable');
      if (!available) setSubdomainError('Domain is already taken');
      return available;
    } catch (e: any) {
      console.error(e);
      setSubdomainStatus('idle'); // Reset to idle to allow retry
      setSubdomainError(e.message || 'Failed to check');
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Basic validation
    if (!formData.name.trim()) {
      toast.error('Project Name is required');
      setLoading(false);
      return;
    }
    if (!formData.github_url.trim()) {
      toast.error('GitHub URL is required');
      setLoading(false);
      return;
    }
    if (!formData.build_command.trim()) {
      toast.error('Build Command is required');
      setLoading(false);
      return;
    }

    try {
      if (formData?.domain?.trim()) {
        const isAvailable = await checkSubdomain();
        if (!isAvailable) {
          toast.error(subdomainError || 'Domain is unavailable');
          setLoading(false);
          return;
        }
      }
      const envVarsRecord = envVars.reduce(
        (acc, curr) => {
          if (curr.key) acc[curr.key] = curr.value;
          return acc;
        },
        {} as Record<string, string>,
      );

      const project = await api.createProject({
        ...formData,
        domain: formData.domain ? `${formData.domain}.thakur.dev` : '',
        env_vars: envVarsRecord,
      });
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to create project');
    } finally {
      if (!formData?.domain?.trim() || subdomainStatus !== 'unavailable') {
        setLoading(false);
      }
    }
  };

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <div className="grid gap-8 md:grid-cols-2">
        {/* Project Details */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Project Details</CardTitle>
            <CardDescription>Configure your project source and build settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="my-awesome-app"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="github_url">GitHub URL</Label>
              <Input
                id="github_url"
                placeholder="https://github.com/user/repo"
                value={formData.github_url}
                onChange={(e) => setFormData({ ...formData, github_url: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="app_type">Framework Preset</Label>
              <Select
                value={formData.app_type}
                onValueChange={(value: any) => setFormData({ ...formData, app_type: value })}
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
                onChange={(e) => setFormData({ ...formData, root_directory: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="build_command">Build Command</Label>
              <Input
                id="build_command"
                placeholder="npm run build"
                value={formData.build_command}
                onChange={(e) => setFormData({ ...formData, build_command: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Subdomain</Label>
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex max-w-sm items-center space-x-2">
                  <Input
                    id="domain"
                    placeholder="my-app"
                    value={formData.domain}
                    onChange={(e) => {
                      setFormData({ ...formData, domain: e.target.value });
                      setSubdomainStatus('idle');
                      setSubdomainError('');
                    }}
                    className="text-right"
                  />
                  <span className="text-muted-foreground whitespace-nowrap">.thakur.dev</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={checkSubdomain}
                  disabled={!formData.domain || subdomainStatus === 'loading'}
                >
                  {subdomainStatus === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Check'
                  )}
                </Button>
              </div>
              {subdomainStatus === 'available' && (
                <p className="text-sm text-green-500 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Available
                </p>
              )}
              {subdomainStatus === 'unavailable' && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <X className="h-3 w-3" /> Domain is taken
                </p>
              )}
              {subdomainError && <p className="text-sm text-destructive">{subdomainError}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Environment Variables */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>Configure environment variables for your deployment.</CardDescription>
          </CardHeader>
          <CardContent>
            <EnvVarEditor vars={envVars} onChange={setEnvVars} />
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4 justify-end pt-4 border-t">
        <Button type="button" variant="outline" disabled={loading} onClick={() => router.push('/')}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="default"
          disabled={loading || subdomainStatus === 'loading' || subdomainStatus === 'unavailable'}
        >
          Create Project
        </Button>
      </div>
    </form>
  );
}
