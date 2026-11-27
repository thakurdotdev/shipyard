import { Worker, Job } from 'bullmq';
import { getRedisConnection, QUEUE_CONFIG } from './config';
import { Builder, type BuildJob } from '../services/build';
import { engineSettings, onEngineSettingsChange } from '../config/runtime-settings';
import { createKeyedLock } from './project-lock';

/**
 * Build job data structure (must match control-api's BuildJobData)
 */
export type BuildJobData = BuildJob;

// Singleton worker instance
let buildWorker: Worker<BuildJobData> | null = null;
let stopFollowingSettings: (() => void) | null = null;

/** Builds of one project run in order even when several builds may run at once. */
const oneBuildPerProject = createKeyedLock();

/**
 * Build Worker Service
 *
 * Consumes build jobs from the BullMQ queue and runs them inside the deploy
 * engine. Because the build happens in the final deployment directory, the
 * subsequent activation reuses the installed dependencies instead of
 * re-installing them.
 */
export const BuildWorker = {
  /**
   * Initialize and start the worker
   */
  async initialize(): Promise<void> {
    if (buildWorker) {
      console.log('[BuildWorker] Already initialized');
      return;
    }

    const connection = getRedisConnection();

    buildWorker = new Worker<BuildJobData>(
      QUEUE_CONFIG.name,
      async (job: Job<BuildJobData>) => {
        console.log(`[BuildWorker] Processing job ${job.id} for build ${job.data.build_id}`);

        // Builder handles status updates + log streaming back to the control-api.
        // control-api auto-activates the build when it receives status=success.
        await oneBuildPerProject(job.data.project_id, () => Builder.execute(job.data));

        console.log(`[BuildWorker] Job ${job.id} completed successfully`);
        return { success: true };
      },
      {
        connection,
        concurrency: engineSettings().buildConcurrency,
        // Stalled job handling
        stalledInterval: 30000, // Check for stalled jobs every 30s
        maxStalledCount: 1, // Move to failed after 1 stall
      },
    );

    // Event listeners for logging
    buildWorker.on('completed', (job) => {
      console.log(`[BuildWorker] ✅ Job ${job.id} completed`);
    });

    buildWorker.on('failed', (job, error) => {
      console.error(`[BuildWorker] ❌ Job ${job?.id} failed:`, error.message);
    });

    buildWorker.on('active', (job) => {
      console.log(`[BuildWorker] 🚀 Job ${job.id} is now active`);
    });

    buildWorker.on('stalled', (jobId) => {
      console.warn(`[BuildWorker] ⚠️ Job ${jobId} stalled`);
    });

    buildWorker.on('error', (error) => {
      console.error('[BuildWorker] Worker error:', error);
    });

    // Builds at a time can change from the dashboard; running builds are not interrupted.
    stopFollowingSettings = onEngineSettingsChange((next, previous) => {
      if (!buildWorker || next.buildConcurrency === previous.buildConcurrency) return;
      buildWorker.concurrency = next.buildConcurrency;
      console.log(`[BuildWorker] Now running up to ${next.buildConcurrency} builds at a time`);
    });

    console.log('[BuildWorker] Initialized and listening for jobs');
  },

  /**
   * Graceful shutdown - wait for current job to complete
   */
  async shutdown(): Promise<void> {
    if (!buildWorker) {
      console.log('[BuildWorker] Not running');
      return;
    }

    console.log('[BuildWorker] Shutting down gracefully...');
    stopFollowingSettings?.();
    stopFollowingSettings = null;

    // Close worker (waits for current job to complete)
    await buildWorker.close();
    buildWorker = null;

    console.log('[BuildWorker] Shutdown complete');
  },

  /**
   * Force close - don't wait for current job
   */
  async forceClose(): Promise<void> {
    if (!buildWorker) return;

    console.log('[BuildWorker] Force closing...');
    await buildWorker.close(true);
    buildWorker = null;
  },

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return buildWorker !== null && !buildWorker.closing;
  },

  /**
   * Get worker instance (for testing/debugging)
   */
  getWorker(): Worker<BuildJobData> | null {
    return buildWorker;
  },
};
