/* Petty Cash service worker: keeps the app shell on the device so the app opens instantly, even offline.
   It only ever answers requests for the app's own files. Everything else (above all the sheet endpoint on
   script.google.com) goes straight to the network and is never stored. Changed files appear the next time the app opens. */
const CACHE = 'pc-v1';
const SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'api.js', 'app.js', 'manifest.webmanifest',
  'fonts/bricolage-grotesque.woff2', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('pc-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) { return; }      // not ours: leave it to the network
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req, { cache: 'no-cache' }).then((res) => {      // always ask the server (a cheap 'unchanged' answer), so updates are not held back by the browser's own 10-minute copy
          if (res && res.ok) { cache.put(req, res.clone()); }
          return res;
        });
        if (hit) { fresh.catch(() => {}); return hit; }                               // stale now, refreshed in the background
        return fresh.catch(() => (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
      })
    )
  );
});
