import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projects } from '../db/schema';
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  NotificationService,
} from '../services/notification-service';
import { ProjectAccessService } from '../services/project-access-service';

const channelPair = t.Object({ push: t.Optional(t.Boolean()), email: t.Optional(t.Boolean()) });

/** Push devices, which events notify, and test messages, for the signed-in user. */
export const notificationsRoutes = new Elysia({ prefix: '/notifications' })
  .derive(async ({ request }) => ({
    userId: await ProjectAccessService.userIdFromRequest(request),
  }))
  .onBeforeHandle(({ userId, set }) => {
    if (!userId) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })
  /** Everything the notifications page needs in one call. */
  .get('', async ({ userId }) => {
    const [preferences, devices, ownProjects] = await Promise.all([
      NotificationService.getPreferences(userId!),
      NotificationService.listSubscriptions(userId!),
      db
        .select({ id: projects.id, name: projects.name, domain: projects.domain })
        .from(projects)
        .where(eq(projects.owner_id, userId!)),
    ]);
    let vapidPublicKey: string | null = null;
    let pushError: string | null = null;
    if (NotificationService.pushAvailable()) {
      try {
        vapidPublicKey = await NotificationService.getVapidPublicKey();
      } catch (error) {
        pushError = error instanceof Error ? error.message : String(error);
      }
    } else {
      pushError = 'Push notifications need the dashboard on https.';
    }
    return {
      events: NOTIFICATION_EVENT_KEYS.map((key) => ({
        key,
        label: NOTIFICATION_EVENTS[key].label,
        description: NOTIFICATION_EVENTS[key].description,
      })),
      preferences,
      devices: devices.map(({ endpoint, ...device }) => ({
        ...device,
        // Lets a browser recognise its own row without exposing the whole URL.
        endpoint_hint: endpoint.slice(-24),
      })),
      projects: ownProjects,
      push: {
        available: Boolean(vapidPublicKey),
        vapid_public_key: vapidPublicKey,
        error: pushError,
      },
      email: { available: NotificationService.emailAvailable() },
    };
  })
  .put(
    '/preferences',
    async ({ userId, body }) => NotificationService.setPreferences(userId!, body as any),
    {
      body: t.Object({
        events: t.Optional(t.Record(t.String(), channelPair)),
        muted_projects: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 500 })),
      }),
    },
  )
  .post(
    '/subscriptions',
    async ({ userId, body, request, set }) => {
      try {
        return await NotificationService.subscribe(
          userId!,
          body.subscription,
          request.headers.get('user-agent'),
        );
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Invalid subscription' };
      }
    },
    {
      body: t.Object({
        subscription: t.Object({
          endpoint: t.String({ minLength: 10, maxLength: 2048 }),
          keys: t.Object({
            p256dh: t.String({ minLength: 10, maxLength: 512 }),
            auth: t.String({ minLength: 4, maxLength: 512 }),
          }),
        }),
      }),
    },
  )
  .delete(
    '/subscriptions',
    async ({ userId, body, set }) => {
      const removed = await NotificationService.unsubscribe(userId!, body);
      if (!removed) set.status = 404;
      return { removed };
    },
    {
      body: t.Object({
        id: t.Optional(t.String({ maxLength: 64 })),
        endpoint: t.Optional(t.String({ maxLength: 2048 })),
      }),
    },
  )
  /** Sends a test notification to one device, or to all of them. */
  .post(
    '/test',
    async ({ userId, body, set }) => {
      const result = await NotificationService.sendPush(
        userId!,
        {
          title: '🔔 ShipYard notifications work',
          body: 'You will get deploy and uptime alerts on this device.',
          url: '/notifications',
          tag: 'shipyard-test',
        },
        body.id,
      );
      if (result.sent === 0) set.status = 502;
      return result;
    },
    { body: t.Object({ id: t.Optional(t.String({ maxLength: 64 })) }) },
  );
