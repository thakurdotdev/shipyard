import { Elysia } from "elysia";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Builder } from "./services/builder";

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

connection.on("connect", () => {
  console.log("✅ Connected to Redis");
});

connection.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});

console.log("🚀 Starting Build Worker...");

const worker = new Worker(
  "build-queue",
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
    lockDuration: 60000, // 60s
    stalledInterval: 60000, // Check for stalled jobs every 60s (default 30s)
  },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});

// Keep Elysia for health checks
const app = new Elysia().get("/", () => "Build Worker is running").listen(4001);

console.log(
  `👷 Build Worker is running at ${app.server?.hostname}:${app.server?.port}`,
);

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing worker...`);
  await worker.close();
  await connection.quit();
  console.log("Worker closed");
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
