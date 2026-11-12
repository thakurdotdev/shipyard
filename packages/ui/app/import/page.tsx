'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { InstallationSelector, GitInstallation } from '@/components/github/installation-selector';
import { RepositoryList, GitRepository } from '@/components/github/repository-list';
import { ProjectConfigForm, ProjectConfig } from '@/components/github/project-config-form';
import { FolderPicker, Folder } from '@/components/github/folder-picker';
import { GitBranch, User, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type SelectedFolder = Folder;

export default function ImportPage() {
  const router = useRouter();

  // State
  const [step, setStep] = useState<'installations' | 'repos' | 'config'>('installations');
  const [loading, setLoading] = useState(true);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Data
  const [installations, setInstallations] = useState<GitInstallation[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitRepository | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null);
  // Resolved from the API: the install page of THIS server's GitHub App.
  const [githubApp, setGithubApp] = useState<{ installUrl: string } | null>(null);

  // Initial Fetch & URL Handling
  useEffect(() => {
    const init = async () => {
      try {
        const [data, app] = await Promise.all([api.getGithubInstallations(), api.getGithubApp()]);
        setInstallations(data.installations);
        setGithubApp(app);

        // Check URL for installation_id (Redirect from GitHub App Install)
        const params = new URLSearchParams(window.location.search);
        const installationIdParam = params.get('installation_id');

        if (installationIdParam) {
          const installedId = parseInt(installationIdParam);
          const exists = data.installations.find((i: GitInstallation) => i.id === installedId);

          if (exists) {
            handleInstallationSelect(installedId);
            toast.success('GitHub App connected successfully!');

            // Clean URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('installation_id');
            newUrl.searchParams.delete('setup_action');
            router.replace(newUrl.pathname);
          }
        }
      } catch (e) {
        console.error(e);
        toast.error('Failed to load GitHub installations');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handleInstallationSelect = async (id: number) => {
    setSelectedInstallation(id);
    setLoading(true);
    try {
      const data = await api.getGithubRepositories(id);
      setRepositories(data.repositories);
      setStep('repos');
    } catch (e) {
      toast.error('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  };

  const handleRepoSelect = (repo: GitRepository) => {
    setSelectedRepo(repo);
    setShowFolderPicker(true); // Show folder picker modal
  };

  const handleFolderSelect = (folder: SelectedFolder) => {
    setSelectedFolder(folder);
    setShowFolderPicker(false);
    setStep('config');
  };

  const handleDeploy = async (config: ProjectConfig) => {
    if (!selectedRepo || !selectedInstallation) return;
    setLoading(true);

    try {
      // 1. Create Project
      const project = await api.createProject({
        name: config.name,
        github_url: `https://github.com/${selectedRepo.full_name}`,
        build_command: config.buildCommand,
        pre_deploy_command: config.preDeployCommand,
        app_type: config.appType,
        root_directory: config.rootDirectory,
        domain: config.domain ? `${config.domain}.thakur.dev` : '',
        port: config.port,
        github_repo_id: selectedRepo.id.toString(),
        github_repo_full_name: selectedRepo.full_name,
        github_branch: selectedRepo.default_branch,
        github_installation_id: selectedInstallation.toString(),
        env_vars: config.envVars,
        auto_deploy: config.autoDeploy,
        access: config.access,
      });

      // 2. Trigger Build
      await api.triggerBuild(project.id);

      toast.success('Project created and deployment started!');
      router.push(`/projects/${project.id}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Deployment failed');
      setLoading(false);
    }
  };

  const handleInstallApp = () => {
    if (!githubApp?.installUrl) {
      toast.error('GitHub App install page is not available right now.');
      return;
    }
    window.open(githubApp.installUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="page-width relative min-h-[calc(100svh-4rem)] max-w-5xl pb-16 pt-8 sm:pt-10">
      <header className="mb-7 border-b border-border pb-6">
        <h1 className="page-heading">Import a repository</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Choose an installation, select a repository, then review the deployment settings.
        </p>
      </header>

      <div className="relative mb-7 flex items-center justify-between gap-1.5 text-xs font-medium sm:mb-8 sm:justify-start sm:gap-4 sm:text-sm">
        <div
          aria-current={step === 'installations' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 sm:gap-2',
            step === 'installations' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-full border',
              step === 'installations'
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-300'
                : 'border-border bg-surface-muted',
            )}
          >
            <User className="size-4" />
          </div>
          <span className="max-[359px]:sr-only">Account</span>
        </div>
        <div className="h-px min-w-3 flex-1 bg-border sm:max-w-14" />
        <div
          aria-current={step === 'repos' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 sm:gap-2',
            step === 'repos' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-full border',
              step === 'repos'
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-300'
                : 'border-border bg-surface-muted',
            )}
          >
            <GitBranch className="size-4" />
          </div>
          <span className="max-[359px]:sr-only">Repository</span>
        </div>
        <div className="h-px min-w-3 flex-1 bg-border sm:max-w-14" />
        <div
          aria-current={step === 'config' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 sm:gap-2',
            step === 'config' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-full border',
              step === 'config'
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-300'
                : 'border-border bg-surface-muted',
            )}
          >
            <Settings2 className="size-4" />
          </div>
          <span className="max-[359px]:sr-only">Configure</span>
        </div>
      </div>

      <div className="relative">
        {step === 'installations' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <InstallationSelector
              installations={installations}
              selectedId={selectedInstallation}
              onSelect={handleInstallationSelect}
              onInstall={handleInstallApp}
            />
          </div>
        )}

        {step === 'repos' && (
          <RepositoryList
            repositories={repositories}
            loading={loading}
            onSelect={handleRepoSelect}
          />
        )}

        {step === 'config' && selectedRepo && (
          <ProjectConfigForm
            repo={selectedRepo}
            loading={loading}
            onBack={() => setStep('repos')}
            onSubmit={handleDeploy}
            initialRootDirectory={selectedFolder?.path || './'}
            initialFramework={selectedFolder?.framework || undefined}
            detectionReason={selectedFolder?.detectionReason}
            preDeploySuggestion={selectedFolder?.preDeploy}
            preDeployOptions={selectedFolder?.preDeployOptions}
            migrationNotes={selectedFolder?.migrationNotes}
            buildSuggestion={selectedFolder?.buildCommand}
            runtimeVersion={selectedFolder?.runtimeVersion}
          />
        )}
      </div>

      {/* Folder Picker Modal */}
      {selectedRepo && selectedInstallation && (
        <FolderPicker
          isOpen={showFolderPicker}
          onClose={() => setShowFolderPicker(false)}
          onSelect={handleFolderSelect}
          installationId={selectedInstallation.toString()}
          owner={selectedRepo.full_name.split('/')[0]}
          repo={selectedRepo.full_name.split('/')[1]}
        />
      )}
    </div>
  );
}
