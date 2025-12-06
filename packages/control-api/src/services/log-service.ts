import { db } from "../db";
import { builds } from "../db/schema";
import { eq } from "drizzle-orm";

export const LogService = {
  async persist(buildId: string, logs: string) {
    // Append logs to existing build logs
    // In a real app, we might store logs in a separate table or object storage
    // For now, we'll just append to the text column in builds table
    const build = await db.select().from(builds).where(eq(builds.id, buildId));
    if (!build[0]) return;

    const currentLogs = build[0].logs || "";
    const newLogs = currentLogs + logs;

    await db
      .update(builds)
      .set({ logs: newLogs })
      .where(eq(builds.id, buildId));
  },

  async getLogs(buildId: string) {
    const build = await db.select().from(builds).where(eq(builds.id, buildId));
    return build[0]?.logs || "";
  },
};
