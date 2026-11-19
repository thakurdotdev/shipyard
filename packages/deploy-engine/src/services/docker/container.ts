import { spawn } from 'child_process';
import { execDocker } from './exec';
import {
  ContainerConfig,
  ContainerInfo,
  RunResult,
  DEFAULT_CONTAINER_LIMITS,
  getContainerName,
} from './types';

/**
 * Start a Docker container from an image.
 */
export async function runContainer(config: ContainerConfig): Promise<RunResult> {
  const {
    imageName,
    containerName,
    hostPort,
    internalPort,
    envVars,
    memoryLimit = DEFAULT_CONTAINER_LIMITS.memory,
    cpuLimit = DEFAULT_CONTAINER_LIMITS.cpus,
  } = config;

  // Build environment variable flags
  const envFlags = Object.entries(envVars).flatMap(([key, value]) => ['-e', `${key}=${value}`]);

  // Ensure PORT is always set
  if (!envVars['PORT']) {
    envFlags.push('-e', `PORT=${internalPort}`);
  }

  const args = [
    'run',
    '-d',
    '--name',
    containerName,
    '-p',
    // Published on loopback only: Docker's own iptables rules bypass UFW, so a plain
    // `-p port:port` would expose the app on every interface. Nginx proxies to it.
    `127.0.0.1:${hostPort}:${internalPort}`,
    '--restart',
    'unless-stopped',
    '--memory',
    memoryLimit,
    '--cpus',
    cpuLimit,
    '--label',
    `thakur.projectId=${config.projectId}`,
    '--label',
    `thakur.buildId=${config.buildId}`,
    '-e',
    'NODE_ENV=production',
    ...envFlags,
    imageName,
  ];

  const result = await execDocker(args);

  if (result.exitCode !== 0) {
    return {
      success: false,
      containerId: '',
      error: result.stderr || 'Failed to start container',
    };
  }

  return {
    success: true,
    containerId: result.stdout.trim(),
  };
}

/**
 * Stop a running container.
 */
export async function stopContainer(containerName: string, timeout: number = 10): Promise<boolean> {
  const result = await execDocker(['stop', '-t', timeout.toString(), containerName]);
  return result.exitCode === 0;
}

/**
 * Remove a container (stopped or running).
 */
export async function removeContainer(
  containerName: string,
  force: boolean = true,
): Promise<boolean> {
  const args = force ? ['rm', '-f', containerName] : ['rm', containerName];
  const result = await execDocker(args);
  return result.exitCode === 0;
}

/**
 * Stop and remove a container.
 */
export async function stopAndRemoveContainer(containerName: string): Promise<boolean> {
  await stopContainer(containerName);
  return removeContainer(containerName, true);
}

/**
 * Get container info by name.
 */
export async function getContainerInfo(containerName: string): Promise<ContainerInfo | null> {
  const result = await execDocker([
    'inspect',
    '--format',
    '{{.Id}} {{.State.Status}}',
    containerName,
  ]);

  if (result.exitCode !== 0) return null;

  const [id, status] = result.stdout.split(' ');
  return {
    id,
    name: containerName,
    status: status as ContainerInfo['status'],
    ports: [], // Could parse this from inspect if needed
  };
}

/**
 * Check if a container exists.
 */
export async function containerExists(containerName: string): Promise<boolean> {
  const result = await execDocker(['container', 'inspect', containerName]);
  return result.exitCode === 0;
}

/**
 * Check if a container is running.
 */
export async function isContainerRunning(containerName: string): Promise<boolean> {
  const info = await getContainerInfo(containerName);
  return info?.status === 'running';
}

/**
 * Get container logs.
 */
export async function getContainerLogs(containerName: string, tail: number = 100): Promise<string> {
  const result = await execDocker(['logs', '--tail', tail.toString(), containerName]);
  return result.stdout + result.stderr;
}

/**
 * Stream container logs in real-time.
 * Returns a cleanup function to stop streaming.
 */
export function streamContainerLogs(
  containerName: string,
  onLog: (line: string) => void,
): () => void {
  const proc = spawn('docker', ['logs', '-f', '--tail', '0', containerName], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handleData = (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(onLog);
  };

  if (proc.stdout) {
    proc.stdout.on('data', handleData);
  }

  if (proc.stderr) {
    proc.stderr.on('data', handleData);
  }

  return () => {
    proc.kill('SIGTERM');
  };
}

/**
 * Kill any container using the same name (for re-deployment).
 */
export async function ensureContainerStopped(projectId: string): Promise<void> {
  const containerName = getContainerName(projectId);
  if (await containerExists(containerName)) {
    await stopAndRemoveContainer(containerName);
  }
}

/**
 * List all running containers managed by this system.
 * Returns a list of objects with containerName, projectId, and buildId.
 */
export async function listRunningContainers(): Promise<
  Array<{ containerName: string; projectId: string; buildId: string }>
> {
  // Format: Name Label(projectId) Label(buildId)
  const result = await execDocker([
    'ps',
    '--format',
    '{{.Names}} {{.Label "thakur.projectId"}} {{.Label "thakur.buildId"}}',
    '--filter',
    'label=thakur.projectId',
  ]);

  if (result.exitCode !== 0) return [];

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      // Ensure we have at least 3 parts
      if (parts.length < 3) return null;
      const [containerName, projectId, buildId] = parts;
      return { containerName, projectId, buildId };
    })
    .filter(
      (c): c is { containerName: string; projectId: string; buildId: string } =>
        c !== null && !!c.projectId && !!c.buildId,
    );
}
