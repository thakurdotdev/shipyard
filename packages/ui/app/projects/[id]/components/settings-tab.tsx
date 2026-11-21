'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PreDeployCommandInput } from '@/components/deploy/pre-deploy-command-input';
import { BranchSelect } from '@/components/github/branch-select';
import {
  Field,
  SaveFooter,
  SettingsSection,
  ToggleRow,
  useUnsavedWarning,
} from '@/components/settings/settings-section';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { FRAMEWORK_OPTIONS, isStaticFramework, type AppType } from '@/lib/framework-config';
import { queryKeys } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { setQueryData } from '@/lib/use-query';
import { cn } from '@/lib/utils';
import { AccessProtectionCard } from './access-protection-card';
import { DomainSettingsCard } from './domain-settings-card';

interface SettingsTabProps {
  project: Project;
  hasDeployment: boolean;
  onStopDeployment: () => void;
  /** Called after a change other parts of the page show, such as the branch. */
  onProjectChange: () => void;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'An unexpected error occurred';

export function SettingsTab({
  project,
  hasDeployment,
  onStopDeployment,
  onProjectChange,
}: SettingsTabProps) {
  const connected = !!(project.github_installation_id && project.github_repo_id);
  const sections = [
    { id: 'general', label: 'Build & runtime' },
    { id: 'git', label: 'Git' },
    { id: 'domain', label: 'Domain' },
    { id: 'access', label: 'Access' },
    { id: 'builds', label: 'Build history' },
    { id: 'danger', label: 'Danger zone' },
  ];
  const active = useScrollSpy(sections.map((section) => section.id));

  // Reflect saves everywhere the project is shown, without waiting for a refetch.
  const applyUpdate = (updated: Partial<Project>) =>
    setQueryData<Project | undefined>(queryKeys.project(project.id), (prev) =>
      prev ? { ...prev, ...updated } : prev,
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-36 space-y-0.5 text-[13px]">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById(section.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  history.replaceState(history.state, '', `#${section.id}`);
                }}
                className={cn(
                  'block rounded-md px-2.5 py-1.5 transition-colors',
                  active === section.id
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  section.id === 'danger' &&
                    active !== 'danger' &&
                    'hover:text-red-600 dark:hover:text-red-400',
                )}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-5">
        <GeneralSection project={project} onSaved={applyUpdate} />
        <GitSection
          project={project}
          connected={connected}
          onSaved={(updated) => {
            applyUpdate(updated);
            onProjectChange();
          }}
        />
        <DomainSettingsCard project={project} onDomainChange={onProjectChange} />
        <AccessProtectionCard
          projectId={project.id}
          onProtectionChange={(enabled) => applyUpdate({ access_protected: enabled })}
        />
        <RetentionSection project={project} onSaved={applyUpdate} />
        <DangerSection
          project={project}
          hasDeployment={hasDeployment}
          onStopDeployment={onStopDeployment}
        />
      </div>
    </div>
  );
}

/** The section nearest the top of the viewport, and scrolling to the URL's #section on load. */
function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && ids.includes(hash)) {
      // Wait a frame so the sections have laid out.
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ block: 'start' }),
      );
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return active;
}

