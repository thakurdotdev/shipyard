import { Elysia } from 'elysia';

/**
 * pm0 HTTP APIs. The platform daemon runs ShipYard itself (and, before isolation, every
 * app); the apps daemon (SHIPYARD_APP_USER) runs deployed apps. The API has no auth of
 * its own, so serve it on a Unix socket: `unix:/path/to/http.sock`. A TCP loopback port
 * lets every local account (including deployed apps) start processes as its owner.
 */
type Daemon = 'platform' | 'apps';
interface DaemonEndpoint {
  base: string;
  unix?: string;
}

function endpoint(raw: string): DaemonEndpoint {
  if (raw.startsWith('unix:')) return { base: 'http://localhost/api/v1', unix: raw.slice(5) };
  return { base: raw.replace(/\/+$/, '') };
}

const DAEMONS: Partial<Record<Daemon, DaemonEndpoint>> = {
  platform: endpoint(process.env.PM0_API_URL ?? 'http://127.0.0.1:9615/api/v1'),
  ...(process.env.PM0_APPS_API_URL ? { apps: endpoint(process.env.PM0_APPS_API_URL) } : {}),
};

/** Targets for the apps daemon are prefixed (`apps:3`) since pm_ids overlap between daemons. */
const APPS_PREFIX = 'apps:';

function resolveTarget(target: string): { daemon: Daemon; target: string } {
  if (target.startsWith(APPS_PREFIX)) {
    if (!DAEMONS.apps) throw new Error('No apps pm0 daemon is configured (PM0_APPS_API_URL)');
    return { daemon: 'apps', target: target.slice(APPS_PREFIX.length) };
  }
  return { daemon: 'platform', target };
}

function daemonFetch(daemon: Daemon, path: string, opts?: RequestInit): Promise<Response> {
  const ep = DAEMONS[daemon];
  if (!ep) throw new Error(`pm0 ${daemon} daemon is not configured`);
  // Bun's fetch accepts `unix` to talk HTTP over a Unix domain socket.
  return fetch(`${ep.base}${path}`, {
    ...opts,
    ...(ep.unix ? { unix: ep.unix } : {}),
  } as RequestInit);
}

function configuredDaemons(): Daemon[] {
  return (['apps', 'platform'] as const).filter((d) => DAEMONS[d]);
}

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
function sanitizeProcess(proc: RawPM0Process, daemon: Daemon = 'platform') {
  const env = proc.pm2_env ?? {};
  return {
    daemon,
    // What the dashboard sends back to act on this process.
    target: daemon === 'apps' ? `${APPS_PREFIX}${proc.pm_id}` : String(proc.pm_id),
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

async function pm0Fetch(path: string, opts?: RequestInit, daemon: Daemon = 'platform') {
  const res = await daemonFetch(daemon, path, opts);
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

/** Proxy an action on one process to the daemon that owns it. */
function onTarget(target: string, suffix: string, opts?: RequestInit) {
  const t = resolveTarget(target);
  return pm0Fetch(`/processes/${encodeURIComponent(t.target)}${suffix}`, opts, t.daemon);
}

export const processesRoutes = new Elysia().group('/pm0', (app) =>
  app
    // Daemon health (the platform daemon, falling back to the apps daemon)
    .get('/health', async ({ set }) => {
      let lastError: unknown;
      for (const daemon of ['platform', 'apps'] as const) {
        if (!DAEMONS[daemon]) continue;
        try {
          return await pm0Fetch('/health', undefined, daemon);
        } catch (e) {
          lastError = e;
        }
      }
      set.status = 502;
      return { error: `PM0 daemon unreachable: ${getErrorMessage(lastError)}` };
    })

    // List all processes (sanitized) from every daemon. Pass ?system=true for host telemetry.
    .get('/processes', async ({ query, set }) => {
      const withSystem = query?.system === 'true' || query?.system === '1';
      const processes: ReturnType<typeof sanitizeProcess>[] = [];
      let system: ReturnType<typeof sanitizeSystem> = null;
      let reached = 0;
      let lastError: unknown;

      for (const daemon of configuredDaemons()) {
        try {
          const data = (await pm0Fetch(
            withSystem ? '/processes?system=true' : '/processes',
            undefined,
            daemon,
          )) as RawPM0ListResponse | RawPM0Process[] | null;
          reached++;
          const list = Array.isArray(data) ? data : (data?.processes ?? []);
          processes.push(...list.map((p) => sanitizeProcess(p, daemon)));
          if (!Array.isArray(data) && data?.system && !system) system = sanitizeSystem(data.system);
        } catch (e) {
          lastError = e;
        }
      }

      if (reached === 0) {
        set.status = 502;
        return { error: getErrorMessage(lastError) };
      }
      return withSystem ? { processes, system } : processes;
    })

    // Describe a single process (sanitized)
    .get('/processes/:target', async ({ params: { target }, set }) => {
      try {
        const t = resolveTarget(target);
        const proc = (await onTarget(target, '')) as RawPM0Process;
        return sanitizeProcess(proc, t.daemon);
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 502;
        return { error: errorMsg };
      }
    })

    // Stop
    .post('/processes/:target/stop', async ({ params: { target }, set }) => {
      try {
        return await onTarget(target, '/stop', { method: 'POST' });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Restart
    .post('/processes/:target/restart', async ({ params: { target }, body, set }) => {
      try {
        return await onTarget(target, '/restart', {
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
        return await onTarget(target, '/reload', { method: 'POST' });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Delete
    .delete('/processes/:target', async ({ params: { target }, set }) => {
      try {
        return await onTarget(target, '', { method: 'DELETE' });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Scale
    .post('/processes/:target/scale', async ({ params: { target }, body, set }) => {
      try {
        return await onTarget(target, '/scale', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Save dump (every daemon, so a reboot restores both)
    .post('/daemon/save', async ({ set }) => {
      try {
        const results = [];
        for (const daemon of configuredDaemons()) {
          results.push(await pm0Fetch('/daemon/save', { method: 'POST' }, daemon));
        }
        const saved = results.reduce((n, r) => n + (Number(r?.saved_count) || 0), 0);
        return { ...results[0], saved_count: saved };
      } catch (e: unknown) {
        set.status = 500;
        return { error: getErrorMessage(e) };
      }
    })

    // Resurrect
    .post('/daemon/resurrect', async ({ set }) => {
      try {
        const results = [];
        for (const daemon of configuredDaemons()) {
          results.push(await pm0Fetch('/daemon/resurrect', { method: 'POST' }, daemon));
        }
        return results[results.length - 1];
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
        const t = resolveTarget(target);
        const upstream = await daemonFetch(
          t.daemon,
          `/processes/${encodeURIComponent(t.target)}/logs?${qs.toString()}`,
        );

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
        return await onTarget(target, '/logs/clear', { method: 'POST' });
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 500;
        return { error: errorMsg };
      }
    })

    // DELETE is an equivalent alias for clearing logs
    .delete('/processes/:target/logs', async ({ params: { target }, set }) => {
      try {
        return await onTarget(target, '/logs', { method: 'DELETE' });
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        set.status = errorMsg.includes('no matching') ? 404 : 500;
        return { error: errorMsg };
      }
    }),
);
