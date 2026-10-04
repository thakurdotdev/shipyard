const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010';

// Sanitized process object returned by our proxy (no env vars)
export interface PM0Process {
  pid: number;
  name: string;
  pm_id: number;
  monit: { memory: number; cpu: number };
  status: string;
  exec_mode: string;
  interpreter: string;
  script: string;
  cwd: string;
  instances: number;
  autorestart: boolean;
  restart_time: number;
  unstable_restarts: number;
  created_at: number | null;
  pm_uptime: number;
  exit_code: number | null;
  max_restarts: number;
  watch: boolean;
  args: string[];
}

export interface PM0Health {
  ok: boolean;
  version: string;
  commit: string;
  pid: number;
  kill_mode: string;
  kernel_release: string;
  cgroup_warning: string;
}

export interface PM0ActionResult {
  ok: boolean;
  affected_pm_ids: number[];
}

export interface PM0SaveResult {
  ok: boolean;
  dump_path: string;
  saved_count: number;
}

export const pm0Api = {
  async getHealth(): Promise<PM0Health> {
    const res = await fetch(`${API_URL}/pm0/health`, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'PM0 daemon unreachable' }));
      throw new Error(err.error || 'Failed to fetch PM0 health');
    }
    return res.json();
  },

  async getProcesses(): Promise<PM0Process[]> {
    const res = await fetch(`${API_URL}/pm0/processes`, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch processes' }));
      throw new Error(err.error || 'Failed to fetch processes');
    }
    return res.json();
  },

  async getProcess(target: string): Promise<PM0Process> {
    const res = await fetch(`${API_URL}/pm0/processes/${encodeURIComponent(target)}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Process not found' }));
      throw new Error(err.error || 'Failed to fetch process');
    }
    return res.json();
  },

  async stopProcess(target: string): Promise<PM0ActionResult> {
    const res = await fetch(`${API_URL}/pm0/processes/${encodeURIComponent(target)}/stop`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to stop process' }));
      throw new Error(err.error || 'Failed to stop process');
    }
    return res.json();
  },

  async restartProcess(target: string): Promise<PM0ActionResult> {
    const res = await fetch(`${API_URL}/pm0/processes/${encodeURIComponent(target)}/restart`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to restart process' }));
      throw new Error(err.error || 'Failed to restart process');
    }
    return res.json();
  },

  async reloadProcess(target: string): Promise<PM0ActionResult> {
    const res = await fetch(`${API_URL}/pm0/processes/${encodeURIComponent(target)}/reload`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to reload process' }));
      throw new Error(err.error || 'Failed to reload process');
    }
    return res.json();
  },

  async deleteProcess(target: string): Promise<PM0ActionResult> {
    const res = await fetch(`${API_URL}/pm0/processes/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete process' }));
      throw new Error(err.error || 'Failed to delete process');
    }
    return res.json();
  },

  async saveDump(): Promise<PM0SaveResult> {
    const res = await fetch(`${API_URL}/pm0/daemon/save`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save dump' }));
      throw new Error(err.error || 'Failed to save dump');
    }
    return res.json();
  },

  /** Returns the SSE EventSource URL for process logs */
  getLogsUrl(target: string, options?: { lines?: number; follow?: boolean; stderr?: boolean }) {
    const qs = new URLSearchParams();
    if (options?.lines !== undefined) qs.set('lines', String(options.lines));
    if (options?.follow !== undefined) qs.set('follow', String(options.follow));
    if (options?.stderr !== undefined) qs.set('stderr', String(options.stderr));
    return `${API_URL}/pm0/processes/${encodeURIComponent(target)}/logs?${qs.toString()}`;
  },
};
