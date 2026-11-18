'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BellOff,
  BellRing,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  MonitorSmartphone,
  Send,
  Share,
  SquarePlus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  pushSupport,
  type PushSupport,
} from '@/lib/push';
import { usePwaStore } from '@/lib/pwa-store';
import type { NotificationEventKey, NotificationSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="surface-card rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-3 sm:mt-5">{children}</div>
    </section>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === 'warn'
          ? 'flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-700 dark:text-amber-400'
          : 'flex gap-2.5 rounded-lg border border-border bg-surface-muted p-3 text-sm leading-6'
      }
    >
      {children}
    </div>
  );
}

function formatWhen(value: string | null) {
  if (!value) return 'never';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [support, setSupport] = useState<PushSupport>('unsupported');
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const installPrompt = usePwaStore((s) => s.installPrompt);
  const installed = usePwaStore((s) => s.installed);
  const setInstallPrompt = usePwaStore((s) => s.setInstallPrompt);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getNotificationSettings());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    const subscription = await currentSubscription().catch(() => null);
    setThisEndpoint(subscription?.endpoint ?? null);
  }, []);

  useEffect(() => {
    setSupport(pushSupport());
    setPermission(typeof Notification === 'undefined' ? 'unknown' : Notification.permission);
    setStandalone(isStandalone());
    setIos(isIos());
    void load();
  }, [load]);

  const thisDevice =
    thisEndpoint && data
      ? data.devices.find((d) => thisEndpoint.endsWith(d.endpoint_hint))
      : undefined;

  const turnOn = async () => {
    if (!data?.push.vapid_public_key) return;
    setBusy('enable');
    try {
      await enablePush(data.push.vapid_public_key);
      setPermission(Notification.permission);
      await load();
      toast.success('Notifications are on for this device');
    } catch (e) {
      setPermission(typeof Notification === 'undefined' ? 'unknown' : Notification.permission);
      toast.error(e instanceof Error ? e.message : 'Could not turn on notifications');
    } finally {
      setBusy(null);
    }
  };

  const turnOff = async () => {
    setBusy('disable');
    try {
      await disablePush();
      await load();
      toast.success('Notifications are off for this device');
    } finally {
      setBusy(null);
    }
  };

  const test = async (id?: string) => {
    setBusy(`test-${id ?? 'all'}`);
    try {
      const result = await api.sendTestNotification(id);
      toast.success(
        result.sent === 1 ? 'Test sent' : `Test sent to ${result.sent} devices`,
        result.failed ? { description: `${result.failed} device(s) did not accept it` } : undefined,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  const removeDevice = async (id: string) => {
    setBusy(`remove-${id}`);
    try {
      if (thisDevice?.id === id) await disablePush();
      else await api.removeNotificationDevice(id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the device');
    } finally {
      setBusy(null);
    }
  };

  const setChannel = async (
    event: NotificationEventKey,
    channel: 'push' | 'email',
    value: boolean,
  ) => {
    if (!data) return;
    const previous = data.preferences;
    const next = {
      ...previous,
      events: { ...previous.events, [event]: { ...previous.events[event], [channel]: value } },
    };
    setData({ ...data, preferences: next });
    try {
      await api.updateNotificationPreferences({ events: { [event]: { [channel]: value } } as any });
    } catch (e) {
      setData((d) => (d ? { ...d, preferences: previous } : d));
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const setProjectMuted = async (projectId: string, muted: boolean) => {
    if (!data) return;
    const previous = data.preferences;
    const muted_projects = muted
      ? [...previous.muted_projects, projectId]
      : previous.muted_projects.filter((id) => id !== projectId);
    setData({ ...data, preferences: { ...previous, muted_projects } });
    try {
      await api.updateNotificationPreferences({ muted_projects });
    } catch (e) {
      setData((d) => (d ? { ...d, preferences: previous } : d));
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  if (loadError) {
    return (
      <div className="page-width py-10">
        <Notice tone="warn">
          <TriangleAlert className="mt-1 size-4 shrink-0" />
          {loadError}
        </Notice>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const appInstalled = installed || standalone;

  return (
    <div className="page-width">
      <div className="mx-auto max-w-3xl space-y-5 py-6 sm:space-y-6 sm:py-10">
        <div>
          <h1 className="page-heading">Notifications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Get deploy, failure and uptime alerts on your phone and computers.
          </p>
        </div>

        {/* ── This device ── */}
        <Section
          title="This device"
          description="Push notifications arrive even when ShipYard isn't open."
        >
          {!data.push.available ? (
            <Notice tone="warn">
              <TriangleAlert className="mt-1 size-4 shrink-0" />
              {data.push.error ?? 'Push notifications are not available on this server.'}
            </Notice>
          ) : support === 'needs-install' ? (
            <Notice tone="info">
              <SquarePlus className="mt-1 size-4 shrink-0" />
              <span>
                On iPhone and iPad, notifications work in the installed app. Tap{' '}
                <Share className="inline size-3.5 align-[-2px]" aria-label="Share" /> Share, then{' '}
                <strong>Add to Home Screen</strong>, open ShipYard from the Home Screen and turn
                them on here.
              </span>
            </Notice>
          ) : support === 'unsupported' ? (
            <Notice tone="warn">
              <TriangleAlert className="mt-1 size-4 shrink-0" />
              This browser can't receive push notifications.
            </Notice>
          ) : permission === 'denied' ? (
            <Notice tone="warn">
              <BellOff className="mt-1 size-4 shrink-0" />
              <span>
                Notifications are blocked for ShipYard. Allow them in{' '}
                {ios
                  ? 'Settings → Notifications → ShipYard'
                  : 'the site settings (the icon next to the address)'}
                , then reload.
              </span>
            </Notice>
          ) : thisDevice ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                On for <span className="font-medium">{thisDevice.device_label}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => test(thisDevice.id)}
                  disabled={busy !== null}
                  className="flex-1 gap-1.5 sm:flex-none"
                >
                  {busy === `test-${thisDevice.id}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send test
                </Button>
                <Button
                  variant="ghost"
                  onClick={turnOff}
                  disabled={busy !== null}
                  className="flex-1 gap-1.5 sm:flex-none"
                >
                  <BellOff className="size-4" />
                  Turn off
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={turnOn}
              disabled={busy !== null}
              className="h-11 w-full gap-2 sm:h-9 sm:w-auto"
            >
              {busy === 'enable' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Turn on notifications
            </Button>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <MonitorSmartphone className="size-4" />
                App
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {appInstalled
                  ? 'Running as an installed app.'
                  : installPrompt
                    ? 'Install ShipYard for a full-screen app with its own icon.'
                    : ios
                      ? 'Share → Add to Home Screen installs ShipYard as an app.'
                      : 'Use your browser’s “Install app” or “Add to Home screen” menu item.'}
              </p>
            </div>
            {!appInstalled && installPrompt && (
              <Button variant="outline" onClick={install} className="gap-1.5">
                <Download className="size-4" />
                Install app
              </Button>
            )}
          </div>
        </Section>

        {/* ── Events ── */}
        <Section
          title="What notifies you"
          description="Choose how each event reaches you. Push goes to every device below."
        >
          {!data.email.available && (
            <Notice tone="info">
              <Mail className="mt-1 size-4 shrink-0" />
              <span>
                Email needs Resend: add the API key and sender in{' '}
                <Link href="/settings" className="font-medium underline underline-offset-2">
                  Settings
                </Link>
                .
              </span>
            </Notice>
          )}
          <div className="divide-y divide-border rounded-lg border border-border">
            <div className="hidden grid-cols-[1fr_4.5rem_4.5rem] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>Event</span>
              <span className="text-center">Push</span>
              <span className="text-center">Email</span>
            </div>
            {data.events.map((event) => {
              const choice = data.preferences.events[event.key];
              return (
                <div
                  key={event.key}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-[1fr_4.5rem_4.5rem] sm:px-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{event.label}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{event.description}</p>
                  </div>
                  <label className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground sm:justify-self-center">
                    <Switch
                      checked={choice.push}
                      onCheckedChange={(v) => setChannel(event.key, 'push', v)}
                      aria-label={`Push for ${event.label}`}
                    />
                    <span className="sm:hidden">Push</span>
                  </label>
                  <label className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground sm:justify-self-center">
                    <Switch
                      checked={choice.email}
                      disabled={!data.email.available}
                      onCheckedChange={(v) => setChannel(event.key, 'email', v)}
                      aria-label={`Email for ${event.label}`}
                    />
                    <span className="sm:hidden">Email</span>
                  </label>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Projects ── */}
        {data.projects.length > 0 && (
          <Section title="Projects" description="Muted projects never notify, on any channel.">
            <div className="divide-y divide-border rounded-lg border border-border">
              {data.projects.map((project) => {
                const muted = data.preferences.muted_projects.includes(project.id);
                return (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 sm:px-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{project.name}</span>
                      {project.domain && (
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {project.domain}
                        </span>
                      )}
                    </span>
                    <Switch
                      checked={!muted}
                      onCheckedChange={(on) => setProjectMuted(project.id, !on)}
                      aria-label={`Notifications for ${project.name}`}
                    />
                  </label>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Devices ── */}
        <Section
          title="Devices"
          description="Every browser and installed app that receives push notifications."
          action={
            data.devices.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => test()}
                disabled={busy !== null}
                className="gap-1.5"
              >
                {busy === 'test-all' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Test all
              </Button>
            ) : undefined
          }
        >
          {data.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices yet. Turn notifications on above, on each phone or computer you use.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{device.device_label ?? 'Browser'}</span>
                      {device.id === thisDevice?.id && (
                        <span className="rounded-full border border-border px-1.5 text-[11px] font-normal text-muted-foreground">
                          this device
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {formatWhen(device.created_at)} · last delivered{' '}
                      {formatWhen(device.last_success_at)}
                      {device.failure_count > 0 && ` · ${device.failure_count} failed`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => test(device.id)}
                      disabled={busy !== null}
                      aria-label={`Send a test to ${device.device_label}`}
                    >
                      {busy === `test-${device.id}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDevice(device.id)}
                      disabled={busy !== null}
                      aria-label={`Remove ${device.device_label}`}
                    >
                      {busy === `remove-${device.id}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
