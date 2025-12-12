import { Elysia } from 'elysia';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Builder } from './services/builder';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    // Wait 5s before retrying if we hit a limit, preventing tight restart loops
    return Math.min(times * 500, 5000);
  },
});

connection.on('connect', () => {
  console.log('✅ Connected to Redis');
});

connection.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
  if (err.message.includes('max requests limit exceeded')) {
    console.error('⚠️ Redis limit exceeded. Disconnecting and waiting 30s...');
    connection.disconnect();
    setTimeout(() => {
      console.log('🔄 Reconnecting to Redis...');
      connection.connect();
    }, 30000);
  }
});

// Prevent crash on unhandled errors to stop restart loops
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('🚀 Starting Build Worker...');

const worker = new Worker(
  'build-queue',
  async (job) => {
    console.log(`Processing job ${job.id}:`, job.data.build_id);
    try {
      await Builder.execute(job.data);
      console.log(`Job ${job.id} completed`);
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 1,
    // Optimize for lower Redis usage
    lockDuration: 300000, // 5 minutes (was 60s)
    stalledInterval: 300000, // Check for stalled jobs every 5 mins
    drainDelay: 30000, // Check for delayed jobs every 30s (default 5s)
  },
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});

// Keep Elysia for health checks
const app = new Elysia().get('/', () => 'Build Worker is running').listen(4001);

console.log(`👷 Build Worker is running at ${app.server?.hostname}:${app.server?.port}`);

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing worker...`);
  await worker.close();
  await connection.quit();
  console.log('Worker closed');
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
