// YTVOD · service worker: sin copias guardadas. Pide siempre a GitHub si hay cambios
// (si no los hay, el servidor contesta «sin cambios» y es instantáneo), así cada versión nueva llega al momento.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => fetch(r)));
});
