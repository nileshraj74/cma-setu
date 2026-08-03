// Minimal service worker — mainly here to satisfy PWA installability requirements
// (needed for PWABuilder to generate a proper Android APK). Caches the app shell
// so it opens instantly on repeat visits; calculation requests always go to the
// network fresh (never cached), since results depend on live input data.
const CACHE_NAME = 'cma-studio-v1';
const SHELL_FILES = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache calls to the calculation function — always fetch fresh
  if (url.hostname.endsWith('.run.app') || url.hostname.includes('cloudfunctions.net')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
