import { create } from 'zustand';
import { LogEntry, LogLevel } from '@/lib/types';

interface LogStore {
  logs: Record<string, LogEntry[]>;
  appendLog: (
    buildId: string,
    message: string,
    level: LogLevel,
    meta?: { id?: string; timestamp?: string },
  ) => void;
  setLogs: (buildId: string, entries: LogEntry[]) => void;
  /**
   * Merge entries into the existing stream, skipping ones already present by
   * id. Used for backfilling after a reconnect.
   */
  mergeLogs: (buildId: string, entries: LogEntry[]) => void;
  clearLogs: (buildId: string) => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: {},
  appendLog: (buildId, message, level, meta) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [buildId]: [
          ...(state.logs[buildId] || []),
          {
            id: meta?.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            build_id: buildId,
            level,
            message,
            timestamp: meta?.timestamp || new Date().toISOString(),
          },
        ],
      },
    })),
  mergeLogs: (buildId, entries) =>
    set((state) => {
      const existing = state.logs[buildId] || [];
      const seen = new Set(existing.map((e) => e.id));
      const additions = entries.filter((e) => !seen.has(e.id));
      if (additions.length === 0) return state;
      // Backfilled entries are newer than everything we hold (server queries
      // `timestamp > lastKnown`), so appending preserves order.
      return { logs: { ...state.logs, [buildId]: [...existing, ...additions] } };
    }),
  setLogs: (buildId, entries) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [buildId]: entries,
      },
    })),
  clearLogs: (buildId) =>
    set((state) => {
      const newLogs = { ...state.logs };
      delete newLogs[buildId];
      return { logs: newLogs };
    }),
}));
