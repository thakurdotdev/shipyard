/**
 * Docker Container Configuration Types
 */

export interface ContainerConfig {
  projectId: string;
  buildId: string;
  imageName: string;
  containerName: string;
  hostPort: number;
  internalPort: number;
  envVars: Record<string, string>;
  memoryLimit: string;
  cpuLimit: string;
  workDir: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: 'created' | 'running' | 'paused' | 'exited' | 'dead';
  ports: { host: number; container: number }[];
}

export interface BuildResult {
  success: boolean;
  imageName: string;
  error?: string;
}

export interface RunResult {
  success: boolean;
  containerId: string;
  error?: string;
}

/**
 * Default resource limits
 */
export const DEFAULT_CONTAINER_LIMITS = {
  memory: '512m',
  cpus: '0.5',
} as const;

/**
 * Container naming conventions
 */
export function getContainerName(projectId: string): string {
  return `shipyard-${projectId.slice(0, 8)}`;
}

export function getImageName(projectId: string, buildId: string): string {
  return `shipyard/${projectId.slice(0, 8)}:${buildId.slice(0, 8)}`;
}
