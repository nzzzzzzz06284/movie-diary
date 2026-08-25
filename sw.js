// 观影手记 Service Worker
// 策略：网络优先（每次打开都拉最新），离线时用缓存兜底。
// 这样线上一更新，手机下次打开立刻是最新版，不会卡在旧缓存。
// 👉 更新必看：每次你改完代码重新上传后，把下面这行的版本号 +1（v3→v4→v5），
//    能确保手机把新文件重新缓存进离线包（即便不改，网络优先也会拉到新版）。
const CACHE = 'movie-diary-v4';

// 预缓存：应用外壳全部文件（补全了 discover/assistant/profile/audio 等，之前漏了）
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/audio.js',
  './js/tmdb.js',
  './js/router.js',
  './js/sync.js',
  './js/views/list.js',
  './js/views/detail.js',
  './js/views/edit.js',
  './js/views/discover.js',
  './js/views/assistant.js',
  './js/views/profile.js',
  './js/views/stats.js',
  './js/views/settings.js',
  './assets/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {})) // 单个文件失败不影响整体安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  // TMDB 接口 / 图片不缓存，直接走网络（数据实时、且跨域图片浏览器自己管）
  if (url.includes('api.themoviedb.org') || url.includes('image.tmdb.org')) return;
  // 同源资源：网络优先 + 缓存兜底（离线可用，更新即时生效）
  e.respondWith(
    fetch(req, { cache: 'no-cache' }) // 每次都打线上最新，绕过 HTTP 强缓存
      .then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(c => c || Promise.reject()))
  );
});
