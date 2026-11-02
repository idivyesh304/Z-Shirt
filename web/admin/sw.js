// Team app service worker: lets the app install on phones and shows alerts even when it is closed.
// It never caches: money data must never be served stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Z-SHIRTS', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Z-SHIRTS', {
    body: d.body || '', tag: d.tag, icon: 'icon.svg', badge: 'icon.svg', vibrate: [80, 40, 80], data: { url: self.registration.scope },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(url) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
