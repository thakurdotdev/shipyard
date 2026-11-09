import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { and, asc, avg, count, eq, gte, isNull, lte, sql } from 'drizzle-orm';
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
import { EventStreamService } from './event-stream-service';
import { GateService } from './gate-service';

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

async function performCheck(
  endpoint: string,
  timeoutSeconds: number,
  extraHeaders: Record<string, string> = {},
) {
  const startedAt = Date.now();
  try {
    const url = await validatePublicEndpoint(endpoint);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      headers: { 'User-Agent': 'ShipYard-Uptime/1.0', ...extraHeaders },
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

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ${minutes % 60}m`;
}

function buildAlertEmailHtml(params: {
  projectName: string;
  endpoint: string;
  isDown: boolean;
  occurredAt: string;
  consecutiveFails: number;
  downDuration: string | null;
  dashboardLink: string;
}): string {
  const {
    projectName,
    endpoint,
    isDown,
    occurredAt,
    consecutiveFails,
    downDuration,
    dashboardLink,
  } = params;

  const statusColor = isDown ? '#DC2626' : '#16A34A';
  const statusDot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor};margin-right:8px;vertical-align:middle"></span>`;
  const heading = isDown ? `${projectName} is down` : `${projectName} is back up`;
  const description = isDown
    ? `Your endpoint is not responding. We detected consecutive failed health checks.`
    : `Your endpoint is responding normally again.${downDuration ? ` Total downtime: ${downDuration}.` : ''}`;

  const rows: [string, string][] = [
    ['Project', projectName],
    ['Endpoint', endpoint],
    [isDown ? 'Detected at' : 'Recovered at', occurredAt],
  ];
  if (isDown) rows.push(['Failed checks', String(consecutiveFails)]);
  if (!isDown && downDuration) rows.push(['Downtime', downDuration]);

  const rowsHtml = rows
    .map(
      ([label, value], i) =>
        `<tr>
          <td style="padding:8px 0;color:#6B7280;font-size:14px;vertical-align:top${i < rows.length - 1 ? ';border-bottom:1px solid #E5E7EB' : ''}">${label}</td>
          <td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;vertical-align:top${i < rows.length - 1 ? ';border-bottom:1px solid #E5E7EB' : ''}">${label === 'Endpoint' ? `<a href="${value}" style="color:#2563EB;text-decoration:none">${value}</a>` : value}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">

        <tr><td style="padding-bottom:24px">
          <span style="font-size:16px;font-weight:600;color:#111827">ShipYard</span>
        </td></tr>

        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px">
            <tr><td style="padding:32px">

              <p style="margin:0 0 4px 0;font-size:20px;font-weight:600;color:#111827;line-height:1.3">
                ${statusDot}${heading}
              </p>
              <p style="margin:0 0 24px 0;font-size:14px;color:#6B7280;line-height:1.5">
                ${description}
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rowsHtml}
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px">
                <tr><td>
                  <a href="${dashboardLink}"
                    style="display:inline-block;background:#111827;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;padding:10px 20px;border-radius:6px">
                    View in Dashboard
                  </a>
                </td></tr>
              </table>

            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding-top:20px;text-align:center">
          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5">
            Sent by ShipYard uptime monitoring for ${projectName}.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

    // A password-protected project would otherwise answer every check with its login page.
    const gateHeaders = await GateService.monitorHeaders(project.id, endpoint);
    const result = await performCheck(endpoint, monitor.timeout_seconds, gateHeaders);
    const checkedAt = new Date();
    let finalStatus: string | null = null;
    let finalTransition: 'up' | 'down' | null = null;

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

      // Server errors (5xx) are critical — alert immediately without waiting
      // for FAILURE_THRESHOLD consecutive failures.
      const isServerError = result.status_code !== null && result.status_code >= 500;

      if (result.success) {
        if (current.current_status === 'down') transition = 'up';
        status = 'up';
        downSince = null;
      } else if (
        (isServerError || failures >= FAILURE_THRESHOLD) &&
        current.current_status !== 'down'
      ) {
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

      finalStatus = status;
      finalTransition = transition;

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

    if (finalStatus) {
      EventStreamService.broadcastUptimeStatus(monitor.project_id, {
        status: finalStatus,
        transition: finalTransition,
      });
    }
  },

  async deliverPendingAlerts() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      console.warn(
        '[Uptime] RESEND_API_KEY or RESEND_FROM_EMAIL not configured — skipping alert delivery',
      );
      return;
    }

    const pending = await db
      .select({ alert: uptimeAlerts, monitor: uptimeMonitors, project: projects, account: user })
      .from(uptimeAlerts)
      .innerJoin(uptimeMonitors, eq(uptimeMonitors.id, uptimeAlerts.monitor_id))
      .innerJoin(projects, eq(projects.id, uptimeMonitors.project_id))
      .innerJoin(user, eq(user.id, projects.owner_id))
      .where(and(isNull(uptimeAlerts.delivered_at), lte(uptimeAlerts.attempts, 5)))
      .orderBy(asc(uptimeAlerts.occurred_at))
      .limit(20);

    const dashboardUrl = process.env.CLIENT_URL || 'https://deploy.thakur.dev';

    for (const { alert, monitor, project, account } of pending) {
      if (alert.delivered_at) continue;
      const endpoint =
        monitor.endpoint_url || (project.domain ? `https://${project.domain}` : 'your endpoint');
      const down = alert.status === 'down';
      const subject = down ? `${project.name} is down` : `${project.name} is back up`;
      const occurredAtLocal = alert.occurred_at.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'long',
      });
      const downDuration =
        down && monitor.down_since
          ? formatDuration(alert.occurred_at.getTime() - monitor.down_since.getTime())
          : null;
      const consecutiveFails = monitor.consecutive_failures;

      // Plain text fallback
      const text = down
        ? `[ShipYard Uptime Alert]\n\n${project.name} is DOWN.\n\nEndpoint: ${endpoint}\nDetected at: ${occurredAtLocal}\nConsecutive failures: ${consecutiveFails}\n\nView details: ${dashboardUrl}/projects/${project.id}?tab=uptime`
        : `[ShipYard Uptime Alert]\n\n${project.name} has RECOVERED.\n\nEndpoint: ${endpoint}\nRecovered at: ${occurredAtLocal}${downDuration ? `\nTotal downtime: ${downDuration}` : ''}\n\nView details: ${dashboardUrl}/projects/${project.id}?tab=uptime`;

      const html = buildAlertEmailHtml({
        projectName: project.name,
        endpoint,
        isDown: down,
        occurredAt: occurredAtLocal,
        consecutiveFails,
        downDuration,
        dashboardLink: `${dashboardUrl}/projects/${project.id}?tab=uptime`,
      });

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': alert.id,
          },
          body: JSON.stringify({ from, to: account.email, subject, html, text }),
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
        console.log(`[Uptime] Alert ${alert.id} delivered to ${account.email}`);
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

  async getSettings(projectId: string, limit: number = 20) {
    const monitor = await db.query.uptimeMonitors.findFirst({
      where: eq(uptimeMonitors.project_id, projectId),
    });
    if (!monitor) return null;

    const history = await db.query.uptimeChecks.findMany({
      where: eq(uptimeChecks.monitor_id, monitor.id),
      orderBy: (checks, { desc }) => [desc(checks.checked_at)],
      limit,
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const summaryRows = await db
      .select({
        total_checks: count(),
        successful_checks: count(sql`case when ${uptimeChecks.success} then 1 else null end`),
        avg_latency_ms: avg(uptimeChecks.latency_ms),
      })
      .from(uptimeChecks)
      .where(
        and(eq(uptimeChecks.monitor_id, monitor.id), gte(uptimeChecks.checked_at, thirtyDaysAgo)),
      );

    const totalChecks = Number(summaryRows[0]?.total_checks ?? 0);
    const successfulChecks = Number(summaryRows[0]?.successful_checks ?? 0);
    const rawAvgLatency = summaryRows[0]?.avg_latency_ms;
    const avgLatencyMs =
      rawAvgLatency !== null && rawAvgLatency !== undefined
        ? Math.round(Number(rawAvgLatency))
        : null;
    const uptimePercentage =
      totalChecks > 0 ? Math.round((successfulChecks / totalChecks) * 1000) / 10 : null;

    const summary = {
      uptime_percentage: uptimePercentage,
      avg_latency_ms: avgLatencyMs,
      total_checks: totalChecks,
      successful_checks: successfulChecks,
      window_days: 30,
    };

    return { ...monitor, history, summary };
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
