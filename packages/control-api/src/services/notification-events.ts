/** Notification events, their defaults and other helpers that need no database. */

export const NOTIFICATION_EVENTS = {
  deploy_succeeded: {
    label: 'Deployment live',
    description: 'A build finished and is now serving traffic.',
    defaults: { push: true, email: false },
  },
  deploy_failed: {
    label: 'Build or deployment failed',
    description: 'A build failed, or a finished build could not go live.',
    defaults: { push: true, email: true },
  },
  deploy_started: {
    label: 'Build started',
    description: 'A push or redeploy started building.',
    defaults: { push: false, email: false },
  },
  uptime_down: {
    label: 'Site down',
    description: 'Uptime monitoring found a project unreachable.',
    defaults: { push: true, email: true },
  },
  uptime_recovered: {
    label: 'Site recovered',
    description: 'A project that was down answers again.',
    defaults: { push: true, email: true },
  },
  domain_changed: {
    label: 'Domain change finished',
    description: 'Moving a project to another domain succeeded or failed.',
    defaults: { push: true, email: false },
  },
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export type Channel = 'push' | 'email';
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

export interface NotificationPreferences {
  events: Record<NotificationEvent, { push: boolean; email: boolean }>;
  muted_projects: string[];
}

export interface NotificationMessage {
  event: NotificationEvent;
  title: string;
  body: string;
  /** Dashboard path opened when the notification is tapped. */
  url: string;
  projectId?: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Stored preferences merged over the defaults; unknown keys are dropped. */
export function resolvePreferences(
  row?: {
    events: string;
    muted_projects: string;
  } | null,
): NotificationPreferences {
  const stored = parseJson<Record<string, { push?: unknown; email?: unknown }>>(row?.events, {});
  const events = {} as NotificationPreferences['events'];
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const defaults = NOTIFICATION_EVENTS[key].defaults;
    const saved = stored[key] ?? {};
    events[key] = {
      push: typeof saved.push === 'boolean' ? saved.push : defaults.push,
      email: typeof saved.email === 'boolean' ? saved.email : defaults.email,
    };
  }
  const muted = parseJson<unknown>(row?.muted_projects, []);
  return {
    events,
    muted_projects: Array.isArray(muted) ? muted.filter((m) => typeof m === 'string') : [],
  };
}

/** A short device name from a User-Agent, e.g. "Chrome on Android". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? /iPad/.test(ua)
      ? 'iPad'
      : 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown device';
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  return `${browser} on ${os}`;
}
