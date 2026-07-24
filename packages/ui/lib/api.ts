const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

import { Project, Build, Deployment, EnvVar, LogEntry } from '@/lib/types';

export const api = {
  getProjects: async (): Promise<Project[]> => {
    const res = await fetch(`${API_URL}/projects`, { credentials: 'include' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch projects' }));
      throw new Error(error.error || error.message || 'Failed to fetch projects');
    }
    return res.json();
  },
  createProject: async (data: any): Promise<Project> => {
    const res = await fetch(`${API_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to create project' }));
      throw new Error(error.error || error.message || 'Failed to create project');
    }
    return res.json();
  },
  getProject: async (id: string): Promise<Project> => {
    const res = await fetch(`${API_URL}/projects/${id}`, { credentials: 'include' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch project' }));
      throw new Error(error.error || error.message || 'Failed to fetch project');
    }
    return res.json();
  },
  getBuilds: async (projectId: string): Promise<Build[]> => {
    const res = await fetch(`${API_URL}/projects/${projectId}/builds`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch builds' }));
      throw new Error(error.error || error.message || 'Failed to fetch builds');
    }
    return res.json();
  },
  triggerBuild: async (projectId: string): Promise<Build> => {
    const res = await fetch(`${API_URL}/projects/${projectId}/builds`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to trigger build' }));
      throw new Error(error.error || error.message || 'Failed to trigger build');
    }
    return res.json();
  },
  getBuild: async (buildId: string): Promise<Build> => {
    const res = await fetch(`${API_URL}/builds/${buildId}`, { credentials: 'include' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch build' }));
      throw new Error(error.error || error.message || 'Failed to fetch build');
    }
    return res.json();
  },
  getBuildLogs: async (buildId: string): Promise<LogEntry[]> => {
    const res = await fetch(`${API_URL}/builds/${buildId}/logs`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to fetch build logs');
    return res.json();
  },
  clearBuildLogs: async (buildId: string) => {
    const res = await fetch(`${API_URL}/builds/${buildId}/logs`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to clear build logs');
    return res.json();
  },
  getEnvVars: async (projectId: string): Promise<EnvVar[]> => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env`, { credentials: 'include' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch env vars' }));
      throw new Error(error.error || error.message || 'Failed to fetch env vars');
    }
    return res.json();
  },
  addEnvVar: async (projectId: string, data: any): Promise<EnvVar> => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to add env var' }));
      throw new Error(error.error || error.message || 'Failed to add env var');
    }
    return res.json();
  },
  deleteEnvVar: async (projectId: string, key: string) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env/${key}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to delete env var' }));
      throw new Error(error.error || error.message || 'Failed to delete env var');
    }
    return res.json();
  },
  async activateBuild(buildId: string): Promise<Deployment> {
    const res = await fetch(`${API_URL}/deploy/build/${buildId}/activate`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to activate build' }));
      throw new Error(error.error || error.message || 'Failed to activate build');
    }
    return res.json();
  },

  async getActiveDeployment(projectId: string): Promise<Deployment | null> {
    const res = await fetch(`${API_URL}/projects/${projectId}/deployment`, {
      credentials: 'include',
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const error = await res.json().catch(() => ({ error: 'Failed to get active deployment' }));
      throw new Error(error.error || error.message || 'Failed to get active deployment');
    }
    return res.json();
  },

  async deleteProject(projectId: string): Promise<Project> {
    const res = await fetch(`${API_URL}/projects/${projectId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to delete project' }));
      throw new Error(error.error || error.message || 'Failed to delete project');
    }
    return res.json();
  },
  async updateProject(projectId: string, data: any): Promise<Project> {
    const res = await fetch(`${API_URL}/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to update project' }));
      throw new Error(error.error || error.message || 'Failed to update project');
    }
    return res.json();
  },
  async stopDeployment(projectId: string) {
    const res = await fetch(`${API_URL}/projects/${projectId}/stop`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to stop deployment' }));
      throw new Error(error.error || error.message || 'Failed to stop deployment');
    }
    return res.json();
  },
  async checkDomainAvailability(subdomain: string) {
    const res = await fetch(`${API_URL}/domains/check?subdomain=${subdomain}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to check domain');
    }
    return res.json() as Promise<{ available: boolean }>;
  },

  // GitHub Integration
  async getGithubInstallations() {
    const res = await fetch(`${API_URL}/github/installations`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res
        .json()
        .catch(() => ({ error: 'Failed to fetch GitHub installations' }));
      throw new Error(error.error || error.message || 'Failed to fetch GitHub installations');
    }
    return res.json();
  },

  async getGithubRepositories(installationId: number) {
    const res = await fetch(`${API_URL}/github/installations/${installationId}/repositories`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch repositories' }));
      throw new Error(error.error || error.message || 'Failed to fetch repositories');
    }
    return res.json();
  },

  // Infrastructure Services
  async getInfraServices() {
    const res = await fetch(`${API_URL}/infra/services`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch services' }));
      throw new Error(error.error || error.message || 'Failed to fetch services');
    }
    return res.json();
  },

  async getInfraService(id: string) {
    const res = await fetch(`${API_URL}/infra/services/${id}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch service' }));
      throw new Error(error.error || error.message || 'Failed to fetch service');
    }
    return res.json();
  },

  async createInfraService(data: {
    name: string;
    service_type: 'redis' | 'postgres';
    version?: string;
    bind_localhost?: boolean;
  }) {
    const res = await fetch(`${API_URL}/infra/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to create service' }));
      throw new Error(error.error || error.message || 'Failed to create service');
    }
    return res.json();
  },

  async deleteInfraService(id: string) {
    const res = await fetch(`${API_URL}/infra/services/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to delete service' }));
      throw new Error(error.error || error.message || 'Failed to delete service');
    }
    return res.json();
  },

  async restartInfraService(id: string) {
    const res = await fetch(`${API_URL}/infra/services/${id}/restart`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to restart service' }));
      throw new Error(error.error || error.message || 'Failed to restart service');
    }
    return res.json();
  },

  async getInfraServiceLogs(id: string, tail: number = 100) {
    const res = await fetch(`${API_URL}/infra/services/${id}/logs?tail=${tail}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to fetch logs' }));
      throw new Error(error.error || error.message || 'Failed to fetch logs');
    }
    return res.json();
  },
};
