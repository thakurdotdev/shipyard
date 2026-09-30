import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { and, asc, count, eq, isNull, lte } from 'drizzle-orm';
import { Job, Queue, Worker } from 'bullmq';
import { db } from '../db';
import {
  deployments,
  projects,
  uptimeAlerts,
  uptimeChecks,
  uptimeMonitors,
  user,
} from '../db/schema';

const QUEUE_NAME = 'uptime-queue';
const FAILURE_THRESHOLD = 2;
const DISPATCH_INTERVAL_MS = 15_000;
const HISTORY_MAX_CHECKS = 3_000;

type CheckJobData = { monitorId: string };

function redisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
  };
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized)
    );
  }
  return true;
}

async function validatePublicEndpoint(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Endpoint must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Endpoint must use HTTP or HTTPS');
  }
  if (url.username || url.password) throw new Error('Endpoint cannot contain credentials');

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Endpoint must be publicly reachable');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Endpoint must be publicly reachable');
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Endpoint must resolve only to public addresses');
    }
  }
  return url;
}

async function performCheck(endpoint: string, timeoutSeconds: number) {
  const startedAt = Date.now();
  try {
    const url = await validatePublicEndpoint(endpoint);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      headers: { 'User-Agent': 'ShipYard-Uptime/1.0' },
    });
    await response.body?.cancel();
    return {
      success: response.status >= 200 && response.status < 400,
      status_code: response.status,
      latency_ms: Date.now() - startedAt,
      error: response.status >= 400 ? `HTTP ${response.status}` : null,
    };
  } catch (error) {
    return {
      success: false,
      status_code: null,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Request failed',
    };
  }
}

