import { Elysia } from 'elysia';
import { Builder } from './services/builder';
import { BuildWorker } from './queue';

// Prevent crash on unhandled errors to stop restart loops
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('🚀 Starting Build Worker...');

// Initialize BullMQ worker
BuildWorker.initialize().catch((err) => {
  console.error('[BuildWorker] Failed to initialize:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 4011;
// HTTP server for health checks and fallback direct build triggering
const app = new Elysia()
  .get('/', () => 'Build Worker is running')
  .get('/health', () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    workerRunning: BuildWorker.isRunning(),
  }))
  // Keep HTTP endpoint as fallback for direct builds (optional)
  .post('/build', async ({ body }) => {
    const job = body as any;
    console.log(`[Build] Received direct HTTP request for ${job.build_id}`);
    console.log(`[Build] Note: Consider using the queue for better reliability`);
    try {
      // Run build asynchronously (don't block the response)
      Builder.execute(job).catch((err) => {
        console.error(`[Build] ${job.build_id} failed:`, err);
      });
      return { success: true, message: 'Build started (direct)', build_id: job.build_id };
    } catch (error: any) {
      console.error(`[Build] Failed to start:`, error);
      return { success: false, error: error.message };
    }
  })
  .listen(PORT);

console.log(`👷 Build Worker is running at ${app.server?.hostname}:${app.server?.port}`);

const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    // Shutdown worker (waits for current job to complete)
    await BuildWorker.shutdown();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
