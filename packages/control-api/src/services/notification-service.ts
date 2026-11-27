import { config } from '@shipyard/config';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../db';
import { notificationPreferences, projects, pushSubscriptions, user } from '../db/schema';
import { SettingsService } from './settings-service';
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  describeDevice,
  resolvePreferences,
  type Channel,
  type NotificationEvent,
  type NotificationMessage,
  type NotificationPreferences,
} from './notification-events';

export {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  describeDevice,
  resolvePreferences,
  type Channel,
  type NotificationEvent,
  type NotificationMessage,
  type NotificationPreferences,
};

/**
 * Notifications about a user's projects, by Web Push (every device that turned them on,
 * including the installed app on a phone) and by email (Resend, when set up).
 *
 * Each event goes to the channels the user picked; projects can be muted. Delivery never
 * throws: a notification that can't be sent must not affect a deploy.
 */

let vapidReady: Promise<string> | null = null;

/** The VAPID public key, generating and saving the key pair the first time. */
async function ensureVapid(): Promise<string> {
  vapidReady ??= (async () => {
    let publicKey = SettingsService.get('vapid_public_key');
    let privateKey = SettingsService.get('vapid_private_key');
    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys();
      await SettingsService.set({
        vapid_public_key: keys.publicKey,
        vapid_private_key: keys.privateKey,
      });
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      console.log('[Notifications] Generated Web Push (VAPID) keys');
    }
    // The subject identifies this server to push services; the dashboard URL needs no email.
    webpush.setVapidDetails(config.publicUrl, publicKey, privateKey);
    return publicKey;
  })().catch((error) => {
    vapidReady = null;
    throw error;
  });
  return vapidReady;
}

/** Push services reject subjects that aren't https: or mailto: URLs. */
function canSendPush(): boolean {
  return config.publicUrl.startsWith('https://');
}

const MAX_FAILURES = 10;

export const NotificationService = {
  async getVapidPublicKey(): Promise<string> {
    return ensureVapid();
  },

  pushAvailable(): boolean {
    return canSendPush();
  },

  emailAvailable(): boolean {
    return Boolean(
      SettingsService.get('resend_api_key') && SettingsService.get('resend_from_email'),
    );
  },

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.user_id, userId),
    });
    return resolvePreferences(row);
  },

  async setPreferences(userId: string, input: Partial<NotificationPreferences>) {
    const current = await this.getPreferences(userId);
    const events = { ...current.events };
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const next = input.events?.[key];
      if (!next) continue;
      events[key] = {
        push: typeof next.push === 'boolean' ? next.push : events[key].push,
        email: typeof next.email === 'boolean' ? next.email : events[key].email,
      };
    }
    const muted = input.muted_projects
      ? [...new Set(input.muted_projects.filter((id) => typeof id === 'string'))].slice(0, 500)
      : current.muted_projects;
    const values = {
      user_id: userId,
      events: JSON.stringify(events),
      muted_projects: JSON.stringify(muted),
      updated_at: new Date(),
    };
    await db
      .insert(notificationPreferences)
      .values(values)
      .onConflictDoUpdate({ target: notificationPreferences.user_id, set: values });
    return { events, muted_projects: muted };
  },

  async listSubscriptions(userId: string) {
    return db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        device_label: pushSubscriptions.device_label,
        created_at: pushSubscriptions.created_at,
        last_success_at: pushSubscriptions.last_success_at,
        failure_count: pushSubscriptions.failure_count,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.user_id, userId));
  },

  /** Saves (or moves to this user) a browser's push subscription. */
  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string | null,
  ) {
    const url = new URL(subscription.endpoint);
    if (url.protocol !== 'https:') throw new Error('Push endpoint must be https');
    const values = {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      device_label: describeDevice(userAgent),
      failure_count: 0,
    };
    const [row] = await db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .returning({ id: pushSubscriptions.id, device_label: pushSubscriptions.device_label });
    return row;
  },

  async unsubscribe(userId: string, by: { id?: string; endpoint?: string }) {
    const rows = await this.listSubscriptions(userId);
    const target = rows.find(
      (r) => (by.id && r.id === by.id) || (by.endpoint && r.endpoint === by.endpoint),
    );
    if (!target) return false;
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, target.id));
    return true;
  },

  /** Sends to every device of a user. Returns how many accepted it. */
  async sendPush(
    userId: string,
    message: Omit<NotificationMessage, 'event'> & { event?: NotificationEvent },
    onlySubscriptionId?: string,
  ): Promise<{ sent: number; failed: number }> {
    if (!canSendPush()) return { sent: 0, failed: 0 };
    await ensureVapid();
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.user_id, userId));
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
      tag: message.tag,
      event: message.event,
      timestamp: Date.now(),
    });
    const urgent = message.event === 'deploy_failed' || message.event === 'uptime_down';
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subscriptions
        .filter((s) => !onlySubscriptionId || s.id === onlySubscriptionId)
        .map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
              { TTL: 24 * 60 * 60, urgency: urgent ? 'high' : 'normal', timeout: 10_000 },
            );
            sent++;
            await db
              .update(pushSubscriptions)
              .set({ last_success_at: new Date(), failure_count: 0 })
              .where(eq(pushSubscriptions.id, s.id));
          } catch (error: any) {
            failed++;
            const status = error?.statusCode as number | undefined;
            // 404/410: the browser dropped this subscription for good.
            if (status === 404 || status === 410 || s.failure_count + 1 >= MAX_FAILURES) {
              await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
              console.log(`[Notifications] Removed expired push subscription (${s.device_label})`);
            } else {
              await db
                .update(pushSubscriptions)
                .set({ failure_count: s.failure_count + 1 })
                .where(eq(pushSubscriptions.id, s.id));
              console.warn(
                `[Notifications] Push to ${s.device_label} failed (${status ?? 'network'}): ${String(error?.body ?? error?.message ?? error).slice(0, 200)}`,
              );
            }
          }
        }),
    );
    return { sent, failed };
  },

  async sendEmail(userId: string, subject: string, text: string, url?: string) {
    const apiKey = SettingsService.get('resend_api_key');
    const from = SettingsService.get('resend_from_email');
    if (!apiKey || !from) return false;
    const account = await db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!account?.email) return false;
    const escape = (v: string) =>
      v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const link = url ? `${config.publicUrl}${url}` : null;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">
