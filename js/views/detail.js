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
    const sorted = es.slice().sort((a, b) => (a.watchDate || '9999').localeCompare(b.watchDate || '9999'));
    const count = es.length;
    const recentLabel = App.util.movieDateLabel(rec);
    const watchChips = sorted.map(e =>
      `<span class="chip watch-chip ${e.seq === curSeq ? 'active' : ''}" data-seq="${e.seq}">${App.util.entryLabel(e.seq)} · ${App.util.fmtEntryDate(e)}</span>`).join('')
      + `<span class="chip add" id="rewatchBtn">🔁 又看一遍</span>`;
    return `
      <div class="detail-hero">
        <div class="poster ${rec.posterUrl ? '' : 'ph'}">${poster}</div>
        <div class="hero-actions">
          <button class="btn sm" id="editBtn" title="编辑资料">✏️</button>
          <button class="btn sm danger" id="delBtn" title="删除">🗑</button>
        </div>
        <div class="dh-info">
          <h2>${App.util.escapeHtml(rec.title)}</h2>
          <div class="date">${recentLabel}${count > 1 ? ' · 看了' + count + '次' : ''}</div>
          ${App.util.latestRating(rec) ? '<div>' + App.util.starsHtml(App.util.latestRating(rec), 5) + '</div>' : ''}
          ${tagHtml}
          ${meta ? `<div class="meta-line">${App.util.escapeHtml(meta)}</div>` : ''}
          ${rec.overview && rec.overview.trim() ? `<div class="ov-wrap" id="ovWrap"><div class="ov-txt">${App.util.escapeHtml(rec.overview)}</div><span class="ov-more" id="ovMore">展开</span></div>` : ''}
        </div>
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
    const head = `<div class="entry-head">📌 ${App.util.entryLabel(e.seq)} · ${App.util.fmtEntryDate(e)}</div>`;

    if (curTab === 'feel') {
      // 旧单条 review 先迁移成多条，之后增删改都基于 e.feelings
      if (!Array.isArray(e.feelings) && e.review && e.review.trim()) {
        e.feelings = [{ text: e.review, ts: Date.now() }];
        e.review = '';
      }
      const feels = Array.isArray(e.feelings) ? e.feelings : [];
      const listHtml = feels.length ? feels.map((f, i) =>
        `<div class="cmt-item" data-fi="${i}" title="双击可编辑"><div class="ct">${App.util.escapeHtml(f.text)}<div class="ctt">${App.util.fmtTime(f.ts)}</div></div><span class="del" data-fi="${i}">✕</span></div>`).join('')
        : '<div class="muted" style="padding:4px 0">还没有写观影感受，写下你的心情吧</div>';
      p.innerHTML = head + `<div id="feelList">${listHtml}</div>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:flex-end">
          <textarea id="feelInput" maxlength="5000" placeholder="写下你看完后的心情、想法、触动…（最多 5000 字，Ctrl+Enter 发送）" style="flex:1;border:1px solid var(--border);border-radius:16px;padding:10px 14px;font-size:14px;resize:vertical;min-height:130px;font-family:inherit;outline:none;line-height:1.6"></textarea>
          <button class="cmt-send" id="feelSend" style="display:none;height:44px;width:44px" title="发布感受">➤</button>
        </div>`;
      const feelInput = p.querySelector('#feelInput');
      const feelSend = p.querySelector('#feelSend');
      const showSend = () => feelSend.style.display = feelInput.value.trim() ? 'flex' : 'none';
      feelInput.addEventListener('input', showSend);
      feelInput.addEventListener('focus', showSend);
      p.querySelectorAll('#feelList .del').forEach(d => d.onclick = () => {
        const arr = feels.filter((_, i) => i !== +d.dataset.fi);
        e.feelings = arr.length ? arr : undefined;
        saveRec().then(() => renderPanel());
      });
      // 双击一条感受 → 原地进入编辑态
      p.querySelectorAll('#feelList .cmt-item').forEach(item => {
        item.addEventListener('dblclick', () => {
          const fi = +item.dataset.fi;
          const f = feels[fi];
          if (!f) return;
          item.innerHTML = `<textarea class="feel-edit" maxlength="5000">${App.util.escapeHtml(f.text)}</textarea>
            <div style="display:flex;gap:8px;margin-top:6px">
              <button class="btn sm block" data-act="save">保存</button>
              <button class="btn sm block" data-act="cancel">取消</button>
            </div>`;
          const ta = item.querySelector('textarea');
          item.querySelector('[data-act=save]').onclick = () => {
            const v = ta.value.trim();
            if (!v) return App.util.toast('内容不能为空');
            f.text = v; f.ts = Date.now();
            saveRec().then(() => { App.util.toast('已更新'); App.audio.sfx('success'); renderPanel(); });
          };
          item.querySelector('[data-act=cancel]').onclick = () => renderPanel();
          ta.focus && ta.focus();
        });
      });
      const sendFeel = () => {
        const v = feelInput.value.trim();
        if (!v) return;
        const arr = Array.isArray(e.feelings) ? e.feelings.slice()
          : (e.review && e.review.trim() ? [{ text: e.review, ts: Date.now() }] : []);
        arr.push({ text: v, ts: Date.now() });
        e.feelings = arr;
        e.review = ''; // 旧单条迁移到多条后清空
        saveRec().then(() => { App.util.toast('已发布'); App.audio.sfx('success'); renderPanel(); });
      };
      feelSend.onclick = sendFeel;
      feelInput.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); sendFeel(); } });
    } else if (curTab === 'quote') {
      const list = (e.quotes || []).map((q, i) => {
        const txt = typeof q === 'string' ? q : (q.text || '');
        const spk = (typeof q === 'object' && q.speaker) ? q.speaker : '';
        return `<div class="quote-item"><span class="del" data-i="${i}">✕</span>“${App.util.escapeHtml(txt)}”${spk ? `<div class="spk">—— ${App.util.escapeHtml(spk)}</div>` : ''}</div>`;
      }).join('') || '<div class="muted">还没有记录台词</div>';
      p.innerHTML = head + `<div id="quoteList">${list}</div>
        <div class="field" style="margin-top:10px"><label>添加一句台词</label><textarea id="qInput" placeholder="“……”"></textarea></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <span class="chip" id="qSpeaker">💬 谁说的</span>
          <span class="muted" id="qSpeakerSel" style="font-size:12.5px">选择剧中人物（可跳过）</span>
        </div>
        <button class="btn primary block" id="addQ" style="margin-top:8px">＋ 添加台词</button>`;
      p.querySelectorAll('.quote-item .del').forEach(d => d.onclick = () => {
        e.quotes.splice(+d.dataset.i, 1); saveRec().then(() => renderPanel());
      });
      let speaker = '';
      const qSpeakerSel = p.querySelector('#qSpeakerSel');
      p.querySelector('#qSpeaker').onclick = () => openSpeakerPicker((name) => {
        speaker = name;
        qSpeakerSel.textContent = name || '未选择（可跳过）';
      });
      p.querySelector('#addQ').onclick = () => {
        const v = p.querySelector('#qInput').value.trim();
        if (!v) return App.util.toast('先写点什么');
        e.quotes = e.quotes || [];
        e.quotes.push(speaker ? { text: v, speaker } : v);
        saveRec().then(() => { renderPanel(); App.audio.sfx('success'); });
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
        Promise.all(tasks).then(() => App.db.getScreenshots(rec.id)).then(s => { shots = s; renderPanel(); App.util.toast('已添加'); App.audio.sfx('success'); });
      };
    } else if (curTab === 'comment') {
      const cmts = App.util.eComments(e);
      const listHtml = cmts.length ? cmts.map((c, i) =>
        `<div class="cmt-item"><div class="ct">${App.util.escapeHtml(c.text)}<div class="ctt">${App.util.fmtTime(c.ts)}</div></div><span class="del" data-ci="${i}">✕</span></div>`).join('')
        : '<div class="muted" style="padding:4px 0">还没有评论，写一条吧</div>';
      const hasReason = !!(e.ratingReason && e.ratingReason.trim());
      p.innerHTML = head + `
        <div class="field"><label>我的评分（${App.util.entryLabel(e.seq)}）</label>
          <div class="rate-stars" id="rateStars" title="点击调分"></div>
          <div class="rate-box" id="rateBox" style="display:none">
            <input type="range" id="rateSlider" min="0" max="5" step="0.1" value="${e.rating || 0}">
            <div class="rate-num" id="rateNum"></div>
          </div>
        </div>
        <div class="field"><label>评分理由（选填）</label><textarea id="reasonInput" placeholder="为什么给这个分？">${App.util.escapeHtml(e.ratingReason || '')}</textarea></div>
        <div class="save-row ${hasReason ? 'show' : ''}" id="reasonRow">
          <button class="btn primary block" id="saveReason">保存评分</button>
        </div>
        <div class="field" style="margin-top:4px"><label>评论区</label><div id="cmtList">${listHtml}</div>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
            <textarea id="cmtInput" placeholder="写一条评论…" style="flex:1;border:1px solid var(--border);border-radius:20px;padding:8px 14px;font-size:14px;resize:none;min-height:40px;font-family:inherit;outline:none"></textarea>
            <button class="cmt-send" id="cmtSend" style="display:none" title="发送">➤</button>
          </div>
        </div>`;
      const rateStars = p.querySelector('#rateStars');
      const rateBox = p.querySelector('#rateBox');
      const slider = p.querySelector('#rateSlider');
      const rateNum = p.querySelector('#rateNum');
      const paintStars = (v) => { rateStars.innerHTML = App.util.starsHtml(v, 5); };
      paintStars(e.rating || 0);
      // 点击星星才弹出滑块；保存后收起来
      rateStars.onclick = () => { rateBox.style.display = 'block'; rateNum.textContent = (+slider.value).toFixed(1) + ' 分'; if (slider.focus) slider.focus(); };
      slider.addEventListener('input', () => {
        rateNum.textContent = (+slider.value).toFixed(1) + ' 分';
        paintStars(+slider.value);
        reasonRow.classList.add('show');
      });
      const reasonInput = p.querySelector('#reasonInput');
      const reasonRow = p.querySelector('#reasonRow');
      reasonInput.addEventListener('input', () => reasonRow.classList.add('show'));
      p.querySelector('#saveReason').onclick = () => {
        e.rating = Math.round(+slider.value * 10) / 10;
        e.ratingReason = reasonInput.value.trim();
        saveRec().then(() => { App.util.toast('已保存评分'); App.audio.sfx('success'); reasonRow.classList.remove('show'); rateBox.style.display = 'none'; paintStars(e.rating); });
      };
      p.querySelectorAll('.cmt-item .del').forEach(d => d.onclick = () => {
        const arr = App.util.eComments(e).filter((_, i) => i !== +d.dataset.ci);
        e.comments = arr.length ? arr : undefined;
        saveRec().then(() => renderPanel());
      });
      const cmtInput = p.querySelector('#cmtInput');
      const cmtSend = p.querySelector('#cmtSend');
      const showSend = () => cmtSend.style.display = cmtInput.value.trim() ? 'flex' : 'none';
      cmtInput.addEventListener('input', showSend);
      cmtInput.addEventListener('focus', showSend);
      const sendCmt = () => {
        const v = cmtInput.value.trim();
        if (!v) return;
        const arr = App.util.eComments(e);
        arr.push({ text: v, ts: Date.now() });
        e.comments = arr;
        saveRec().then(() => { App.util.toast('已发布'); App.audio.sfx('success'); renderPanel(); });
      };
      cmtSend.onclick = sendCmt;
      cmtInput.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendCmt(); } });
    }
  }

  function openRewatch(root) {
    const mask = document.createElement('div'); mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>记录又看了一遍</h3>
        <div class="field"><label>这次的观影时间</label><input type="date" id="rwDate" value="${App.util.today()}"></div>
        <label class="unk-toggle"><input type="checkbox" id="rwUnknown"> 🤔 记不清具体哪天了</label>
        <div class="field" id="rwNoteWrap" style="display:none;margin-top:8px"><label>大概什么时候？（选填）</label><input type="text" id="rwNote" placeholder="可留空"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="rwCancel">取消</button>
          <button class="btn primary block" id="rwOk">记上</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const rwUnk = mask.querySelector('#rwUnknown');
    const rwNoteWrap = mask.querySelector('#rwNoteWrap');
    const rwDate = mask.querySelector('#rwDate');
    rwUnk.onchange = () => { rwDate.disabled = rwUnk.checked; rwNoteWrap.style.display = rwUnk.checked ? 'block' : 'none'; if (rwUnk.checked) rwDate.value = ''; };
    mask.querySelector('#rwCancel').onclick = () => mask.remove();
    mask.querySelector('#rwOk').onclick = () => {
      const unknown = rwUnk.checked;
      const note = unknown ? mask.querySelector('#rwNote').value.trim() : '';
      const d = unknown ? '' : (rwDate.value || App.util.today());
      const maxSeq = App.util.entries(rec).reduce((m, e) => Math.max(m, e.seq || 0), 0);
      const newSeq = maxSeq + 1;
      rec.entries.push({ seq: newSeq, watchDate: d, rating: 0, review: '', comment: '', quotes: [], dateUnknown: unknown, dateNote: note });
      rec.entries.sort((a, b) => (a.watchDate || '').localeCompare(b.watchDate || ''));
      rec.watchDates = rec.entries.map(e => e.watchDate).filter(Boolean).sort();
      rec.watchedDate = rec.watchDates[rec.watchDates.length - 1] || (rec.entries[0] && rec.entries[0].watchDate) || '';
      App.db.saveRecord(rec).then(() => {
        mask.remove(); curSeq = newSeq;
        App.util.toast('已记录' + App.util.entryLabel(newSeq));
        App.audio.sfx('success');
        refresh();
      });
    };
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  // 「谁说的」人物选择弹窗：剧中角色（头像+名字），支持跳过
  function openSpeakerPicker(cb) {
    const infos = (rec.castInfo && rec.castInfo.length) ? rec.castInfo
      : (rec.cast || []).map(n => ({ name: n, character: '', profile: '' }));
    const mask = document.createElement('div'); mask.className = 'modal-mask spk-mask';
    const rows = infos.slice(0, 12).map((p, i) => `
      <div class="spk-item" data-i="${i}">
        ${p.profile ? `<img src="${App.util.escapeHtml(p.profile)}" onerror="this.style.display='none'" alt="">` : '<div class="spk-ph">👤</div>'}
        <div class="spk-t"><b>${App.util.escapeHtml(p.name)}</b>${p.character ? `<span>${App.util.escapeHtml(p.character)}</span>` : ''}</div>
      </div>`).join('');
    mask.innerHTML = `<div class="modal spk-modal">
      <h3>谁说的这句话？</h3>
      <div class="spk-list">${rows}
        <div class="spk-item" data-i="none"><div class="spk-ph">🤷</div><div class="spk-t"><b>记不清 / 其他</b></div></div>
      </div>
      <button class="btn block" id="spkCancel" style="margin-top:12px">取消</button>
    </div>`;
    document.body.appendChild(mask);
    mask.querySelectorAll('.spk-item').forEach(it => it.onclick = () => {
      const i = it.dataset.i;
      cb(i === 'none' ? '' : (infos[+i] ? infos[+i].name : ''));
      mask.remove();
    });
    mask.querySelector('#spkCancel').onclick = () => mask.remove();
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  function openOverview() {
    const mask = document.createElement('div'); mask.className = 'modal-mask ov-mask';
    mask.innerHTML = `<div class="modal ov-modal">
      <h3>${App.util.escapeHtml(rec.title)} · 简介</h3>
      <div class="ov-full">${App.util.escapeHtml(rec.overview || '')}</div>
      <button class="btn primary block" id="ovClose" style="margin-top:16px">知道了</button>
    </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#ovClose').onclick = () => mask.remove();
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  function render(param, root) {
    root.innerHTML = hero();
    root.querySelector('#editBtn').onclick = () => App.router.go('#/edit/' + rec.id);
    root.querySelector('#delBtn').onclick = () => {
      if (!confirm('确定删除《' + rec.title + '》？此操作不可恢复。')) return;
      App.db.deleteRecord(rec.id).then(() => { App.util.toast('已删除'); App.router.go('#/list'); });
    };
    const ovMore = root.querySelector('#ovMore');
    if (ovMore) ovMore.onclick = () => openOverview();
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
