/**
 * Docker Service - Main entry point
 *
 * Provides high-level API for Docker container deployments.
 * Uses modular sub-components for specific operations.
 */

import { LogService } from '../log-service';
import { buildImage, removeImage, pruneProjectImages } from './image-builder';
import {
  runContainer,
  stopAndRemoveContainer,
  ensureContainerStopped,
  isContainerRunning,
  getContainerLogs,
  streamContainerLogs,
  listRunningContainers,
} from './container';

import { isDockerAvailable } from './exec';
import { ContainerConfig, DEFAULT_CONTAINER_LIMITS, getContainerName, getImageName } from './types';

// Re-export types
export * from './types';

type AppType = 'nextjs' | 'vite' | 'express' | 'hono' | 'elysia' | 'go';

/**
 * Default internal port - containers use this internally,
 * mapped to unique host port externally.
 */
const DEFAULT_INTERNAL_PORT = 3000;
const VITE_INTERNAL_PORT = 80; // nginx serves on 80

export const DockerService = {
  /**
   * Check if Docker is available on the system.
   */
  isAvailable: isDockerAvailable,

  /**
   * Deploy an application as a Docker container.
   */
  async deploy(
    projectId: string,
    buildId: string,
    sourceDir: string,
    hostPort: number,
    appType: AppType,
    envVars: Record<string, string> = {},
  ): Promise<{ success: boolean; containerId?: string; error?: string }> {
    const containerName = getContainerName(projectId);
    const internalPort = appType === 'vite' ? VITE_INTERNAL_PORT : DEFAULT_INTERNAL_PORT;

    try {
      // 1. Stop any existing container for this project
      await LogService.stream(buildId, 'Preparing container environment...', 'info');
      await ensureContainerStopped(projectId);

      // 2. Build the Docker image
      await LogService.stream(buildId, 'Building Docker image...', 'info');
      const buildResult = await buildImage(
        projectId,
        buildId,
        sourceDir,
        appType,
        internalPort,
        (msg) => LogService.stream(buildId, msg, 'info'),
      );

      if (!buildResult.success) {
        await LogService.stream(buildId, `Image build failed: ${buildResult.error}`, 'error');
        return { success: false, error: buildResult.error };
      }

      // 3. Run the container
      await LogService.stream(buildId, 'Starting container...', 'info');
      const config: ContainerConfig = {
        projectId,
        buildId,
        imageName: buildResult.imageName,
        containerName,
        hostPort,
        internalPort,
        envVars,
        memoryLimit: DEFAULT_CONTAINER_LIMITS.memory,
        cpuLimit: DEFAULT_CONTAINER_LIMITS.cpus,
        workDir: sourceDir,
      };

      const runResult = await runContainer(config);

      if (!runResult.success) {
        await LogService.stream(buildId, `Container failed to start: ${runResult.error}`, 'error');
        return { success: false, error: runResult.error };
      }

      await LogService.stream(buildId, `Container started: ${containerName}`, 'info');

      // 4. Health check
      await LogService.stream(buildId, 'Performing health check...', 'info');
      const healthy = await this.waitForHealthy(hostPort, 15000);

      if (!healthy) {
        const logs = await getContainerLogs(containerName, 50);
        await LogService.stream(buildId, `Container logs:\n${logs}`, 'warning');
        await LogService.stream(buildId, 'Health check failed', 'error');
        await stopAndRemoveContainer(containerName);
        return { success: false, error: 'Health check failed' };
      }

      await LogService.stream(buildId, 'Container deployed successfully!', 'success');

      // 5. Cleanup old images (keep last 3)
      await pruneProjectImages(projectId, 3);

      // 6. Start background log streaming for runtime logs
      this.startLogStreaming(projectId, buildId);

      return { success: true, containerId: runResult.containerId };
    } catch (error: any) {
      await LogService.stream(buildId, `Deployment error: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  },

  /**
   * Active log streaming cleanups (projectId -> cleanup function)
   */
  _logStreamers: new Map<string, () => void>(),

  /**
   * Start streaming container logs to control-api in background.
   */
  startLogStreaming(projectId: string, buildId: string): void {
    this.stopLogStreaming(projectId);

    const containerName = getContainerName(projectId);
    const cleanup = streamContainerLogs(containerName, (line) => {
      LogService.stream(buildId, line, 'info');
    });

    this._logStreamers.set(projectId, cleanup);
  },

  /**
   * Stop streaming logs for a project.
   */
  stopLogStreaming(projectId: string): void {
    const cleanup = this._logStreamers.get(projectId);
    if (cleanup) {
      cleanup();
      this._logStreamers.delete(projectId);
    }
  },

  /**
   * Stop a deployed container.
   */
  async stop(projectId: string, buildId?: string): Promise<boolean> {
    // Stop log streaming first
    this.stopLogStreaming(projectId);

    const containerName = getContainerName(projectId);

    if (buildId) {
      await LogService.stream(buildId, 'Stopping container...', 'info');
    }

    const result = await stopAndRemoveContainer(containerName);

    if (buildId && result) {
      await LogService.stream(buildId, 'Container stopped', 'success');
    }

    return result;
  },

  /**
   * Delete all resources for a project.
   */
  async cleanup(projectId: string, buildIds?: string[]): Promise<void> {
    // Stop log streaming
    this.stopLogStreaming(projectId);

    // Stop container
    await ensureContainerStopped(projectId);

    // Remove all images for this project
    if (buildIds) {
      for (const buildId of buildIds) {
        const imageName = getImageName(projectId, buildId);
        await removeImage(imageName);
      }
    }
  },

  /**
   * Wait for container to become healthy (respond to HTTP).
   */
  async waitForHealthy(port: number, timeoutMs: number = 10000): Promise<boolean> {
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${port}`);
        if (res.ok || res.status < 500) {
          return true;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    return false;
  },

  /**
   * Check if a project's container is running.
   */
  async isRunning(projectId: string): Promise<boolean> {
    const containerName = getContainerName(projectId);
    return isContainerRunning(containerName);
  },

  /**
   * Get logs from a project's container.
   */
  async getLogs(projectId: string, tail: number = 100): Promise<string> {
    const containerName = getContainerName(projectId);
    return getContainerLogs(containerName, tail);
  },

  /**
   * Stream logs from a project's container.
   */
  streamLogs(projectId: string, onLog: (line: string) => void): () => void {
    const containerName = getContainerName(projectId);
    return streamContainerLogs(containerName, onLog);
  },

  /**
   * Recover log streams for running containers on system startup.
   */
  async recoverLogStreams(): Promise<void> {
    console.log('[DockerService] Recovering log streams for running containers...');
    const containers = await listRunningContainers();

    let count = 0;
    for (const container of containers) {
      // Use existing startLogStreaming to handle tracking and output to LogService
      this.startLogStreaming(container.projectId, container.buildId);
      count++;
    }

    console.log(`[DockerService] Recovered log streams for ${count} containers`);
  },
};
