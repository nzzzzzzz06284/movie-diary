// 视图：电影详情 —— 观看记录选择器 + 分栏（按次展示：观影感受 / 喜欢的台词 / 最美定格 / 评论区）
window.App = window.App || {};
App.views = App.views || {};

App.views.detail = (function () {
  let rec = null;
  let shots = [];
  let curTab = 'feel';
  let curSeq = null;
  let objUrls = [];

  function clearUrls() { objUrls.forEach(u => URL.revokeObjectURL(u)); objUrls = []; }
  function url(blob) { const u = URL.createObjectURL(blob); objUrls.push(u); return u; }

  async function reload(id) {
    clearUrls();
    rec = await App.db.getRecord(id);
    shots = rec ? await App.db.getScreenshots(id) : [];
    if (!rec) throw new Error('找不到这部电影');
    if (!curSeq || !App.util.entryBySeq(rec, curSeq)) {
      const le = App.util.latestEntry(rec);
      curSeq = le ? le.seq : 1;
    }
  }

  function hero() {
    const poster = rec.posterUrl
      ? `<img src="${App.util.escapeHtml(rec.posterUrl)}" onerror="this.parentNode.classList.add('ph');this.remove();" alt="">`
      : '🎬';
    const tagHtml = (rec.tags || []).length ? `<div class="chips" style="margin-top:6px">${rec.tags.map(t => `<span class="chip tag">${App.util.escapeHtml(t)}</span>`).join('')}</div>` : '';
    const meta = [rec.director ? '导演 ' + rec.director : '', (rec.cast || []).length ? '主演 ' + rec.cast.join('、') : ''].filter(Boolean).join('　');
    const es = App.util.entries(rec);
    const sorted = es.slice().sort((a, b) => (a.watchDate || '').localeCompare(b.watchDate || ''));
    const count = es.length;
    const recent = App.util.latestWatch(rec);
    const watchChips = sorted.map(e =>
      `<span class="chip watch-chip ${e.seq === curSeq ? 'active' : ''}" data-seq="${e.seq}">${App.util.entryLabel(e.seq)} · ${App.util.fmtDate(e.watchDate)}</span>`).join('')
      + `<span class="chip add" id="rewatchBtn">🔁 又看一遍</span>`;
    return `
      <div class="detail-hero">
        <div class="poster ${rec.posterUrl ? '' : 'ph'}">${poster}</div>
        <div class="dh-info">
          <h2>${App.util.escapeHtml(rec.title)}</h2>
          <div class="date">📅 ${count > 1 ? '看了 ' + count + ' 次 · 最近 ' + App.util.fmtDate(recent) : App.util.fmtDate(recent)}</div>
          ${App.util.latestRating(rec) ? '<div>' + App.util.starsHtml(App.util.latestRating(rec), 5) + '</div>' : ''}
          ${tagHtml}
          ${meta ? `<div class="muted" style="margin-top:6px;font-size:12.5px">${App.util.escapeHtml(meta)}</div>` : ''}
        </div>
      </div>
      ${rec.overview ? `<div class="detail-hero" style="margin-top:-4px"><div class="overview">${App.util.escapeHtml(rec.overview)}</div></div>` : ''}
      <div style="display:flex;gap:10px;margin:10px 0 4px;flex-wrap:wrap">
        <button class="btn sm" id="editBtn">✏️ 编辑资料</button>
        <button class="btn sm danger" id="delBtn">🗑 删除</button>
      </div>
      <div class="watch-select">
        <div class="section-title">📌 观看记录 <span class="hint">${count} 次 · 点选不同次</span></div>
        <div class="chips" id="watchChips">${watchChips}</div>
      </div>
      <div class="subtabs" id="subtabs">
        <button data-t="feel" class="${curTab === 'feel' ? 'active' : ''}">观影感受</button>
        <button data-t="quote" class="${curTab === 'quote' ? 'active' : ''}">喜欢的台词</button>
        <button data-t="shot" class="${curTab === 'shot' ? 'active' : ''}">最美定格</button>
        <button data-t="comment" class="${curTab === 'comment' ? 'active' : ''}">评论区</button>
      </div>
      <div id="panel" class="panel"></div>`;
  }

  function starPicker(elId, current) {
    let r = current || 0;
    const box = document.getElementById(elId);
    function paint() {
      box.innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="s ${i <= r ? 'on' : ''}" data-i="${i}">★</span>`).join('');
      box.querySelectorAll('.s').forEach(s => s.onclick = () => { r = +s.dataset.i; paint(); });
    }
    paint();
    return () => r;
  }

  function saveRec() { return App.db.saveRecord(rec); }

  function setWatchActive(root) {
    root.querySelectorAll('#watchChips .watch-chip').forEach(c =>
      c.classList.toggle('active', +c.dataset.seq === curSeq));
  }

  async function refresh() {
    await reload(rec.id);
    render(rec.id, document.getElementById('view'));
  }

  function renderPanel() {
    const p = document.getElementById('panel');
    if (!p) return;
    const e = App.util.entryBySeq(rec, curSeq);
    if (!e) { p.innerHTML = '<div class="muted">没有该次记录</div>'; return; }
    const head = `<div class="entry-head">📌 ${App.util.entryLabel(e.seq)} · ${App.util.fmtDate(e.watchDate)}</div>`;

    if (curTab === 'feel') {
      p.innerHTML = head + `
        <div class="field"><label>观影感受</label><textarea id="feelInput" placeholder="写下你看完后的心情、想法、触动……">${App.util.escapeHtml(e.review || '')}</textarea></div>
        <button class="btn primary block" id="saveFeel">保存感受</button>`;
      p.querySelector('#saveFeel').onclick = () => {
        e.review = p.querySelector('#feelInput').value;
        saveRec().then(() => App.util.toast('已保存'));
      };
    } else if (curTab === 'quote') {
      const list = (e.quotes || []).map((q, i) =>
        `<div class="quote-item"><span class="del" data-i="${i}">✕</span>${App.util.escapeHtml(q)}</div>`).join('') || '<div class="muted">还没有记录台词</div>';
      p.innerHTML = head + `<div id="quoteList">${list}</div>
        <div class="field" style="margin-top:10px"><label>添加一句台词</label><textarea id="qInput" placeholder="“……”"></textarea></div>
        <button class="btn primary block" id="addQ">＋ 添加台词</button>`;
      p.querySelectorAll('.quote-item .del').forEach(d => d.onclick = () => {
        e.quotes.splice(+d.dataset.i, 1); saveRec().then(() => renderPanel());
      });
      p.querySelector('#addQ').onclick = () => {
        const v = p.querySelector('#qInput').value.trim();
        if (!v) return App.util.toast('先写点什么');
        e.quotes = e.quotes || []; e.quotes.push(v);
        saveRec().then(() => renderPanel());
      };
    } else if (curTab === 'shot') {
      const myShots = shots.filter(s => (s.seq || 1) === curSeq);
      const grid = myShots.length ? myShots.map(s => `
        <div class="shot">
          <span class="del" data-id="${s.id}">删除</span>
          ${s.isMostBeautiful ? '<span class="badge">★ 最美画面</span>' : ''}
          <img src="${url(s.blob)}" alt="">
          <div class="cap">
            <textarea data-id="${s.id}" placeholder="这张图的评论…" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:6px;font-size:12.5px;resize:vertical;min-height:46px">${App.util.escapeHtml(s.comment || '')}</textarea>
            <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12.5px;color:var(--muted)">
              <input type="checkbox" data-beautiful="${s.id}" ${s.isMostBeautiful ? 'checked' : ''}> 标记为最美画面
            </label>
          </div>
        </div>`).join('') : '<div class="muted" style="padding:8px 0">还没有截图，下面添加你最喜欢的定格吧</div>';
      p.innerHTML = head + `<div class="shot-grid">${grid}</div>
        <div style="margin-top:12px"><input type="file" id="shotFile" accept="image/*" multiple></div>
        <button class="btn block" id="addShot" style="margin-top:8px">＋ 添加截图（${App.util.entryLabel(curSeq)}）</button>`;
      p.querySelectorAll('.shot .del').forEach(d => d.onclick = () => {
        if (!confirm('删除这张截图？')) return;
        App.db.deleteScreenshot(d.dataset.id).then(() => { shots = shots.filter(x => x.id !== d.dataset.id); renderPanel(); });
      });
      p.querySelectorAll('textarea[data-id]').forEach(t => t.onchange = () => {
        const s = shots.find(x => x.id === t.dataset.id); if (s) { s.comment = t.value; App.db.saveScreenshot(s); }
      });
      p.querySelectorAll('input[data-beautiful]').forEach(c => c.onchange = () => {
        const s = shots.find(x => x.id === c.dataset.beautiful); if (s) { s.isMostBeautiful = c.checked; App.db.saveScreenshot(s); }
      });
      p.querySelector('#addShot').onclick = () => {
        const f = p.querySelector('#shotFile').files;
        if (!f.length) return App.util.toast('先选图片');
        const tasks = [...f].map(file => App.util.compressImage(file).then(blob =>
          App.db.saveScreenshot({ id: App.util.uid(), recordId: rec.id, blob, comment: '', isMostBeautiful: false, order: shots.length, seq: curSeq })));
        Promise.all(tasks).then(() => App.db.getScreenshots(rec.id)).then(s => { shots = s; renderPanel(); App.util.toast('已添加'); });
      };
    } else if (curTab === 'comment') {
      p.innerHTML = head + `
        <div class="field"><label>我的评分（${App.util.entryLabel(e.seq)}）</label><div class="stars" id="cmtStars"></div></div>
        <div class="field"><label>评论区</label><textarea id="cmtInput" placeholder="写一句你的短评 / 想对这部电影说的话">${App.util.escapeHtml(e.comment || '')}</textarea></div>
        <button class="btn primary block" id="saveCmt">保存评论</button>`;
      const getRate = starPicker('cmtStars', e.rating);
      p.querySelector('#saveCmt').onclick = () => {
        e.rating = getRate(); e.comment = p.querySelector('#cmtInput').value;
        saveRec().then(() => App.util.toast('已保存'));
      };
    }
  }

  function openRewatch(root) {
    const mask = document.createElement('div'); mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>记录又看了一遍</h3>
        <div class="field"><label>这次的观影时间</label><input type="date" id="rwDate" value="${App.util.today()}"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="rwCancel">取消</button>
          <button class="btn primary block" id="rwOk">记上</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#rwCancel').onclick = () => mask.remove();
    mask.querySelector('#rwOk').onclick = () => {
      const d = mask.querySelector('#rwDate').value || App.util.today();
      const maxSeq = App.util.entries(rec).reduce((m, e) => Math.max(m, e.seq || 0), 0);
      const newSeq = maxSeq + 1;
      rec.entries.push({ seq: newSeq, watchDate: d, rating: 0, review: '', comment: '', quotes: [] });
      rec.entries.sort((a, b) => (a.watchDate || '').localeCompare(b.watchDate || ''));
      rec.watchDates = rec.entries.map(e => e.watchDate).filter(Boolean).sort();
      rec.watchedDate = rec.watchDates[rec.watchDates.length - 1] || '';
      App.db.saveRecord(rec).then(() => {
        mask.remove(); curSeq = newSeq;
        App.util.toast('已记录' + App.util.entryLabel(newSeq));
        refresh();
      });
    };
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  function render(param, root) {
    root.innerHTML = hero();
    root.querySelector('#editBtn').onclick = () => App.router.go('#/edit/' + rec.id);
    root.querySelector('#delBtn').onclick = () => {
      if (!confirm('确定删除《' + rec.title + '》？此操作不可恢复。')) return;
      App.db.deleteRecord(rec.id).then(() => { App.util.toast('已删除'); App.router.go('#/list'); });
    };
    root.querySelectorAll('#watchChips .watch-chip').forEach(c => c.onclick = () => {
      curSeq = +c.dataset.seq; setWatchActive(root); renderPanel();
    });
    root.querySelector('#rewatchBtn').onclick = () => openRewatch(root);
    root.querySelector('#subtabs').querySelectorAll('button').forEach(b => b.onclick = () => {
      curTab = b.dataset.t;
      root.querySelectorAll('#subtabs button').forEach(x => x.classList.toggle('active', x === b));
      renderPanel();
    });
    renderPanel();
  }

  return { render, reload };
})();
