// 视图：电影库（发现页）—— TMDB 全量片库网格 + 搜索 + 多选批量加入我的电影库
window.App = window.App || {};
App.views = App.views || {};

App.views.discover = (function () {
  let state = { kind: 'popular', genre: null, lang: null, year: null, page: 1, totalPages: 1, query: '', loading: false,
                selecting: false, selected: new Set(), movies: [], records: [], key: '' };
  let scrollBound = false; // 滚动自动加载只绑定一次
  let suppressClick = false; // 长按进入多选后抑制紧随的 click，避免刚勾选又被取消
  let genreCache = null;   // TMDB 类型列表缓存
  let reqSeq = 0;          // 请求序号：只认最后一次请求的结果，防止慢的旧请求覆盖新筛选（"点分类没反应"的真凶）
  let searchSeq = 0;       // 搜索序号：同理，避免上一次搜索结果盖掉这一次

  // 类型兜底表：TMDB 类型接口拉不到时也要能点（否则整条类型栏空白，看着像"点了没反应"）
  const FALLBACK_GENRES = [
    { id: 28, name: '动作' }, { id: 12, name: '冒险' }, { id: 16, name: '动画' },
    { id: 35, name: '喜剧' }, { id: 80, name: '犯罪' }, { id: 99, name: '纪录' },
    { id: 18, name: '剧情' }, { id: 10751, name: '家庭' }, { id: 14, name: '奇幻' },
    { id: 36, name: '历史' }, { id: 27, name: '恐怖' }, { id: 10402, name: '音乐' },
    { id: 9648, name: '悬疑' }, { id: 10749, name: '爱情' }, { id: 878, name: '科幻' },
    { id: 53, name: '惊悚' }, { id: 10752, name: '战争' }, { id: 37, name: '西部' }
  ];

  function posterBlock(poster) {
    if (poster) return `<div class="poster"><img loading="lazy" decoding="async" src="${App.util.escapeHtml(poster)}" onerror="this.parentNode.classList.add('ph');this.remove();" alt=""></div>`;
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
      genres: seed.genres || [], castInfo: [],
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
      if (suppressClick) { suppressClick = false; return; }
      const m = { tmdbId: c.dataset.tmdb, title: c.dataset.title, year: c.dataset.year, poster: c.dataset.poster, overview: c.dataset.over };
      if (state.selecting) {
        if (c.classList.contains('added')) { App.util.toast('这部已在你的电影库'); return; }
        const id = c.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        c.classList.toggle('sel');
        const ck = c.querySelector('.check'); if (ck) ck.classList.toggle('on');
        updateBatch();
      } else {
        openMovie(m);
      }
    });
  }

  function updateBatch() {
    const bar = document.getElementById('batchBar');
    if (!bar) return;
    const c = document.getElementById('selCount');
    if (c) c.textContent = '已选 ' + state.selected.size + ' 部';
    const add = bar.querySelector('#batchAdd');
    if (add) add.style.opacity = state.selected.size ? '1' : '.5';
  }

  // 底部「加载更多 / 加载中 / 失败重试」状态（避免划到一半静默卡死）
  function updateMore() {
    const more = document.getElementById('discMore');
    if (!more) return;
    more.style.display = '';   // 之前失败/搜索时被设成 none，这里必须恢复，否则再也不出现「加载更多」
    if (state.query) { more.innerHTML = ''; return; }
    if (state.page < state.totalPages) {
      more.innerHTML = '<button class="btn sm" id="discLoadMore">加载更多</button>';
      const b = document.getElementById('discLoadMore');
      if (b) b.onclick = () => loadList(state.kind, state.page + 1, true);
    } else {
      more.innerHTML = state.movies.length ? '<span class="muted">已经到底啦 🎬</span>' : '';
    }
  }

  // 骨架屏：点了筛选立刻有反馈，不再"点了像没反应"
  function renderSkeleton() {
    const box = document.getElementById('discGrid');
    if (!box) return;
    let h = '';
    for (let i = 0; i < 8; i++) h += '<div class="movie-card sk"><div class="poster ph"></div><div class="body"><p class="name"></p><div class="meta"><span></span></div></div></div>';
    box.innerHTML = h;
  }

  function loadList(kind, page, append) {
    if (!state.key) { renderMsg('需要 TMDB 密钥才能浏览电影库，去「设置」填写'); return; }
    // 追加时若上一次还在飞，直接忽略，避免同一页被重复拉、page 被搞乱
    if (append && state.loading) return;
    const my = ++reqSeq;          // 本次请求编号
    searchSeq++;                  // 让在飞的搜索结果作废，避免它盖掉筛选结果
    state.loading = true;
    if (!append) { state.query = ''; renderSkeleton(); }
    const more = document.getElementById('discMore');
    if (more) { more.style.display = ''; more.innerHTML = '<span class="muted">加载中…</span>'; }

    App.tmdb.discover({ kind, genre: state.genre, lang: state.lang, year: state.year }, state.key, page)
      .then(data => {
        if (my !== reqSeq) return;       // 已有更新的请求，丢弃这份旧结果
        state.page = data.page; state.totalPages = data.totalPages;
        if (append) {
          // 去重：TMDB「最新」等接口相邻页会重复返回同一部，按 tmdbId 过滤已显示的
          const have = new Set(state.movies.map(m => String(m.tmdbId)));
          const fresh = (data.results || []).filter(m => m.tmdbId && !have.has(String(m.tmdbId)));
          state.movies = state.movies.concat(fresh);
          // 这一页全是重复且还有后续页时，自动往后再取一页，避免"划不动"
          if (!fresh.length && state.page < state.totalPages) {
            state.loading = false;
            loadList(kind, state.page + 1, true);
            return;
          }
        } else {
          state.movies = data.results || [];
        }
        state.loading = false;
        if (!append) resetWall(); else if (wallCards.length) rekeyWall();
        renderGrid();
        updateMore();
      })
      .catch(() => {
        if (my !== reqSeq) return;
        state.loading = false;
        if (!append) {
          renderMsg('这批没加载出来（网络不稳）', () => loadList(kind, 1, false));
        } else {
          // 追加失败：保留已加载内容，给重试入口（不整页清空）
          const m2 = document.getElementById('discMore');
          if (m2) {
            m2.style.display = '';
            m2.innerHTML = '没加载出来，<a class="link" id="discRetry">点此重试</a>';
            const r = document.getElementById('discRetry');
            if (r) r.onclick = () => loadList(state.kind, state.page + 1, true);
          }
        }
      });
  }

  // 空/错误提示，可带重试按钮
  function renderMsg(msg, retry) {
    const box = document.getElementById('discGrid');
    if (box) {
      box.innerHTML = `<div class="empty"><div class="big">🎬</div>${msg}`
        + (retry ? `<div style="margin-top:12px"><button class="btn sm primary" id="discMsgRetry">重新加载</button></div>` : '')
        + `</div>`;
      if (retry) {
        const b = document.getElementById('discMsgRetry');
        if (b) b.onclick = retry;
      }
    }
    const more = document.getElementById('discMore');
    if (more) { more.style.display = ''; more.innerHTML = ''; }
  }

  function doSearch(q) {
    if (!q) { loadList(state.kind, 1, false); return; }
    if (!state.key) { renderMsg('需要 TMDB 密钥才能搜索'); return; }
    const my = ++searchSeq;
    reqSeq++;                 // 让在飞的列表请求作废，别盖掉搜索结果
    state.loading = false;    // 搜索不参与分页，避免把 loading 卡住导致后续都不响应
    renderSkeleton();
    const more = document.getElementById('discMore');
    if (more) { more.style.display = ''; more.innerHTML = '<span class="muted">搜索中…</span>'; }
    App.tmdb.search(q, state.key).then(list => {
      if (my !== searchSeq) return;
      if (!list.length) { renderMsg('没找到「' + App.util.escapeHtml(q) + '」相关的电影'); return; }
      state.movies = list;
      state.page = 1; state.totalPages = 1;
      resetWall();
      renderGrid();
      if (more) more.innerHTML = '';
    }).catch(() => {
      if (my !== searchSeq) return;
      renderMsg('搜索没成功，网络不太稳', () => doSearch(q));
    });
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
      if (seed.tmdbId && state.key) App.tmdb.details(seed.tmdbId, state.key).then(d => { rec.director = d.director || ''; rec.cast = d.cast || []; rec.castInfo = d.castInfo || []; rec.overview = d.overview || rec.overview; rec.year = d.year || seed.year; rec.genres = d.genres || []; finish(rec); }).catch(() => finish(rec));
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
        state.selected.clear();   // 清零已选计数，保持在多选模式继续选择
        updateBatch();
        App.util.toast('已加入 ' + ok + ' 部，继续选择或点「完成」退出 🎉');
        App.audio.sfx('success');
        reload().then(renderGrid);
        return;
      }
      const m = picks[i++];
      const rec = makeRecord(m, { date: '', unknown: false, note: '', rating: 0 });
      const finish = (r) => App.db.saveRecord(r).then(() => { ok++; next(); });
      if (m.tmdbId && state.key) App.tmdb.details(m.tmdbId, state.key).then(d => { rec.director = d.director || ''; rec.cast = d.cast || []; rec.castInfo = d.castInfo || []; rec.overview = d.overview || rec.overview; rec.year = d.year || m.year; rec.genres = d.genres || []; finish(rec); }).catch(() => finish(rec));
      else finish(rec);
    }
    next();
  }

  function enterSelect() {
    state.selecting = true; state.selected.clear();
    const mb = document.getElementById('discMulti'); if (mb) mb.textContent = '完成';
    const bar = document.getElementById('batchBar'); if (bar) bar.hidden = false;
    const fab = document.getElementById('fab'); if (fab) fab.style.display = 'none';
    const wrap = document.getElementById('gfxHero'); if (wrap) wrap.style.display = 'none';
    updateBatch();
    renderGrid();
  }
  function exitSelect() {
    state.selecting = false;
    const mb = document.getElementById('discMulti'); if (mb) mb.textContent = '多选';
    const bar = document.getElementById('batchBar'); if (bar) bar.hidden = true;
    const fab = document.getElementById('fab'); if (fab) fab.style.display = 'flex';
    const wrap = document.getElementById('gfxHero'); if (wrap) wrap.style.display = '';
    renderGrid();
  }

  // 地区（按原声语言近似）与年份选项
  const LANGS = [
    ['zh', '中国'], ['en', '美国'], ['ja', '日本'], ['ko', '韩国'],
    ['fr', '法国'], ['de', '德国'], ['it', '意大利'], ['es', '西班牙'],
    ['ru', '俄罗斯'], ['hi', '印度'], ['th', '泰国'], ['pt', '巴西'],
    ['tr', '土耳其'], ['id', '印尼'], ['vi', '越南'], ['ar', '阿拉伯']
  ];
  const LANG_OTHER = 'other'; // 其他语种（TMDB 侧映射一组非主流语种）

  function filterChip(active, key, val, label) {
    return `<span class="chip ${active ? 'active' : ''}" data-${key}="${val}">${label}</span>`;
  }

  // 筛选点击统一入口：先刷新选中态（立刻有反馈），再发请求
  function applyFilter(root) {
    paintFilters(root);
    resetFiltersAndLoad(root);
  }

  function paintFilters(root) {
    // 类型栏：同步先用「缓存 / 兜底表」画出来，保证一定能点；随后再静默拉官方中文名刷新
    const gbar = root.querySelector('#discGenres');
    if (gbar) {
      const gs = genreCache || FALLBACK_GENRES;
      gbar.innerHTML = `<span class="f-label">类型</span>` + filterChip(!state.genre, 'g', '', '全部')
        + gs.slice(0, 18).map(g => filterChip(String(state.genre) === String(g.id), 'g', g.id, App.util.escapeHtml(g.name))).join('');
      gbar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
        const v = c.dataset.g;
        state.genre = v ? ((String(state.genre) === v) ? null : v) : null;
        applyFilter(root);
      });
      if (!genreCache && state.key) {
        App.tmdb.genres(state.key).then(list => {
          if (!list || !list.length) return;
          genreCache = list;
          if (document.body.contains(gbar)) paintFilters(root); // 只刷新文案，不重新请求列表
        }).catch(() => {});
      }
    }
    // 地区栏
    const lbar = root.querySelector('#discLangs');
    if (lbar) {
      lbar.innerHTML = `<span class="f-label">地区</span>` + filterChip(!state.lang, 'l', '', '全部')
        + LANGS.map(([v, n]) => filterChip(state.lang === v, 'l', v, n)).join('')
        + filterChip(state.lang === LANG_OTHER, 'l', LANG_OTHER, '其他');
      lbar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
        const v = c.dataset.l;
        state.lang = v ? (state.lang === v ? null : v) : null;
        applyFilter(root);
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
        applyFilter(root);
      });
    }
  }

  function resetFiltersAndLoad(root) {
    state.query = '';
    const inp = root.querySelector('#discSearch'); if (inp) inp.value = '';
    const clr = root.querySelector('#discClear'); if (clr) clr.style.display = 'none';
    state.loading = false;          // 上一次可能没 settle，别让它把新请求挡住
    loadList(state.kind, 1, false);
  }

  // ===== 旋转海报墙 v2（环形容器 + transform 滑动，零 DOM 重建、无限循环、可拖拽） =====
  const WALL_STEP = 84, WALL_N = 7, WALL_MID = 3;
  let wallIdx = 0, wallTimer = null, wallCards = [], wallRing = null, wallBusy = false;
  let wallDrag = { on: false, x0: 0, dx: 0, t0: 0, moved: false };
  let wallTimer2 = null, wallCollapsed = false, heroEl = null, wallSuppressClick = false;
  let collapseBound = false, ticking = false;
  let wallWinBound = false;   // window 级拖拽监听只绑一次，避免反复进入页面越绑越多

  const wMod = (i, n) => ((i % n) + n) % n;

  function cardT(slot) {
    const d = Math.abs(slot);
    // 顺序：先水平平移排开，再绕自身 Y 轴旋转 → 两侧卡片水平排列不跑弧线
    return `rotateY(${-slot * 24}deg) translateX(${slot * WALL_STEP}px) scale(${(1 - d * 0.13).toFixed(3)})`;
  }
  function applyVisual(card, slot) {
    const d = Math.abs(slot);
    card.style.transform = cardT(slot);
    card.style.opacity = (1 - d * 0.22).toFixed(2);
    card.style.zIndex = slot === 0 ? 20 : 20 - d * 6;
  }
  // 预渲染固定 7 张卡片（环），之后只换内容 + 平移 transform
  function ensureRing(root) {
    const wall = root.querySelector('#gfxWall');
    if (!wall) return null;
    if (wall._ready) return wall;
    wall._ready = true;
    wall.innerHTML = '';
    wallCards = [];
    for (let k = 0; k < WALL_N; k++) {
      const c = document.createElement('div');
      c.className = 'gfx-card';
      c.innerHTML = '<img alt=""><div class="gfx-ph" hidden>🎬</div><span class="added-badge" hidden>已加入</span>';
      applyVisual(c, k - WALL_MID);
      wall.appendChild(c);
      wallCards.push(c);
    }
    wallRing = wall;
    return wall;
  }

  function setCard(card, m, slot) {
    const img = card.querySelector('img');
    const ph = card.querySelector('.gfx-ph');
    const badge = card.querySelector('.added-badge');
    card.dataset.tmdb = m.tmdbId;
    card.classList.toggle('cur', slot === 0);
    if (m.poster) {
      img.src = m.poster;
      img.hidden = false;
      ph.hidden = true;
      img.onerror = () => { img.hidden = true; ph.hidden = false; };
    } else {
      img.hidden = true;
      ph.hidden = false;
    }
    badge.hidden = !inLibrary(m);
  }

  // 重排环（无过渡）：把内容对齐到当前 wallIdx（静止态）。先禁用卡片过渡，改完强制 reflow
  // 提交"无过渡"样式后再恢复 → 位置/内容同步换，不会触发第二次滑动（v2 横跳的根因）
  function rekeyWall() {
    const n = state.movies.length;
    if (!n) { if (wallCards) wallCards.forEach(c => c.style.display = 'none'); updateMeta(null); return; }
    wallIdx = wMod(wallIdx, n);
    wallCards.forEach((c, k) => c.style.display = '');
    wallCards.forEach(c => c.style.transition = 'none');
    wallCards.forEach((card, k) => {
      const slot = k - WALL_MID;
      const m = state.movies[wMod(wallIdx + slot, n)];
      setCard(card, m, slot);
      applyVisual(card, slot);
    });
    if (wallRing) void wallRing.offsetHeight; // 强制 reflow，让"无过渡"的 transform 立即生效
    wallCards.forEach(c => c.style.transition = '');
    updateMeta(state.movies[wallIdx]);
    // 预加载相邻海报，切换零白屏
    [1, -1, 2, -2].forEach(off => {
      const im = new Image();
      const p = state.movies[wMod(wallIdx + off, n)].poster;
      if (p) im.src = p;
    });
  }

  function updateMeta(m) {
    const box = document.getElementById('gfxMeta');
    if (!box) return;
    if (!m) { box.innerHTML = ''; return; }
    const t = box.querySelector('#gfxTitle');
    if (t) t.textContent = m.title;
    const y = box.querySelector('#gfxYear');
    if (y) y.textContent = m.year || '';
    const a = box.querySelector('#gfxAdded');
    if (a) a.style.display = inLibrary(m) ? '' : 'none';
    const c = box.querySelector('#gfxCount');
    if (c && state.movies.length) c.textContent = (wMod(wallIdx, state.movies.length) + 1) + '/' + state.movies.length;
  }

  function clearSettle() { if (wallTimer2) { clearTimeout(wallTimer2); wallTimer2 = null; } }

  function openMovie(m) {
    if (!m) return;
    if (inLibrary(m)) {
      const rec = state.records.find(r => String(r.tmdbId) === String(m.tmdbId));
      if (rec) { App.audio && App.audio.sfx('click'); App.router.go('#/detail/' + rec.id); return; }
    }
    quickAdd(m);
  }

  // 翻一页：每张卡片各自滑到相邻位置（旋转木马感），动画结束后无过渡重排（视觉无缝）
  function stepWall(dir) {
    const n = state.movies.length;
    if (!n || wallBusy || wallCollapsed || wallDrag.on) return;
    wallBusy = true;
    wallCards.forEach((card, k) => applyVisual(card, k - WALL_MID - dir));
    clearSettle();
    wallTimer2 = setTimeout(() => {
      wallBusy = false;
      wallIdx = wMod(wallIdx + dir, n); // 动画结束才推进索引
      rekeyWall();
    }, 480);
  }

  function jumpTo(idx) {
    const n = state.movies.length;
    if (!n || wallBusy) return;
    wallIdx = wMod(idx, n);
    clearSettle();
    wallRing.style.transition = '';
    wallRing.style.transform = '';
    rekeyWall();
  }

  function resetWall() {
    wallIdx = 0;
    clearSettle();
    if (wallRing) { wallRing.style.transition = ''; wallRing.style.transform = ''; }
    if (wallCards.length) rekeyWall();
  }

  function stopWallAuto() { if (wallTimer) { clearInterval(wallTimer); wallTimer = null; } clearSettle(); }

  function startWallAuto() {
    stopWallAuto();
    const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rm && rm.matches) return; // 减弱动效：只手动
    wallTimer = setInterval(() => {
      if (!document.getElementById('gfxWall')) { stopWallAuto(); return; }
      if (wallCollapsed || wallBusy || wallDrag.on) return;
      stepWall(1);
    }, 3500);
  }

  // 丝滑拖拽：触摸 + 鼠标都支持，跟手（无过渡 transform），松手按位移/速度翻页
  function bindWallDrag(root) {
    const wall = root.querySelector('#gfxWall');
    if (!wall || wall._dragBound) return;
    wall._dragBound = true;
    function start(x) {
      if (!wallCards.length) return;
      stopWallAuto(); clearSettle(); wallBusy = false;
      rekeyWall(); // 若上一轮动画被打断，先把卡片无过渡归位对齐，避免跟手时错位
      wallDrag.on = true; wallDrag.x0 = x; wallDrag.dx = 0; wallDrag.t0 = Date.now(); wallDrag.moved = false;
      wallRing.style.transition = ''; // 跟手阶段无过渡
      wallRing.classList.add('dragging');
    }
    function move(x) {
      if (!wallDrag.on) return;
      wallDrag.dx = x - wallDrag.x0;
      if (!wallDrag.moved && Math.abs(wallDrag.dx) > 5) wallDrag.moved = true;
      wallRing.style.transform = 'translateX(' + wallDrag.dx + 'px)';
    }
    function end() {
      if (!wallDrag.on) return;
      wallDrag.on = false;
      wallRing.classList.remove('dragging');
      if (wallDrag.moved) wallSuppressClick = true; // 拖完本次点击不触发打开
      const moved = wallDrag.moved;
      const dt = Math.max(1, Date.now() - wallDrag.t0);
      const spd = Math.abs(wallDrag.dx) / dt;
      let dir = 0;
      if (wallDrag.dx > 55 || (moved && spd > 0.5 && wallDrag.dx > 0)) dir = -1;
      else if (wallDrag.dx < -55 || (moved && spd > 0.5 && wallDrag.dx < 0)) dir = 1;
      wallDrag.moved = false;
      if (dir) {
        const n = state.movies.length;
        // 容器带过渡回 0（回弹跟手位移），同时每张卡片各自滑到相邻位置 → 净效果连续
        wallRing.style.transition = 'transform .3s ease';
        wallRing.style.transform = '';
        wallCards.forEach((card, k) => applyVisual(card, k - WALL_MID - dir));
        clearSettle();
        wallTimer2 = setTimeout(() => {
          wallBusy = false;
          wallRing.style.transition = '';
          wallIdx = wMod(wallIdx + dir, n);
          rekeyWall();
        }, 480);
      } else {
        wallRing.style.transition = 'transform .3s ease';
        wallRing.style.transform = '';
        setTimeout(() => { wallRing.style.transition = ''; }, 320);
      }
      setTimeout(startWallAuto, 700);
    }
    wall.addEventListener('touchstart', e => { if (e.touches[0]) start(e.touches[0].clientX); }, { passive: true });
    wall.addEventListener('touchmove', e => { if (wallDrag.on && e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    wall.addEventListener('touchend', end, { passive: true });
    wall.addEventListener('touchcancel', end, { passive: true });
    wall.addEventListener('mousedown', e => { if (e.button === 0) { e.preventDefault(); start(e.clientX); } });
    // window 上的监听只能绑一次：海报墙每次进页面都是新元素，若跟着重复绑会越攒越多、页面越用越卡
    if (!wallWinBound) {
      wallWinBound = true;
      window.addEventListener('mousemove', e => { if (wallDrag.on) move(e.clientX); }, { passive: true });
      window.addEventListener('mouseup', () => { if (wallDrag.on) end(); });
    }
    // 点击：中间海报=打开；两侧海报=跳转
    wall.addEventListener('click', e => {
      if (wallSuppressClick) { wallSuppressClick = false; return; }
      if (wallDrag.moved) return;
      const card = e.target.closest('.gfx-card');
      if (!card || !state.movies.length) return;
      const m = state.movies.find(x => String(x.tmdbId) === card.dataset.tmdb);
      if (!m) return;
      const idx = state.movies.indexOf(m);
      if (idx === wMod(wallIdx, state.movies.length)) { openMovie(m); return; }
      jumpTo(idx);
    });
  }

  // ===== 可折叠海报墙：下滑>50px 收起，回到顶部再下拉(>60px)展开 =====
  function expandWall() {
    if (!wallCollapsed) return;
    wallCollapsed = false;
    if (heroEl) heroEl.classList.remove('wall-collapsed');
    startWallAuto();
  }

  function bindCollapse(root) {
    heroEl = root.querySelector('#gfxHero');
    if (!heroEl || collapseBound) return;
    collapseBound = true;
    const onScroll = () => {
      if (window.scrollY > 50 && !wallCollapsed) {
        wallCollapsed = true;
        heroEl.classList.add('wall-collapsed');
        stopWallAuto();
      }
    };
    const rafScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; onScroll(); });
    };
    window.addEventListener('scroll', rafScroll, { passive: true });
    // 顶部下拉展开（触摸：竖直意图且 scrollY==0）
    let tY0 = null;
    window.addEventListener('touchstart', e => { if (window.scrollY === 0) tY0 = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', e => {
      if (wallCollapsed && window.scrollY === 0 && tY0 != null && e.touches[0]) {
        const dy = e.touches[0].clientY - tY0;
        if (dy > 60) expandWall();
      }
    }, { passive: true });
    window.addEventListener('touchend', () => { tY0 = null; }, { passive: true });
    // 鼠标滚轮向上
    window.addEventListener('wheel', e => {
      if (wallCollapsed && window.scrollY === 0 && e.deltaY < -60) expandWall();
    }, { passive: true });
  }

  function render(param, root) {
    const kindName = { popular: '热门', now_playing: '最新', top_rated: '高分' };
    root.innerHTML = `
      <div class="view-block search-wrap">
        <div class="search-bar">
          <span class="ico">🔍</span>
          <input id="discSearch" type="text" placeholder="搜电影名…">
          <span class="search-clear" id="discClear" style="display:none">✕</span>
        </div>
      </div>
      <div class="gfx-hero" id="gfxHero">
        <div class="gfx-wall-wrap" id="gfxWallWrap"><div class="gfx-wall" id="gfxWall"></div></div>
        <div class="gfx-meta" id="gfxMeta">
          <div class="gfx-title" id="gfxTitle"></div>
          <div class="gfx-subrow">
            <button class="gfx-arr" id="gfxPrev" title="上一部">‹</button>
            <span id="gfxYear"></span>
            <span class="gfx-added" id="gfxAdded" style="display:none">已加入 ✓</span>
            <span id="gfxCount"></span>
            <button class="gfx-arr" id="gfxNext" title="下一部">›</button>
          </div>
        </div>
      </div>
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
      <div class="view-block" style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 8px">
        <div class="section-title" style="margin:0">电影库 <span class="hint" id="discKindHint">${state.query ? '搜索结果' : kindName[state.kind]}</span></div>
        <button class="btn sm" id="discMulti">多选</button>
      </div>
      <div id="discGrid" class="movie-grid discover"></div>
      <div id="discMore" class="disc-more"></div>
      <div id="batchBar" class="fab-select" hidden>
        <span class="sel-count" id="selCount">已选 0 部</span>
        <button class="btn primary fab-add" id="batchAdd">添加</button>
      </div>`;

    root.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
      state.kind = b.dataset.kind;
      root.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
      const hint = root.querySelector('#discKindHint');
      if (hint) hint.textContent = kindName[state.kind] || '';
      resetFiltersAndLoad(root);   // 会清搜索框、解掉可能卡住的 loading，再重新拉第一页
    });
    const input = root.querySelector('#discSearch');
    input.oninput = debounce((e) => {
      state.query = e.target.value.trim();
      root.querySelector('#discClear').style.display = state.query ? 'block' : 'none';
      doSearch(state.query);
    }, 400);
    root.querySelector('#discClear').onclick = () => { input.value = ''; state.query = ''; root.querySelector('#discClear').style.display = 'none'; loadList(state.kind, 1, false); };
    root.querySelector('#discMulti').onclick = () => { if (state.selecting) exitSelect(); else enterSelect(); };
    root.querySelector('#batchAdd').onclick = () => batchAdd();
    // 筛选栏：类型（含「全部」）/ 地区 / 年份
    paintFilters(root);
    // 海报墙：预渲染环 + 拖拽 + 可折叠 + 自动轮播
    ensureRing(root);
    bindWallDrag(root);
    bindCollapse(root);
    root.querySelector('#gfxPrev').onclick = () => { if (!wallBusy) stepWall(-1); };
    root.querySelector('#gfxNext').onclick = () => { if (!wallBusy) stepWall(1); };
    startWallAuto();
    // 本页为浅色沉浸（覆盖路由设置的深色状态栏色）
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', '#f5fbf9');

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

    bindLongPressGrid(root);
    loadList(state.kind, 1, false);
  }

  // 长按电影卡片 → 进入多选模式并自动勾选（事件委托，容器只绑一次，避免泄漏）
  function bindLongPressGrid(root) {
    const box = root.querySelector('#discGrid');
    if (!box || box._lpBound) return;
    box._lpBound = true;
    let timer = null, target = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } target = null; };
    box.addEventListener('touchstart', e => {
      const card = e.target.closest('.movie-card.disc'); if (!card) return;
      target = card; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => {
        timer = null;
        suppressClick = true; // 抑制松手后紧随的 click，避免刚勾选又被取消
        const id = target.dataset.id;
        if (!state.selecting) enterSelect();
        const fresh = box.querySelector('.movie-card.disc[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
        if (fresh && fresh.classList.contains('added')) { App.util.toast('这部已在你的电影库'); return; }
        if (fresh && !state.selected.has(id)) {
          state.selected.add(id); fresh.classList.add('sel');
          const ck = fresh.querySelector('.check'); if (ck) ck.classList.add('on');
          updateBatch();
        }
      }, 480);
    }, { passive: true });
    box.addEventListener('touchmove', e => { if (!timer) return; const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) cancel(); }, { passive: true });
    box.addEventListener('touchend', cancel, { passive: true });
    box.addEventListener('touchcancel', cancel, { passive: true });
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
