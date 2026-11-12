'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleDashed,
  DatabaseZap,
  FolderGit2,
  GitBranch,
  Globe,
  Hammer,
  KeyRound,
  Lock,
  Loader2,
  Package,
  Rocket,
  RotateCcw,
  Settings2,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FrameworkIcon } from '@/components/ui/framework-icons';
import {
  PreDeployCommandInput,
  PreDeploySuggestion,
} from '@/components/deploy/pre-deploy-command-input';
import {
  DEFAULT_PASSWORD_PROTECTION,
  PasswordProtectionFields,
  PasswordProtectionValue,
  passwordProtectionError,
  toAccessPayload,
} from '@/components/deploy/password-protection-fields';
import { GitRepository } from './repository-list';
import { EnvVarEditor, EnvVar } from '../env-var-editor';
import {
  AppType,
  FRAMEWORK_OPTIONS,
  getDefaultBuildCommand,
  isStaticFramework,
} from '@/lib/framework-config';
import { cn } from '@/lib/utils';

const BASE_DOMAIN = 'thakur.dev';

interface ProjectConfigFormProps {
  repo: GitRepository;
  loading: boolean;
  onBack: () => void;
  onSubmit: (config: ProjectConfig) => void;
  initialRootDirectory?: string;
  initialFramework?: string;
  /** Why the framework was detected, e.g. "Found bun.lock". */
  detectionReason?: string;
  preDeploySuggestion?: PreDeploySuggestion | null;
  /** Build command worked out from the repo layout (e.g. Go `cmd/` packages). */
  buildSuggestion?: { command: string; reason: string } | null;
  /** e.g. "Go 1.23" from go.mod. */
  runtimeVersion?: string | null;
}

export interface ProjectConfig {
  name: string;
  appType: AppType;
  buildCommand: string;
  preDeployCommand: string | null;
  rootDirectory: string;
  domain?: string;
  port?: number;
  envVars: Record<string, string>;
  autoDeploy: boolean;
  access?: { password: string; session_hours: number };
}

type CheckStatus = 'idle' | 'loading' | 'available' | 'unavailable' | 'error';

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-');

const trimSlug = (value: string) => value.replace(/^-+|-+$/g, '');

/**
 * Runs `check` for `value` after the user stops typing, ignoring stale responses.
 */
function useDebouncedCheck(
  value: string,
  enabled: boolean,
  check: (value: string) => Promise<{ available: boolean; reason?: string }>,
) {
  const [status, setStatus] = useState<CheckStatus>('idle');
  const [message, setMessage] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (!enabled || !value) {
      setStatus('idle');
      setMessage('');
      return;
    }
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const result = await check(value);
        if (id !== requestId.current) return;
        setStatus(result.available ? 'available' : 'unavailable');
        setMessage(result.available ? '' : result.reason || 'Already taken');
      } catch (e: any) {
        if (id !== requestId.current) return;
        setStatus('error');
        setMessage(e?.message || 'Could not check availability');
      }
    }, 450);
    return () => clearTimeout(timer);
    // `check` is a stable module-level call; re-run only when the input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  return { status, message };
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'loading')
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />;
  if (status === 'available')
    return <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />;
  if (status === 'unavailable' || status === 'error')
    return <X className="size-4 text-destructive" aria-hidden />;
  return null;
}

