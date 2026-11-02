// Minimal service worker so the app can be installed on phones.
// It always goes to the network: money data must never be served stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
