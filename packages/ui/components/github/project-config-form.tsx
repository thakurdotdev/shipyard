'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitRepository } from './repository-list';
import { EnvVarEditor, EnvVar } from '../env-var-editor';

interface ProjectConfigFormProps {
  repo: GitRepository;
  loading: boolean;
  onBack: () => void;
  onSubmit: (config: ProjectConfig) => void;
}

export interface ProjectConfig {
  name: string;
  appType: 'nextjs' | 'vite';
  buildCommand: string;
  rootDirectory: string;
  domain?: string;
  envVars: Record<string, string>;
}

export function ProjectConfigForm({ repo, loading, onBack, onSubmit }: ProjectConfigFormProps) {
  const [name, setName] = useState(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const [rootDirectory, setRootDirectory] = useState('./');
  const [domain, setDomain] = useState('');
  const [appType, setAppType] = useState<'nextjs' | 'vite'>('nextjs');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  const [subdomainStatus, setSubdomainStatus] = useState<
    'idle' | 'loading' | 'available' | 'unavailable'
  >('idle');
  const [subdomainError, setSubdomainError] = useState('');

  const checkSubdomain = async (): Promise<boolean> => {
    if (!domain) return true;
    setSubdomainStatus('loading');
    setSubdomainError('');
    try {
      const { available } = await api.checkDomainAvailability(domain);
      setSubdomainStatus(available ? 'available' : 'unavailable');
      if (!available) setSubdomainError('Domain is already taken');
      return available;
    } catch (e: any) {
      console.error(e);
      setSubdomainStatus('idle');
      setSubdomainError(e.message || 'Failed to check');
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error('Project Name is required');
    if (!buildCommand.trim()) return toast.error('Build Command is required');

    if (domain.trim()) {
      const isAvailable = await checkSubdomain();
      if (!isAvailable) {
        return toast.error(subdomainError || 'Domain is unavailable');
      }
    }

    const envVarsRecord = envVars.reduce(
      (acc, curr) => {
        if (curr.key) acc[curr.key] = curr.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    onSubmit({ name, appType, buildCommand, rootDirectory, domain, envVars: envVarsRecord });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Configure Project</CardTitle>
            <Button variant="ghost" size="sm" onClick={onBack}>
              Change Repo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Project Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
            />
            <p className="text-xs text-muted-foreground">
              This will be your project's unique identifier and subdomain.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Root Directory</Label>
              <Input
                value={rootDirectory}
                onChange={(e) => setRootDirectory(e.target.value)}
                placeholder="./"
              />
            </div>
            <div className="space-y-2">
              <Label>Subdomain (Optional)</Label>
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex max-w-sm items-center space-x-2">
                  <Input
                    value={domain}
                    onChange={(e) => {
                      setDomain(e.target.value);
                      setSubdomainStatus('idle');
                      setSubdomainError('');
                    }}
                    placeholder="my-app"
                    className="text-right"
                  />
                  <span className="text-muted-foreground whitespace-nowrap">.thakur.dev</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={checkSubdomain}
                  disabled={!domain || subdomainStatus === 'loading'}
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Framework Preset</Label>
              <Select value={appType} onValueChange={(v: any) => setAppType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nextjs">Next.js</SelectItem>
                  <SelectItem value="vite">Vite / React</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Build Command</Label>
              <Input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
        </CardHeader>
        <CardContent>
          <EnvVarEditor vars={envVars} onChange={setEnvVars} />
        </CardContent>
      </Card>

      <div className="pt-2">
        <Button className="w-full" onClick={handleSubmit} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Deploy Project
        </Button>
      </div>
    </div>
  );
}
