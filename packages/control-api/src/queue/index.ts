export interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: 'nextjs' | 'vite';
  env_vars: Record<string, string>;
  installation_id?: string;
}

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Initialize BullMQ Queue
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

connection.on('error', (err) => {
  console.error('Redis error:', err);
  if (err.message.includes('max requests limit exceeded')) {
    console.error('Redis limit exceeded. Pausing connection for 30s...');
    connection.disconnect();
    setTimeout(() => connection.connect(), 30000);
  }
});

export const buildQueue = new Queue('build-queue', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

export const JobQueue = {
  async enqueue(job: BuildJob) {
    console.log('Enqueueing job to Redis:', job.build_id);
    await buildQueue.add('build-job', job, {
      removeOnComplete: true,
    });
  },
};
