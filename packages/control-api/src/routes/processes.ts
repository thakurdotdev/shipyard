import { Elysia } from 'elysia';

const PM0_BASE = process.env.PM0_API_URL ?? 'http://127.0.0.1:9615/api/v1';

interface RawPM0Process {
  pid?: number;
  name?: string;
  pm_id?: number | string;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    exec_mode?: string;
    interpreter?: string;
    pm_exec_path?: string;
    pm_cwd?: string;
    instances?: number | string;
    autorestart?: boolean;
    restart_time?: number;
    unstable_restarts?: number;
    created_at?: number | string | null;
    pm_uptime?: number;
    exit_code?: number | null;
    max_restarts?: number;
    watch?: boolean;
    args?: string | string[];
    env?: Record<string, string | undefined>;
    DEPLOY_PROJECT_ID?: string;
    DEPLOY_BUILD_ID?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface RawPM0SystemStats {
  cpu_cores?: number;
  load_1?: number;
  load_5?: number;
  load_15?: number;
  has_load?: boolean;
  memory_total_bytes?: number;
  memory_used_bytes?: number;
  memory_used_pct?: number;
  has_memory?: boolean;
}

interface RawPM0ListResponse {
  processes?: RawPM0Process[];
  system?: RawPM0SystemStats | null;
}

function sanitizeSystem(system?: RawPM0SystemStats | null) {
  if (!system) return null;
  return {
    cpu_cores: system.cpu_cores ?? 0,
    load_1: system.load_1 ?? 0,
    load_5: system.load_5 ?? 0,
    load_15: system.load_15 ?? 0,
    has_load: system.has_load ?? false,
    memory_total_bytes: system.memory_total_bytes ?? 0,
    memory_used_bytes: system.memory_used_bytes ?? 0,
    memory_used_pct: system.memory_used_pct ?? 0,
    has_memory: system.has_memory ?? false,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Strip sensitive / bulky fields from a pm0 process object before
 * sending it to the dashboard.  We keep only what the UI needs:
 *   - top-level: pid, name, pm_id, project_id, monit
 *   - pm2_env: status, exec_mode, interpreter, pm_exec_path, pm_cwd,
 *     instances, autorestart, restart_time, unstable_restarts,
 *     created_at, pm_uptime, exit_code, max_restarts, watch, args
 *
 * Everything else (the full child `env`, log paths, node_args, …) is
 * dropped so we never leak secrets or useless system env vars.
 */
function sanitizeProcess(proc: RawPM0Process) {
  const env = proc.pm2_env ?? {};
  return {
    pid: proc.pid,
    name: proc.name,
    pm_id: proc.pm_id,
    project_id: env.env?.DEPLOY_PROJECT_ID ?? env.DEPLOY_PROJECT_ID,
    monit: proc.monit,
    status: env.status,
    exec_mode: env.exec_mode,
    interpreter: env.interpreter,
    script: env.pm_exec_path,
    cwd: env.pm_cwd,
    instances: env.instances,
    autorestart: env.autorestart,
    restart_time: env.restart_time,
    unstable_restarts: env.unstable_restarts,
    created_at: env.created_at,
    pm_uptime: env.pm_uptime,
    exit_code: env.exit_code,
    max_restarts: env.max_restarts,
    watch: env.watch,
    args: env.args,
  };
}

async function pm0Fetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${PM0_BASE}${path}`, opts);
  const text = await res.text();

  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      // Ignore JSON parse errors and keep the original text
    }
    throw new Error(msg);
  }

  return text ? JSON.parse(text) : null;
}

export const processesRoutes = new Elysia().group('/pm0', (app) =>
  app
    // Daemon health
    .get('/health', async ({ set }) => {
      try {
        return await pm0Fetch('/health');
      } catch (e: unknown) {
        set.status = 502;
        return { error: `PM0 daemon unreachable: ${getErrorMessage(e)}` };
      }
    })

    // List all processes (sanitized). Pass ?system=true for host telemetry.
    .get('/processes', async ({ query, set }) => {
      try {
        const withSystem = query?.system === 'true' || query?.system === '1';

        if (!withSystem) {
          const procs = (await pm0Fetch('/processes')) as RawPM0Process[];
          return (procs ?? []).map(sanitizeProcess);
        }

        const data = (await pm0Fetch('/processes?system=true')) as
          RawPM0ListResponse | RawPM0Process[];

        if (Array.isArray(data)) {
          return { processes: data.map(sanitizeProcess), system: null };
        }

        return {
          processes: (data.processes ?? []).map(sanitizeProcess),
          system: sanitizeSystem(data.system),
        };
      } catch (e: unknown) {
        set.status = 502;
        return { error: getErrorMessage(e) };
      }
    })

    // Describe a single process (sanitized)
    .get('/processes/:target', async ({ params: { target }, set }) => {
      try {
        const proc = (await pm0Fetch(`/processes/${encodeURIComponent(target)}`)) as RawPM0Process;
        return sanitizeProcess(proc);
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 502;
        return { error: errorMsg };
      }
    })

    // Stop
    .post('/processes/:target/stop', async ({ params: { target }, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/stop`, {
          method: 'POST',
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Restart
    .post('/processes/:target/restart', async ({ params: { target }, body, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/restart`, {
          method: 'POST',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Reload
    .post('/processes/:target/reload', async ({ params: { target }, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/reload`, {
          method: 'POST',
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Delete
    .delete('/processes/:target', async ({ params: { target }, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}`, {
          method: 'DELETE',
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Scale
    .post('/processes/:target/scale', async ({ params: { target }, body, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/scale`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Save dump
    .post('/daemon/save', async ({ set }) => {
      try {
        return await pm0Fetch('/daemon/save', { method: 'POST' });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Resurrect
    .post('/daemon/resurrect', async ({ set }) => {
      try {
        return await pm0Fetch('/daemon/resurrect', { method: 'POST' });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // SSE log stream — proxy straight through
    .get('/processes/:target/logs', async ({ params: { target }, query, set }) => {
      try {
        const qs = new URLSearchParams();
        if (query && typeof query === 'object') {
          for (const [k, v] of Object.entries(query as Record<string, string>)) {
            if (v !== undefined && v !== '') qs.set(k, v);
          }
        }
        const url = `${PM0_BASE}/processes/${encodeURIComponent(target)}/logs?${qs.toString()}`;
        const upstream = await fetch(url);

        if (!upstream.ok) {
          set.status = upstream.status;
          return { error: `PM0 log stream error: ${upstream.status}` };
        }

        // Return SSE response
        set.headers['content-type'] = 'text/event-stream';
        set.headers['cache-control'] = 'no-cache';
        set.headers['connection'] = 'keep-alive';
        set.headers['x-accel-buffering'] = 'no';

        return upstream.body;
      } catch (e: unknown) {
        set.status = 502;
        return { error: getErrorMessage(e) };
      }
    })

    // Clear logs (truncates files and drops the in-memory backlog)
    .post('/processes/:target/logs/clear', async ({ params: { target }, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/logs/clear`, {
          method: 'POST',
        });
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 500;
        return { error: errorMsg };
      }
    })

    // DELETE is an equivalent alias for clearing logs
    .delete('/processes/:target/logs', async ({ params: { target }, set }) => {
      try {
        return await pm0Fetch(`/processes/${encodeURIComponent(target)}/logs`, {
          method: 'DELETE',
        });
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 500;
        return { error: errorMsg };
      }
    }),
);