function Section({
  icon: Icon,
  title,
  description,
  children,
  aside,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="surface-card rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted">
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ProjectConfigForm({
  repo,
  loading,
  onBack,
  onSubmit,
  initialRootDirectory = './',
  initialFramework,
  detectionReason,
  preDeploySuggestion,
  buildSuggestion,
  runtimeVersion,
}: ProjectConfigFormProps) {
  const detectedAppType = (initialFramework as AppType | undefined) ?? null;
  // The detected framework's build command comes from the repo layout when we know it.
  const defaultBuildFor = (type: AppType) =>
    type === detectedAppType && buildSuggestion
      ? buildSuggestion.command
      : getDefaultBuildCommand(type);
  const [name, setName] = useState(trimSlug(toSlug(repo.name)));
  const [rootDirectory, setRootDirectory] = useState(initialRootDirectory);
  const [domain, setDomain] = useState('');
  const [port, setPort] = useState('');
  const [appType, setAppType] = useState<AppType>(detectedAppType ?? 'nextjs');
  const [buildCommand, setBuildCommand] = useState(() => defaultBuildFor(appType));
  const [protection, setProtection] = useState<PasswordProtectionValue>(
    DEFAULT_PASSWORD_PROTECTION,
  );
  const [preDeployCommand, setPreDeployCommand] = useState('');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [envOpen, setEnvOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const isStatic = isStaticFramework(appType);
  const framework = FRAMEWORK_OPTIONS.find((f) => f.value === appType)!;
  const defaultBuildCommand = defaultBuildFor(appType);
  const isGo = appType === 'go';
  const protectionError = passwordProtectionError(protection);
  const effectivePreDeploy = isStatic ? '' : preDeployCommand.trim();
  const definedEnvVars = envVars.filter((v) => v.key.trim());
  const hasDatabaseEnv = definedEnvVars.some((v) =>
    /DATABASE|DB_|POSTGRES|MYSQL|MONGO/i.test(v.key),
  );

  const subdomain = trimSlug(domain);
  const domainCheck = useDebouncedCheck(subdomain, true, (value) =>
    api.checkDomainAvailability(value),
  );
  const portNumber = Number(port);
  const portInRange = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;
  const portCheck = useDebouncedCheck(port, !isStatic && portInRange, (value) =>
    api.checkPortAvailability(Number(value)),
  );
  const portError =
    !isStatic && port && !portInRange ? 'Port must be between 1024 and 65535' : portCheck.message;

  const nameError = submitted && !trimSlug(name) ? 'Project name is required' : '';
  const buildError = submitted && !buildCommand.trim() ? 'Build command is required' : '';

  // Migration commands almost always need a connection string: surface the env section.
  useEffect(() => {
    if (effectivePreDeploy && !hasDatabaseEnv) setEnvOpen(true);
  }, [effectivePreDeploy, hasDatabaseEnv]);

  const handleAppTypeChange = (value: AppType) => {
    // Keep a hand-edited build command; swap only the untouched default.
    if (buildCommand.trim() === defaultBuildCommand) {
      setBuildCommand(defaultBuildFor(value));
    }
    setAppType(value);
    if (isStaticFramework(value)) setPort('');
  };

  const previewHost = `${subdomain || `${trimSlug(name) || 'my-app'}-xxxx`}.${BASE_DOMAIN}`;

  const blockingIssue = useMemo(() => {
    if (!trimSlug(name)) return 'Add a project name';
    if (!buildCommand.trim()) return 'Add a build command';
    if (subdomain && domainCheck.status === 'unavailable') return 'Choose another subdomain';
    if (!isStatic && port && !portInRange) return 'Fix the port';
    if (!isStatic && port && portCheck.status === 'unavailable') return 'Choose another port';
    if (protectionError) return protectionError;
    return null;
  }, [
    protectionError,
    name,
    buildCommand,
    subdomain,
    domainCheck.status,
    isStatic,
    port,
    portInRange,
    portCheck.status,
  ]);

  const handleSubmit = () => {
    setSubmitted(true);
    if (blockingIssue) {
      toast.error(blockingIssue);
      return;
    }
    if (domainCheck.status === 'loading' || portCheck.status === 'loading') {
      toast.message('Still checking availability, try again in a moment.');
      return;
    }

    onSubmit({
      name: trimSlug(name),
      appType,
      buildCommand: buildCommand.trim(),
      preDeployCommand: effectivePreDeploy || null,
      rootDirectory,
      domain: subdomain,
      port: !isStatic && port ? portNumber : undefined,
      envVars: Object.fromEntries(definedEnvVars.map((v) => [v.key.trim(), v.value])),
      autoDeploy,
      access: toAccessPayload(protection),
    });
  };

  // Cmd/Ctrl + Enter deploys from anywhere in the form.
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pipeline = [
    { icon: GitBranch, label: 'Clone', detail: `${repo.default_branch ?? 'main'} branch` },
    isGo
      ? { icon: Package, label: 'Modules', detail: 'go mod download' }
      : { icon: Package, label: 'Install', detail: 'bun install' },
    { icon: Hammer, label: 'Build', detail: buildCommand.trim() || '—' },
    ...(effectivePreDeploy
      ? [{ icon: DatabaseZap, label: 'Pre-deploy', detail: effectivePreDeploy, highlight: true }]
      : []),
    {
      icon: Rocket,
      label: isStatic ? 'Serve' : 'Start',
      detail: isStatic
        ? 'Static files via Nginx'
        : isGo
          ? `Compiled binary on port ${port || 'auto'}`
          : `${framework.label} on port ${port || 'auto'}`,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground">Configure project</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            Deploying
            <span className="truncate rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {repo.full_name}
            </span>
            {rootDirectory && rootDirectory !== './' && (
              <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                /{rootDirectory.replace(/^\.?\//, '')}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1.5 size-4" />
          Change repo
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* Project & URL */}
          <Section icon={Globe} title="Project" description="Name and public address.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => setName(toSlug(e.target.value))}
                  onBlur={() => setName((n) => trimSlug(n))}
                  placeholder="my-project"
                  aria-invalid={!!nameError}
                  className="font-mono text-sm"
                />
                {nameError ? (
                  <p className="text-xs text-destructive">{nameError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, dashes.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="subdomain">
                  Subdomain <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="subdomain"
                      value={domain}
                      onChange={(e) => setDomain(toSlug(e.target.value))}
                      placeholder={trimSlug(name) || 'my-app'}
                      aria-invalid={domainCheck.status === 'unavailable'}
                      aria-describedby="subdomain-status"
                      className="rounded-r-none pr-8 font-mono text-sm"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <StatusIcon status={domainCheck.status} />
                    </span>
                  </div>
                  <span className="flex h-10 items-center rounded-r-xl border border-l-0 border-border bg-surface-muted px-3 text-sm text-muted-foreground">
                    .{BASE_DOMAIN}
                  </span>
                </div>
                <p
                  id="subdomain-status"
                  aria-live="polite"
                  className={cn(
                    'text-xs',
                    domainCheck.status === 'unavailable' || domainCheck.status === 'error'
                      ? 'text-destructive'
                      : domainCheck.status === 'available'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-muted-foreground',
                  )}
                >
                  {domainCheck.status === 'available'
                    ? `${subdomain}.${BASE_DOMAIN} is available`
                    : domainCheck.status === 'loading'
                      ? 'Checking availability…'
                      : domainCheck.message || 'Leave blank for a generated subdomain.'}
                </p>
              </div>
            </div>
          </Section>

          {/* Framework */}
          <Section
            icon={Sparkles}
            title="Framework"
            description="Sets how Shipyard installs, builds and starts your app."
            aside={
              detectedAppType ? (
                <Badge variant="brand" title={detectionReason}>
                  <Sparkles /> Auto-detected
                </Badge>
              ) : (
                <Badge variant="secondary">Not detected</Badge>
              )
            }
          >
            <div role="radiogroup" aria-label="Framework" className="space-y-3">
              {(['Frontend', 'Backend'] as const).map((category) => (
                <div key={category}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {category}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {FRAMEWORK_OPTIONS.filter((f) => f.category === category).map((f) => {
                      const selected = f.value === appType;
                      return (
                        <button
                          key={f.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => handleAppTypeChange(f.value)}
                          className={cn(
                            'relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selected
                              ? 'border-brand-500/60 bg-brand-500/[0.07] text-foreground shadow-sm'
                              : 'border-border text-foreground/80 hover:border-foreground/25 hover:bg-surface-muted/60',
                          )}
                        >
                          <FrameworkIcon icon={f.value} size={20} />
                          <span className="truncate font-medium">{f.label}</span>
                          {f.value === detectedAppType && (
                            <span
                              className="absolute -top-1.5 right-1.5 rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
                              aria-label="detected"
                            >
                              detected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {detectionReason && detectedAppType && (
              <p className="mt-3 text-xs text-muted-foreground">
                {appType === detectedAppType ? 'Detected' : `Detected ${detectedAppType}`} —{' '}
                {detectionReason.charAt(0).toLowerCase() + detectionReason.slice(1)}
                {runtimeVersion && appType === detectedAppType ? ` · ${runtimeVersion}` : ''}.
              </p>
            )}
            <div className="mt-4 space-y-2">
              <Label htmlFor="root-directory">Root directory</Label>
              <div className="relative">
                <FolderGit2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="root-directory"
                  value={rootDirectory}
                  onChange={(e) => setRootDirectory(e.target.value)}
                  placeholder="./"
                  className="pl-9 font-mono text-sm"
                />
              </div>
            </div>
          </Section>

          {/* Build & release */}
          <Section
            icon={Terminal}
            title="Build & release"
            description="Commands that run on every deploy."
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="build-command">Build command</Label>
                  {buildCommand.trim() !== defaultBuildCommand && (
                    <button
                      type="button"
                      onClick={() => setBuildCommand(defaultBuildCommand)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="size-3" /> Reset to default
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Hammer className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="build-command"
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    aria-invalid={!!buildError}
                    spellCheck={false}
                    className="pl-9 font-mono text-sm"
                  />
                </div>
                {buildError ? (
                  <p className="text-xs text-destructive">{buildError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {isGo
                      ? appType === detectedAppType && buildSuggestion
                        ? `Compiled with the Go toolchain (${buildSuggestion.reason}); the binary is started directly.`
                        : 'Compiled with the Go toolchain; the resulting binary is started directly.'
                      : framework.category === 'Backend'
                        ? 'Skipped automatically when your package.json has no build script.'
                        : 'Runs after dependencies are installed.'}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="pre-deploy-command">
                  Pre-deploy command{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <PreDeployCommandInput
                  value={isStatic ? '' : preDeployCommand}
                  onChange={setPreDeployCommand}
                  suggestion={preDeploySuggestion}
                  disabled={isStatic}
                />
              </div>
            </div>
          </Section>

          {/* Environment variables */}
          <Collapsible
            open={envOpen}
            onOpenChange={setEnvOpen}
            className="surface-card rounded-xl border border-border bg-card"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
              <span className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-muted">
                  <KeyRound className="size-4 text-muted-foreground" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    Environment variables
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Paste a .env file into any field to import it.
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{definedEnvVars.length}</Badge>
                <ChevronDown
                  className={cn(
                    'size-4 text-muted-foreground transition-transform',
                    envOpen && 'rotate-180',
                  )}
                />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4 sm:px-5">
              {effectivePreDeploy && !hasDatabaseEnv && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Your pre-deploy command probably needs a connection string such as{' '}
                  <code className="font-mono">DATABASE_URL</code>.
                </div>
              )}
              <EnvVarEditor vars={envVars} onChange={setEnvVars} />
            </CollapsibleContent>
          </Collapsible>

          {/* Access */}
          <Section
            icon={Lock}
            title="Access"
            description="Keep the site private from its very first deploy."
            aside={protection.enabled ? <Badge variant="brand">Protected</Badge> : undefined}
          >
            <PasswordProtectionFields
              value={protection}
              onChange={setProtection}
              showErrors={submitted}
            />
          </Section>

          {/* Advanced */}
          <Collapsible
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            className="surface-card rounded-xl border border-border bg-card"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
              <span className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-muted">
                  <Settings2 className="size-4 text-muted-foreground" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">Advanced</span>
                  <span className="block text-xs text-muted-foreground">
                    Port and automatic deploys.
                  </span>
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 px-4 pb-5 sm:px-5">
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <div className="relative max-w-xs">
                  <Input
                    id="port"
                    type="number"
                    inputMode="numeric"
                    min={1024}
                    max={65535}
                    value={isStatic ? '' : port}
                    disabled={isStatic}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder={isStatic ? 'Not needed for static sites' : 'Auto-assigned'}
                    aria-invalid={!!portError && !isStatic}
                    className="pr-8 font-mono text-sm"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {!isStatic && (
                      <StatusIcon
                        status={portInRange ? portCheck.status : port ? 'unavailable' : 'idle'}
                      />
                    )}
                  </span>
                </div>
                <p
                  aria-live="polite"
                  className={cn(
                    'text-xs',
                    portError && !isStatic ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {isStatic
                    ? 'Static files are served directly by Nginx.'
                    : portError ||
                      (portCheck.status === 'available'
                        ? `Port ${port} is free`
                        : 'Leave blank to pick a free port automatically. Your app must listen on the PORT environment variable.')}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
                <Label
                  htmlFor="auto-deploy"
                  className="flex flex-col items-start gap-0.5 font-normal"
                >
                  <span className="text-sm font-medium text-foreground">Deploy on push</span>
                  <span className="text-xs text-muted-foreground">
                    Rebuild when commits land on {repo.default_branch ?? 'main'}.
                  </span>
                </Label>
                <Switch id="auto-deploy" checked={autoDeploy} onCheckedChange={setAutoDeploy} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Live summary */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="surface-card overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-surface-muted/40 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
                  <FrameworkIcon icon={appType} size={22} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {trimSlug(name) || 'Untitled project'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {framework.label}
                    {runtimeVersion && appType === detectedAppType
                      ? ` ${runtimeVersion.replace(/^\D+/, '')}`
                      : ''}{' '}
                    · {framework.category.toLowerCase()}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 truncate rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground/90">
                {protection.enabled ? (
                  <Lock className="size-3.5 shrink-0 text-brand-800 dark:text-brand-300" />
                ) : (
                  <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">https://{previewHost}</span>
              </div>
            </div>

            <ol className="space-y-0 p-4" aria-label="Deployment steps">
              {pipeline.map((step, i) => (
                <li key={step.label} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < pipeline.length - 1 && (
                    <span className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-border" />
                  )}
                  <span
                    className={cn(
                      'z-10 flex size-6 shrink-0 items-center justify-center rounded-full border',
                      'highlight' in step && step.highlight
                        ? 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-300'
                        : 'border-border bg-card text-muted-foreground',
                    )}
                  >
                    <step.icon className="size-3" />
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className="block text-xs font-medium text-foreground">{step.label}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {step.detail}
                    </span>
                  </span>
                </li>
              ))}
              <li className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <Check className="size-3" />
                </span>
                <span className="pt-1 text-xs font-medium text-foreground">Live</span>
              </li>
            </ol>

            <div className="space-y-1.5 border-t border-border px-4 py-3 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Env variables</span>
                <span className="font-medium text-foreground">{definedEnvVars.length}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Password protection</span>
                <span className="font-medium text-foreground">
                  {protection.enabled ? 'On' : 'Off'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Deploy on push</span>
                <span className="font-medium text-foreground">{autoDeploy ? 'On' : 'Off'}</span>
              </div>
            </div>

            <div className="border-t border-border p-4">
              <Button className="h-11 w-full text-base" onClick={handleSubmit} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-2 size-5 animate-spin" />
                ) : (
                  <Rocket className="mr-2 size-4" />
                )}
                {loading ? 'Deploying…' : 'Deploy'}
              </Button>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                {submitted && blockingIssue ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <CircleDashed className="size-3" /> {blockingIssue}
                  </span>
                ) : (
                  <>
                    Press
                    <kbd className="rounded border border-border bg-surface-muted px-1 font-sans">
                      Ctrl
                    </kbd>
                    +
                    <kbd className="rounded border border-border bg-surface-muted px-1 font-sans">
                      Enter
                    </kbd>
                    to deploy
                  </>
                )}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
