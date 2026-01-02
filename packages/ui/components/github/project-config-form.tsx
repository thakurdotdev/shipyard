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

    onSubmit({
      name,
      appType,
      buildCommand,
      rootDirectory,
      domain,
      envVars: envVarsRecord,
      autoDeploy,
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Configure Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Configure Project</h2>
          <p className="text-zinc-400 text-sm">
            Deploying{' '}
            <span className="text-zinc-200 font-mono bg-zinc-800 px-1 py-0.5 rounded text-xs">
              {repo.full_name}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-zinc-400 hover:text-white"
        >
          Change Repo
        </Button>
      </div>

      <div className="space-y-6 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
        {/* Project Name */}
        <div className="space-y-3">
          <Label className="text-zinc-300">Project Name</Label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="bg-zinc-950/50 border-zinc-700/50 focus-visible:ring-zinc-500/20"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Used as the unique identifier and default subdomain.
          </p>
        </div>

        {/* Framework & Directory */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Label className="text-zinc-300">Framework Preset</Label>
            <Select value={appType} onValueChange={handleAppTypeChange}>
              <SelectTrigger className="bg-zinc-950/50 border-zinc-700/50">
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
            <Label className="text-zinc-300">Root Directory</Label>
            <div className="relative">
              <FolderGit2 className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input
                value={rootDirectory}
                onChange={(e) => setRootDirectory(e.target.value)}
                placeholder="./"
                className="pl-9 bg-zinc-950/50 border-zinc-700/50"
              />
            </div>
          </div>
        </div>

        {/* Collapsible Build Settings */}
        <Collapsible
          open={isBuildSettingsOpen}
          onOpenChange={setIsBuildSettingsOpen}
          className="bg-zinc-950/30 border border-zinc-800/50 rounded-lg"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full flex justify-between items-center p-4 h-auto hover:bg-zinc-800/50"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-zinc-400" />
                <span className="font-medium text-zinc-300">Build Settings</span>
              </div>
              {isBuildSettingsOpen ? (
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-500" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="p-4 pt-0 space-y-4">
            <div className="space-y-3 pt-2">
              <Label className="text-zinc-400 text-xs uppercase tracking-wide">Build Command</Label>
              <div className="relative">
                <Terminal className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <Input
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  className="pl-9 bg-zinc-950/50 border-zinc-700/50 font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-zinc-400 text-xs uppercase tracking-wide">
                Output Directory (Optional)
              </Label>
              <div className="relative">
                <Box className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <Input
                  placeholder="dist, build, or public"
                  className="pl-9 bg-zinc-950/50 border-zinc-700/50"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Collapsible Env Vars */}
        <Collapsible
          open={isEnvVarsOpen}
          onOpenChange={setIsEnvVarsOpen}
          className="bg-zinc-950/30 border border-zinc-800/50 rounded-lg"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full flex justify-between items-center p-4 h-auto hover:bg-zinc-800/50"
            >
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-zinc-400" />
                <span className="font-medium text-zinc-300">Environment Variables</span>
                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                  {envVars.length}
                </span>
              </div>
              {isEnvVarsOpen ? (
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-500" />
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
        <div className="space-y-3 pt-2 border-t border-zinc-800/50">
          <Label className="text-zinc-300">Custom Subdomain (Optional)</Label>
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
                className="text-right bg-zinc-950/50 border-zinc-700/50 rounded-r-none border-r-0 focus-visible:ring-0"
              />
              <div className="bg-zinc-900 border border-l-0 border-zinc-700/50 px-3 h-10 flex items-center rounded-r-md">
                <span className="text-zinc-500 text-sm whitespace-nowrap">.thakur.dev</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={checkSubdomain}
              disabled={!domain || subdomainStatus === 'loading'}
              className="h-10 border-zinc-700/50 hover:bg-zinc-800 text-zinc-300"
            >
              {subdomainStatus === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Check Availability'
              )}
            </Button>
          </div>
          {subdomainStatus === 'available' && (
            <p className="text-sm text-zinc-300 flex items-center gap-1">
              <Check className="h-3 w-3" /> Available
            </p>
          )}
          {subdomainStatus === 'unavailable' && (
            <p className="text-sm text-red-400 flex items-center gap-1">
              <X className="h-3 w-3" /> Domain is taken
            </p>
          )}
          {subdomainError && <p className="text-sm text-red-400">{subdomainError}</p>}
        </div>

        {/* Footer Actions */}
        <div className="pt-6 flex flex-col gap-4">
          <div className="flex items-center space-x-2">
            <Switch id="auto-deploy" checked={autoDeploy} onCheckedChange={setAutoDeploy} />
            <Label htmlFor="auto-deploy" className="text-zinc-300 font-normal">
              Auto Deploy on push
            </Label>
          </div>

          <Button
            className="w-full h-12 text-base font-medium bg-white text-black hover:bg-zinc-200"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Deploy Project
          </Button>
        </div>
      </div>
    </div>
  );
}