export const UptimeService = {
  queue: null as Queue<CheckJobData> | null,
  worker: null as Worker<CheckJobData> | null,

  async initialize() {
    if (this.queue) return;
    const connection = redisConnection();
    this.queue = new Queue<CheckJobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
    this.worker = new Worker<CheckJobData>(
      QUEUE_NAME,
      async (job) => {
        if (job.name === 'dispatch-due-checks') {
          await this.dispatchDueChecks();
          await this.deliverPendingAlerts();
          return;
        }
        await this.runCheck(job);
      },
      { connection, concurrency: 5 },
    );
    this.worker.on('error', (error) => console.error('[Uptime] Worker error:', error));
    await this.queue.upsertJobScheduler(
      'uptime-dispatcher',
      { every: DISPATCH_INTERVAL_MS },
      { name: 'dispatch-due-checks', data: { monitorId: '' } },
    );
    console.log('[Uptime] Scheduler and worker initialized');
  },

  async dispatchDueChecks() {
    if (!this.queue) return;
    const now = new Date();
    const due = await db
      .select({ monitor: uptimeMonitors, project: projects, activeDeploymentId: deployments.id })
      .from(uptimeMonitors)
      .innerJoin(projects, eq(projects.id, uptimeMonitors.project_id))
      .leftJoin(
        deployments,
        and(eq(deployments.project_id, projects.id), eq(deployments.status, 'active')),
      )
      .where(and(eq(uptimeMonitors.enabled, true), lte(uptimeMonitors.next_check_at, now)))
      .orderBy(asc(uptimeMonitors.next_check_at))
      .limit(100);

    for (const { monitor, project, activeDeploymentId } of due) {
      let endpoint = monitor.endpoint_url;
      if (!endpoint) {
        if (!project.domain || !activeDeploymentId) {
          await db
            .update(uptimeMonitors)
            .set({ next_check_at: new Date(now.getTime() + 60_000) })
            .where(eq(uptimeMonitors.id, monitor.id));
          continue;
        }
        endpoint = `https://${project.domain}`;
      }

      const dueAt = monitor.next_check_at?.getTime() ?? now.getTime();
      await this.queue.add(
        'check-endpoint',
        { monitorId: monitor.id },
        { jobId: `uptime_${monitor.id}_${dueAt}` },
      );
    }
  },

  async runCheck(job: Job<CheckJobData>) {
    const monitor = await db.query.uptimeMonitors.findFirst({
      where: eq(uptimeMonitors.id, job.data.monitorId),
    });
    if (!monitor?.enabled) return;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, monitor.project_id),
    });
    if (!project) return;
    let endpoint = monitor.endpoint_url;
    if (!endpoint) {
      const active = await db.query.deployments.findFirst({
        where: and(eq(deployments.project_id, project.id), eq(deployments.status, 'active')),
        columns: { id: true },
      });
      if (!active || !project.domain) return;
      endpoint = `https://${project.domain}`;
    }

    const result = await performCheck(endpoint, monitor.timeout_seconds);
    const checkedAt = new Date();
    await db.transaction(async (tx) => {
      const current = await tx.query.uptimeMonitors.findFirst({
        where: eq(uptimeMonitors.id, monitor.id),
      });
      if (!current?.enabled) return;

      await tx
        .insert(uptimeChecks)
        .values({ monitor_id: monitor.id, checked_at: checkedAt, ...result });
      const failures = result.success ? 0 : current.consecutive_failures + 1;
      let status = current.current_status;
      let downSince = current.down_since;
      let transition: 'up' | 'down' | null = null;

      if (result.success) {
        if (current.current_status === 'down') transition = 'up';
        status = 'up';
        downSince = null;
      } else if (failures >= FAILURE_THRESHOLD && current.current_status !== 'down') {
        transition = 'down';
        status = 'down';
        downSince = checkedAt;
      }

      await tx
        .update(uptimeMonitors)
        .set({
          current_status: status,
          consecutive_failures: failures,
          last_checked_at: checkedAt,
          next_check_at: new Date(checkedAt.getTime() + current.interval_seconds * 1000),
          down_since: downSince,
          updated_at: checkedAt,
        })
        .where(eq(uptimeMonitors.id, monitor.id));

      if (transition) {
        await tx.insert(uptimeAlerts).values({
          monitor_id: monitor.id,
          status: transition,
          occurred_at: checkedAt,
        });
      }

      // Keep the check table bounded without adding a separate cleanup worker.
      const oldChecks = await tx
        .select({ count: count() })
        .from(uptimeChecks)
        .where(eq(uptimeChecks.monitor_id, monitor.id));
      if (Number(oldChecks[0]?.count ?? 0) > HISTORY_MAX_CHECKS) {
        const oldest = await tx.query.uptimeChecks.findFirst({
          where: eq(uptimeChecks.monitor_id, monitor.id),
          orderBy: (checks, { asc: orderAsc }) => [orderAsc(checks.checked_at)],
          columns: { id: true },
        });
        if (oldest) await tx.delete(uptimeChecks).where(eq(uptimeChecks.id, oldest.id));
      }
    });
  },

  async deliverPendingAlerts() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return;

    const pending = await db
      .select({ alert: uptimeAlerts, monitor: uptimeMonitors, project: projects, account: user })
      .from(uptimeAlerts)
      .innerJoin(uptimeMonitors, eq(uptimeMonitors.id, uptimeAlerts.monitor_id))
      .innerJoin(projects, eq(projects.id, uptimeMonitors.project_id))
      .innerJoin(user, eq(user.id, projects.owner_id))
      .where(
        and(
          isNull(uptimeAlerts.delivered_at),
          lte(uptimeAlerts.attempts, 5),
          eq(user.emailVerified, true),
        ),
      )
      .orderBy(asc(uptimeAlerts.occurred_at))
      .limit(20);

    for (const { alert, monitor, project, account } of pending) {
      if (alert.delivered_at) continue;
      const endpoint =
        monitor.endpoint_url || (project.domain ? `https://${project.domain}` : 'your endpoint');
      const down = alert.status === 'down';
      const subject = down ? `${project.name} is down` : `${project.name} is back up`;
      const text = down
        ? `ShipYard could not reach ${endpoint} for ${project.name}. We detected ${FAILURE_THRESHOLD} consecutive failed checks at ${alert.occurred_at.toISOString()}.`
        : `ShipYard can reach ${endpoint} again. ${project.name} recovered at ${alert.occurred_at.toISOString()}.`;

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': alert.id,
          },
          body: JSON.stringify({ from, to: account.email, subject, text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
          throw new Error(
            `Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
          );
        await db
          .update(uptimeAlerts)
          .set({ delivered_at: new Date(), attempts: alert.attempts + 1, last_error: null })
          .where(eq(uptimeAlerts.id, alert.id));
      } catch (error) {
        await db
          .update(uptimeAlerts)
          .set({
            attempts: alert.attempts + 1,
            last_error:
              error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed',
          })
          .where(eq(uptimeAlerts.id, alert.id));
        console.error(`[Uptime] Alert ${alert.id} delivery failed`, error);
      }
    }
  },

  async getSettings(projectId: string) {
    const monitor = await db.query.uptimeMonitors.findFirst({
      where: eq(uptimeMonitors.project_id, projectId),
    });
    if (!monitor) return null;
    const history = await db.query.uptimeChecks.findMany({
      where: eq(uptimeChecks.monitor_id, monitor.id),
      orderBy: (checks, { desc }) => [desc(checks.checked_at)],
      limit: 100,
    });
    return { ...monitor, history };
  },

  async updateSettings(
    projectId: string,
    data: { enabled?: boolean; endpoint_url?: string | null; interval_seconds?: number },
  ) {
    const monitor = await db.query.uptimeMonitors.findFirst({
      where: eq(uptimeMonitors.project_id, projectId),
    });
    if (!monitor) return null;
    const endpointUrl = data.endpoint_url?.trim() || null;
    if (endpointUrl && endpointUrl.length > 2_048) {
      throw new Error('Endpoint URL must be 2048 characters or fewer');
    }
    if (endpointUrl) await validatePublicEndpoint(endpointUrl);

    const enabled = data.enabled ?? monitor.enabled;
    const [updated] = await db
      .update(uptimeMonitors)
      .set({
        ...data,
        ...(data.endpoint_url !== undefined ? { endpoint_url: endpointUrl } : {}),
        current_status: 'unknown',
        consecutive_failures: 0,
        down_since: null,
        next_check_at: enabled ? new Date() : null,
        updated_at: new Date(),
      })
      .where(eq(uptimeMonitors.id, monitor.id))
      .returning();

    return updated ? this.getSettings(projectId) : null;
  },

  async shutdown() {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    this.worker = null;
    this.queue = null;
  },
};
