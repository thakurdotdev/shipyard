/**
 * PM0 Process Manager Types
 *
 * PM0 is a PM2-compatible process supervisor built in Go.
 * It provides the same CLI interface and ecosystem config format as PM2.
 */

/**
 * PM2-compatible process info structure returned by `pm0 jlist`
 */
export interface PM0ProcessInfo {
  name: string;
  pm_id: number;
  monit: {
    memory: number;
    cpu: number;
  };
  pm2_env: {
    status: 'online' | 'stopping' | 'stopped' | 'errored' | 'launching';
    pm_uptime: number;
    restart_time: number;
    pm_cwd: string;
    PORT?: string;
    DEPLOY_PROJECT_ID?: string;
    DEPLOY_PROJECT_NAME?: string;
    DEPLOY_BUILD_ID?: string;
  };
}

/**
 * Process naming convention.
 * Uses sanitized project name (slug) if provided, otherwise falls back to first 8 chars of projectId.
 */
export function getProcessName(projectId: string, projectName?: string): string {
  if (projectName && projectName.trim()) {
    const slug = projectName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (slug) return slug;
  }
  return `deploy-${projectId.slice(0, 8)}`;
}
