import type { Project } from './types';

interface ProjectStatus {
  label: string;
  tone: 'success' | 'error' | 'progress' | 'neutral';
  timestamp: string | null;
  detail: string;
}

/** The latest attempt can fail even while an older deployment is still live. */
export function getProjectStatus(
  project: Pick<Project, 'latest_build' | 'latest_deployment'> & {
    uptime_status?: 'unknown' | 'up' | 'down' | null;
  },
): ProjectStatus {
  const build = project.latest_build;
  const deployment = project.latest_deployment;
  const building = build?.status === 'pending' || build?.status === 'building';
  const useDeployment =
    deployment &&
    !(building && deployment.build_id === build.id) &&
    (!build ||
      deployment.build_id === build.id ||
      Date.parse(deployment.activated_at) >= Date.parse(build.created_at));

  if (useDeployment) {
    const common = {
      timestamp: deployment.activated_at,
      detail: deployment.status_message || `Latest deployment: ${deployment.status}`,
    };
    switch (deployment.status) {
      case 'active':
        if (project.uptime_status === 'down') {
          return {
            ...common,
            label: 'Down',
            tone: 'error',
            detail: 'Service is down (uptime monitor check failing)',
          };
        }
        return { ...common, label: 'Ready', tone: 'success' };
      case 'failed':
        return { ...common, label: 'Failed', tone: 'error' };
      case 'inactive':
        return { ...common, label: 'Inactive', tone: 'neutral' };
      default:
        return { ...common, label: 'Deploying', tone: 'progress' };
    }
  }

  if (build) {
    const common = { timestamp: build.completed_at || build.created_at };
    switch (build.status) {
      case 'pending':
        return { ...common, label: 'Queued', tone: 'progress', detail: 'Latest build is queued' };
      case 'building':
        return {
          ...common,
          label: 'Building',
          tone: 'progress',
          detail: 'Latest build is running',
        };
      case 'failed':
        return { ...common, label: 'Failed', tone: 'error', detail: 'Latest build failed' };
      case 'cancelled':
        return {
          ...common,
          label: 'Skipped',
          tone: 'neutral',
          detail: 'Latest build was skipped for a newer commit',
        };
      case 'success':
        return {
          ...common,
          label: 'Deploying',
          tone: 'progress',
          detail: 'Build succeeded; waiting for deployment activation',
        };
    }
  }

  return { label: 'Not deployed', tone: 'neutral', timestamp: null, detail: 'No deployments yet' };
}
