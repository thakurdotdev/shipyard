import { db } from '../db';
import { buildLogs, LogLevel } from '../db/schema';
import { and, asc, eq, gt } from 'drizzle-orm';

export interface LogEntry {
  id: string;
  build_id: string;
  level: LogLevel;
  message: string;
  timestamp: Date;
}

function toLogEntry(log: typeof buildLogs.$inferSelect): LogEntry {
  return {
    id: log.id,
    build_id: log.build_id,
    level: log.level as LogLevel,
    message: log.message,
    timestamp: log.timestamp,
  };
}

export const LogService = {
  /**
   * Persist a structured log entry to the database.
   * Returns the inserted row so callers can forward its id/timestamp in the
   * WebSocket broadcast (lets clients de-duplicate when backfilling).
   */
  async persist(buildId: string, message: string, level: LogLevel = 'info'): Promise<LogEntry> {
    const [row] = await db
      .insert(buildLogs)
      .values({
        build_id: buildId,
        level,
        message,
      })
      .returning();
    return toLogEntry(row);
  },

  /**
   * Get all logs for a build, ordered by timestamp
   */
  async getLogs(buildId: string): Promise<LogEntry[]> {
    const logs = await db
      .select()
      .from(buildLogs)
      .where(eq(buildLogs.build_id, buildId))
      .orderBy(asc(buildLogs.timestamp));

    return logs.map(toLogEntry);
  },

  /**
   * Get only logs persisted after `since` (strictly greater), ordered by
   * timestamp. Used by clients to backfill lines missed over a flaky
   * transport (e.g. long-polling reconnects).
   */
  async getLogsSince(buildId: string, since: Date): Promise<LogEntry[]> {
    const logs = await db
      .select()
      .from(buildLogs)
      .where(and(eq(buildLogs.build_id, buildId), gt(buildLogs.timestamp, since)))
      .orderBy(asc(buildLogs.timestamp));

    return logs.map(toLogEntry);
  },

  /**
   * Clear all logs for a build
   */
  async clearLogs(buildId: string) {
    await db.delete(buildLogs).where(eq(buildLogs.build_id, buildId));
  },

  /**
   * Get logs as plain text (for backward compatibility)
   */
  async getLogsAsText(buildId: string): Promise<string> {
    const logs = await this.getLogs(buildId);
    return logs.map((log) => log.message).join('');
  },
};
