import type { Tone } from '@/components/ui/status';
import type { ActiveDeployment, BuildWithDeployment } from '@/lib/queries';
import type { Project } from '@/lib/types';

/** A `deployment_updated` event from the project stream. */
export interface DeploymentEvent {
  id: string;
  build_id: string;
  status: string;
  status_message?: string | null;
}

/** Steps a release goes through between "build succeeded" and "live". */
export const PIPELINE_STEPS = [
  { key: 'dns', label: 'DNS', statuses: ['dns_creating', 'dns_created'] },
  { key: 'ssl', label: 'Certificate', statuses: ['ssl_issuing', 'ssl_issued'] },
  { key: 'proxy', label: 'Proxy', statuses: ['nginx_configuring', 'nginx_configured'] },
  { key: 'start', label: 'Start', statuses: ['app_starting'] },
  { key: 'health', label: 'Health check', statuses: ['health_checking'] },
] as const;

const IN_FLIGHT = new Set([
  'pending',
  'activating',
  ...PIPELINE_STEPS.flatMap((step) => step.statuses as readonly string[]),
]);

export const isDeployInFlight = (status: string | null | undefined) =>
  !!status && IN_FLIGHT.has(status);

const STEP_LABEL: Record<string, string> = {
  pending: 'Preparing',
  activating: 'Activating',
  dns_creating: 'Creating DNS record',
  dns_created: 'DNS ready',
  ssl_issuing: 'Issuing certificate',
  ssl_issued: 'Certificate ready',
  nginx_configuring: 'Configuring proxy',
  nginx_configured: 'Proxy ready',
  app_starting: 'Starting app',
  health_checking: 'Health check',
  active: 'Live',
  inactive: 'Inactive',
  failed: 'Failed',
};

export const deployStepLabel = (status: string) =>
  STEP_LABEL[status] ?? status.replaceAll('_', ' ');

/** How a build reads in lists: its own status, or its release while that is in flight. */
export function buildStatus(
  build: BuildWithDeployment,
  deploymentEvent?: DeploymentEvent | null,
): { tone: Tone; label: string; busy: boolean } {
  const release =
    deploymentEvent?.build_id === build.id ? deploymentEvent.status : build.deployment_status;
  if (build.status === 'success' && isDeployInFlight(release))
    return { tone: 'progress', label: 'Deploying', busy: true };
  if (build.status === 'success' && release === 'failed')
    return { tone: 'error', label: 'Deploy failed', busy: false };
  switch (build.status) {
    case 'pending':
      return { tone: 'progress', label: 'Queued', busy: true };
    case 'building':
      return { tone: 'progress', label: 'Building', busy: true };
    case 'failed':
      return { tone: 'error', label: 'Failed', busy: false };
    case 'cancelled':
      return { tone: 'neutral', label: 'Skipped', busy: false };
    default:
      return { tone: 'success', label: 'Ready', busy: false };
  }
}

export interface ProjectState {
  tone: Tone;
  label: string;
  /** A build or release is running, so another deploy would queue behind it. */
  busy: boolean;
  /** Production is serving a deployment. */
  live: boolean;
  /** The newest attempt failed while an older deployment keeps serving. */
  failedAttempt: { kind: 'build' | 'deploy'; build?: BuildWithDeployment; message?: string } | null;
}

export function deriveProjectState({
  project,
  latestBuild,
  activeDeployment,
  deploymentEvent,
  starting,
}: {
  project: Project;
  latestBuild: BuildWithDeployment | undefined;
  activeDeployment: ActiveDeployment | null;
  deploymentEvent: DeploymentEvent | null;
  starting: boolean;
}): ProjectState {
  const live = !!activeDeployment;
  const building = latestBuild?.status === 'building' || latestBuild?.status === 'pending';
  const releasing = isDeployInFlight(deploymentEvent?.status);
  const deployFailed = deploymentEvent?.status === 'failed';
  const buildFailed = latestBuild?.status === 'failed';

  const failedAttempt: ProjectState['failedAttempt'] =
    live && deployFailed
      ? { kind: 'deploy', message: deploymentEvent?.status_message ?? undefined }
      : live && buildFailed
        ? { kind: 'build', build: latestBuild }
        : null;

  if (starting || building)
    return {
      tone: 'progress',
      label: latestBuild?.status === 'pending' ? 'Queued' : 'Building',
      busy: true,
      live,
      failedAttempt: null,
    };
  if (releasing)
    return {
      tone: 'progress',
      label: `Deploying · ${deployStepLabel(deploymentEvent!.status)}`,
      busy: true,
      live,
      failedAttempt: null,
    };
  if (live && project.uptime_status === 'down')
    return { tone: 'error', label: 'Down', busy: false, live, failedAttempt };
  if (live) return { tone: 'success', label: 'Live', busy: false, live, failedAttempt };
  if (deployFailed || buildFailed)
    return { tone: 'error', label: 'Failed', busy: false, live, failedAttempt: null };
  return { tone: 'neutral', label: 'Not deployed', busy: false, live, failedAttempt: null };
}
