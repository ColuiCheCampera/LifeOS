/// <reference lib="webworker" />
import { Serwist, StaleWhileRevalidate, ExpirationPlugin, type PrecacheEntry } from 'serwist';
import { flush, observeCrossTab } from '@/features/sync/client';
import { LockedError } from '@/features/sync/vault';
declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] };
const serwist: Serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  cacheId: 'lifeos-public-v2',
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  precacheOptions: { cleanupOutdatedCaches: true },
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new StaleWhileRevalidate({
        cacheName: 'lifeos-static-v2',
        plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 30 * 86400 })],
      }),
    },
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin && request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
      handler: async ({ event, request }): Promise<Response> => {
        try {
          const preload = await (event as FetchEvent).preloadResponse;
          const response = preload ?? (await fetch(request));
          return response;
        } catch {
          const fallback = await serwist.matchPrecache('/offline.html');
          return fallback ?? new Response('Offline', { status: 503 });
        }
      },
    },
  ],
});
// Deliberately omit generic CACHE_URLS message support. Only this build's public allowlist is precached.
self.addEventListener('install', serwist.handleInstall);
self.addEventListener('activate', serwist.handleActivate);
self.addEventListener('fetch', serwist.handleFetch);
observeCrossTab();
self.addEventListener('sync', ((event: ExtendableEvent & { tag: string }) => {
  if (event.tag !== 'lifeos-sync') return;
  event.waitUntil(
    flush()
      .then(async () => {
        for (const client of await self.clients.matchAll())
          client.postMessage({ type: 'SYNC_COMPLETE' });
      })
      .catch(async (error) => {
        if (error instanceof LockedError) {
          for (const client of await self.clients.matchAll())
            client.postMessage({ type: 'AUTH_REVOKED' });
        } else throw error;
      }),
  );
}) as EventListener);
