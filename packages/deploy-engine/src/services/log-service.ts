export type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'deploy';

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4010';

/**
 * Streams deployment logs to the control-api for persistence and WebSocket broadcast.
 * Uses the same endpoint as the build pipeline, so logs appear in the same build log stream.
 */
export const LogService = {
  /**
   * Stream a log message for a deployment
   */
  async stream(buildId: string, message: string, level: LogLevel = 'deploy') {
    // Also log to console for debugging
    console.log(`[Deploy:${buildId}] ${message}`);

    try {
      const res = await fetch(`${CONTROL_API_URL}/builds/${buildId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: message, level }),
      });

      if (!res.ok) {
        console.error(`[LogService] Failed to stream log: ${res.status} ${res.statusText}`);
      }
    } catch (error) {
      console.error('[LogService] Failed to stream deploy log:', error);
    }
  },

  /**
   * Log a step in the deployment process with emoji prefix
   */
  async step(buildId: string, step: string) {
    await this.stream(buildId, `📦 ${step}\n`, 'deploy');
  },

  /**
   * Log a sub-step or detail
   */
  async detail(buildId: string, detail: string) {
    await this.stream(buildId, `   → ${detail}\n`, 'info');
  },

  /**
   * Log progress
   */
  async progress(buildId: string, message: string) {
    await this.stream(buildId, `⏳ ${message}\n`, 'info');
  },

  /**
   * Log success
   */
  async success(buildId: string, message: string) {
    await this.stream(buildId, `✅ ${message}\n`, 'success');
  },

  /**
   * Log warning
   */
  async warning(buildId: string, message: string) {
    await this.stream(buildId, `⚠️ ${message}\n`, 'warning');
  },

  /**
   * Log error
   */
  async error(buildId: string, message: string) {
    await this.stream(buildId, `❌ ${message}\n`, 'error');
  },
};
