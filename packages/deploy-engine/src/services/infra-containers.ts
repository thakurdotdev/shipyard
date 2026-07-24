/**
 * Infrastructure Containers Service
 *
 * Manages Docker containers for standalone infrastructure services (Redis, PostgreSQL)
 */

import { execDocker } from './docker/exec';
import {
  stopContainer,
  removeContainer,
  getContainerLogs,
  containerExists,
} from './docker/container';

export interface RedisCredentials {
  password: string;
}

export interface PostgresCredentials {
  username: string;
  password: string;
  database: string;
}

export interface StartServiceConfig {
  serviceId: string;
  serviceType: 'redis' | 'postgres';
  containerName: string;
  port: number;
  credentials: RedisCredentials | PostgresCredentials;
  version: string;
  bindLocalhost: boolean;
}

export interface ContainerResult {
  success: boolean;
  containerId?: string;
  error?: string;
}

// Volume name prefix for data persistence
const VOLUME_PREFIX = 'infra-data';

export const InfraContainers = {
  /**
   * Start a Redis container
   */
  async startRedis(config: StartServiceConfig): Promise<ContainerResult> {
    const { containerName, port, credentials, version, bindLocalhost } = config;
    const redisCreds = credentials as RedisCredentials;
    const volumeName = `${VOLUME_PREFIX}-${containerName}`;

    // Port binding: localhost only or all interfaces
    const portBinding = bindLocalhost ? `127.0.0.1:${port}:6379` : `${port}:6379`;

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      portBinding,
      '-v',
      `${volumeName}:/data`,
      '--restart',
      'unless-stopped',
      '--memory',
      '512m',
      '--cpus',
      '0.5',
      '--label',
      'thakur.infra=true',
      '--label',
      `thakur.infra.type=redis`,
      '--label',
      `thakur.infra.id=${config.serviceId}`,
      `redis:${version}-alpine`,
      'redis-server',
      '--requirepass',
      redisCreds.password,
      '--appendonly',
      'yes',
    ];

    console.log(`[InfraContainers] Starting Redis: ${containerName} on port ${port}`);

    const result = await execDocker(args);

    if (result.exitCode !== 0) {
      console.error(`[InfraContainers] Redis start failed:`, result.stderr);
      return { success: false, error: result.stderr || 'Failed to start Redis' };
    }

    console.log(`[InfraContainers] Redis started: ${containerName}`);
    return { success: true, containerId: result.stdout.trim() };
  },

  /**
   * Start a PostgreSQL container
   */
  async startPostgres(config: StartServiceConfig): Promise<ContainerResult> {
    const { containerName, port, credentials, version, bindLocalhost } = config;
    const pgCreds = credentials as PostgresCredentials;
    const volumeName = `${VOLUME_PREFIX}-${containerName}`;

    // Port binding: localhost only or all interfaces
    const portBinding = bindLocalhost ? `127.0.0.1:${port}:5432` : `${port}:5432`;

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      portBinding,
      '-v',
      `${volumeName}:/var/lib/postgresql/data`,
      '--restart',
      'unless-stopped',
      '--memory',
      '1g',
      '--cpus',
      '1.0',
      '--label',
      'thakur.infra=true',
      '--label',
      `thakur.infra.type=postgres`,
      '--label',
      `thakur.infra.id=${config.serviceId}`,
      '-e',
      `POSTGRES_USER=${pgCreds.username}`,
      '-e',
      `POSTGRES_PASSWORD=${pgCreds.password}`,
      '-e',
      `POSTGRES_DB=${pgCreds.database}`,
      `postgres:${version}-alpine`,
    ];

    console.log(`[InfraContainers] Starting PostgreSQL: ${containerName} on port ${port}`);

    const result = await execDocker(args);

    if (result.exitCode !== 0) {
      console.error(`[InfraContainers] PostgreSQL start failed:`, result.stderr);
      return { success: false, error: result.stderr || 'Failed to start PostgreSQL' };
    }

    console.log(`[InfraContainers] PostgreSQL started: ${containerName}`);
    return { success: true, containerId: result.stdout.trim() };
  },

  /**
   * Start a service container based on type
   */
  async startService(config: StartServiceConfig): Promise<ContainerResult> {
    // Check if container already exists
    if (await containerExists(config.containerName)) {
      console.log(`[InfraContainers] Container ${config.containerName} exists, removing first`);
      await removeContainer(config.containerName, true);
    }

    if (config.serviceType === 'redis') {
      return this.startRedis(config);
    } else if (config.serviceType === 'postgres') {
      return this.startPostgres(config);
    }

    return { success: false, error: `Unknown service type: ${config.serviceType}` };
  },

  /**
   * Stop a service container
   */
  async stopService(
    containerName: string,
    removeVolume: boolean = false,
  ): Promise<{ success: boolean }> {
    console.log(`[InfraContainers] Stopping: ${containerName}`);

    try {
      await stopContainer(containerName, 10);
      await removeContainer(containerName, true);

      if (removeVolume) {
        const volumeName = `${VOLUME_PREFIX}-${containerName}`;
        await execDocker(['volume', 'rm', '-f', volumeName]);
        console.log(`[InfraContainers] Removed volume: ${volumeName}`);
      }

      console.log(`[InfraContainers] Stopped: ${containerName}`);
      return { success: true };
    } catch (error) {
      console.error(`[InfraContainers] Stop failed:`, error);
      return { success: false };
    }
  },

  /**
   * Get container status
   */
  async getStatus(containerName: string): Promise<'running' | 'stopped' | 'error'> {
    const result = await execDocker(['inspect', '--format', '{{.State.Status}}', containerName]);

    if (result.exitCode !== 0) {
      return 'stopped';
    }

    const status = result.stdout.trim();
    if (status === 'running') return 'running';
    return 'stopped';
  },

  /**
   * Get container logs
   */
  async getLogs(containerName: string, tail: number = 100): Promise<string> {
    return getContainerLogs(containerName, tail);
  },

  /**
   * List all infrastructure containers
   */
  async listAll(): Promise<Array<{ containerName: string; type: string; serviceId: string }>> {
    const result = await execDocker([
      'ps',
      '-a',
      '--format',
      '{{.Names}} {{.Label "thakur.infra.type"}} {{.Label "thakur.infra.id"}}',
      '--filter',
      'label=thakur.infra=true',
    ]);

    if (result.exitCode !== 0) return [];

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [containerName, type, serviceId] = line.split(/\s+/);
        return { containerName, type, serviceId };
      })
      .filter((c) => c.containerName && c.type && c.serviceId);
  },
};
