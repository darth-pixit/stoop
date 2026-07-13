// Minimal offline-first shell cache so Stoop installs as a PWA.
// App code (HTML/JS) is served network-first / stale-while-revalidate below, so
// a deploy reaches installed clients even without a version bump. Bump CACHE
// when the precache list or non-code assets change.
const CACHE = 'stoop-v6';
const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'js/app.js', 'js/store.js', 'js/strain.js', 'js/sensors.js', 'js/context.js', 'js/figure.js',
  'js/charts.js', 'js/ui.js', 'js/monitor.js', 'js/stats.js', 'js/exercises.js',
  'js/flex.js', 'js/pose.js', 'js/onboarding.js', 'js/calibrate.js', 'js/notify.js',
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

const cachePut = (req, res) => {
  if (res.ok && new URL(req.url).origin === location.origin) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Navigations: NETWORK-FIRST so the app shell is always current (cache-first
  // previously pinned installed clients to old HTML forever); fall back to the
  // cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => cachePut(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  // Everything else (JS modules, css, icons, manifest): STALE-WHILE-REVALIDATE
  // — serve the cache instantly for a fast start, but always refetch in the
  // background so a deploy lands on the next load instead of never.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => cachePut(req, res)).catch(() => hit);
      return hit || net;
    }),
  );
});

// Focus (or open) the app when a stoop nudge notification is tapped.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow ? self.clients.openWindow('.') : undefined;
    }),
  );
});
