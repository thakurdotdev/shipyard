/**
 * Queue configuration for build jobs
 */
export const QUEUE_CONFIG = {
  name: 'build-queue',

  // Redis connection options (parsed from REDIS_URL)
  connection: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // Default job options
  defaultJobOptions: {
    // Builds run in-place in the deploy engine, so a BullMQ retry would re-clone
    // and rebuild from scratch (duplicate work). Re-trigger builds manually
    // until the pipeline is fully resumable.
    attempts: 1,
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      count: 50, // Keep last 50 failed jobs
    },
  },

  // Worker settings
  worker: {
    concurrency: 1, // Process one build at a time to protect server
  },
};
