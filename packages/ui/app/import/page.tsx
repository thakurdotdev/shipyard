'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { InstallationSelector, GitInstallation } from '@/components/github/installation-selector';
import { RepositoryList, GitRepository } from '@/components/github/repository-list';
import { ProjectConfigForm, ProjectConfig } from '@/components/github/project-config-form';
import { FolderPicker } from '@/components/github/folder-picker';
import { GitBranch, User, Settings2, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectedFolder {
  path: string;
  name: string;
  framework: string | null;
  frameworkInfo: { name: string; icon: string; color: string };
}

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

  // Initial Fetch & URL Handling
  useEffect(() => {
    const init = async () => {
      try {
        const data = await api.getGithubInstallations();
        setInstallations(data.installations);

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
        app_type: config.appType,
        root_directory: config.rootDirectory,
        domain: config.domain ? `${config.domain}.thakur.dev` : '',
        github_repo_id: selectedRepo.id.toString(),
        github_repo_full_name: selectedRepo.full_name,
        github_branch: selectedRepo.default_branch,
        github_installation_id: selectedInstallation.toString(),
        env_vars: config.envVars,
        auto_deploy: config.autoDeploy,
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
    window.open('https://github.com/apps/thakur-deploy/installations/new', '_blank');
  };

  return (
    <div className="container mx-auto py-12 max-w-3xl px-4 min-h-[calc(100vh-64px)]">
      <div className="mb-10 text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white glow-text">
          Import Git Repository
        </h1>
        <p className="text-zinc-400 max-w-lg mx-auto">
          Deploy your GitHub repositories instantly. Connect your account, select a project, and
          we'll handle the rest.
        </p>
      </div>

      {/* Progress Steps (Visual only) */}
      <div className="mb-10 flex justify-center items-center gap-4 text-sm font-medium">
        <div
          className={cn(
            'flex items-center gap-2',
            step === 'installations' ? 'text-white' : 'text-zinc-500',
          )}
        >
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center border',
              step === 'installations'
                ? 'border-white bg-white/10 text-white'
                : 'border-zinc-800 bg-zinc-900',
            )}
          >
            <User className="w-4 h-4" />
          </div>
          <span>Account</span>
        </div>
        <div className="w-8 h-px bg-zinc-800" />
        <div
          className={cn(
            'flex items-center gap-2',
            step === 'repos' ? 'text-white' : 'text-zinc-500',
          )}
        >
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center border',
              step === 'repos'
                ? 'border-white bg-white/10 text-white'
                : 'border-zinc-800 bg-zinc-900',
            )}
          >
            <GitBranch className="w-4 h-4" />
          </div>
          <span>Repository</span>
        </div>
        <div className="w-8 h-px bg-zinc-800" />
        <div
          className={cn(
            'flex items-center gap-2',
            step === 'config' ? 'text-white' : 'text-zinc-500',
          )}
        >
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center border',
              step === 'config'
                ? 'border-white bg-white/10 text-white'
                : 'border-zinc-800 bg-zinc-900',
            )}
          >
            <Settings2 className="w-4 h-4" />
          </div>
          <span>Configure</span>
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
