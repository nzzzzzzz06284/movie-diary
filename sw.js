// 观影手记 Service Worker
// 策略：应用外壳「缓存优先 + 后台静默更新」。
//   打开 app 时页面文件直接从本地缓存取 → 秒开，弱网/断网也不会白屏（这是"加载不出来"的根治点）。
//   同时后台悄悄去拉新版存进缓存，下次打开就是新版；改了版本号则立刻整包换新并自动刷新。
// 👉 更新必看：每次改完代码重新上传后，把下面这行版本号 +1（v4→v5→v6），
//    手机下次打开会自动重下全部文件并刷新成新版。
const CACHE = 'movie-diary-v7';

// 预缓存：应用外壳全部文件
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
      // 逐个抓，单个文件 404/超时不会让整包安装失败（addAll 是一挂全挂）
      .then(c => Promise.all(SHELL.map(u =>
        fetch(u, { cache: 'reload' }).then(r => (r && r.ok) ? c.put(u, r) : null).catch(() => null)
      )))
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

// 不由 SW 接管的请求：TMDB 接口（含备用域名）、TMDB 图片、本机 Hermes 网关
function bypass(url) {
  return url.includes('api.themoviedb.org')
    || url.includes('api.tmdb.org')
    || url.includes('image.tmdb.org')
    || url.includes('127.0.0.1:8642')
    || url.includes('localhost:8642');
}

// 后台静默更新：拉到新版就写回缓存，失败就算了，绝不影响本次显示
function revalidate(req, cache) {
  fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
  }).catch(() => {});
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (bypass(req.url)) return;
  if (new URL(req.url).origin !== self.location.origin) return; // 其他跨域资源交给浏览器

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: false }).then(hit => {
        if (hit) {
          revalidate(req, cache);   // 命中缓存：先秒开，再后台更新
          return hit;
        }
        // 没缓存过：走网络，成功则顺手存起来
        return fetch(req).then(res => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(() =>
          // 网络也不行：导航请求退回首页外壳，至少能进 app
          (req.mode === 'navigate' ? cache.match('./index.html') : undefined) || Response.error()
        );
      })
    )
  );
});
