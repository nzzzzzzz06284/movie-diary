// 视图：电影库（首页）—— 搜索栏 + 搜索结果 + 本地库列表 + 筛选
window.App = window.App || {};
App.views = App.views || {};

App.views.list = (function () {
  let state = { query: '', tags: new Set(), year: '' };
  let records = [];
  let key = '';

  function posterBlock(poster) {
    if (poster) return `<div class="poster"><img src="${App.util.escapeHtml(poster)}" onerror="this.parentNode.classList.add('ph');this.remove();" alt=""></div>`;
    return `<div class="poster ph">🎬</div>`;
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function renderLibrary() {
    const box = document.getElementById('library');
    if (!box) return;
    let list = records.slice();
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter(r => (r.title || '').toLowerCase().includes(q)
        || App.util.entries(r).some(e => (e.review || '').toLowerCase().includes(q)
          || (e.comment || '').toLowerCase().includes(q)
          || (e.quotes || []).some(qt => (qt || '').toLowerCase().includes(q))));
    }
    if (state.year) list = list.filter(r => App.util.watchDates(r).some(d => d.slice(0, 4) === state.year));
    if (state.tags.size) list = list.filter(r => (r.tags || []).some(t => state.tags.has(t)));

    if (!list.length) {
      box.innerHTML = `<div class="empty"><div class="big">🎞️</div>${state.query || state.tags.size || state.year ? '没有匹配的电影' : '还没有电影，去搜索或点右下角 ＋ 添加'}</div>`;
      return;
    }
    box.innerHTML = `<div class="movie-grid">` + list.map(r => `
      <div class="movie-card" data-id="${r.id}">
        ${posterBlock(r.posterUrl)}
        <div class="body">
          <p class="name">${App.util.escapeHtml(r.title)}</p>
          <div class="meta"><span>${App.util.fmtDate(App.util.latestWatch(r))}${(App.util.watchCount(r) > 1) ? ' · ' + App.util.watchCount(r) + '刷' : ''}</span>${App.util.latestRating(r) ? App.util.starsHtml(App.util.latestRating(r), 5) : ''}</div>
        </div>
      </div>`).join('') + `</div>`;
    box.querySelectorAll('.movie-card').forEach(c =>
      c.onclick = () => App.router.go('#/detail/' + c.dataset.id));
  }

  function renderFilters() {
    const box = document.getElementById('filters');
    if (!box) return;
    const allTags = [...new Set(records.flatMap(r => r.tags || []))].sort();
    const years = [...new Set(records.flatMap(r => App.util.watchDates(r).map(d => d.slice(0, 4))))].filter(Boolean).sort().reverse();
    let html = '';
    if (allTags.length) html += `<div class="chips">` + allTags.map(t =>
      `<span class="chip ${state.tags.has(t) ? 'active' : ''}" data-tag="${App.util.escapeHtml(t)}">${App.util.escapeHtml(t)}</span>`).join('') + `</div>`;
    if (years.length) html += `<div class="row" style="margin-top:8px"><select id="yearSel"><option value="">全部年份</option>${years.map(y => `<option value="${y}" ${state.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`;
    box.innerHTML = html;
    box.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const t = c.dataset.tag;
      if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
      renderFilters(); renderLibrary();
    });
    const ys = document.getElementById('yearSel');
    if (ys) ys.onchange = () => { state.year = ys.value; renderLibrary(); };
  }

  function renderResults(list) {
    const box = document.getElementById('searchResults');
    if (!box) return;
    if (!list) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title">搜索结果 <span class="hint">点“添加”选观影时间</span></div>` +
      list.map(m => `
      <div class="result-card" data-tmdb="${m.tmdbId}" data-title="${App.util.escapeHtml(m.title)}" data-year="${m.year}" data-poster="${App.util.escapeHtml(m.poster)}" data-over="${App.util.escapeHtml(m.overview)}">
        ${m.poster ? `<img src="${m.poster}" onerror="this.style.display='none'">` : `<div style="width:48px;height:72px;background:var(--bg-soft);border-radius:8px;display:flex;align-items:center;justify-content:center">🎬</div>`}
        <div class="rc-body"><div class="rc-title">${App.util.escapeHtml(m.title)}</div><div class="rc-sub">${m.year || ''}</div></div>
        <button class="btn primary sm add-res">添加</button>
      </div>`).join('');
    box.querySelectorAll('.add-res').forEach(b => b.onclick = (e) => {
      const card = e.target.closest('.result-card');
      quickAdd({
        title: card.dataset.title, posterUrl: card.dataset.poster,
        overview: card.dataset.over, tmdbId: card.dataset.tmdb
      });
    });
  }

  function renderResultsMsg(msg, showManual) {
    const box = document.getElementById('searchResults');
    if (!box) return;
    box.innerHTML = `<div class="section-title">搜索结果</div><div class="empty" style="padding:14px">${msg}</div>` +
      (showManual ? `<div style="text-align:center"><button class="btn primary" id="manualFromSearch">手动添加《${App.util.escapeHtml(state.query)}》</button></div>` : '');
    const mb = document.getElementById('manualFromSearch');
    if (mb) mb.onclick = () => App.router.go('#/edit?title=' + encodeURIComponent(state.query));
  }

  function quickAdd(seed) {
    seed = seed || {};
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>添加到电影库</h3>
        <div class="preview">
          ${seed.posterUrl ? `<img src="${seed.posterUrl}" onerror="this.style.display='none'">` : `<div style="width:70px;height:105px;background:var(--bg-soft);border-radius:8px;display:flex;align-items:center;justify-content:center">🎬</div>`}
          <div><div style="font-weight:600">${App.util.escapeHtml(seed.title || '')}</div><div class="muted">${seed.year || ''}</div></div>
        </div>
        <div class="field"><label>观影时间</label><input type="date" id="qaDate" value="${App.util.today()}"></div>
        <div class="field"><label>快速评分（可留空，进详情再评）</label><div class="stars" id="qaStars"></div></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="qaCancel">取消</button>
          <button class="btn primary block" id="qaOk">加入电影库</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    let rating = 0;
    const starsBox = mask.querySelector('#qaStars');
    function paintStars() {
      starsBox.innerHTML = [1,2,3,4,5].map(i => `<span class="s ${i <= rating ? 'on' : ''}" data-i="${i}">★</span>`).join('');
      starsBox.querySelectorAll('.s').forEach(s => s.onclick = () => { rating = +s.dataset.i; paintStars(); });
    }
    paintStars();
    mask.querySelector('#qaCancel').onclick = () => mask.remove();
    mask.querySelector('#qaOk').onclick = () => {
      const rec = {
        id: App.util.uid(), watchedDate: mask.querySelector('#qaDate').value || App.util.today(), watchDates: [mask.querySelector('#qaDate').value || App.util.today()],
        title: seed.title || '未命名', posterUrl: seed.posterUrl || '', overview: seed.overview || '',
        director: '', cast: [], rating: rating || 0, review: '', comment: '', tags: [], quotes: [],
        tmdbId: seed.tmdbId || '', createdAt: Date.now(), updatedAt: Date.now()
      };
      App.db.saveRecord(rec).then(() => {
        mask.remove();
        App.util.toast('已加入电影库');
        App.router.go('#/detail/' + rec.id);
      });
    };
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  }

  function doSearch(q) {
    if (!q) { renderResults(null); return; }
    if (!key) { renderResultsMsg('未配置 TMDB 密钥，已切换为手动添加', true); return; }
    App.tmdb.search(q, key)
      .then(list => { if (!list.length) renderResultsMsg('没找到相关电影，可手动添加', true); else renderResults(list); })
      .catch(err => {
        if (err.message === 'NO_KEY') renderResultsMsg('未配置 TMDB 密钥，已切换为手动添加', true);
        else renderResultsMsg('自动搜索暂时不可用（可能是网络/CORS 限制），可手动添加', true);
      });
  }

  function render(param, root) {
    root.innerHTML = `
      <div class="view-block">
        <div class="search-bar">
          <span class="ico">🔍</span>
          <input id="searchInput" type="text" placeholder="搜索今天看的电影…" value="${App.util.escapeHtml(state.query)}">
        </div>
        <div id="searchResults"></div>
      </div>
      <div class="view-block">
        <div class="section-title">我的电影库 <span class="hint">${records.length} 部</span></div>
        <div id="filters"></div>
        <div id="library" style="margin-top:10px"></div>
      </div>`;

    const input = root.querySelector('#searchInput');
    input.oninput = debounce((e) => { state.query = e.target.value.trim(); doSearch(state.query); }, 450);

    renderFilters();
    renderLibrary();
  }

  // 初始化时加载数据
  function init() {
    return App.db.getSettings().then(s => { key = s.tmdbApiKey || ''; })
      .then(() => App.db.getRecords()).then(r => { records = r; });
  }

  // 每次进入刷新数据
  function reload() {
    return App.db.getRecords().then(r => { records = r; })
      .then(() => App.db.getSettings()).then(s => { key = s.tmdbApiKey || ''; });
  }

  return { render, init, reload };
})();
