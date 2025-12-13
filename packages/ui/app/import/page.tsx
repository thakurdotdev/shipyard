'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { InstallationSelector, GitInstallation } from '@/components/github/installation-selector';
import { RepositoryList, GitRepository } from '@/components/github/repository-list';
import { ProjectConfigForm, ProjectConfig } from '@/components/github/project-config-form';

export default function ImportPage() {
  const router = useRouter();

  // State
  const [step, setStep] = useState<'installations' | 'repos' | 'config'>('installations');
  const [loading, setLoading] = useState(false);

  // Data
  const [installations, setInstallations] = useState<GitInstallation[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitRepository | null>(null);

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
        } else if (data.installations.length === 1) {
          // Auto-select if only one exists (Optional UX preference)
          // handleInstallationSelect(data.installations[0].id);
        }
      } catch (e) {
        console.error(e);
        toast.error('Failed to load GitHub installations');
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
      });

      // 2. Trigger Build
      await api.triggerBuild(project.id);

      toast.success('Project created and deployment started!');
      router.push(`/projects/${project.id}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Deployment failed');
    } finally {
      setLoading(false);
    }
  };

  const handleInstallApp = () => {
    window.open('https://github.com/apps/thakur-deploy/installations/new', '_blank');
  };

  return (
    <div className="container mx-auto py-10 max-w-4xl px-4">
      <h1 className="text-3xl font-bold mb-2">Import Git Repository</h1>
      <p className="text-muted-foreground mb-8">
        Connect your GitHub account and select a repository to deploy.
      </p>

      <div className="space-y-6">
        {/* Step 1: Installation Selection */}
        {(step === 'installations' || step === 'repos' || step === 'config') && (
          <div className={step !== 'installations' ? 'opacity-60 pointer-events-none' : ''}>
            <InstallationSelector
              installations={installations}
              selectedId={selectedInstallation}
              onSelect={handleInstallationSelect}
              onInstall={handleInstallApp}
            />
          </div>
        )}

        {/* Step 2: Repository Selection */}
        {(step === 'repos' || step === 'config') && (
          <div className={step !== 'repos' ? 'hidden' : ''}>
            <RepositoryList
              repositories={repositories}
              loading={loading}
              onSelect={handleRepoSelect}
            />
          </div>
        )}

        {/* Step 3: Config */}
        {step === 'config' && selectedRepo && (
          <ProjectConfigForm
            repo={selectedRepo}
            loading={loading}
            onBack={() => setStep('repos')}
            onSubmit={handleDeploy}
          />
        )}
      </div>
    </div>
  );
}
