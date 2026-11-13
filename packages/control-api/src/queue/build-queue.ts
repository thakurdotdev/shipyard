import { config } from '@thakur-deploy/config';
import { Queue, QueueEvents, Job } from 'bullmq';
import { QUEUE_CONFIG } from './config';
import { EventStreamService } from '../services/event-stream-service';
import { AppType } from '../config/framework-config';

/**
 * Build job data structure
 */
export interface BuildJobData {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: AppType;
  env_vars: Record<string, string>;
  installation_id?: string;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// Parse Redis URL for connection
function getRedisConnection() {
  const redisUrl = config.redisUrl;

  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    };
  } catch {
    // Fallback for simple host:port format
    return {
      host: 'localhost',
      port: 6379,
    };
  }
}

// Singleton instances
let buildQueue: Queue<BuildJobData> | null = null;
let queueEvents: QueueEvents | null = null;

/**
 * Build Queue Service
 * Manages the BullMQ queue for build jobs
 */
export const BuildQueue = {
  /**
   * Initialize the build queue and event listeners
   */
  async initialize(): Promise<void> {
    if (buildQueue) {
      console.log('[BuildQueue] Already initialized');
      return;
    }

    const connection = getRedisConnection();

    // Create queue instance
    buildQueue = new Queue<BuildJobData>(QUEUE_CONFIG.name, {
      connection,
      defaultJobOptions: QUEUE_CONFIG.defaultJobOptions,
    });

    // Create queue events for monitoring
    queueEvents = new QueueEvents(QUEUE_CONFIG.name, {
      connection,
    });

    // Setup event listeners for WebSocket broadcasts
    this.setupEventListeners();

    console.log('[BuildQueue] Initialized successfully');
  },

  /**
   * Setup event listeners for queue state changes
   */
  setupEventListeners(): void {
    if (!queueEvents) return;

    queueEvents.on('waiting', async ({ jobId }) => {
      const job = await this.getJob(jobId);
      if (job) {
        const position = await this.getJobPosition(jobId);
        const stats = await this.getStats();

        EventStreamService.broadcast(
          job.data.build_id,
          `🔄 Build queued (position ${position} of ${stats.waiting + stats.active})\n`,
          'info',
        );
      }
    });

    queueEvents.on('active', async ({ jobId }) => {
      const job = await this.getJob(jobId);
      if (job) {
        EventStreamService.broadcast(
          job.data.build_id,
          `🚀 Build started - worker picked up the job\n`,
          'info',
        );
      }
    });

    queueEvents.on('completed', async ({ jobId }) => {
      console.log(`[BuildQueue] Job ${jobId} completed`);
    });

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      const job = await this.getJob(jobId);
      if (job) {
        console.error(`[BuildQueue] Job ${jobId} failed:`, failedReason);
      }
    });

    queueEvents.on('stalled', async ({ jobId }) => {
      const job = await this.getJob(jobId);
      if (job) {
        EventStreamService.broadcast(
          job.data.build_id,
          `⚠️ Build stalled - will be retried\n`,
          'warning',
        );
      }
    });
  },

  /**
   * Add a build job to the queue
   */
  async addJob(data: BuildJobData): Promise<{ jobId: string; position: number }> {
    if (!buildQueue) {
      throw new Error('Build queue not initialized');
    }

    const job = await buildQueue.add('build', data, {
      jobId: data.build_id, // Use build_id as job ID for easy lookup
    });

    const position = await this.getJobPosition(job.id!);

    console.log(`[BuildQueue] Added job ${job.id} at position ${position}`);

    return {
      jobId: job.id!,
      position,
    };
  },

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job<BuildJobData> | undefined> {
    if (!buildQueue) return undefined;
    return await buildQueue.getJob(jobId);
  },

  /**
   * Get job position in queue (1-indexed)
   */
  async getJobPosition(jobId: string): Promise<number> {
    if (!buildQueue) return 0;

    const waiting = await buildQueue.getWaiting();
    const index = waiting.findIndex((job) => job.id === jobId);

    if (index === -1) {
      // Job might be active or completed
      const active = await buildQueue.getActive();
      if (active.some((job) => job.id === jobId)) {
        return 0; // Currently processing
      }
      return -1; // Not found
    }

    return index + 1;
  },

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    if (!buildQueue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      buildQueue.getWaitingCount(),
      buildQueue.getActiveCount(),
      buildQueue.getCompletedCount(),
      buildQueue.getFailedCount(),
      buildQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  },

  /**
   * Get detailed queue info with jobs
   */
  async getQueueInfo(): Promise<{
    stats: QueueStats;
    waitingJobs: Array<{ id: string; buildId: string; position: number }>;
    activeJobs: Array<{ id: string; buildId: string }>;
  }> {
    if (!buildQueue) {
      return {
        stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        waitingJobs: [],
        activeJobs: [],
      };
    }

    const [stats, waiting, active] = await Promise.all([
      this.getStats(),
      buildQueue.getWaiting(),
      buildQueue.getActive(),
    ]);

    return {
      stats,
      waitingJobs: waiting.map((job, index) => ({
        id: job.id!,
        buildId: job.data.build_id,
        position: index + 1,
      })),
      activeJobs: active.map((job) => ({
        id: job.id!,
        buildId: job.data.build_id,
      })),
    };
  },

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[BuildQueue] Shutting down...');

    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }

    if (buildQueue) {
      await buildQueue.close();
      buildQueue = null;
    }

    console.log('[BuildQueue] Shutdown complete');
  },

  /**
   * Check if queue is initialized
   */
  isInitialized(): boolean {
    return buildQueue !== null;
  },
};