<p style="font-size:16px;font-weight:600;margin:0 0 8px">${escape(subject)}</p>
<p style="margin:0 0 16px;white-space:pre-line">${escape(text)}</p>
${link ? `<p style="margin:0"><a href="${escape(link)}">Open in ShipYard</a></p>` : ''}
</div>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: account.email,
        subject: `[ShipYard] ${subject}`,
        text: link ? `${text}\n\n${link}` : text,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Resend HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return true;
  },

  /** Who hears about a project: its owner, or every user for unowned projects. */
  async recipientsFor(projectId: string): Promise<string[]> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { owner_id: true },
    });
    if (project?.owner_id) return [project.owner_id];
    return (await db.select({ id: user.id }).from(user)).map((u) => u.id);
  },

  /**
   * Sends a project event to its recipients over the channels they chose.
   * `channels` limits it (uptime emails have their own retrying queue).
   */
  async notify(message: NotificationMessage, channels: Channel[] = ['push', 'email']) {
    try {
      const recipients = message.projectId ? await this.recipientsFor(message.projectId) : [];
      for (const userId of recipients) {
        const prefs = await this.getPreferences(userId);
        if (message.projectId && prefs.muted_projects.includes(message.projectId)) continue;
        const choice = prefs.events[message.event];
        if (choice.push && channels.includes('push')) {
          await this.sendPush(userId, message).catch((error) =>
            console.warn('[Notifications] Push failed:', error),
          );
        }
        if (choice.email && channels.includes('email')) {
          await this.sendEmail(userId, message.title, message.body, message.url).catch((error) =>
            console.warn('[Notifications] Email failed:', error),
          );
        }
      }
    } catch (error) {
      console.warn(`[Notifications] Could not send "${message.event}":`, error);
    }
  },

  /** Whether a user wants email for an event about a project (used by uptime emails). */
  async wantsEmail(userId: string, event: NotificationEvent, projectId: string) {
    const prefs = await this.getPreferences(userId);
    return !prefs.muted_projects.includes(projectId) && prefs.events[event].email;
  },
};
