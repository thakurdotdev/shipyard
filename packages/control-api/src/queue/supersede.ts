/** The fields of a queued job that decide whether a newer build replaces it. */
export interface QueuedBuildJob {
  id?: string;
  timestamp: number;
  data: { build_id: string; project_id: string };
}

/**
 * Jobs that a newly queued build makes redundant: the same project's builds queued
 * before it that have not started yet. Only the newest waiting build of a project
 * runs; the one already building is left to finish. Ties on the queue timestamp
 * keep both, so two builds queued in the same millisecond never cancel each other.
 */
export function selectSupersededJobs<T extends QueuedBuildJob>(
  waiting: T[],
  newer: QueuedBuildJob,
): T[] {
  return waiting.filter(
    (job) =>
      job.id !== newer.id &&
      job.data.project_id === newer.data.project_id &&
      job.timestamp < newer.timestamp,
  );
}
