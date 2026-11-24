/*
 * The partner app's service worker (F6 design 2.6, B14), scope /partner, so it also controls the
 * app's start page (served with Service-Worker-Allowed: /partner). It keeps the app's
 * own files (scripts, styles, fonts, icons, the doodles) and a static offline page, so an
 * installed app opened without a connection says so instead of failing. It never keeps a page,
 * an API answer or an image link: personal data and location answers always come from the
 * network (P8.4).
 */

const VERSION = 'partner-v1';
const OFFLINE_URL = '/partner/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/partner/icons/icon-192.png',
  '/partner/icons/icon-512.png',
  '/illustrations/doodles/meditating-ink.svg',
  '/illustrations/doodles/meditating-accent.svg',
  '/illustrations/doodles/coffee-ink.svg',
  '/illustrations/doodles/coffee-accent.svg',
  '/illustrations/doodles/sprinting-ink.svg',
  '/illustrations/doodles/sprinting-accent.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// "Reload" on the new-version banner (P8.5): the waiting worker takes over.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const isAppFile = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/partner/icons/') ||
    url.pathname.startsWith('/illustrations/doodles/'));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Pages: always the network; the offline page only when there is none.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Build files are named by their content, so a kept copy is always right.
  if (isAppFile(url)) {
    event.respondWith(
      caches.match(request).then(
        (kept) =>
          kept ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
