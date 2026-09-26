'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EnvVarEditor, EnvVar } from './env-var-editor';
import { AppType, FRAMEWORK_OPTIONS, getDefaultBuildCommand } from '@/lib/framework-config';

export function ManualProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    github_url: '',
    build_command: getDefaultBuildCommand('nextjs'),
    app_type: 'nextjs' as AppType,
    root_directory: '',
    domain: '',
    port: '',
  });

  const handleAppTypeChange = (value: AppType) => {
    setFormData({
      ...formData,
      app_type: value,
      build_command: getDefaultBuildCommand(value),
    });
  };

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

  const [portStatus, setPortStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>(
    'idle',
  );
  const [portError, setPortError] = useState('');

  const checkPort = async (): Promise<boolean> => {
    if (!formData.port) return true;
    const portNum = parseInt(formData.port, 10);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setPortStatus('unavailable');
      setPortError('Port must be between 1024 and 65535');
      return false;
    }
    setPortStatus('loading');
    setPortError('');
    try {
      const res = await api.checkPortAvailability(portNum);
      setPortStatus(res.available ? 'available' : 'unavailable');
      if (!res.available) {
        setPortError(res.reason || 'Port is already in use');
      }
      return res.available;
    } catch (e: any) {
      console.error(e);
      setPortStatus('idle');
      setPortError(e.message || 'Failed to check port');
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

      if (formData?.port?.trim()) {
        const isPortFree = await checkPort();
        if (!isPortFree) {
          toast.error(portError || 'Port is unavailable');
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
        port: formData.port ? parseInt(formData.port, 10) : undefined,
        domain: formData.domain ? `${formData.domain}.thakur.dev` : '',
        env_vars: envVarsRecord,
      });
      router.push(`/projects/${project.id}`);
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Failed to create project');
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
              <Select value={formData.app_type} onValueChange={handleAppTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select framework" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Frontend</SelectLabel>
                    {FRAMEWORK_OPTIONS.filter((f) => f.category === 'Frontend').map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Backend</SelectLabel>
                    {FRAMEWORK_OPTIONS.filter((f) => f.category === 'Backend').map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
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

            <div className="space-y-2">
              <Label htmlFor="port">Port (Optional)</Label>
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex max-w-sm items-center space-x-2">
                  <Input
                    id="port"
                    type="number"
                    min={1024}
                    max={65535}
                    placeholder="Auto-assigned (5000-6000)"
                    value={formData.port}
                    onChange={(e) => {
                      setFormData({ ...formData, port: e.target.value });
                      setPortStatus('idle');
                      setPortError('');
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={checkPort}
                  disabled={!formData.port || portStatus === 'loading'}
                >
                  {portStatus === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Check'
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty for automatic port assignment, or specify a custom port (1024-65535).
              </p>
              {portStatus === 'available' && (
                <p className="text-sm text-green-500 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Port is available
                </p>
              )}
              {portStatus === 'unavailable' && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <X className="h-3 w-3" /> {portError || 'Port is already taken'}
                </p>
              )}
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