function GeneralSection({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (updated: Partial<Project>) => void;
}) {
  const initial = {
    appType: project.app_type,
    rootDirectory: project.root_directory || './',
    buildCommand: project.build_command,
    preDeployCommand: project.pre_deploy_command ?? '',
    port: project.port ? String(project.port) : '',
  };
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const isStatic = isStaticFramework(form.appType);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'port') setPortError(null);
  };

  const dirty =
    form.appType !== saved.appType ||
    form.rootDirectory !== saved.rootDirectory ||
    form.buildCommand !== saved.buildCommand ||
    form.preDeployCommand.trim() !== saved.preDeployCommand.trim() ||
    (!isStatic && form.port !== saved.port);
  useUnsavedWarning(dirty);

  const portValue = form.port.trim() ? Number(form.port) : undefined;
  const portInvalid =
    !isStatic &&
    portValue !== undefined &&
    (!Number.isInteger(portValue) || portValue < 1024 || portValue > 65535);

  const save = async () => {
    setSaving(true);
    try {
      if (!isStatic && portValue !== undefined && portValue !== project.port) {
        const check = await api.checkPortAvailability(portValue);
        if (!check.available) {
          setPortError(check.reason || `Port ${portValue} is not available`);
          return;
        }
      }
      const changes = {
        build_command: form.buildCommand,
        pre_deploy_command: form.preDeployCommand.trim() || null,
        app_type: form.appType,
        root_directory: form.rootDirectory,
        port: isStatic ? undefined : portValue,
      };
      await api.updateProject(project.id, changes);
      const next = { ...form, preDeployCommand: form.preDeployCommand.trim() };
      setSaved(next);
      setForm(next);
      onSaved({ ...changes, port: changes.port ?? project.port });
      toast.success('Build settings saved', { description: 'They apply from the next deploy.' });
    } catch (error) {
      toast.error('Could not save build settings', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="general"
      title="Build & runtime"
      description="How Shipyard builds the project and runs it on the server."
      footer={
        <SaveFooter
          dirty={dirty}
          saving={saving}
          canSave={!portInvalid}
          onSave={save}
          onReset={() => (setForm(saved), setPortError(null))}
          note="Changes apply from the next deploy."
        />
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Framework" htmlFor="app-type">
          <Select value={form.appType} onValueChange={(value) => set('appType', value as AppType)}>
            <SelectTrigger id="app-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FRAMEWORK_OPTIONS.map((framework) => (
                <SelectItem key={framework.value} value={framework.value}>
                  {framework.label}
                  <span className="text-xs text-muted-foreground">{framework.category}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Root directory"
          htmlFor="root-directory"
          hint="Folder with the app’s package.json, for monorepos."
        >
          <Input
            id="root-directory"
            value={form.rootDirectory}
            onChange={(event) => set('rootDirectory', event.target.value)}
            placeholder="./"
            spellCheck={false}
            className="font-mono text-sm"
          />
        </Field>
        <Field label="Build command" htmlFor="build-command">
          <Input
            id="build-command"
            value={form.buildCommand}
            onChange={(event) => set('buildCommand', event.target.value)}
            placeholder="npm run build"
            spellCheck={false}
            className="font-mono text-sm"
          />
        </Field>
        <Field
          label="Port"
          htmlFor="port"
          error={portError ?? (portInvalid ? 'Use a port between 1024 and 65535.' : null)}
          hint={
            isStatic
              ? 'Static files are served by Nginx; no port needed.'
              : 'Leave empty to assign one automatically.'
          }
        >
          <Input
            id="port"
            type="number"
            inputMode="numeric"
            min={1024}
            max={65535}
            value={isStatic ? '' : form.port}
            disabled={isStatic}
            onChange={(event) => set('port', event.target.value)}
            placeholder={isStatic ? 'Not used' : 'Auto'}
            aria-invalid={portInvalid || !!portError}
            className="font-mono text-sm"
          />
        </Field>
      </div>
      <Field label="Pre-deploy command" htmlFor="pre-deploy-command" optional>
        <PreDeployCommandInput
          value={isStatic ? '' : form.preDeployCommand}
          onChange={(value) => set('preDeployCommand', value)}
          disabled={isStatic}
        />
      </Field>
    </SettingsSection>
  );
}

function GitSection({
  project,
  connected,
  onSaved,
}: {
  project: Project;
  connected: boolean;
  onSaved: (updated: Partial<Project>) => void;
}) {
  const initial = {
    branch: project.github_branch || 'main',
    autoDeploy: project.auto_deploy ?? true,
    paths: project.auto_deploy_paths ?? '',
  };
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const root = (project.root_directory || './').replace(/^(\.\/)+|^\.$/, '').replace(/\/$/, '');
  const repo =
    project.github_repo_full_name ?? project.github_url.replace(/^https?:\/\/github\.com\//, '');

  const dirty =
    form.branch !== saved.branch ||
    form.autoDeploy !== saved.autoDeploy ||
    form.paths.trim() !== saved.paths.trim();
  useUnsavedWarning(dirty);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, {
        ...(form.branch !== saved.branch ? { github_branch: form.branch } : {}),
        auto_deploy: form.autoDeploy,
        auto_deploy_paths: form.paths.trim() || null,
      });
      // The server canonicalises branch and paths; show what it stored.
      const next = {
        branch: updated?.github_branch || form.branch,
        autoDeploy: updated?.auto_deploy ?? form.autoDeploy,
        paths: updated?.auto_deploy_paths ?? '',
      };
      const branchChanged = next.branch !== saved.branch;
      setSaved(next);
      setForm(next);
      onSaved({
        github_branch: next.branch,
        auto_deploy: next.autoDeploy,
        auto_deploy_paths: next.paths || null,
      });
      toast.success(branchChanged ? `Now deploying from ${next.branch}` : 'Git settings saved', {
        description: branchChanged
          ? 'The live deployment stays until the next deploy.'
          : next.autoDeploy
            ? next.paths
              ? 'Pushes deploy when watched paths change.'
              : `Every push to ${next.branch} deploys.`
            : 'Pushes no longer deploy automatically.',
        ...(branchChanged
          ? {
              action: {
                label: 'Deploy now',
                onClick: () =>
                  void api
                    .triggerBuild(project.id)
                    .then(() => toast.success(`Deploying the latest commit on ${next.branch}`))
                    .catch((error: Error) =>
                      toast.error('Could not start the deploy', { description: error.message }),
                    ),
              },
            }
          : {}),
      });
    } catch (error) {
      toast.error('Could not save Git settings', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="git"
      title="Git"
      description={
        <>
          Builds clone{' '}
          <a
            href={project.github_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-mono text-xs text-foreground hover:underline"
          >
            {repo}
            <ArrowUpRight className="size-3" />
          </a>
          {connected
            ? '.'
            : ' over Git. Connect the GitHub app to pick a branch and deploy on push.'}
        </>
      }
      footer={
        connected && (
          <SaveFooter
            dirty={dirty}
            saving={saving}
            onSave={save}
            onReset={() => setForm(saved)}
            note={
              form.autoDeploy
                ? `Pushes to ${saved.branch} deploy automatically.`
                : 'Deploys only when you press Deploy.'
            }
          />
        )
      }
    >
      {connected && (
        <>
          <Field
            label="Production branch"
            htmlFor="production-branch"
            hint="The branch every build clones."
          >
            <BranchSelect
              id="production-branch"
              value={form.branch}
              onChange={(branch) => setForm((prev) => ({ ...prev, branch }))}
              load={() => api.getProjectBranches(project.id)}
              sourceKey={project.id}
              disabled={saving}
            />
          </Field>
          <ToggleRow
            id="auto-deploy"
            label="Deploy on push"
            description={`Build and release every push to ${form.branch}.`}
            control={
              <Switch
                id="auto-deploy"
                checked={form.autoDeploy}
                onCheckedChange={(autoDeploy) => setForm((prev) => ({ ...prev, autoDeploy }))}
                disabled={saving}
              />
            }
          />
          <Field
            label="Only deploy when these paths change"
            htmlFor="auto-deploy-paths"
            optional
            hint={
              <>
                One path or glob per line (<code>apps/web</code>, <code>packages/*</code>); prefix{' '}
                <code>!</code> to exclude. Always watched:{' '}
                {root ? (
                  <>
                    <code>{root}</code>,{' '}
                  </>
                ) : null}
                workspace packages it depends on, and root lockfiles. Empty commits and force pushes
                always deploy.
              </>
            }
          >
            <Textarea
              id="auto-deploy-paths"
              value={form.paths}
              onChange={(event) => setForm((prev) => ({ ...prev, paths: event.target.value }))}
              placeholder={`${root || 'apps/web'}\npackages/config\n!**/*.md`}
              rows={3}
              spellCheck={false}
              disabled={!form.autoDeploy || saving}
              className="font-mono text-sm"
            />
          </Field>
        </>
      )}
    </SettingsSection>
  );
}

function RetentionSection({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (updated: Partial<Project>) => void;
}) {
  const initial = project.keep_builds ? String(project.keep_builds) : 'all';
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const options = Array.from(
    new Set([2, 3, 5, 10, 20, ...(project.keep_builds ? [project.keep_builds] : [])]),
  ).sort((a, b) => a - b);

  const save = async () => {
    const keep = value === 'all' ? null : Number(value);
    setSaving(true);
    try {
      await api.updateProject(project.id, { keep_builds: keep });
      setSaved(value);
      onSaved({ keep_builds: keep });
      toast.success('Build retention saved');
    } catch (error) {
      toast.error('Could not save build retention', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="builds"
      title="Build history"
      description="Old builds hold a copy of the repository, dependencies and output. Pruning them frees disk space."
      footer={
        <SaveFooter
          dirty={value !== saved}
          saving={saving}
          onSave={save}
          onReset={() => setValue(saved)}
          note={
            saved === 'all'
              ? 'Builds are kept until you delete them.'
              : `Pruned after each successful deploy. The live build is always kept.`
          }
        />
      }
    >
      <Field label="Keep" htmlFor="keep-builds" className="max-w-xs">
        <Select value={value} onValueChange={setValue} disabled={saving}>
          <SelectTrigger id="keep-builds" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every build</SelectItem>
            {options.map((count) => (
              <SelectItem key={count} value={String(count)}>
                The newest {count} builds
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SettingsSection>
  );
}

function DangerSection({
  project,
  hasDeployment,
  onStopDeployment,
}: {
  project: Project;
  hasDeployment: boolean;
  onStopDeployment: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<'stop' | 'delete' | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (confirmName !== project.name) return;
    setDeleting(true);
    try {
      await api.deleteProject(project.id);
      toast.success(`Deleted ${project.name}`);
      router.push('/');
    } catch (error) {
      toast.error('Could not delete the project', { description: errorMessage(error) });
      setDeleting(false);
    }
  };

  const row =
    'flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between';
  return (
    <SettingsSection id="danger" title="Danger zone" tone="danger">
      <div className="divide-y divide-border">
        {hasDeployment && (
          <div className={row}>
            <div>
              <p className="text-sm font-medium">Stop production</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Takes the site offline. Builds and settings stay; deploy again to bring it back.
              </p>
            </div>
            <Button variant="outline" className="shrink-0" onClick={() => setDialog('stop')}>
              Stop production
            </Button>
          </div>
        )}
        <div className={row}>
          <div>
            <p className="text-sm font-medium">Delete project</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Removes the project with its deployments, builds, files and domain records. This can’t
              be undone.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 border-red-500/30 text-red-700 hover:border-red-500/50 hover:bg-red-500/10 dark:text-red-400"
            onClick={() => setDialog('delete')}
          >
            Delete project
          </Button>
        </div>
      </div>

      <AlertDialog open={dialog === 'stop'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop production for {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {project.domain ?? 'The site'} stops answering until you deploy again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onStopDeployment}
            >
              Stop production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => {
          if (open || deleting) return;
          setDialog(null);
          setConfirmName('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every deployment, build, log and environment variable of this project is removed, and
              its site goes offline. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label={`Type ${project.name} to confirm`} htmlFor="confirm-name">
            <Input
              id="confirm-name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void remove()}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={confirmName !== project.name || deleting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
