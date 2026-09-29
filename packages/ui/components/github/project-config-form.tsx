'use client';

import { useState } from 'react';
import {
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Settings2,
  Box,
  Terminal,
  FolderGit2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitRepository } from './repository-list';
import { EnvVarEditor, EnvVar } from '../env-var-editor';
import { AppType, FRAMEWORK_OPTIONS, getDefaultBuildCommand } from '@/lib/framework-config';
import { cn } from '@/lib/utils';

interface ProjectConfigFormProps {
  repo: GitRepository;
  loading: boolean;
  onBack: () => void;
  onSubmit: (config: ProjectConfig) => void;
  initialRootDirectory?: string;
  initialFramework?: string;
}

export interface ProjectConfig {
  name: string;
  appType: AppType;
  buildCommand: string;
  rootDirectory: string;
  domain?: string;
  port?: number;
  envVars: Record<string, string>;
  autoDeploy: boolean;
}

export function ProjectConfigForm({
  repo,
  loading,
  onBack,
  onSubmit,
  initialRootDirectory = './',
  initialFramework,
}: ProjectConfigFormProps) {
  const [name, setName] = useState(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const [rootDirectory, setRootDirectory] = useState(initialRootDirectory);
  const [domain, setDomain] = useState('');
  const [port, setPort] = useState('');
  const detectedAppType = (initialFramework as AppType) || 'nextjs';
  const [appType, setAppType] = useState<AppType>(detectedAppType);
  const [buildCommand, setBuildCommand] = useState(getDefaultBuildCommand(detectedAppType));
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Collapsible sections state
  const [isBuildSettingsOpen, setIsBuildSettingsOpen] = useState(false);
  const [isEnvVarsOpen, setIsEnvVarsOpen] = useState(false);

  const handleAppTypeChange = (value: AppType) => {
    setAppType(value);
    setBuildCommand(getDefaultBuildCommand(value));
  };

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

  const [portStatus, setPortStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>(
    'idle',
  );
  const [portError, setPortError] = useState('');

  const checkPort = async (): Promise<boolean> => {
    if (!port) return true;
    const portNum = parseInt(port, 10);
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

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error('Project Name is required');
    if (!buildCommand.trim()) return toast.error('Build Command is required');

    if (domain.trim()) {
      const isAvailable = await checkSubdomain();
      if (!isAvailable) {
        return toast.error(subdomainError || 'Domain is unavailable');
      }
    }

    if (port.trim()) {
      const isPortFree = await checkPort();
      if (!isPortFree) {
        return toast.error(portError || 'Port is unavailable');
      }
    }

    const envVarsRecord = envVars.reduce(
      (acc, curr) => {
        if (curr.key) acc[curr.key] = curr.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    onSubmit({
      name,
      appType,
      buildCommand,
      rootDirectory,
      domain,
      port: port.trim() ? parseInt(port, 10) : undefined,
      envVars: envVarsRecord,
      autoDeploy,
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Configure Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Configure Project</h2>
          <p className="text-muted-foreground text-sm">
            Deploying{' '}
            <span className="text-foreground font-mono bg-surface-muted px-1 py-0.5 rounded-md text-xs">
              {repo.full_name}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          Change Repo
        </Button>
      </div>

      <div className="space-y-6 bg-surface-muted/40 border border-border rounded-2xl p-6">
        {/* Project Name */}
        <div className="space-y-3">
          <Label className="text-foreground/90">Project Name</Label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="bg-surface-muted/60 border-border "
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Used as the unique identifier and default subdomain.
          </p>
        </div>

        {/* Framework & Directory */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Label className="text-foreground/90">Framework Preset</Label>
            <Select value={appType} onValueChange={handleAppTypeChange}>
              <SelectTrigger className="bg-surface-muted/60 border-border">
                <SelectValue />
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

          <div className="space-y-3">
            <Label className="text-foreground/90">Root Directory</Label>
            <div className="relative">
              <FolderGit2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={rootDirectory}
                onChange={(e) => setRootDirectory(e.target.value)}
                placeholder="./"
                className="pl-9 bg-surface-muted/60 border-border"
              />
            </div>
          </div>
        </div>

        {/* Collapsible Build Settings */}
        <Collapsible
          open={isBuildSettingsOpen}
          onOpenChange={setIsBuildSettingsOpen}
          className="bg-surface-muted/40 border border-border rounded-xl"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full flex justify-between items-center p-4 h-auto hover:bg-surface-muted"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-foreground/90">Build Settings</span>
              </div>
              {isBuildSettingsOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="p-4 pt-0 space-y-4">
            <div className="space-y-3 pt-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                Build Command
              </Label>
              <div className="relative">
                <Terminal className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  className="pl-9 bg-surface-muted/60 border-border font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                Output Directory (Optional)
              </Label>
              <div className="relative">
                <Box className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="dist, build, or public"
                  className="pl-9 bg-surface-muted/60 border-border"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Collapsible Env Vars */}
        <Collapsible
          open={isEnvVarsOpen}
          onOpenChange={setIsEnvVarsOpen}
          className="bg-surface-muted/40 border border-border rounded-xl"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full flex justify-between items-center p-4 h-auto hover:bg-surface-muted"
            >
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-foreground/90">Environment Variables</span>
                <span className="text-xs text-muted-foreground bg-surface-muted px-2 py-0.5 rounded-full">
                  {envVars.length}
                </span>
              </div>
              {isEnvVarsOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="p-4 pt-0">
            <div className="pt-2">
              <EnvVarEditor vars={envVars} onChange={setEnvVars} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Advanced: Domain */}
        <div className="space-y-3 pt-2 border-t border-border">
          <Label className="text-foreground/90">Custom Subdomain (Optional)</Label>
          <div className="flex gap-2 items-center">
            <div className="flex-1 flex items-center">
              <Input
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setSubdomainStatus('idle');
                  setSubdomainError('');
                }}
                placeholder="my-app"
                className="text-right bg-surface-muted/60 border-border rounded-r-none rounded-l-xl border-r-0"
              />
              <div className="bg-surface-muted border border-border border-l-0 px-3 h-10 flex items-center rounded-r-xl">
                <span className="text-muted-foreground text-sm whitespace-nowrap">.thakur.dev</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={checkSubdomain}
              disabled={!domain || subdomainStatus === 'loading'}
              className="h-10 border-border hover:bg-surface-muted text-foreground/90"
            >
              {subdomainStatus === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Check Availability'
              )}
            </Button>
          </div>
          {subdomainStatus === 'available' && (
            <p className="text-sm text-foreground/90 flex items-center gap-1">
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

        {/* Port Configuration */}
        <div className="space-y-3 pt-2 border-t border-border">
          <Label className="text-foreground/90">Port (Optional)</Label>
          <div className="flex gap-2 items-center">
            <div className="flex-1 flex items-center">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setPortStatus('idle');
                  setPortError('');
                }}
                placeholder="Auto-assigned (5000-6000)"
                className="bg-surface-muted/60 border-border"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={checkPort}
              disabled={!port || portStatus === 'loading'}
              className="h-10 border-border hover:bg-surface-muted text-foreground/90"
            >
              {portStatus === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Check Availability'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave blank for auto-assignment, or specify a custom port (1024-65535).
          </p>
          {portStatus === 'available' && (
            <p className="text-sm text-foreground/90 flex items-center gap-1">
              <Check className="h-3 w-3 text-emerald-400" /> Port is available
            </p>
          )}
          {portStatus === 'unavailable' && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <X className="h-3 w-3" /> {portError || 'Port is already taken'}
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-6 flex flex-col gap-4">
          <div className="flex items-center space-x-2">
            <Switch id="auto-deploy" checked={autoDeploy} onCheckedChange={setAutoDeploy} />
            <Label htmlFor="auto-deploy" className="text-foreground/90 font-normal">
              Auto Deploy on push
            </Label>
          </div>

          <Button className="w-full h-12 text-base" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Deploy Project
          </Button>
        </div>
      </div>
    </div>
  );
}
