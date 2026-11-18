/*
 * ShipYard service worker: makes the dashboard installable, opens fast and shows an
 * offline page without a connection, and receives push notifications.
 *
 * Never cached: /api (live data), sign-in, and any redirect or error (e.g. a Cloudflare
 * Access login), so a sign-in wall can never be served from the cache.
 */
const VERSION = 'v2';
const STATIC_CACHE = `shipyard-static-${VERSION}`;
const PAGE_CACHE = `shipyard-pages-${VERSION}`;
const OFFLINE_URL = '/offline.html';
/** Which open windows are the installed app (kept across service worker restarts). */
const META_CACHE = 'shipyard-meta';
const MODES_KEY = '/__shipyard/client-modes';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/badge-96.png',
  '/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (
          key.startsWith('shipyard-') &&
          key !== STATIC_CACHE &&
          key !== PAGE_CACHE &&
          key !== META_CACHE
        ) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

async function readModes() {
  try {
    const cached = await (await caches.open(META_CACHE)).match(MODES_KEY);
    if (cached) return await cached.json();
  } catch {}
  return { installed: false, clients: {} };
}

async function writeModes(modes) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    MODES_KEY,
    new Response(JSON.stringify(modes), { headers: { 'Content-Type': 'application/json' } }),
  );
}

/** A window says whether it runs as the installed app (display-mode standalone). */
async function rememberClientMode(clientId, standalone) {
  const modes = await readModes();
  const open = new Set(
    (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((c) => c.id),
  );
  for (const id of Object.keys(modes.clients)) if (!open.has(id)) delete modes.clients[id];
  modes.clients[clientId] = standalone;
  if (standalone) modes.installed = true;
  await writeModes(modes);
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CLIENT_MODE' && event.source && event.source.id) {
    event.waitUntil(rememberClientMode(event.source.id, Boolean(event.data.standalone)));
  }
});

function cacheable(response) {
  return response && response.ok && response.type === 'basic' && !response.redirected;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;

  // Pages: always try the network; fall back to the last copy, then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (cacheable(response)) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        } catch {
          return (
            (await caches.match(request, { cacheName: PAGE_CACHE })) ||
            (await caches.match(OFFLINE_URL)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Build output is content-hashed: cache it for good.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (cacheable(response)) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })(),
    );
    return;
  }

  // Icons and other public files: answer from the cache, refresh in the background.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/logo.png') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then((response) => {
            if (cacheable(response)) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});

// ── Push notifications ──────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ShipYard', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ShipYard';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    // A newer state of the same build replaces the old one but still alerts.
    renotify: Boolean(data.tag),
    timestamp: data.timestamp || Date.now(),
    requireInteraction: data.event === 'uptime_down',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Opens a notification's page in the installed app when there is one:
 *  1. an open app window: focus it and go to the page;
 *  2. the app is installed but not open: open a new window, which the system hands to
 *     the app (Android opens in-scope links in the installed app);
 *  3. no app: reuse an open ShipYard browser tab, else open one.
 * A browser tab is never preferred over the app.
 */
async function openFromNotification(target) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ours = windows.filter((c) => new URL(c.url).origin === self.location.origin);
  const modes = await readModes();
  const reuse = async (client) => {
    try {
      await client.focus();
      const navigated = await client.navigate(target);
      if (navigated) return navigated;
    } catch {}
    return self.clients.openWindow(target);
  };
  const app = ours.find((c) => modes.clients[c.id] === true);
  if (app) return reuse(app);
  if (!modes.installed && ours.length) return reuse(ours[0]);
  return self.clients.openWindow(target);
}
self.__openFromNotification = openFromNotification;

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(openFromNotification(target));
});

// The browser rotated the subscription: tell the app to register the new one next open.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
    })(),
  );
});
