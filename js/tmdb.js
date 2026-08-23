// TMDB 电影搜索：用 api_key 查询参数 GET，best-effort；失败即回退手动
window.App = window.App || {};
App.tmdb = (function () {
  const BASE = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/w342';

  function poster(path) { return path ? IMG + path : ''; }

  // 搜索：返回简化列表
  function search(query, apiKey) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const url = `${BASE}/search/movie?api_key=${encodeURIComponent(apiKey)}&language=zh-CN&include_adult=false&query=${encodeURIComponent(query)}`;
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => (data.results || []).slice(0, 8).map(m => ({
        tmdbId: m.id,
        title: m.title,
        year: m.release_date ? m.release_date.slice(0, 4) : '',
        poster: poster(m.poster_path),
        overview: m.overview || ''
      })));
  }

  // 详情：补全导演 / 演员
  function details(tmdbId, apiKey) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const mk = p => `${BASE}${p}?api_key=${encodeURIComponent(apiKey)}&language=zh-CN`;
    return Promise.all([fetch(mk(`/movie/${tmdbId}`)), fetch(mk(`/movie/${tmdbId}/credits`))])
      .then(([r1, r2]) => Promise.all([r1.json(), r2.json()]))
      .then(([m, c]) => {
        const director = (c.crew || []).filter(p => p.job === 'Director').map(p => p.name).join('、');
        const cast = (c.cast || []).slice(0, 5).map(p => p.name);
        return {
          title: m.title,
          year: m.release_date ? m.release_date.slice(0, 4) : '',
          poster: poster(m.poster_path),
          overview: m.overview || '',
          director, cast
        };
      });
  }

  return { search, details, poster };
})();
