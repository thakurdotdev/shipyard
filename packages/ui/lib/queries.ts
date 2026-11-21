'use client';

import { api } from '@/lib/api';
import { pm0Api, type PM0Process } from '@/lib/pm0-api';
import type { Build, Project, UptimeSettings } from '@/lib/types';
import { useQuery } from '@/lib/use-query';

/** Cache keys, so realtime handlers can update exactly what a page reads. */
export const queryKeys = {
  projects: 'projects',
  processes: 'pm0:processes',
  project: (id: string) => `project:${id}`,
  builds: (id: string) => `project:${id}:builds`,
  deployment: (id: string) => `project:${id}:deployment`,
  domain: (id: string) => `project:${id}:domain`,
  uptime: (id: string) => `project:${id}:uptime`,
};

/** A build row as the builds list returns it: the build plus its deployment, if any. */
export type BuildWithDeployment = Build & {
  commit_sha?: string | null;
  commit_message?: string | null;
  deployment_id?: string | null;
  deployment_status?: string | null;
  deployment_activated_at?: string | null;
};

export interface ActiveDeployment {
  id: string;
  project_id: string;
  build_id: string;
  status: string;
  activated_at: string;
}

export interface DomainProvision {
  provisioned: boolean;
  full_domain?: string;
  dns_status: string;
  ssl_status: string;
  ssl_expiry?: string | null;
  error_message?: string | null;
}

/** One PM0 listing serves the projects list, the processes page and every project page. */
export function useProcessList(refreshInterval = 5000) {
  return useQuery(queryKeys.processes, () => pm0Api.getProcessesWithSystem(), {
    refreshInterval,
  });
}

/** The process serving a project: the running one if there are several. */
export function projectProcess(processes: PM0Process[] | undefined, projectId: string) {
  return processes
    ?.filter((process) => process.project_id === projectId)
    .sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'))[0];
}

export function useProjects() {
  return useQuery<Project[]>(queryKeys.projects, () => api.getProjects(), {
    refreshInterval: 5000,
  });
}

export function useProject(id: string | null) {
  return useQuery<Project>(id ? queryKeys.project(id) : null, () => api.getProject(id!));
}

export function useBuilds(id: string | null) {
  return useQuery<BuildWithDeployment[]>(
    id ? queryKeys.builds(id) : null,
    () => api.getBuilds(id!) as Promise<BuildWithDeployment[]>,
  );
}

export function useActiveDeployment(id: string | null) {
  return useQuery<ActiveDeployment | null>(
    id ? queryKeys.deployment(id) : null,
    () => api.getActiveDeployment(id!) as Promise<ActiveDeployment | null>,
  );
}

export function useDomainStatus(id: string | null) {
  return useQuery<DomainProvision>(id ? queryKeys.domain(id) : null, () =>
    api.getDomainStatus(id!),
  );
}

export function useUptime(id: string | null) {
  return useQuery<UptimeSettings>(id ? queryKeys.uptime(id) : null, () =>
    api.getUptimeSettings(id!),
  );
}
