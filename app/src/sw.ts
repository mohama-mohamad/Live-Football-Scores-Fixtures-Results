/// <reference lib="webworker" />
// Service Worker: تخزين مسبق للتطبيق (يعمل دون إنترنت) + استقبال التنبيهات
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import type { PushPayload } from '../../shared/types';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// كل صفحات التطبيق تُفتح من index.html (حتى دون إنترنت)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// بيانات المباريات: من الشبكة أولاً، وعند انقطاع الإنترنت آخر نسخة محفوظة
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/push'),
  new NetworkFirst({
    cacheName: 'api',
    networkTimeoutSeconds: 8,
    plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 7 * 86400 })],
  }),
);

// شعارات الفرق والبطولات: تُحفظ في الجهاز 30 يوماً (لا تتغير تقريباً)
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.hostname === 'media.api-sports.io',
  new CacheFirst({
    cacheName: 'logos',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 86400 })],
  }),
);

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'كورة لايف', body: '' };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data.body = event.data?.text() ?? '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: data.icon ?? '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'ar',
      dir: 'rtl',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data?.url as string) ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await c.focus();
          if ('navigate' in c) await (c as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
