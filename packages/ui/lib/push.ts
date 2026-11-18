'use client';

import { API_URL } from '@/lib/api-url';

/** Browser-side helpers for installing the app and Web Push. */

export type PushSupport =
  | 'supported'
  /** iPhone/iPad Safari: push works only once the app is added to the Home Screen. */
  | 'needs-install'
  | 'unsupported';

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'needs-install';
  return hasApis ? 'supported' : 'unsupported';
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const res = await fetch(`${API_URL}/notifications/subscriptions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys } }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not save this device');
  }
}

/**
 * Asks for permission (must run from a tap or click) and registers this device.
 * Reuses the existing subscription when it was made with the same server key.
 */
export async function enablePush(vapidPublicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the browser or system settings.'
        : 'Notification permission was not granted.',
    );
  }
  const registration =
    (await getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await navigator.serviceWorker.ready;
  const key = base64UrlToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  const sameKey =
    subscription?.options.applicationServerKey &&
    new Uint8Array(subscription.options.applicationServerKey).every((b, i) => b === key[i]);
  if (subscription && !sameKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await saveSubscription(subscription);
  return subscription;
}

/** Stops push on this device and forgets it on the server. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch(`${API_URL}/notifications/subscriptions`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe();
}

/** Re-sends this device's subscription (after the browser rotated it). */
export async function refreshPushSubscription(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const subscription = await currentSubscription();
  if (subscription) await saveSubscription(subscription).catch(() => {});
}
