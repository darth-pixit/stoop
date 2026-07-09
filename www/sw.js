// Minimal offline-first shell cache so Stoop installs as a PWA.
const CACHE = 'stoop-v3';
const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'js/app.js', 'js/store.js', 'js/strain.js', 'js/sensors.js', 'js/figure.js',
  'js/charts.js', 'js/ui.js', 'js/monitor.js', 'js/stats.js', 'js/exercises.js',
  'js/flex.js', 'js/pose.js', 'js/onboarding.js', 'js/calibrate.js',
  // auth + cloud sync layer
  'js/config.js', 'js/auth.js', 'js/sync.js', 'js/login.js', 'js/vendor/supabase.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit
      || fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })),
  );
});
