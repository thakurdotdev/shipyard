/**
 * Notification delivery against a real Postgres, with the push service and Resend faked.
 *
 *   TEST_DATABASE_URL=postgres://... (migrated) DATABASE_URL=$TEST_DATABASE_URL \
 *     PUBLIC_URL=https://deploy.example.com bun test src/services/notifications.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

const enabled =
  Boolean(process.env.TEST_DATABASE_URL) &&
  process.env.DATABASE_URL === process.env.TEST_DATABASE_URL &&
  process.env.PUBLIC_URL === 'https://deploy.example.com';

// Defined only when enabled: the suite imports the database module, which needs it.
(enabled ? describe : describe.skip)('notifications', async () => {
  if (!enabled) return;
  const { db } = await import('../db');
  const schema = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const webpush = (await import('web-push')).default;
  const { SettingsService } = await import('./settings-service');
  const { NotificationService } = await import('./notification-service');

  let pushed: { endpoint: string; payload: any; urgency?: string }[];
  let failEndpoints: Map<string, number>;
  let emails: any[];
  const realFetch = globalThis.fetch;
  let sendSpy: ReturnType<typeof spyOn>;
  let settingsGet: ReturnType<typeof spyOn>;
  let settingsSet: ReturnType<typeof spyOn>;
  const savedSettings = new Map<string, string>();

  const userId = 'user-notify-test';
  let projectId: string;
  let mutedProjectId: string;

  beforeAll(async () => {
    settingsGet = spyOn(SettingsService, 'get').mockImplementation(
      ((key: string) =>
        savedSettings.get(key) ??
        ({ resend_api_key: 're_test', resend_from_email: 'ShipYard <alerts@example.com>' } as any)[
          key
        ]) as any,
    );
    settingsSet = spyOn(SettingsService, 'set').mockImplementation((async (updates: any) => {
      for (const [k, v] of Object.entries(updates)) savedSettings.set(k, v as string);
    }) as any);
    sendSpy = spyOn(webpush, 'sendNotification').mockImplementation((async (
      sub: any,
      payload: any,
      options: any,
    ) => {
      const status = failEndpoints.get(sub.endpoint);
      if (status) throw Object.assign(new Error('push failed'), { statusCode: status, body: 'x' });
      pushed.push({
        endpoint: sub.endpoint,
        payload: JSON.parse(payload),
        urgency: options.urgency,
      });
      return { statusCode: 201 };
    }) as any);
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      if (String(input).startsWith('https://api.resend.com')) {
        emails.push(JSON.parse(String(init?.body)));
        return new Response('{"id":"e1"}', { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    await db.delete(schema.pushSubscriptions);
    await db.delete(schema.notificationPreferences);
    await db.delete(schema.domainProvisions);
    await db.delete(schema.buildLogs);
    await db.delete(schema.deployments);
    await db.delete(schema.builds);
    await db.delete(schema.uptimeMonitors);
    await db.delete(schema.projects);
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.insert(schema.user).values({
      id: userId,
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    const [p1] = await db
      .insert(schema.projects)
      .values({
        name: 'portfolio',
        github_url: 'x',
        build_command: 'b',
        app_type: 'vite',
        owner_id: userId,
      })
      .returning();
    const [p2] = await db
      .insert(schema.projects)
      .values({
        name: 'noisy',
        github_url: 'x',
        build_command: 'b',
        app_type: 'vite',
        owner_id: userId,
      })
      .returning();
    projectId = p1.id;
    mutedProjectId = p2.id;
  });

  afterAll(() => {
    sendSpy.mockRestore();
    settingsGet.mockRestore();
    settingsSet.mockRestore();
    globalThis.fetch = realFetch;
  });

  beforeEach(() => {
    pushed = [];
    emails = [];
    failEndpoints = new Map();
  });

  const sub = (n: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
    keys: { p256dh: `p256dh-key-${n}-0123456789`, auth: `auth-${n}` },
  });

  test('generates VAPID keys once and reuses them', async () => {
    const first = await NotificationService.getVapidPublicKey();
    const second = await NotificationService.getVapidPublicKey();
    expect(first).toHaveLength(87);
    expect(second).toBe(first);
    expect(savedSettings.get('vapid_private_key')).toBeTruthy();
  });

  test('registers devices, re-registering the same browser updates it', async () => {
    const android =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
    await NotificationService.subscribe(userId, sub('phone'), android);
    await NotificationService.subscribe(userId, sub('phone'), android);
    await NotificationService.subscribe(
      userId,
      sub('laptop'),
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/133.0',
    );
    const devices = await NotificationService.listSubscriptions(userId);
    expect(devices.map((d) => d.device_label).sort()).toEqual([
      'Chrome on Android',
      'Firefox on macOS',
    ]);
    await expect(
      NotificationService.subscribe(userId, { ...sub('x'), endpoint: 'http://insecure/x' }),
    ).rejects.toThrow('https');
  });

  test('a failed deploy goes to every device (urgent) and by email', async () => {
    await NotificationService.notify({
      event: 'deploy_failed',
      projectId,
      title: '❌ portfolio build failed',
      body: 'abc1234 · Fix header',
      url: `/projects/${projectId}?tab=deployments`,
      tag: 'build-1',
    });
    expect(pushed).toHaveLength(2);
    expect(pushed[0].payload).toMatchObject({ title: '❌ portfolio build failed', tag: 'build-1' });
    expect(pushed[0].urgency).toBe('high');
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('owner@example.com');
    expect(emails[0].text).toContain(`https://deploy.example.com/projects/${projectId}`);
  });

  test('respects per-event channels and muted projects', async () => {
    await NotificationService.setPreferences(userId, {
      events: { deploy_succeeded: { push: false }, deploy_failed: { email: false } } as any,
      muted_projects: [mutedProjectId],
    });
    const prefs = await NotificationService.getPreferences(userId);
    expect(prefs.events.deploy_succeeded).toEqual({ push: false, email: false });
    expect(prefs.events.deploy_failed).toEqual({ push: true, email: false });

    await NotificationService.notify({
      event: 'deploy_succeeded',
      projectId,
      title: 't',
      body: 'b',
      url: '/',
    });
    expect(pushed).toHaveLength(0);
    await NotificationService.notify({
      event: 'deploy_failed',
      projectId: mutedProjectId,
      title: 't',
      body: 'b',
      url: '/',
    });
    expect(pushed).toHaveLength(0);
    await NotificationService.notify({
      event: 'deploy_failed',
      projectId,
      title: 't',
      body: 'b',
      url: '/',
    });
    expect(pushed).toHaveLength(2);
    expect(emails).toHaveLength(0);
    expect(await NotificationService.wantsEmail(userId, 'uptime_down', mutedProjectId)).toBe(false);
    expect(await NotificationService.wantsEmail(userId, 'uptime_down', projectId)).toBe(true);
  });

  test('drops a device the push service says is gone, keeps one with a temporary error', async () => {
    failEndpoints.set(sub('laptop').endpoint, 410);
    failEndpoints.set(sub('phone').endpoint, 503);
    const result = await NotificationService.sendPush(userId, { title: 't', body: 'b', url: '/' });
    expect(result).toEqual({ sent: 0, failed: 2 });
    const devices = await NotificationService.listSubscriptions(userId);
    expect(devices.map((d) => d.device_label)).toEqual(['Chrome on Android']);
    expect(devices[0].failure_count).toBe(1);

    failEndpoints.clear();
    await NotificationService.sendPush(userId, { title: 't', body: 'b', url: '/' });
    const [phone] = await NotificationService.listSubscriptions(userId);
    expect(phone.failure_count).toBe(0);
    expect(phone.last_success_at).toBeTruthy();
  });

  test('a device can be removed by its owner only', async () => {
    const [phone] = await NotificationService.listSubscriptions(userId);
    expect(await NotificationService.unsubscribe('someone-else', { id: phone.id })).toBe(false);
    expect(await NotificationService.unsubscribe(userId, { id: phone.id })).toBe(true);
    expect(await NotificationService.listSubscriptions(userId)).toEqual([]);
  });
});
