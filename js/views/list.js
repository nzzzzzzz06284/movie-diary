// 视图：电影库（首页）—— 搜索栏（爱奇艺式自动联想）+ 本地库列表 + 筛选
window.App = window.App || {};
App.views = App.views || {};

App.views.list = (function () {
  let state = { query: '', tags: new Set(), year: '', selecting: false, selSet: new Set() };
  let records = [];
  let key = '';
  let suppressClick = false; // 长按进入多选后抑制紧随的 click，避免刚勾选又被取消
  let srSeq = 0;             // 搜索序号：慢的旧结果不许盖掉新一次搜索（否则"搜一次就搜不了了"）

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
          <div class="meta"><span>${App.util.dateShort(App.util.latestWatch(r)) || (App.util.entries(r).some(e => e.dateUnknown) ? '记不清了' : '')}${(App.util.watchCount(r) > 1) ? ' · ' + App.util.watchCount(r) + '刷' : ''}</span>${App.util.latestRating(r) ? `<span class="rate-num">${App.util.ratingText(App.util.latestRating(r))}</span>` : ''}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
    box.querySelectorAll('.movie-card').forEach(c => {
      c.onclick = () => {
        if (suppressClick) { suppressClick = false; return; }
        const id = c.dataset.id;
        if (state.selecting) {
          if (state.selSet.has(id)) state.selSet.delete(id); else state.selSet.add(id);
          c.classList.toggle('sel');
          const ck = c.querySelector('.check'); if (ck) ck.classList.toggle('on');
          updateListBatch();
        } else {
          // 搜索状态下点结果 → 直接进入编辑（用户要搜到自己的电影并改时间等）；浏览状态下 → 进详情
          App.router.go((state.query ? '#/edit/' : '#/detail/') + id);
        }
      };
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
    // 包装成与下拉「＋」一致的字段（poster 兼容 posterUrl）
    seed = Object.assign({}, seed, { poster: seed.poster || seed.posterUrl });
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
    if (!q) {
      // 清空：收起下拉，恢复全部库列表
      const box = document.getElementById('searchResults');
      if (box) { box.classList.remove('open'); box.innerHTML = ''; }
      const bd = document.getElementById('listBackdrop');
      if (bd) bd.hidden = true;
      state.query = '';
      renderLibrary();
      return;
    }
    if (!key) { renderLibrary(); return; }  // 没密钥：直接在本地库里按片名过滤（grid 已按 query 过滤）
    renderLibrary(); // 有密钥时也同步过滤本地库，搜索结果里能直接点我的电影进去编辑
    const my = ++srSeq;
    App.tmdb.search(q, key)
      .then(list => {
        if (my !== srSeq) return;   // 已经有更新的搜索了，丢弃这份旧结果
        if (!list.length) renderResultsMsg('没找到相关电影，可手动添加', true); else renderResults(list);
      })
      .catch(err => {
        if (my !== srSeq) return;
        if (err && err.message === 'NO_KEY') renderResultsMsg('未配置 TMDB 密钥', true);
        else renderResultsMsg('网络不太稳，没搜到，改几个字再试或手动添加', true);
      });
  }

  function render(param, root) {
    root.innerHTML = `
      <div class="view-block search-wrap">
        <div class="search-bar">
          <span class="ico">🔍</span>
          <input id="listSearch" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="搜我库里的电影…">
          <span class="search-clear" id="listClear" style="display:none">✕</span>
        </div>
        <div class="disc-backdrop" id="listBackdrop" hidden></div>
        <div class="search-results disc-results" id="searchResults"></div>
      </div>
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
      <div id="listBatchBar" class="fab-select" hidden>
        <span class="sel-count" id="listCount">已选 0 部</span>
        <button class="btn primary fab-add" id="listBatchEdit">批量编辑</button>
        <button class="btn danger fab-add" id="listDel">删除</button>
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
    const bedit = document.getElementById('listBatchEdit');
    if (bedit) bedit.onclick = batchEdit;
    // 搜索（我的库里按片名过滤，有密钥则联机搜索 TMDB 可顺手加新片）
    const linput = document.getElementById('listSearch');
    if (linput) {
      linput.oninput = debounce((e) => {
        const q = e.target.value.trim();
        state.query = q;
        const cl = document.getElementById('listClear');
        if (cl) cl.style.display = q ? 'block' : 'none';
        doSearch(q);
      }, 350);
      linput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(linput.value.trim()); } };
    }
    const lbd = document.getElementById('listBackdrop');
    if (lbd) lbd.onclick = () => { const b = document.getElementById('searchResults'); if (b) { b.classList.remove('open'); b.innerHTML = ''; } lbd.hidden = true; };
    const lcl = document.getElementById('listClear');
    if (lcl) lcl.onclick = () => { const i = document.getElementById('listSearch'); if (i) i.value = ''; state.query = ''; lcl.style.display = 'none'; const b = document.getElementById('searchResults'); if (b) { b.classList.remove('open'); b.innerHTML = ''; } if (lbd) lbd.hidden = true; renderLibrary(); };
    bindLongPressLibrary(root);
  }

  function updateListBatch() {
    const bar = document.getElementById('listBatchBar');
    if (!bar) return;
    const c = document.getElementById('listCount'); if (c) c.textContent = '已选 ' + state.selSet.size + ' 部';
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

  // 批量编辑：给选中的电影统一设置观影时间 / 评分 / 标签（留空的项不改变）
  function batchEdit() {
    const ids = [...state.selSet];
    if (!ids.length) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>批量编辑（${ids.length} 部）</h3>
        <div class="muted" style="margin:-6px 0 12px">留空的项表示「不改」；填了就对选中电影统一生效。</div>
        <div class="field"><label>统一观影时间（都记这一次）</label><input type="date" id="beDate"></div>
        <label class="unk-toggle" style="margin-bottom:10px"><input type="checkbox" id="beUnknown"> 🤔 这些时间都记不清了</label>
        <div class="field"><label>统一评分（可留空）</label><div class="stars" id="beStars"></div></div>
        <div class="field"><label>统一加标签（多个用逗号分隔，可留空）</label><input type="text" id="beTags" placeholder="如：科幻,治愈"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="beCancel">取消</button>
          <button class="btn primary block" id="beOk">保存修改</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    let rating = 0;
    const starsBox = mask.querySelector('#beStars');
    function paintStars() {
      starsBox.innerHTML = [1,2,3,4,5].map(i => `<span class="s ${i <= rating ? 'on' : ''}" data-i="${i}">★</span>`).join('');
      starsBox.querySelectorAll('.s').forEach(s => s.onclick = () => { rating = +s.dataset.i; paintStars(); });
    }
    paintStars();
    mask.querySelector('#beCancel').onclick = () => mask.remove();
    mask.querySelector('#beOk').onclick = () => {
      const date = mask.querySelector('#beDate').value;
      const unknown = mask.querySelector('#beUnknown').checked;
      const tagsRaw = mask.querySelector('#beTags').value.trim();
      const addTags = tagsRaw ? tagsRaw.split(/[，,、]/).map(t => t.trim()).filter(Boolean) : [];
      const setDate = !unknown && !!date;
      if (!setDate && !rating && !addTags.length) { App.util.toast('至少填一项再保存'); return; }
      App.util.toast('正在保存…');
      Promise.all(ids.map(id => App.db.getRecord(id).then(r => {
        if (!r) return;
        // 统一时间：追加一条新观看（不覆盖原有）
        if (setDate) {
          const seq = (App.util.entries(r).length || 0) + 1;
          r.entries = r.entries || [];
          r.entries.push({ seq, watchDate: date, rating: rating || 0, review: '', comment: '', quotes: [], dateUnknown: false, dateNote: '' });
        }
        if (unknown) {
          const seq = (App.util.entries(r).length || 0) + 1;
          r.entries = r.entries || [];
          r.entries.push({ seq, watchDate: '', rating: rating || 0, review: '', comment: '', quotes: [], dateUnknown: true, dateNote: '' });
        }
        if (rating) {
          // 写入最新一条观看的评分
          const es = App.util.entries(r);
          if (es.length) es[es.length - 1].rating = rating;
        }
        if (addTags.length) {
          const set = new Set(r.tags || []); addTags.forEach(t => set.add(t));
          r.tags = [...set];
        }
        r.watchDates = App.util.watchDates(r).slice().sort();
        r.rating = App.util.latestRating(r);
        r.updatedAt = Date.now();
        return App.db.saveRecord(r);
      }))).then(() => {
        mask.remove();
        exitMulti();
        return reload();
      }).then(() => { renderFilters(); renderLibrary(); App.util.toast('已批量修改 ' + ids.length + ' 部 ✅'); App.audio.sfx('success'); })
        .catch(() => App.util.toast('批量编辑失败，请重试'));
    };
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  }

  // 长按电影卡片 → 进入多选模式并自动勾选（事件委托，容器只绑一次，避免泄漏）
  function bindLongPressLibrary(root) {
    const box = root.querySelector('#library');
    if (!box || box._lpBound) return;
    box._lpBound = true;
    let timer = null, target = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } target = null; };
    box.addEventListener('touchstart', e => {
      const card = e.target.closest('.movie-card'); if (!card) return;
      target = card; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => {
        timer = null;
        suppressClick = true; // 抑制松手后紧随的 click，避免刚勾选又被取消
        const id = target.dataset.id;
        if (!state.selecting) enterMulti();
        const fresh = box.querySelector('.movie-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
        if (fresh && !state.selSet.has(id)) {
          state.selSet.add(id); fresh.classList.add('sel');
          const ck = fresh.querySelector('.check'); if (ck) ck.classList.add('on');
          updateListBatch();
        }
      }, 480);
    }, { passive: true });
    box.addEventListener('touchmove', e => { if (!timer) return; const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) cancel(); }, { passive: true });
    box.addEventListener('touchend', cancel, { passive: true });
    box.addEventListener('touchcancel', cancel, { passive: true });
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

  return { render, init, reload, quickAdd };
})();
