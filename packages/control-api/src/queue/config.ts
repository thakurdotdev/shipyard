import { config } from '@shipyard/config';
/**
 * Queue configuration for build jobs
 */
export const QUEUE_CONFIG = {
  name: 'build-queue',

  // Redis connection options (parsed from REDIS_URL)
  connection: {
    url: config.redisUrl,
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

  // The Deploy Engine runs the worker; builds at a time is set in Settings → Deployments.
};
