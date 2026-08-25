// 视图：电影库（首页）—— 搜索栏（爱奇艺式自动联想）+ 本地库列表 + 筛选
window.App = window.App || {};
App.views = App.views || {};

App.views.list = (function () {
  let state = { query: '', tags: new Set(), year: '', selecting: false, selSet: new Set() };
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
    const sel = state.selSet;
    box.innerHTML = `<div class="movie-grid ${state.selecting ? 'selecting' : ''}">` + list.map(r => {
      const isSel = sel.has(r.id);
      return `
      <div class="movie-card ${state.selecting ? 'selectable' : ''} ${isSel ? 'sel' : ''}" data-id="${r.id}">
        ${state.selecting ? '<span class="check ' + (isSel ? 'on' : '') + '"></span>' : ''}
        ${posterBlock(r.posterUrl)}
        <div class="body">
          <p class="name">${App.util.escapeHtml(r.title)}</p>
          <div class="meta"><span>${App.util.movieDateLabel(r)}${(App.util.watchCount(r) > 1) ? ' · ' + App.util.watchCount(r) + '刷' : ''}</span>${App.util.latestRating(r) ? App.util.starsHtml(App.util.latestRating(r), 5) : ''}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
    box.querySelectorAll('.movie-card').forEach(c => {
      if (state.selecting) {
        c.onclick = () => {
          const id = c.dataset.id;
          if (state.selSet.has(id)) state.selSet.delete(id); else state.selSet.add(id);
          c.classList.toggle('sel');
          const ck = c.querySelector('.check'); if (ck) ck.classList.toggle('on');
          updateListBatch();
        };
      } else {
        c.onclick = () => App.router.go('#/detail/' + c.dataset.id);
      }
    });
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

  // 判断某部搜索结果是否已在库
  function inLibrary(m) {
    return records.some(r => (m.tmdbId && r.tmdbId === m.tmdbId)
      || (r.title || '').toLowerCase() === (m.title || '').toLowerCase());
  }

  // 渲染搜索联想下拉（爱奇艺式：海报 + 片名 + 年份 + 简介 + 点选加入）
  function renderResults(list) {
    const box = document.getElementById('searchResults');
    if (!box) return;
    if (!list) { box.innerHTML = ''; box.classList.remove('open'); return; }
    box.classList.add('open');
    box.innerHTML = `<div class="sr-head">搜索结果 · 点电影即加入</div>` + list.map(m => {
      const added = inLibrary(m);
      const over = m.overview ? (m.overview.length > 46 ? m.overview.slice(0, 46) + '…' : m.overview) : '暂无简介';
      return `
      <div class="result-row ${added ? 'added' : ''}" data-tmdb="${m.tmdbId}" data-title="${App.util.escapeHtml(m.title)}" data-year="${m.year}" data-poster="${App.util.escapeHtml(m.poster)}" data-over="${App.util.escapeHtml(m.overview)}">
        ${m.poster ? `<img class="sr-poster" src="${m.poster}" onerror="this.style.visibility='hidden'">` : `<div class="sr-poster ph">🎬</div>`}
        <div class="sr-info">
          <div class="sr-title">${App.util.escapeHtml(m.title)} <span class="sr-year">${m.year || ''}</span></div>
          <div class="sr-over">${App.util.escapeHtml(over)}</div>
        </div>
        <div class="sr-action">${added ? '<span class="badge-done">已在库</span>' : '＋'}</div>
      </div>`;
    }).join('');
    box.querySelectorAll('.result-row').forEach(r => r.onclick = () => {
      if (r.classList.contains('added')) { App.util.toast('这部已在你的电影库'); return; }
      quickAdd({ tmdbId: r.dataset.tmdb, title: r.dataset.title, year: r.dataset.year, posterUrl: r.dataset.poster, overview: r.dataset.over }, true);
    });
  }

  function renderResultsMsg(msg, showManual) {
    const box = document.getElementById('searchResults');
    if (!box) return;
    box.classList.add('open');
    box.innerHTML = `<div class="sr-head">搜索</div><div class="empty" style="padding:14px">${msg}</div>` +
      (showManual ? `<div style="text-align:center;padding-bottom:12px"><button class="btn primary" id="manualFromSearch">手动添加《${App.util.escapeHtml(state.query)}》</button></div>` : '');
    const mb = document.getElementById('manualFromSearch');
    if (mb) mb.onclick = () => App.router.go('#/edit?title=' + encodeURIComponent(state.query));
  }

  // 快速加入：选观影时间（首刷）+ 快速评分，点确定即入库
  function quickAdd(seed, enrich) {
    seed = seed || {};
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>加入电影库</h3>
        <div class="preview">
          ${seed.posterUrl ? `<img src="${seed.posterUrl}" onerror="this.style.display='none'">` : `<div style="width:70px;height:105px;background:var(--bg-soft);border-radius:8px;display:flex;align-items:center;justify-content:center">🎬</div>`}
          <div><div style="font-weight:600">${App.util.escapeHtml(seed.title || '')}</div><div class="muted">${seed.year || ''}</div></div>
        </div>
        <div class="field"><label>观影时间（首刷）</label><input type="date" id="qaDate" value="${App.util.today()}"></div>
        <label class="unk-toggle"><input type="checkbox" id="qaUnknown"> 🤔 记不清具体哪天了</label>
        <div class="field" id="qaNoteWrap" style="display:none;margin-top:8px"><label>大概什么时候？（选填，如 2020 / 大学时）</label><input type="text" id="qaNote" placeholder="可留空"></div>
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
    const qaUnk = mask.querySelector('#qaUnknown');
    const qaNoteWrap = mask.querySelector('#qaNoteWrap');
    const qaDate = mask.querySelector('#qaDate');
    qaUnk.onchange = () => { qaDate.disabled = qaUnk.checked; qaNoteWrap.style.display = qaUnk.checked ? 'block' : 'none'; if (qaUnk.checked) qaDate.value = ''; };
    mask.querySelector('#qaCancel').onclick = () => mask.remove();
    mask.querySelector('#qaOk').onclick = () => {
      const unknown = qaUnk.checked;
      const note = mask.querySelector('#qaNote').value.trim();
      const date = unknown ? '' : (qaDate.value || App.util.today());
      const rec = {
        id: App.util.uid(),
        watchDates: date ? [date] : [],
        title: seed.title || '未命名',
        posterUrl: seed.posterUrl || '',
        overview: seed.overview || '',
        director: '', cast: [], castInfo: [], rating: rating || 0,
        review: '', comment: '', tags: [], quotes: [],
        tmdbId: seed.tmdbId || '',
        entries: [{ seq: 1, watchDate: date, rating: rating || 0, review: '', comment: '', quotes: [], dateUnknown: unknown, dateNote: unknown ? note : '' }],
        createdAt: Date.now(), updatedAt: Date.now()
      };
      const finish = (r) => App.db.saveRecord(r).then(() => { mask.remove(); App.util.toast('已加入电影库 🎉'); App.audio.sfx('success'); App.router.go('#/detail/' + r.id); });
      // 点选时自动补全导演 / 演员，确保资料正确
      if (enrich && seed.tmdbId && key) {
        App.tmdb.details(seed.tmdbId, key)
          .then(d => { rec.director = d.director || ''; rec.cast = d.cast || []; rec.castInfo = d.castInfo || []; rec.overview = d.overview || rec.overview; rec.year = d.year || seed.year; rec.genres = d.genres || []; finish(rec); })
          .catch(() => finish(rec));
      } else finish(rec);
    };
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  }

  function doSearch(q) {
    if (!q) { renderResults(null); return; }
    if (!key) {
      const box = document.getElementById('searchResults');
      box.classList.add('open');
      box.innerHTML = `<div class="sr-head">搜索</div>
        <div class="empty" style="padding:14px">开启「搜片名自动填资料」需要一个 TMDB 免费密钥。</div>
        <div style="text-align:center;padding-bottom:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" id="goSettings">去设置填密钥</button>
          <button class="btn" id="manualFromSearch">手动添加《${App.util.escapeHtml(q)}》</button>
        </div>`;
      document.getElementById('goSettings').onclick = () => App.router.go('#/settings');
      document.getElementById('manualFromSearch').onclick = () => App.router.go('#/edit?title=' + encodeURIComponent(q));
      return;
    }
    App.tmdb.search(q, key)
      .then(list => { if (!list.length) renderResultsMsg('没找到相关电影，可手动添加', true); else renderResults(list); })
      .catch(err => {
        if (err.message === 'NO_KEY') renderResultsMsg('未配置 TMDB 密钥', true);
        else renderResultsMsg('自动搜索暂时不可用（网络/CORS 限制），可手动添加', true);
      });
  }

  function render(param, root) {
    root.innerHTML = `
      <div class="view-block">
        <div class="section-title">我的电影库 <span class="hint">${records.length} 部</span>
          <span class="ml-auto" style="display:flex;gap:8px;margin-left:auto">
            <button class="btn sm ghost" id="listDup">清除重复</button>
            <button class="btn sm" id="listMulti">多选删除</button>
          </span>
        </div>
        <div id="filters"></div>
        <div id="library" style="margin-top:10px"></div>
      </div>
      <div id="listBatchBar" class="batch-bar" hidden>
        <button class="btn sm" id="listCancel">取消</button>
        <span class="batch-count">已选 <b id="listCount">0</b> 部</span>
        <button class="btn danger" id="listDel">删除</button>
      </div>`;
    renderFilters();
    renderLibrary();
    const multi = document.getElementById('listMulti');
    if (multi) multi.onclick = () => { if (state.selecting) exitMulti(); else enterMulti(); };
    const dup = document.getElementById('listDup');
    if (dup) dup.onclick = clearDuplicates;
    const cancel = document.getElementById('listCancel');
    if (cancel) cancel.onclick = exitMulti;
    const del = document.getElementById('listDel');
    if (del) del.onclick = batchDelete;
  }

  function updateListBatch() {
    const bar = document.getElementById('listBatchBar');
    if (!bar) return;
    const c = document.getElementById('listCount'); if (c) c.textContent = state.selSet.size;
    const d = document.getElementById('listDel'); if (d) d.style.opacity = state.selSet.size ? '1' : '.5';
  }
  function enterMulti() {
    state.selecting = true; state.selSet.clear();
    const bar = document.getElementById('listBatchBar'); if (bar) bar.hidden = false;
    const btn = document.getElementById('listMulti'); if (btn) btn.textContent = '完成';
    updateListBatch(); renderLibrary();
  }
  function exitMulti() {
    state.selecting = false; state.selSet.clear();
    const bar = document.getElementById('listBatchBar'); if (bar) bar.hidden = true;
    const btn = document.getElementById('listMulti'); if (btn) btn.textContent = '多选删除';
    renderLibrary();
  }
  // 通用确认弹窗，返回 Promise<boolean>
  function confirmModal(msg) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = `<div class="modal"><p style="margin:6px 0 16px;line-height:1.5">${msg}</p>
        <div style="display:flex;gap:10px"><button class="btn block" id="cmNo">取消</button><button class="btn danger block" id="cmYes">删除</button></div></div>`;
      document.body.appendChild(mask);
      const close = (v) => { mask.remove(); resolve(v); };
      mask.querySelector('#cmNo').onclick = () => close(false);
      mask.querySelector('#cmYes').onclick = () => close(true);
      mask.onclick = (e) => { if (e.target === mask) close(false); };
    });
  }
  // 多选批量删除
  function batchDelete() {
    const ids = [...state.selSet];
    if (!ids.length) return;
    confirmModal(`确定删除选中的 ${ids.length} 部电影吗？此操作不可恢复。`).then(ok => {
      if (!ok) return;
      let i = 0; const total = ids.length;
      (function del() {
        if (i >= total) {
          exitMulti();
          reload().then(() => { renderFilters(); renderLibrary(); });
          App.util.toast('已删除 ' + total + ' 部 🗑️');
          App.audio.sfx('success');
          return;
        }
        App.db.deleteRecord(ids[i++]).then(del);
      })();
    });
  }
  // 一键清除重复电影（同 TMDB 编号或同片名视为重复，保留第一部）
  function clearDuplicates() {
    const seen = new Set(); const dup = [];
    records.forEach(r => {
      const k = (r.tmdbId && r.tmdbId !== '') ? ('t' + r.tmdbId) : ('n' + (r.title || '').toLowerCase());
      if (seen.has(k)) dup.push(r.id); else seen.add(k);
    });
    if (!dup.length) { App.util.toast('没有发现重复电影 🎉'); return; }
    confirmModal(`发现 ${dup.length} 部重复电影，将保留第一部、删除其余重复项。确定清除？`).then(ok => {
      if (!ok) return;
      let i = 0; const total = dup.length;
      (function del() {
        if (i >= total) {
          reload().then(() => { renderFilters(); renderLibrary(); });
          App.util.toast('已清除 ' + total + ' 部重复 🎉');
          App.audio.sfx('success');
          return;
        }
        App.db.deleteRecord(dup[i++]).then(del);
      })();
    });
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
