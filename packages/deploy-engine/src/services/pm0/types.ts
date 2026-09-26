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
    DEPLOY_BUILD_ID?: string;
  };
}

/**
 * Process naming convention — mirrors Docker container naming.
 * Uses first 8 chars of projectId for uniqueness.
 */
export function getProcessName(projectId: string): string {
  return `deploy-${projectId.slice(0, 8)}`;
}
