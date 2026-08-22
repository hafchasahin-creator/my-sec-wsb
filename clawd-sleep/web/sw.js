/*
 * Offline. The whole app is a handful of files and no audio assets — the beds
 * are synthesised — so it is cached whole on install and served cache-first.
 * There is nothing to fetch at night, which is the point.
 */
const CACHE = 'clawd-sleep-v1';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/main.js', './src/scene.js', './src/clawd.js', './src/audio.js',
  './src/ambience.js', './src/sleepmode.js', './src/wakelock.js',
  './src/timer.js', './src/store.js', './src/ease.js', './src/rng.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        // Cache same-origin successes so a first-run miss still ends up offline.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
