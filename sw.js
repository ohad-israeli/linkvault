// Minimal service worker: no offline caching, it exists only because some
// Android/Chrome versions require a registered service worker with a fetch
// handler before a page can be "installed" (needed for the Share Target
// integration in manifest.webmanifest to register).
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function () {
  // Intentionally not calling event.respondWith — every request just
  // passes through to the network as normal.
});
