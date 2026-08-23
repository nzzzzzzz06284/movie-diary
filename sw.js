// 观影手记 Service Worker：缓存应用外壳，支持离线打开
const CACHE = 'movie-diary-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/util.js',
  './js/tmdb.js',
  './js/router.js',
  './js/views/list.js',
  './js/views/detail.js',
  './js/views/edit.js',
  './js/views/stats.js',
  './js/views/settings.js',
  './js/app.js',
  './assets/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 网络优先（TMDB 等接口不缓存），其余缓存优先
  if (req.url.includes('api.themoviedb.org') || req.url.includes('image.tmdb.org')) return;
  e.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
