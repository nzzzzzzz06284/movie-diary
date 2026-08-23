// 视图：添加 / 编辑电影资料（含标签、评分、感受、评论、联网补全）
window.App = window.App || {};
App.views = App.views || {};

App.views.edit = (function () {
  let rec = null;
  let key = '';
  let selTags = new Set();
  let allTags = [];
  let rating = 0;
  let firstEntry = null;

  async function reload(param) {
    const settings = await App.db.getSettings();
    key = settings.tmdbApiKey || '';
    allTags = [...new Set((await App.db.getRecords()).flatMap(r => r.tags || []))].sort();
    if (param) {
      rec = await App.db.getRecord(param);
      if (!rec) throw new Error('找不到这部电影');
    } else {
      // 新建：支持从搜索页带标题
      const q = new URLSearchParams((location.hash.split('?')[1]) || '');
      const title = q.get('title') || '';
      rec = { id: App.util.uid(), entries: [{ seq: 1, watchDate: App.util.today(), rating: 0, review: '', comment: '', quotes: [] }], title, posterUrl: '', overview: '', director: '', cast: [], tags: [] };
    }
    selTags = new Set(rec.tags || []);
    firstEntry = App.util.entries(rec)[0] || { rating: 0, review: '', comment: '', quotes: [] };
    rating = firstEntry.rating || 0;
  }

  function starPicker(elId) {
    const box = document.getElementById(elId);
    function paint() {
      box.innerHTML = [1,2,3,4,5].map(i => `<span class="s ${i <= rating ? 'on' : ''}" data-i="${i}">★</span>`).join('');
      box.querySelectorAll('.s').forEach(s => s.onclick = () => { rating = +s.dataset.i; paint(); });
    }
    paint();
  }

  function renderTags() {
    const box = document.getElementById('tagBox');
    box.innerHTML = (allTags.length ? allTags.map(t => `<span class="chip ${selTags.has(t) ? 'active' : ''}" data-t="${App.util.escapeHtml(t)}">${App.util.escapeHtml(t)}</span>`).join('') : '<span class="muted">还没有标签，下面新建</span>');
    box.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const t = c.dataset.t; if (selTags.has(t)) selTags.delete(t); else selTags.add(t); renderTags();
    });
  }

  function render(param, root) {
    root.innerHTML = `
      <h2 style="margin:4px 2px 14px">${param ? '编辑《' + App.util.escapeHtml(rec.title) + '》' : '添加电影'}</h2>
      <div class="field"><label>观影时间（可添加多次，二刷三刷都记上）</label>
        <div id="dateList" class="chips"></div>
        <div class="row" style="margin-top:8px">
          <input type="date" id="newDate" value="${App.util.today()}">
          <button class="btn sm" id="addDate" style="flex:0 0 auto">＋ 添加时间</button>
        </div>
      </div>
      <div class="field"><label>电影名</label><input type="text" id="fTitle" value="${App.util.escapeHtml(rec.title || '')}" placeholder="电影名"></div>
      ${key ? `<button class="btn sm block" id="tmdbFill" style="margin-bottom:12px">🔍 联网补全资料（按片名搜 TMDB）</button>` : `<div class="muted" style="margin-bottom:12px">未配置 TMDB 密钥，可在“设置”里填写后自动补全资料。</div>`}
      <div class="field"><label>海报链接 / 上传</label><div class="row"><input type="text" id="fPoster" value="${App.util.escapeHtml(rec.posterUrl || '')}" placeholder="图片网址"><input type="file" id="fPosterFile" accept="image/*" style="flex:0 0 auto"></div></div>
      <div class="field"><label>简介</label><textarea id="fOverview" placeholder="剧情简介">${App.util.escapeHtml(rec.overview || '')}</textarea></div>
      <div class="row">
        <div class="field"><label>导演</label><input type="text" id="fDirector" value="${App.util.escapeHtml(rec.director || '')}" placeholder="导演"></div>
        <div class="field"><label>主演</label><input type="text" id="fCast" value="${App.util.escapeHtml((rec.cast || []).join('、'))}" placeholder="逗号分隔"></div>
      </div>
      <div class="field"><label>我的评分</label><div class="stars" id="fStars"></div></div>
      <div class="field"><label>标签</label><div id="tagBox" class="chips"></div>
        <div class="row" style="margin-top:8px"><input type="text" id="newTag" placeholder="新建标签，回车添加"><button class="btn sm" id="addTag">添加</button></div>
      </div>
      <div class="field"><label>观影感受（首刷）</label><textarea id="fReview" placeholder="看完的心情与想法">${App.util.escapeHtml(firstEntry.review || '')}</textarea></div>
      <div class="field"><label>评论区（首刷）</label><textarea id="fComment" placeholder="一句话短评">${App.util.escapeHtml(firstEntry.comment || '')}</textarea></div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn block" id="cancelBtn">取消</button>
        <button class="btn primary block" id="saveBtn">保存</button>
      </div>`;

    starPicker('fStars');
    renderTags();
    let dates = App.util.entries(rec).map(e => e.watchDate);
    function renderDates() {
      const box = document.getElementById('dateList');
      if (!box) return;
      box.innerHTML = dates.map((d, i) => `<span class="chip ${i === dates.length - 1 ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:6px">${App.util.entryLabel(i + 1)} ${App.util.fmtDate(d)}<span class="x" data-i="${i}" style="cursor:pointer;color:var(--danger)">✕</span></span>`).join('') || '<span class="muted">还没有观影时间</span>';
      box.querySelectorAll('.x').forEach(x => x.onclick = () => {
        dates.splice(+x.dataset.i, 1);
        if (!dates.length) dates.push(App.util.today());
        renderDates();
      });
    }
    renderDates();
    document.getElementById('addDate').onclick = () => {
      const v = document.getElementById('newDate').value;
      if (!v) return App.util.toast('先选个日期');
      dates.push(v); renderDates();
    };
    document.getElementById('addTag').onclick = addTag;
    document.getElementById('newTag').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } };
    function addTag() {
      const v = document.getElementById('newTag').value.trim();
      if (!v) return;
      selTags.add(v); if (!allTags.includes(v)) allTags.push(v);
      document.getElementById('newTag').value = ''; renderTags();
    }

    const posterFile = document.getElementById('fPosterFile');
    posterFile.onchange = () => {
      const f = posterFile.files[0]; if (!f) return;
      App.util.compressImage(f, 600, 0.85).then(b => {
        const r = new FileReader(); r.onload = () => { document.getElementById('fPoster').value = r.result; }; r.readAsDataURL(b);
      });
    };

    if (key) document.getElementById('tmdbFill').onclick = tmdbFill;

    document.getElementById('cancelBtn').onclick = () => history.back();
    document.getElementById('saveBtn').onclick = () => {
      const reviewVal = document.getElementById('fReview').value;
      const commentVal = document.getElementById('fComment').value;
      rec.entries = dates.map((d, i) => {
        const ex = (rec.entries || [])[i];
        if (i === 0) {
          return { seq: 1, watchDate: d, rating: rating, review: reviewVal, comment: commentVal,
                   quotes: ex ? ex.quotes : (firstEntry ? firstEntry.quotes : []) };
        }
        return { seq: i + 1, watchDate: d, rating: ex ? ex.rating : 0, review: ex ? ex.review : '',
                 comment: ex ? ex.comment : '', quotes: ex ? ex.quotes : [] };
      });
      rec.watchDates = dates.slice().sort();
      rec.watchedDate = rec.watchDates[rec.watchDates.length - 1] || '';
      rec.rating = rating;
      rec.review = reviewVal;
      rec.comment = commentVal;
      rec.title = document.getElementById('fTitle').value.trim() || '未命名';
      rec.posterUrl = document.getElementById('fPoster').value.trim();
      rec.overview = document.getElementById('fOverview').value.trim();
      rec.director = document.getElementById('fDirector').value.trim();
      rec.cast = document.getElementById('fCast').value.split(/[，,、]/).map(s => s.trim()).filter(Boolean);
      rec.tags = [...selTags];
      App.db.saveRecord(rec).then(() => { App.util.toast('已保存'); App.router.go('#/detail/' + rec.id); });
    };
  }

  function tmdbFill() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) return App.util.toast('先填写片名');
    App.tmdb.search(title, key).then(list => {
      if (!list.length) return App.util.toast('没搜到，可手动填');
      const mask = document.createElement('div'); mask.className = 'modal-mask';
      mask.innerHTML = `<div class="modal"><h3>选择匹配的电影</h3>${list.map((m,i)=>`
        <div class="result-card" data-i="${i}">${m.poster?`<img src="${m.poster}" onerror="this.style.display='none'">`:''}<div class="rc-body"><div class="rc-title">${App.util.escapeHtml(m.title)}</div><div class="rc-sub">${m.year||''}</div></div><button class="btn primary sm">选</button></div>`).join('')}</div>`;
      document.body.appendChild(mask);
      mask.querySelectorAll('.result-card').forEach(c => c.onclick = async () => {
        const m = list[+c.dataset.i];
        const d = await App.tmdb.details(m.tmdbId, key).catch(() => m);
        rec.posterUrl = d.poster || m.poster; rec.overview = d.overview || m.overview;
        rec.director = d.director || ''; rec.cast = d.cast || [];
        mask.remove();
        // 重渲染表单以填入
        const root = document.getElementById('view');
        render(null, root);
        App.util.toast('已补全，可继续编辑');
      });
      mask.onclick = e => { if (e.target === mask) mask.remove(); };
    }).catch(() => App.util.toast('自动搜索不可用'));
  }

  return { render, reload };
})();
