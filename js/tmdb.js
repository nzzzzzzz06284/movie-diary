// TMDB 数据层：超时 + 重试 + 多域名回退 + 本地缓存兜底
// 目标：弱网 / 请求被掐断时不再无限挂起，也尽量用缓存把内容显示出来（不留空白页）
window.App = window.App || {};
App.tmdb = (function () {
  const HOSTS = [
    'https://api.themoviedb.org/3',
    'https://api.tmdb.org/3'      // TMDB 官方备用域名，主域名不通时自动换
  ];
  const IMG = 'https://image.tmdb.org/t/p/w780'; // 高清海报
  const TIMEOUT = 8000;   // 单次请求最长等待，超过就放弃换下一个（弱网卡死的根治点）
  const ROUNDS = 2;       // 每个域名尝试轮数
  const TTL = 60 * 60 * 1000;   // 缓存新鲜期 1 小时
  const CK = 'md_tmdb_cache_v2';
  const MAX_KEYS = 80;    // localStorage 只保留最近 80 条，避免爆容量

  let hostIdx = 0;              // 记住上次成功的域名，优先复用
  const mem = new Map();        // 内存缓存（本次会话最快）
  let disk = {};                // 持久缓存（跨次打开也能兜底）
  try { disk = JSON.parse(localStorage.getItem(CK) || '{}') || {}; } catch (e) { disk = {}; }

  let saveT = null;
  function saveDisk() {
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => {
      saveT = null;
      try {
        const ks = Object.keys(disk);
        if (ks.length > MAX_KEYS) {
          ks.sort((a, b) => (disk[a].t || 0) - (disk[b].t || 0))
            .slice(0, ks.length - MAX_KEYS).forEach(k => { delete disk[k]; });
        }
        localStorage.setItem(CK, JSON.stringify(disk));
      } catch (e) { try { localStorage.removeItem(CK); } catch (e2) {} }
    }, 500);
  }

  function cacheGet(k, allowStale) {
    const r = mem.get(k) || disk[k];
    if (!r) return null;
    if (!allowStale && (Date.now() - (r.t || 0)) > TTL) return null;
    return r.d;
  }
  function cacheSet(k, d) {
    const r = { t: Date.now(), d: d };
    mem.set(k, r); disk[k] = r; saveDisk();
  }

  // 带超时的单次请求：AbortController 保证一定会 settle，不会永远 pending
  function timedFetch(url) {
    let ac = null, to = null;
    try { ac = new AbortController(); } catch (e) { ac = null; }
    const p = fetch(url, ac ? { signal: ac.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    if (ac) to = setTimeout(() => { try { ac.abort(); } catch (e) {} }, TIMEOUT);
    // 双保险：即使 AbortController 不可用，也用 race 兜住超时
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), TIMEOUT + 500));
    return Promise.race([p, guard]).then(
      v => { if (to) clearTimeout(to); return v; },
      e => { if (to) clearTimeout(to); throw e; }
    );
  }

  // 核心：一个 TMDB 接口调用 = 缓存命中 → 多域名多轮重试 → 全失败则回退旧缓存
  function api(path, params, apiKey, opts) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    opts = opts || {};
    const p = Object.assign({}, params || {});
    const ck = path + '|' + JSON.stringify(p);

    if (!opts.fresh) {
      const hit = cacheGet(ck, false);
      if (hit) return Promise.resolve(hit);
    }

    const qs = new URLSearchParams(Object.assign({ api_key: apiKey }, p)).toString();
    const plan = [];
    for (let r = 0; r < ROUNDS; r++) {
      for (let h = 0; h < HOSTS.length; h++) plan.push((hostIdx + h) % HOSTS.length);
    }

    let i = 0;
    function attempt() {
      if (i >= plan.length) {
        const stale = cacheGet(ck, true);   // 网络全挂：先把旧数据端上来，界面不空白
        if (stale) return Promise.resolve(stale);
        return Promise.reject(new Error('NET'));
      }
      const hi = plan[i++];
      return timedFetch(HOSTS[hi] + path + '?' + qs)
        .then(d => { hostIdx = hi; cacheSet(ck, d); return d; })
        .catch(() => attempt());
    }
    return attempt();
  }

  function poster(path) { return path ? IMG + path : ''; }

  function mapMovie(m) {
    return {
      tmdbId: m.id,
      title: m.title || m.name || '',
      year: m.release_date ? m.release_date.slice(0, 4) : '',
      poster: poster(m.poster_path),
      overview: m.overview || '',
      genres: (m.genre_ids || []).map(id => String(id))
    };
  }
  function mapPage(data) {
    return {
      page: data.page || 1,
      totalPages: Math.min(data.total_pages || 1, 500), // TMDB 最多 500 页，超过会报错
      results: (data.results || []).map(mapMovie)
    };
  }

  // 搜索：返回简化列表（前 8 条）
  function search(query, apiKey) {
    return api('/search/movie', { language: 'zh-CN', include_adult: 'false', query: query }, apiKey)
      .then(data => (data.results || []).slice(0, 8).map(mapMovie));
  }

  // 详情：补全导演 / 演员 / 类型 / 角色（含头像，供台词「谁说的」选择）
  function details(tmdbId, apiKey) {
    return Promise.all([
      api('/movie/' + tmdbId, { language: 'zh-CN' }, apiKey),
      api('/movie/' + tmdbId + '/credits', { language: 'zh-CN' }, apiKey).catch(() => ({}))
    ]).then(([m, c]) => {
      const director = (c.crew || []).filter(x => x.job === 'Director').map(x => x.name).join('、');
      const cast = (c.cast || []).slice(0, 5).map(x => x.name);
      const castInfo = (c.cast || []).slice(0, 12).map(x => ({
        name: x.name,
        character: x.character || '',
        profile: x.profile_path ? 'https://image.tmdb.org/t/p/w185' + x.profile_path : ''
      }));
      return {
        title: m.title, year: m.release_date ? m.release_date.slice(0, 4) : '',
        poster: poster(m.poster_path), overview: m.overview || '',
        director, cast, castInfo,
        genres: (m.genres || []).map(g => g.name)
      };
    });
  }

  // 片库列表：热门/最新/高分（分页）
  function lists(kind, apiKey, page) {
    return api('/movie/' + kind, { language: 'zh-CN', page: page || 1 }, apiKey).then(mapPage);
  }

  // 类型列表（中文，供电影库分类栏）
  function genres(apiKey) {
    return api('/genre/movie/list', { language: 'zh-CN' }, apiKey).then(d => d.genres || []);
  }

  // 按类型发现电影
  function byGenre(genreId, apiKey, page) {
    return api('/discover/movie', { language: 'zh-CN', page: page || 1, with_genres: genreId }, apiKey).then(mapPage);
  }

  // 其他语种（非主流地区，TMDB 用 with_original_language 管道 OR）
  const OTHER_LANGS = 'sv|da|no|fi|nl|pl|cs|el|he|hu|ro|uk|bn|ms|tl|fa';

  // 统一发现接口：排序(热门/最新/高分) + 类型 + 地区(原声语言) + 年份 组合筛选
  function discover(opts, apiKey, page) {
    opts = opts || {};
    const sorts = { popular: 'popularity.desc', now_playing: 'primary_release_date.desc', top_rated: 'vote_average.desc' };
    const p = {
      language: 'zh-CN',
      page: page || 1,
      include_adult: 'false',
      sort_by: sorts[opts.kind] || 'popularity.desc'
    };
    // 「高分」若不加最低票数门槛，会全是只有 1 票的冷门片（看着像坏了）
    if (opts.kind === 'top_rated') p['vote_count.gte'] = 200;
    // 「最新」限制不晚于今天，否则前几页全是还没上映的空壳条目
    if (opts.kind === 'now_playing') p['primary_release_date.lte'] = new Date().toISOString().slice(0, 10);
    if (opts.genre) p.with_genres = opts.genre;
    if (opts.lang) p.with_original_language = (opts.lang === 'other') ? OTHER_LANGS : opts.lang;
    if (opts.year === 'old') p['primary_release_date.lte'] = '2021-12-31';
    else if (opts.year) p.primary_release_year = opts.year;
    return api('/discover/movie', p, apiKey).then(mapPage);
  }

  // 连通性自检（设置页可用）：返回 true/false，不抛错
  function ping(apiKey) {
    if (!apiKey) return Promise.resolve(false);
    return api('/configuration', {}, apiKey, { fresh: true }).then(() => true).catch(() => false);
  }

  // 清空接口缓存（设置页「修复加载问题」用）
  function clearCache() {
    mem.clear(); disk = {};
    try { localStorage.removeItem(CK); } catch (e) {}
  }

  return { search, details, poster, lists, genres, byGenre, discover, ping, clearCache };
})();
