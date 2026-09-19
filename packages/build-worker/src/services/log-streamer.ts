export type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'deploy';

const FLUSH_INTERVAL = 300; // 300ms - flush more frequently for real-time feel

interface LogEntry {
  message: string;
  level: LogLevel;
}

interface LogBuffer {
  entries: LogEntry[];
  timeout: Timer | null;
}

const buffers: Record<string, LogBuffer> = {};

export const LogStreamer = {
  /**
   * Stream a log message with a specific level
   */
  async stream(buildId: string, _projectId: string, message: string, level: LogLevel = 'info') {
    if (!buffers[buildId]) {
      buffers[buildId] = {
        entries: [],
        timeout: null,
      };
    }

    const buffer = buffers[buildId];
    buffer.entries.push({ message, level });

    // Set timeout for time-based flush if not already set
    if (!buffer.timeout) {
      buffer.timeout = setTimeout(() => {
        this.flush(buildId);
      }, FLUSH_INTERVAL);
    }
  },

  async flush(buildId: string) {
    const buffer = buffers[buildId];
    if (!buffer || buffer.entries.length === 0) return;

    // Clear timeout if exists
    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }

    const entriesToSend = [...buffer.entries];
    buffer.entries = []; // Clear buffer immediately

    const controlApiUrl = process.env.CONTROL_API_URL || 'http://localhost:4010';

    // Send each entry individually for proper log level tracking
    // Batch into single request with combined message per level
    const byLevel = new Map<LogLevel, string>();
    for (const entry of entriesToSend) {
      const existing = byLevel.get(entry.level) || '';
      byLevel.set(entry.level, existing + entry.message);
    }

    // Send each level group
    for (const [level, logs] of byLevel) {
      try {
        const res = await fetch(`${controlApiUrl}/builds/${buildId}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logs, level }),
        });
        if (!res.ok) {
          console.error(`[LogStreamer] Failed to flush: ${res.statusText}`);
        }
      } catch (error) {
        console.error('[LogStreamer] Failed to stream logs:', error);
      }
    }
  },

  async ensureFlushed(buildId: string) {
    await this.flush(buildId);
    delete buffers[buildId];
  },
};
