'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { RepoFolder } from '@/lib/types';
import { InstallationSelector, GitInstallation } from '@/components/github/installation-selector';
import { RepositoryList, GitRepository } from '@/components/github/repository-list';
import { ProjectConfigForm, ProjectConfig } from '@/components/github/project-config-form';
import { DirectoryStep } from '@/components/github/directory-step';
import { SetupStepper } from '@/components/github/setup-stepper';

type Step = 'account' | 'repo' | 'directory' | 'config';

export type DeployPhase = 'idle' | 'creating' | 'building';

export default function ImportPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('account');
  const [installations, setInstallations] = useState<GitInstallation[]>([]);
  const [installationsLoading, setInstallationsLoading] = useState(true);
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitRepository | null>(null);
  const [folders, setFolders] = useState<RepoFolder[] | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<RepoFolder | null>(null);
  /** True when the directory step was skipped because the repo has a single app. */
  const [autoPickedFolder, setAutoPickedFolder] = useState(false);
  const [deployPhase, setDeployPhase] = useState<DeployPhase>('idle');
  const [githubApp, setGithubApp] = useState<{ installUrl: string } | null>(null);
  const folderRequest = useRef(0);

  const goTo = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const loadRepositories = useCallback(async (id: number) => {
    setReposLoading(true);
    try {
      const data = await api.getGithubRepositories(id);
      setRepositories(data.repositories);
    } catch {
      toast.error('Failed to load repositories');
    } finally {
      setReposLoading(false);
    }
  }, []);

  const selectInstallation = useCallback(
    (id: number) => {
      if (id !== selectedInstallation) {
        setRepositories([]);
        setSelectedRepo(null);
      }
      setSelectedInstallation(id);
      goTo('repo');
      void loadRepositories(id);
    },
    [selectedInstallation, loadRepositories],
  );

  useEffect(() => {
    const init = async () => {
      try {
        const [data, app] = await Promise.all([api.getGithubInstallations(), api.getGithubApp()]);
        setInstallations(data.installations);
        setGithubApp(app);

        // Back from installing the GitHub App, or only one account: go straight to repos.
        const params = new URLSearchParams(window.location.search);
        const installedId = Number(params.get('installation_id'));
        const fromInstall = data.installations.find((i: GitInstallation) => i.id === installedId);
        if (fromInstall) {
          toast.success('GitHub App connected');
          router.replace(window.location.pathname);
          selectInstallation(fromInstall.id);
        } else if (data.installations.length === 1) {
          selectInstallation(data.installations[0].id);
        }
      } catch (e) {
        console.error(e);
        toast.error('Failed to load GitHub accounts');
      } finally {
        setInstallationsLoading(false);
      }
    };
    void init();
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanRepo = async (repo: GitRepository, installationId: number) => {
    const request = ++folderRequest.current;
    setFolders(null);
    setFoldersError(null);
    setFoldersLoading(true);
    try {
      const data = await api.getRepoFolders(installationId, repo.full_name);
      if (request !== folderRequest.current) return;
      setFolders(data.folders);
      // A single app needs no choice: go straight to configuration.
      if (data.folders.length === 1) {
        setSelectedFolder(data.folders[0]);
        setAutoPickedFolder(true);
        goTo('config');
      }
    } catch (e: any) {
      if (request !== folderRequest.current) return;
      setFoldersError(e.message || 'Could not read the repository');
    } finally {
      if (request === folderRequest.current) setFoldersLoading(false);
    }
  };

  const selectRepo = (repo: GitRepository) => {
    setSelectedRepo(repo);
    setSelectedFolder(null);
    setAutoPickedFolder(false);
    goTo('directory');
    if (selectedInstallation) void scanRepo(repo, selectedInstallation);
  };

  const selectFolder = (folder: RepoFolder) => {
    setSelectedFolder(folder);
    setAutoPickedFolder(false);
    goTo('config');
  };

  const handleDeploy = async (config: ProjectConfig) => {
    if (!selectedRepo || !selectedInstallation) return;
    setDeployPhase('creating');
    try {
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

      setDeployPhase('building');
      try {
        await api.triggerBuild(project.id);
        toast.success('Project created — first deploy started');
      } catch (e: any) {
        // The project exists; let the user retry the build from its page.
        toast.warning('Project created, but the first build could not start', {
          description: e.message || 'Start it from the project page.',
        });
      }
      router.push(`/projects/${project.id}`);
    } catch (e: any) {
      console.error(e);
      toast.error('Could not create the project', { description: e.message });
      setDeployPhase('idle');
    }
  };

  const openInstall = () => {
    if (!githubApp?.installUrl) {
      toast.error('GitHub App install page is not available right now.');
      return;
    }
    window.open(githubApp.installUrl, '_blank', 'noopener,noreferrer');
  };

  const account = installations.find((i) => i.id === selectedInstallation)?.account.login;
  const steps = [
    { id: 'account', label: 'Account', value: account },
    { id: 'repo', label: 'Repository', value: selectedRepo?.name },
    {
      id: 'directory',
      label: 'App',
      value: selectedFolder
        ? selectedFolder.path === './'
          ? 'root'
          : selectedFolder.path
        : undefined,
    },
    { id: 'config', label: 'Configure' },
  ];

  const handleStepSelect = (id: string) => {
    if (deployPhase !== 'idle') return;
    // The directory step was skipped; going "back" to it means back to the repo list.
    if (id === 'directory' && autoPickedFolder) return goTo('repo');
    goTo(id as Step);
  };

  return (
    <div className="page-width relative min-h-[calc(100svh-4rem)] max-w-5xl pb-28 pt-6 sm:pt-10 lg:pb-16">
      <header className="mb-6 space-y-5 border-b border-border pb-6">
        <div>
          <h1 className="page-heading">Deploy from GitHub</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Pick a repository and we&apos;ll detect the framework, build command and migrations for
            you. Every push redeploys automatically.
          </p>
        </div>
        <SetupStepper steps={steps} current={step} onSelect={handleStepSelect} />
      </header>

      {step === 'account' && (
        <InstallationSelector
          installations={installations}
          selectedId={selectedInstallation}
          loading={installationsLoading}
          onSelect={selectInstallation}
          onInstall={openInstall}
        />
      )}

      {step === 'repo' && (
        <RepositoryList
          repositories={repositories}
          loading={reposLoading}
          onSelect={selectRepo}
          onRefresh={
            selectedInstallation ? () => loadRepositories(selectedInstallation) : undefined
          }
          onManageAccess={openInstall}
        />
      )}

      {step === 'directory' && selectedRepo && (
        <DirectoryStep
          repoName={selectedRepo.full_name}
          folders={folders}
          loading={foldersLoading}
          error={foldersError}
          onRetry={() => selectedInstallation && scanRepo(selectedRepo, selectedInstallation)}
          onSelect={selectFolder}
        />
      )}

      {step === 'config' && selectedRepo && (
        <ProjectConfigForm
          // Remount when the app changes so detected defaults apply again.
          key={`${selectedRepo.id}:${selectedFolder?.path ?? './'}`}
          repo={selectedRepo}
          loading={deployPhase !== 'idle'}
          deployPhase={deployPhase}
          onBack={() => goTo(autoPickedFolder ? 'repo' : 'directory')}
          backLabel={autoPickedFolder ? 'Change repo' : 'Change app'}
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
  );
}
