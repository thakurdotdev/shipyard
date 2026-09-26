/**
 * Queue configuration for the in-engine build worker.
 * Must match control-api's QUEUE_CONFIG.name (packages/control-api/src/queue/config.ts).
 */
export const QUEUE_CONFIG = {
  name: 'build-queue',

  // Worker settings
  worker: {
    concurrency: 1, // Process one build at a time to protect the server
  },
};

/**
 * Parse Redis URL for connection options
 */
export function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

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
