'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { isStandalone, refreshPushSubscription } from '@/lib/push';
import { usePwaStore, type InstallPromptEvent } from '@/lib/pwa-store';

/**
 * Registers the service worker, offers updates when a new dashboard version is deployed,
 * keeps the install prompt for the Install button, and re-registers a rotated push
 * subscription. Development builds skip the service worker so hot reload stays honest.
 */
export function PwaProvider() {
  const setInstallPrompt = usePwaStore((s) => s.setInstallPrompt);
  const setInstalled = usePwaStore((s) => s.setInstalled);

  // The manifest must be fetched with cookies: behind an access proxy (Cloudflare Access)
  // a cookieless request gets the login page and the app can't be installed. Next renders
  // the link without `crossorigin`; set it in place (React keeps owning the node) and
  // change the URL so the browser fetches the manifest again, this time with cookies.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link || link.crossOrigin === 'use-credentials') return;
    link.crossOrigin = 'use-credentials';
    link.setAttribute('href', '/manifest.json?credentials=1');
  }, []);

  useEffect(() => {
    setInstalled(isStandalone());
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      toast.success('ShipYard installed');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [setInstallPrompt, setInstalled]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let reloading = false;

    const offerUpdate = (worker: ServiceWorker) => {
      toast('A new version of ShipYard is ready', {
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
        },
      });
    };

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') void refreshPushSubscription();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // An update found earlier and still waiting.
        if (registration.waiting && navigator.serviceWorker.controller) {
          offerUpdate(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              offerUpdate(installing);
            }
          });
        });
        // Installed apps can stay open for days: look for updates when they come back.
        const check = () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', check);
      })
      .catch((error) => console.warn('[PWA] Service worker registration failed', error));

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.addEventListener('message', onMessage);
    void refreshPushSubscription();
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}
