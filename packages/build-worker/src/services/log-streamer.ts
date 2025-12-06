const BUFFER_SIZE_LIMIT = 2 * 1024; // 2KB
const FLUSH_INTERVAL = 500; // 500ms

interface LogBuffer {
  logs: string;
  timeout: Timer | null;
}

const buffers: Record<string, LogBuffer> = {};

export const LogStreamer = {
  async stream(buildId: string, projectId: string, message: string) {
    if (!buffers[buildId]) {
      buffers[buildId] = {
        logs: "",
        timeout: null,
      };
    }

    const buffer = buffers[buildId];
    buffer.logs += message;

    // Check size limit
    if (buffer.logs.length >= BUFFER_SIZE_LIMIT) {
      await this.flush(buildId);
    } else if (!buffer.timeout) {
      // Set timeout for time-based flush
      buffer.timeout = setTimeout(() => {
        this.flush(buildId);
      }, FLUSH_INTERVAL);
    }
  },

  async flush(buildId: string) {
    const buffer = buffers[buildId];
    if (!buffer || buffer.logs.length === 0) return;

    // Clear timeout if exists
    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }

    const logsToSend = buffer.logs;
    buffer.logs = ""; // Clear buffer immediately

    // console.log(`[LogStreamer] Flushing ${logsToSend.length} chars for ${buildId}`);

    const controlApiUrl =
      process.env.CONTROL_API_URL || "http://localhost:4000";

    try {
      const res = await fetch(`${controlApiUrl}/builds/${buildId}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs: logsToSend }),
      });
      if (!res.ok) {
        console.error(`[LogStreamer] Failed to flush: ${res.statusText}`);
      }
    } catch (error) {
      console.error("[LogStreamer] Failed to stream logs:", error);
    }
  },

  async ensureFlushed(buildId: string) {
    await this.flush(buildId);
    delete buffers[buildId];
  },
};
