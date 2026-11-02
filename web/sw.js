/* Z-SHIRTS shop · shows notifications (order updates, back in stock) even when the shop is closed */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Z-SHIRTS', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Z-SHIRTS', {
    body: d.body || '', tag: d.tag, icon: 'icon.svg', badge: 'icon.svg', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c && c.url.split('?')[0] === url.split('?')[0]) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
