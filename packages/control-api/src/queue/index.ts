export interface BuildJob {
  build_id: string;
  project_id: string;
  github_url: string;
  build_command: string;
  root_directory: string;
  app_type: "nextjs" | "vite";
  env_vars: Record<string, string>;
}

import { Queue } from "bullmq";
import IORedis from "ioredis";

// Initialize BullMQ Queue
const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const buildQueue = new Queue("build-queue", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
  },
});

export const JobQueue = {
  async enqueue(job: BuildJob) {
    console.log("Enqueueing job to Redis:", job.build_id);
    await buildQueue.add("build-job", job, {
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  },
};
