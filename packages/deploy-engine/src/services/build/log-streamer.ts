import { config, internalAuthHeaders } from '@shipyard/config';
export type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'deploy';

const FLUSH_INTERVAL = 300; // 300ms - flush more frequently for real-time feel
/** Flush early once this much output is waiting, so one request never carries megabytes. */
const MAX_BUFFERED_CHARS = 256 * 1024;
/** A stuck Control API must not stall the build that is logging to it. */
const REQUEST_TIMEOUT_MS = 10_000;

interface LogEntry {
  message: string;
  level: LogLevel;
}

interface LogBuffer {
  entries: LogEntry[];
  chars: number;
  timeout: Timer | null;
  /** The flush in progress; the next one waits for it so lines arrive in order. */
  sending: Promise<void>;
}

const buffers = new Map<string, LogBuffer>();

/** Joins neighbouring entries of the same level, keeping the original line order. */
export function groupByLevel(entries: LogEntry[]): LogEntry[] {
  const groups: LogEntry[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.level === entry.level) last.message += entry.message;
    else groups.push({ ...entry });
  }
  return groups;
}

async function send(buildId: string, groups: LogEntry[]) {
  for (const { level, message } of groups) {
    try {
      const res = await fetch(`${config.controlApiUrl}/builds/${buildId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ logs: message, level }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`[LogStreamer] Failed to flush: ${res.statusText}`);
      }
    } catch (error) {
      console.error('[LogStreamer] Failed to stream logs:', error);
    }
  }
}

/**
 * Streams build logs to the control-api for persistence and WebSocket broadcast.
 * Entries are buffered and sent in batches so chatty build output does not
 * generate one HTTP request per line.
 */
export const LogStreamer = {
  /**
   * Stream a log message with a specific level
   */
  stream(buildId: string, _projectId: string, message: string, level: LogLevel = 'info') {
    let buffer = buffers.get(buildId);
    if (!buffer) {
      buffer = { entries: [], chars: 0, timeout: null, sending: Promise.resolve() };
      buffers.set(buildId, buffer);
    }

    buffer.entries.push({ message, level });
    buffer.chars += message.length;

    if (buffer.chars >= MAX_BUFFERED_CHARS) {
      void this.flush(buildId);
    } else if (!buffer.timeout) {
      // Set timeout for time-based flush if not already set
      buffer.timeout = setTimeout(() => void this.flush(buildId), FLUSH_INTERVAL);
    }
  },

  /** Sends everything buffered so far; resolves once it (and any earlier flush) is delivered. */
  flush(buildId: string): Promise<void> {
    const buffer = buffers.get(buildId);
    if (!buffer) return Promise.resolve();

    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }
    if (buffer.entries.length === 0) return buffer.sending;

    const groups = groupByLevel(buffer.entries);
    buffer.entries = [];
    buffer.chars = 0;
    const sent = buffer.sending.then(() => send(buildId, groups));
    buffer.sending = sent;
    void sent.then(() => {
      // Forget idle builds so the map only holds builds that are logging right now. A
      // later line simply starts a new buffer; nothing is in flight, so order is kept.
      if (buffers.get(buildId) === buffer && buffer.sending === sent && !buffer.entries.length) {
        buffers.delete(buildId);
      }
    });
    return sent;
  },

  /** Sends everything still buffered. Call when the build (or deployment step) is done. */
  async ensureFlushed(buildId: string) {
    await this.flush(buildId);
  },

  /** Builds with buffered or in-flight output (for tests). */
  get pending() {
    return buffers.size;
  },
};
