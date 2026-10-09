// 工具层：uuid / 日期 / 图片压缩 / 导出导入 / toast
window.App = window.App || {};
App.util = (function () {
  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtDate(s) {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function starsHtml(rating, scale) {
    scale = scale || 5;
    // 5分制一星一分；10分制每2分一星；支持小数（4.5 → 亮4星半）
    const v = scale === 10 ? (rating || 0) / 2 : (rating || 0);
    const pct = Math.max(0, Math.min(5, v)) / 5 * 100;
    return `<span class="rate" style="--r:${pct.toFixed(1)}%"><span class="rb">★★★★★</span><span class="rf">★★★★★</span></span>`;
  }

  // 数字评分（如 8.5）：卡片上替代长串星星，不挤压文字
  function ratingText(rating) {
    const r = Number(rating || 0);
    if (!r) return '';
    return r.toFixed(1);
  }

  // 短日期：2026-08-03 → 2026.8.3（去前导零），用于卡片紧凑展示
  function dateShort(s) {
    if (!s) return '';
    const parts = String(s).split('-');
    if (parts.length < 3) return s;
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    return `${y}.${m}.${d}`;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1900);
  }

  // 前端压缩图片：缩到 maxW 宽，JPEG 质量 q，返回 Blob
  function compressImage(file, maxW = 1200, q = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('compress failed')), 'image/jpeg', q);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(dataURL) {
    const [head, body] = dataURL.split(',');
    const mime = head.match(/:(.*?);/)[1];
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // 导出全部数据为 JSON（截图转 base64 内嵌，单文件备份）
  function exportAll() {
    return Promise.all([App.db.getRecords(), App.db.getAllScreenshots()]).then(([records, shots]) => {
      return Promise.all(shots.map(s => blobToDataURL(s.blob).then(d => ({ ...s, dataURL: d }))))
        .then(shotsWithData => {
          const payload = {
            app: 'movie-diary', version: 1,
            exportedAt: new Date().toISOString(),
            records, screenshots: shotsWithData.map(({ blob, ...rest }) => rest)
          };
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `观影手记备份_${today()}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast('已导出备份');
        });
    });
  }

  // 导入：先自动备份当前数据，再覆盖写入
  async function importAll(file) {
    let text;
    try { text = await file.text(); } catch (e) { toast('读取文件失败'); return; }
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('文件不是合法 JSON'); return; }
    if (!data.records) { toast('文件格式不正确'); return; }
    const cur = await App.db.getRecords();
    if (cur.length) {
      // 自动备份当前数据
      const shots = await App.db.getAllScreenshots();
      const sd = await blobToDataURLAll(shots);
      const backup = { app: 'movie-diary', version: 1, records: cur, screenshots: sd };
      const b = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = `导入前自动备份_${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    // 清空再写入
    const db = await App.db.open();
    await new Promise((res, rej) => {
      const t = db.transaction(['records', 'screenshots'], 'readwrite');
      t.objectStore('records').clear();
      t.objectStore('screenshots').clear();
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    const shotList = (data.screenshots || []).map(s => ({ ...s, blob: dataURLToBlob(s.dataURL) }));
    await Promise.all(data.records.map(r => App.db.saveRecord(r)));
    await Promise.all(shotList.map(s => App.db.saveScreenshot(s)));
    toast('导入成功');
    location.hash = '#/list';
    location.reload();
  }
  function blobToDataURLAll(shots) {
    return Promise.all(shots.map(s => blobToDataURL(s.blob).then(d => ({ ...s, dataURL: d }))))
      .then(list => list.map(({ blob, ...rest }) => rest));
  }

  // 观影时间：兼容旧数据（只有 watchedDate）、新数据（watchDates 数组）、以及只有 entries 的情况
  function watchDates(rec) {
    if (rec && Array.isArray(rec.watchDates) && rec.watchDates.length) return rec.watchDates;
    if (rec && Array.isArray(rec.entries) && rec.entries.length) return rec.entries.map(e => e.watchDate).filter(Boolean);
    return rec && rec.watchedDate ? [rec.watchedDate] : [];
  }
  function latestWatch(rec) {
    const a = watchDates(rec);
    return a.slice().sort().reverse()[0] || '';
  }
  function firstWatch(rec) {
    const a = watchDates(rec);
    return a.slice().sort()[0] || '';
  }
  function watchCount(rec) { return entries(rec).length; }

  // 单次观看的日期展示：记不清时显示备注或「记不清了」
  function fmtEntryDate(e) {
    if (!e) return '';
    if (e.dateUnknown) return (e.dateNote && String(e.dateNote).trim()) ? String(e.dateNote).trim() : '记不清了';
    return fmtDate(e.watchDate);
  }
  // 电影卡片上的日期：优先显示最近一次已知日期，否则若含「记不清」观看则显示「记不清了」
  function movieDateLabel(rec) {
    const lw = latestWatch(rec);
    if (lw) return fmtDate(lw);
    if (entries(rec).some(e => e.dateUnknown)) return '记不清了';
    return '';
  }

  // 按次观影 entries 的辅助函数
  function entries(rec) { return (rec && Array.isArray(rec.entries)) ? rec.entries : []; }
  function entryBySeq(rec, seq) { return entries(rec).find(e => e.seq === seq) || null; }
  function latestEntry(rec) {
    const es = entries(rec);
    if (!es.length) return null;
    return es.slice().sort((a, b) => (b.watchDate || '').localeCompare(a.watchDate || ''))[0];
  }
  function latestRating(rec) { const e = latestEntry(rec); return e ? (e.rating || 0) : 0; }
  function entryLabel(seq) {
    const map = { 1: '首刷', 2: '二刷', 3: '三刷', 4: '四刷', 5: '五刷', 6: '六刷', 7: '七刷', 8: '八刷', 9: '九刷' };
    return map[seq] || (seq + '刷');
  }
  // 评论区：兼容旧 comment 单条字符串，统一返回数组（支持多条评论）
  function eComments(e) {
    if (!e) return [];
    if (Array.isArray(e.comments)) return e.comments;
    if (e.comment && String(e.comment).trim()) return [{ text: e.comment, ts: Date.now() }];
    return [];
  }
  function eReason(e) { return (e && e.ratingReason) || ''; }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 由搜索结果 / 海报墙 / 卡片等构造一条观影记录（默认首刷日=今天，评分 0，可在 modal 里改）
  function makeRecord(seed, opts) {
    opts = opts || {};
    const date = opts.date, unknown = opts.unknown, note = opts.note, rating = opts.rating || 0;
    return {
      id: uid(),
      watchDates: date ? [date] : [],
      title: seed.title || '未命名',
      posterUrl: seed.poster || seed.posterUrl || '',
      overview: seed.overview || '',
      director: '', cast: [], castInfo: [], rating: rating,
      review: '', comment: '', tags: [], quotes: [],
      tmdbId: seed.tmdbId || '',
      year: seed.year || '',
      genres: seed.genres || [],
      mediaType: opts.mediaType || 'movie',
      tv: opts.tv || null,
      entries: [{ seq: 1, watchDate: date, rating: rating, review: '', comment: '', quotes: [], dateUnknown: unknown, dateNote: unknown ? note : '' }],
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  // 一键入库（搜索下拉的「＋」按钮等）：直接保存 + 提示 + 音效，不弹 modal。
  // opts: { tmdbId, title, poster, year, genres, overview, alreadyInLibrary(seed)->bool,
  //         key, enrich, onDone(id), onAlready() }
  function addToLibrary(opts) {
    opts = opts || {};
    const seed = { tmdbId: opts.tmdbId, title: opts.title, poster: opts.poster, year: opts.year, genres: opts.genres, overview: opts.overview };
    if (typeof opts.alreadyInLibrary === 'function' && opts.alreadyInLibrary(seed)) {
      toast('这部已在你的电影库');
      if (opts.onAlready) opts.onAlready();
      return Promise.resolve(null);
    }
    const rec = makeRecord(seed, { date: today(), unknown: false, rating: 0, mediaType: opts.mediaType, tv: opts.tv });
    const finish = (r) => {
      const saved = (App.db && App.db.saveRecord) ? App.db.saveRecord(r) : Promise.reject(new Error('NO_DB'));
      return saved.then(() => {
        toast('已加入影音库');
        if (App.audio && App.audio.sfx) App.audio.sfx('success');
        if (opts.onDone) opts.onDone(r.id);
        return r.id;
      });
    };
    // 联网补全导演/演员（失败时也能正常入库）
    if (opts.enrich && opts.tmdbId && opts.key) {
      return App.tmdb.details(opts.tmdbId, opts.key)
        .then(d => {
          rec.director = d.director || ''; rec.cast = d.cast || []; rec.castInfo = d.castInfo || [];
          rec.overview = d.overview || rec.overview; rec.year = d.year || seed.year; rec.genres = d.genres || [];
          return finish(rec);
        })
        .catch(() => finish(rec));
    }
    return finish(rec);
  }

  // 剧集进度辅助：返回某季的集数（优先用 seasons 明细，否则用全剧总集数）
  function tvSeasonEpisodes(rec) {
    const t = (rec && rec.tv) || {};
    if (t.seasons && t.seasons.length) {
      const f = t.seasons.find(x => x.s === (t.season || 1));
      if (f && f.n) return f.n;
    }
    return t.totalEpisodes || 0;
  }
  // 详情页整句进度（如「看到 第1季 第5集 / 共12集 · 已看完」）
  function tvLabel(rec) {
    if (!rec || rec.mediaType !== 'tv' || !rec.tv) return '';
    const t = rec.tv, s = t.season || 1, e = t.episode || 0;
    const max = tvSeasonEpisodes(rec);
    let out = '看到 第' + s + '季 第' + e + '集';
    if (t.timeInEpisode) out += ' · ' + t.timeInEpisode;
    if (max) out += ' / 共' + max + '集';
    if (t.completed) out += ' · 已看完';
    return out;
  }
  // 列表卡片紧凑标识：S1E5；未开始则 想看
  function tvCardMeta(rec) {
    if (!rec || rec.mediaType !== 'tv' || !rec.tv) return '';
    const t = rec.tv, s = t.season || 1, e = t.episode || 0;
    return e ? ('S' + s + 'E' + e) : '想看';
  }
  function tvCompleted(rec) { return !!(rec && rec.mediaType === 'tv' && rec.tv && rec.tv.completed); }
  function isTv(rec) { return !!(rec && rec.mediaType === 'tv'); }

  // ===== 剧集状态 / 进度（封面不再放文字角标，状态改由分类 + 卡片内一行展示）=====
  // 状态：'watched'（看过/已看完）| 'watching'（在看）| 'want'（想看）
  function tvStatus(rec) {
    if (!isTv(rec)) return '';
    const t = rec.tv || {};
    if (t.completed) return 'watched';
    if ((t.episode || 0) > 0) return 'watching';
    return 'want';
  }
  // 在看进度文字：第5集 · 13:12（有总集数再补 /共12集）
  function tvProgressText(rec) {
    if (!isTv(rec)) return '';
    const t = rec.tv || {};
    const e = t.episode || 0;
    const total = tvSeasonEpisodes(rec);
    let out = '第' + e + '集';
    if (t.timeInEpisode) out += ' · ' + t.timeInEpisode;
    if (total) out += ' / 共' + total + '集';
    return out;
  }
  // 在看进度百分比（0-100），无总集数返回 null
  function tvProgressPct(rec) {
    const t = (rec && rec.tv) || {};
    const total = tvSeasonEpisodes(rec);
    if (!total) return null;
    return Math.max(0, Math.min(100, Math.round(((t.episode || 0) / total) * 100)));
  }

  // ===== 统一图标（描边 SVG，随 currentColor 变色，替代 emoji；风格与底部导航一致）=====
  const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.8 16.8 21 21"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8 4v16M16 4v16M3 9h5M16 9h5M3 15h5M16 15h5"/>',
    tv: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="m8.5 3 3.5 3.5L15.5 3"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.3 12.4 2.6 2.6 4.8-5.4"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
    trend: '<path d="M4 15.5 9.5 10l3.5 3.5L20 6.5"/><path d="M20 6.5v4.5M20 6.5h-4.5"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"/>',
    heart: '<path d="M12 20.3S4.5 15.6 4.5 10.4A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7.5 2.8c0 5.2-7.5 9.9-7.5 9.9z"/>',
    pencil: '<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5 17.5 10.5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    chat: '<path d="M20 12a7.5 7.5 0 0 1-10.7 6.8L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z"/>',
    send: '<path d="M5 12h13"/><path d="m12 5 7 7-7 7"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c0-3.7 3.1-5.8 7-5.8s7 2.1 7 5.8"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 .3 8.5z"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.6 2h8.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4"/><circle cx="9.2" cy="13.5" r="1"/><circle cx="14.8" cy="13.5" r="1"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/>',
    key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21l-2 2"/><path d="M17 12v3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    prev: '<path d="M15 5 8 12l7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
    loop: '<path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 6.9 4"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-6.9-4"/><path d="M4 20v-4h4"/>',
    shuffle: '<path d="M4 7h4l8 10h4"/><path d="M4 17h4l8-10h4"/><path d="M17 4l3 3-3 3M17 14l3 3-3 3"/>',
  };
  function icon(name, opts) {
    opts = opts || {};
    const p = ICON_PATHS[name] || '';
    const sz = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
    const st = opts.size ? ` style="width:${opts.size}px;height:${opts.size}px"` : '';
    return `<svg class="ico${opts.cls ? ' ' + opts.cls : ''}" viewBox="0 0 24 24"${sz}${st} fill="none" stroke="currentColor" stroke-width="${opts.sw || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }

  return { uid, today, fmtDate, escapeHtml, starsHtml, ratingText, dateShort, toast,
           compressImage, blobToDataURL, dataURLToBlob, exportAll, importAll,
           watchDates, latestWatch, firstWatch, watchCount,
           entries, entryBySeq, latestEntry, latestRating, entryLabel,
           fmtEntryDate, movieDateLabel, eComments, eReason, fmtTime,
           makeRecord, addToLibrary,
           tvSeasonEpisodes, tvLabel, tvCardMeta, tvCompleted, isTv,
           tvStatus, tvProgressText, tvProgressPct, icon };
})();
