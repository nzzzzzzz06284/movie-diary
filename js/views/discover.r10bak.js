// 视图：电影库（发现页）—— TMDB 全量片库网格 + 搜索 + 多选批量加入我的电影库
window.App = window.App || {};
App.views = App.views || {};

App.views.discover = (function () {
  let state = { kind: 'popular', genre: null, lang: null, year: null, page: 1, totalPages: 1, query: '', loading: false,
                selecting: false, selected: new Set(), movies: [], records: [], key: '' };
  let scrollBound = false; // 滚动自动加载只绑定一次
  let genreCache = null;   // TMDB 类型列表缓存

  function posterBlock(poster) {
    if (poster) return `<div class="poster"><img src="${App.util.escapeHtml(poster)}" onerror="this.parentNode.classList.add('ph');this.remove();" alt=""></div>`;
    return `<div class="poster ph">🎬</div>`;
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function inLibrary(m) {
    return state.records.some(r => (m.tmdbId && r.tmdbId === m.tmdbId)
      || (r.title || '').toLowerCase() === (m.title || '').toLowerCase());
  }
  function makeRecord(seed, opts) {
    const date = opts.date, unknown = opts.unknown;
    return {
      id: App.util.uid(),
      watchDates: date ? [date] : [],
      title: seed.title || '未命名',
      posterUrl: seed.poster || '',
      overview: seed.overview || '',
      director: '', cast: [], rating: opts.rating || 0,
      review: '', comment: '', tags: [], quotes: [],
      tmdbId: seed.tmdbId || '', year: seed.year || '',
      genres: seed.genres || [],
      entries: [{ seq: 1, watchDate: date, rating: opts.rating || 0, review: '', comment: '', quotes: [], dateUnknown: unknown, dateNote: unknown ? opts.note : '' }],
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  function renderGrid() {
    const box = document.getElementById('discGrid');
    if (!box) return;
    if (!state.movies.length) {
      box.innerHTML = `<div class="empty"><div class="big">🎞️</div>${state.query ? '没有匹配的电影' : '暂无电影，去「设置」填 TMDB 密钥'}</div>`;
      return;
    }
    box.innerHTML = state.movies.map(m => {
      const id = String(m.tmdbId);
      const added = inLibrary(m);
      const sel = state.selecting && state.selected.has(id);
      return `
      <div class="movie-card disc ${state.selecting ? 'selectable' : ''} ${sel ? 'sel' : ''} ${added ? 'added' : ''}" data-id="${id}" data-title="${App.util.escapeHtml(m.title)}" data-year="${m.year}" data-poster="${App.util.escapeHtml(m.poster)}" data-over="${App.util.escapeHtml(m.overview)}" data-tmdb="${m.tmdbId}" data-genres="${(m.genres || []).join(',')}">
        ${posterBlock(m.poster)}
        ${added ? '<span class="added-badge">已加入</span>' : ''}
        <div class="body"><p class="name">${App.util.escapeHtml(m.title)}</p><div class="meta"><span>${m.year || ''}</span></div></div>
        ${state.selecting ? `<span class="check ${sel ? 'on' : ''}"></span>` : ''}
      </div>`;
    }).join('');
    box.querySelectorAll('.movie-card.disc').forEach(c => c.onclick = () => {
      const m = { tmdbId: c.dataset.tmdb, title: c.dataset.title, year: c.dataset.year, poster: c.dataset.poster, overview: c.dataset.over };
      if (state.selecting) {
        const id = c.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        c.classList.toggle('sel');
        const ck = c.querySelector('.check'); if (ck) ck.classList.toggle('on');
        updateBatch();
      } else {
        if (inLibrary(m)) { App.util.toast('这部已在你的电影库'); return; }
        quickAdd(m);
      }
    });
  }

  function updateBatch() {
    const bar = document.getElementById('batchBar');
    if (!bar) return;
    document.getElementById('batchCount').textContent = state.selected.size;
    bar.querySelector('#batchAdd').style.opacity = state.selected.size ? '1' : '.5';
  }

  function loadList(kind, page, append) {
    if (!state.key) { renderMsg('需要 TMDB 密钥才能浏览电影库，去「设置」填写'); return; }
    state.loading = true;
    const req = App.tmdb.discover({ kind, genre: state.genre, lang: state.lang, year: state.year }, state.key, page);
    req.then(data => {
      state.page = data.page; state.totalPages = data.totalPages;
      state.movies = append ? state.movies.concat(data.results) : data.results;
      state.loading = false;
      renderGrid();
      const more = document.getElementById('discMore');
      if (more) more.style.display = (state.page < state.totalPages) ? 'block' : 'none';
    }).catch(() => { state.loading = false; renderMsg('加载失败（检查密钥或网络）'); });
  }

  function renderMsg(msg) {
    const box = document.getElementById('discGrid');
    if (box) box.innerHTML = `<div class="empty"><div class="big">🎬</div>${msg}</div>`;
    const more = document.getElementById('discMore'); if (more) more.style.display = 'none';
  }

  function doSearch(q) {
    if (!q) { loadList(state.kind, 1, false); return; }
    if (!state.key) { renderMsg('需要 TMDB 密钥才能搜索'); return; }
    App.tmdb.search(q, state.key).then(list => {
      if (!list.length) renderMsg('没找到相关电影');
      else { state.movies = list; renderGrid(); const more = document.getElementById('discMore'); if (more) more.style.display = 'none'; }
    }).catch(() => renderMsg('搜索暂时不可用（网络/CORS 限制）'));
  }

  // 单个加入：弹窗填日期/评分，可 enrich 资料
  function quickAdd(seed) {
    seed = seed || {};
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>加入我的电影库</h3>
        <div class="preview">
          ${seed.poster ? `<img src="${seed.poster}" onerror="this.style.display='none'">` : `<div style="width:70px;height:105px;background:var(--bg-soft);border-radius:8px;display:flex;align-items:center;justify-content:center">🎬</div>`}
          <div><div style="font-weight:600">${App.util.escapeHtml(seed.title || '')}</div><div class="muted">${seed.year || ''}</div></div>
        </div>
        <div class="field"><label>观影时间（首刷，可留空稍后补）</label><input type="date" id="qaDate" value=""></div>
        <label class="unk-toggle"><input type="checkbox" id="qaUnknown"> 🤔 记不清具体哪天了</label>
        <div class="field" id="qaNoteWrap" style="display:none;margin-top:8px"><label>大概什么时候？（选填）</label><input type="text" id="qaNote" placeholder="如 2020 / 大学时"></div>
        <div class="field"><label>快速评分（可留空，进详情再评）</label><div class="stars" id="qaStars"></div></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="qaCancel">取消</button>
          <button class="btn primary block" id="qaOk">加入</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    let rating = 0;
    const starsBox = mask.querySelector('#qaStars');
    function paintStars() { starsBox.innerHTML = [1,2,3,4,5].map(i => `<span class="s ${i <= rating ? 'on' : ''}" data-i="${i}">★</span>`).join(''); starsBox.querySelectorAll('.s').forEach(s => s.onclick = () => { rating = +s.dataset.i; paintStars(); }); }
    paintStars();
    const qaUnk = mask.querySelector('#qaUnknown'), qaNoteWrap = mask.querySelector('#qaNoteWrap'), qaDate = mask.querySelector('#qaDate');
    qaUnk.onchange = () => { qaDate.disabled = qaUnk.checked; qaNoteWrap.style.display = qaUnk.checked ? 'block' : 'none'; if (qaUnk.checked) qaDate.value = ''; };
    mask.querySelector('#qaCancel').onclick = () => mask.remove();
    mask.querySelector('#qaOk').onclick = () => {
      const unknown = qaUnk.checked, note = mask.querySelector('#qaNote').value.trim();
      const date = unknown ? '' : (qaDate.value || '');
      const rec = makeRecord(seed, { date, unknown, note, rating: rating || 0 });
      const finish = (r) => App.db.saveRecord(r).then(() => { mask.remove(); App.util.toast('已加入我的电影库 🎉'); App.audio.sfx('success'); reload().then(renderGrid); });
      if (seed.tmdbId && state.key) App.tmdb.details(seed.tmdbId, state.key).then(d => { rec.director = d.director || ''; rec.cast = d.cast || []; rec.overview = d.overview || rec.overview; rec.year = d.year || seed.year; rec.genres = d.genres || []; finish(rec); }).catch(() => finish(rec));
      else finish(rec);
    };
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  }

  // 批量加入：多选的电影一次性建记录（仅基础字段，后续在「我的电影库」补心得）
  function batchAdd() {
    const picks = state.movies.filter(m => state.selected.has(String(m.tmdbId)) && !inLibrary(m));
    if (!picks.length) { App.util.toast('没有可加入的新电影'); return; }
    let i = 0, ok = 0;
    App.util.toast('正在加入 ' + picks.length + ' 部…');
    function next() {
      if (i >= picks.length) {
        state.selecting = false; state.selected.clear();
        exitSelect();
        App.util.toast('已加入 ' + ok + ' 部，去「我的电影库」补心得 🎉');
        App.audio.sfx('success');
        reload().then(renderGrid);
        return;
      }
      const m = picks[i++];
      const rec = makeRecord(m, { date: '', unknown: false, note: '', rating: 0 });
      const finish = (r) => App.db.saveRecord(r).then(() => { ok++; next(); });
      if (m.tmdbId && state.key) App.tmdb.details(m.tmdbId, state.key).then(d => { rec.director = d.director || ''; rec.cast = d.cast || []; rec.overview = d.overview || rec.overview; rec.year = d.year || m.year; rec.genres = d.genres || []; finish(rec); }).catch(() => finish(rec));
      else finish(rec);
    }
    next();
  }

  function enterSelect() {
    state.selecting = true; state.selected.clear();
    const mb = document.getElementById('discMulti'); if (mb) mb.textContent = '完成';
    const bar = document.getElementById('batchBar'); if (bar) bar.hidden = false;
    const fab = document.getElementById('fab'); if (fab) fab.style.display = 'none';
    updateBatch();
    renderGrid();
  }
  function exitSelect() {
    state.selecting = false;
    const mb = document.getElementById('discMulti'); if (mb) mb.textContent = '多选';
    const bar = document.getElementById('batchBar'); if (bar) bar.hidden = true;
    const fab = document.getElementById('fab'); if (fab) fab.style.display = 'flex';
    renderGrid();
  }

  // 地区（按原声语言近似）与年份选项
  const LANGS = [['zh', '中国'], ['en', '美国'], ['ja', '日本'], ['ko', '韩国'], ['fr', '法国'], ['hi', '印度'], ['th', '泰国']];

  function filterChip(active, key, val, label) {
    return `<span class="chip ${active ? 'active' : ''}" data-${key}="${val}">${label}</span>`;
  }

  function paintFilters(root) {
    // 类型栏：全部 + TMDB 类型（缓存列表避免每次点击都请求）
    if (state.key) {
      const getGenres = genreCache ? Promise.resolve(genreCache) : App.tmdb.genres(state.key).then(gs => { genreCache = gs; return gs; });
      getGenres.then(gs => {
        const bar = root.querySelector('#discGenres'); if (!bar) return;
        bar.innerHTML = `<span class="f-label">类型</span>` + filterChip(!state.genre, 'g', '', '全部')
          + gs.slice(0, 18).map(g => filterChip(String(state.genre) === String(g.id), 'g', g.id, App.util.escapeHtml(g.name))).join('');
        bar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
          const v = c.dataset.g;
          state.genre = v ? ((String(state.genre) === v) ? null : v) : null;
          resetFiltersAndLoad(root); paintFilters(root);
        });
      }).catch(() => {});
    }
    // 地区栏
    const lbar = root.querySelector('#discLangs');
    if (lbar) {
      lbar.innerHTML = `<span class="f-label">地区</span>` + filterChip(!state.lang, 'l', '', '全部')
        + LANGS.map(([v, n]) => filterChip(state.lang === v, 'l', v, n)).join('');
      lbar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
        const v = c.dataset.l;
        state.lang = v ? (state.lang === v ? null : v) : null;
        resetFiltersAndLoad(root); paintFilters(root);
      });
    }
    // 年份栏：近 5 年 + 更早
    const ybar = root.querySelector('#discYears');
    if (ybar) {
      const y = new Date().getFullYear();
      const yrs = [y, y - 1, y - 2, y - 3, y - 4];
      ybar.innerHTML = `<span class="f-label">年份</span>` + filterChip(!state.year, 'y', '', '全部')
        + yrs.map(yy => filterChip(String(state.year) === String(yy), 'y', yy, String(yy))).join('')
        + filterChip(state.year === 'old', 'y', 'old', '更早');
      ybar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
        const v = c.dataset.y;
        state.year = v ? (state.year === v ? null : v) : null;
        resetFiltersAndLoad(root); paintFilters(root);
      });
    }
  }

  function resetFiltersAndLoad(root) {
    state.query = '';
    const inp = root.querySelector('#discSearch'); if (inp) inp.value = '';
    const clr = root.querySelector('#discClear'); if (clr) clr.style.display = 'none';
    loadList(state.kind, 1, false);
  }

  function render(param, root) {
    const kindName = { popular: '热门', now_playing: '最新', top_rated: '高分' };
    root.innerHTML = `
      <div class="view-block">
        <div class="seg">
          <button class="seg-btn ${state.kind === 'popular' ? 'active' : ''}" data-kind="popular">热门</button>
          <button class="seg-btn ${state.kind === 'now_playing' ? 'active' : ''}" data-kind="now_playing">最新</button>
          <button class="seg-btn ${state.kind === 'top_rated' ? 'active' : ''}" data-kind="top_rated">高分</button>
        </div>
        <div class="genre-bar" id="discGenres"></div>
        <div class="genre-bar" id="discLangs"></div>
        <div class="genre-bar" id="discYears"></div>
      </div>
      <div class="view-block search-wrap">
        <div class="search-bar">
          <span class="ico">🔍</span>
          <input id="discSearch" type="text" placeholder="搜电影名…">
          <span class="search-clear" id="discClear" style="display:none">✕</span>
        </div>
      </div>
      <div class="view-block" style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 8px">
        <div class="section-title" style="margin:0">电影库 <span class="hint">${state.query ? '搜索结果' : kindName[state.kind]}</span></div>
        <button class="btn sm" id="discMulti">多选</button>
      </div>
      <div id="discGrid" class="movie-grid discover"></div>
      <div id="batchBar" class="batch-bar" hidden>
        <button class="btn sm" id="batchCancel">取消</button>
        <span class="batch-count">已选 <b id="batchCount">0</b> 部</span>
        <button class="btn primary" id="batchAdd">添加</button>
      </div>`;

    root.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
      state.kind = b.dataset.kind;
      root.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
      state.query = '';
      loadList(state.kind, 1, false);
    });
    const input = root.querySelector('#discSearch');
    input.oninput = debounce((e) => {
      state.query = e.target.value.trim();
      root.querySelector('#discClear').style.display = state.query ? 'block' : 'none';
      doSearch(state.query);
    }, 400);
    root.querySelector('#discClear').onclick = () => { input.value = ''; state.query = ''; root.querySelector('#discClear').style.display = 'none'; loadList(state.kind, 1, false); };
    root.querySelector('#discMulti').onclick = () => { if (state.selecting) exitSelect(); else enterSelect(); };
    root.querySelector('#batchCancel').onclick = () => exitSelect();
    root.querySelector('#batchAdd').onclick = () => batchAdd();
    // 筛选栏：类型（含「全部」）/ 地区 / 年份
    paintFilters(root);

    // 滚动到底自动加载更多（在 render 里绑定一次，避免 init 未调用导致不触发）
    if (!scrollBound) {
      scrollBound = true;
      window.addEventListener('scroll', () => {
        if (state.loading || state.query) return;
        const doc = document.documentElement;
        if (window.innerHeight + window.scrollY >= (doc.scrollHeight || document.body.scrollHeight) - 150) {
          if (state.page < state.totalPages) loadList(state.kind, state.page + 1, true);
        }
      });
    }

    loadList(state.kind, 1, false);
  }

  function init() {
    return App.db.getSettings().then(s => { state.key = s.tmdbApiKey || ''; })
      .then(() => App.db.getRecords()).then(r => { state.records = r; });
  }
  function reload() {
    return App.db.getRecords().then(r => { state.records = r; })
      .then(() => App.db.getSettings()).then(s => { state.key = s.tmdbApiKey || ''; });
  }
  return { render, init, reload };
})();
