// TMDB 电影搜索：用 api_key 查询参数 GET，best-effort；失败即回退手动
window.App = window.App || {};
App.tmdb = (function () {
  const BASE = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/w780'; // 高清海报（比 w342 清晰）

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
        overview: m.overview || '',
        genres: (m.genre_ids || []).map(id => String(id))
      })));
  }

  // 详情：补全导演 / 演员 / 类型 / 角色（含头像，供台词「谁说的」选择）
  function details(tmdbId, apiKey) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const mk = p => `${BASE}${p}?api_key=${encodeURIComponent(apiKey)}&language=zh-CN`;
    return Promise.all([fetch(mk(`/movie/${tmdbId}`)), fetch(mk(`/movie/${tmdbId}/credits`))])
      .then(([r1, r2]) => Promise.all([r1.json(), r2.json()]))
      .then(([m, c]) => {
        const director = (c.crew || []).filter(p => p.job === 'Director').map(p => p.name).join('、');
        const cast = (c.cast || []).slice(0, 5).map(p => p.name);
        const castInfo = (c.cast || []).slice(0, 12).map(p => ({
          name: p.name,
          character: p.character || '',
          profile: p.profile_path ? 'https://image.tmdb.org/t/p/w185' + p.profile_path : ''
        }));
        return {
          title: m.title,
          year: m.release_date ? m.release_date.slice(0, 4) : '',
          poster: poster(m.poster_path),
          overview: m.overview || '',
          director, cast, castInfo,
          genres: (m.genres || []).map(g => g.name)
        };
      });
  }

  // 片库列表：热门/最新/高分（分页）
  function lists(kind, apiKey, page) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const url = `${BASE}/movie/${kind}?api_key=${encodeURIComponent(apiKey)}&language=zh-CN&page=${page || 1}`;
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => ({
        page: data.page || 1,
        totalPages: data.total_pages || 1,
        results: (data.results || []).map(m => ({
          tmdbId: m.id, title: m.title,
          year: m.release_date ? m.release_date.slice(0, 4) : '',
          poster: poster(m.poster_path), overview: m.overview || '',
          genres: (m.genre_ids || []).map(id => String(id))
        }))
      }));
  }

  // 类型列表（中文，供电影库分类栏）
  function genres(apiKey) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const url = `${BASE}/genre/movie/list?api_key=${encodeURIComponent(apiKey)}&language=zh-CN`;
    return fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => d.genres || []);
  }

  // 按类型发现电影（电影库分类点击后加载）
  function byGenre(genreId, apiKey, page) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const url = `${BASE}/discover/movie?api_key=${encodeURIComponent(apiKey)}&language=zh-CN&page=${page || 1}&with_genres=${genreId}`;
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => ({
        page: data.page || 1,
        totalPages: data.total_pages || 1,
        results: (data.results || []).map(m => ({
          tmdbId: m.id, title: m.title,
          year: m.release_date ? m.release_date.slice(0, 4) : '',
          poster: poster(m.poster_path), overview: m.overview || '',
          genres: (m.genre_ids || []).map(id => String(id))
        }))
      }));
  }

  // 其他语种（非主流地区，TMDB 用 with_original_language 管道 OR）
  const OTHER_LANGS = 'sv|da|no|fi|nl|pl|cs|el|he|hu|ro|uk|bn|ms|tl|fa';
  // 统一发现接口：排序(热门/最新/高分) + 类型 + 地区(原声语言) + 年份 组合筛选
  function discover(opts, apiKey, page) {
    if (!apiKey) return Promise.reject(new Error('NO_KEY'));
    const sorts = { popular: 'popularity.desc', now_playing: 'primary_release_date.desc', top_rated: 'vote_average.desc' };
    const qs = new URLSearchParams();
    qs.set('api_key', apiKey);
    qs.set('language', 'zh-CN');
    qs.set('page', page || 1);
    qs.set('sort_by', sorts[(opts && opts.kind)] || 'popularity.desc');
    if (opts && opts.genre) qs.set('with_genres', opts.genre);
    if (opts && opts.lang) qs.set('with_original_language', opts.lang === 'other' ? OTHER_LANGS : opts.lang);
    if (opts && opts.year === 'old') qs.set('primary_release_date.lte', '2021-12-31');
    else if (opts && opts.year) qs.set('primary_release_year', opts.year);
    return fetch(`${BASE}/discover/movie?${qs}`)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => ({
        page: data.page || 1,
        totalPages: data.total_pages || 1,
        results: (data.results || []).map(m => ({
          tmdbId: m.id, title: m.title,
          year: m.release_date ? m.release_date.slice(0, 4) : '',
          poster: poster(m.poster_path), overview: m.overview || '',
          genres: (m.genre_ids || []).map(id => String(id))
        }))
      }));
  }

  return { search, details, poster, lists, genres, byGenre, discover };
})();
