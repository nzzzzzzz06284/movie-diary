// 视图：个人主页 —— 头像、昵称、简介、观影档案、偏好标签（无付费/积分界面）
window.App = window.App || {};
App.views = App.views || {};

App.views.profile = (function () {
  let profile = null;
  let avatarUrl = null;

  async function reload() {
    profile = await App.db.getKV('profile') || {};
    if (!profile.joinedAt) { profile.joinedAt = App.util.today(); await App.db.setKV('profile', profile); }
    if (profile.avatar) { if (avatarUrl) URL.revokeObjectURL(avatarUrl); avatarUrl = URL.createObjectURL(profile.avatar); }
    else avatarUrl = null;
  }

  function statCards(records) {
    const allE = records.flatMap(r => App.util.entries(r));
    const rated = allE.filter(e => e.rating > 0);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : '—';
    const rewatched = records.filter(r => App.util.entries(r).length > 1).length;
    const joinedDays = Math.max(1, Math.round((Date.now() - new Date((profile.joinedAt || App.util.today()) + 'T00:00:00').getTime()) / 86400000));
    return [
      { n: records.length, l: '看过电影' },
      { n: allE.length, l: '观影次数' },
      { n: rewatched, l: '二刷+部' },
      { n: avg, l: '平均评分' },
      { n: joinedDays, l: '加入天数' }
    ];
  }

  function taste(records) {
    const cnt = {};
    records.forEach(r => (r.tags || []).forEach(t => cnt[t] = (cnt[t] || 0) + 1));
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }

  async function render(param, root) {
    const records = await App.db.getRecords();
    const cards = statCards(records);
    const tasteList = taste(records);
    const nickname = profile.nickname || '影迷';
    const bio = profile.bio || '这里写一句你的观影宣言吧～';

    root.innerHTML = `
      <div class="profile-head">
        <div class="avatar ${avatarUrl ? '' : 'ph'}" id="avatarBox">
          ${avatarUrl ? `<img src="${avatarUrl}" alt="">` : '👤'}
        </div>
        <div class="p-info">
          <div class="p-name" id="nicknameTxt">${App.util.escapeHtml(nickname)}</div>
          <div class="p-bio" id="bioTxt">${App.util.escapeHtml(bio)}</div>
          <button class="btn sm" id="editProfile" style="margin-top:8px">✏️ 编辑资料</button>
        </div>
      </div>

      <div class="stat-cards" style="grid-template-columns:repeat(3,1fr);margin:6px 0 4px">
        ${cards.slice(0, 3).map(c => `<div class="stat-card"><div class="num">${c.n}</div><div class="lbl">${c.l}</div></div>`).join('')}
        ${cards.slice(3).map(c => `<div class="stat-card"><div class="num">${c.n}</div><div class="lbl">${c.l}</div></div>`).join('')}
      </div>

      <div class="view-block">
        <div class="section-title">🎯 我的观影偏好 <span class="hint">常看的标签</span></div>
        ${tasteList.length
          ? `<div class="chips">${tasteList.map(([t, n]) => `<span class="chip tag">${App.util.escapeHtml(t)} · ${n}</span>`).join('')}</div>`
          : '<div class="muted">还没有标签数据，去电影里加几个标签吧</div>'}
      </div>

      <p class="muted" style="text-align:center;margin-top:6px">观影手记 · 你的私人电影日记</p>
    `;

    root.querySelector('#avatarBox').onclick = () => pickAvatar(root);
    root.querySelector('#editProfile').onclick = () => editProfile(root);
  }

  function pickAvatar(root) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      App.util.compressImage(f, 320).then(blob => {
        profile.avatar = blob;
        return App.db.setKV('profile', profile);
      }).then(() => reload()).then(() => render('', root)).then(() => App.util.toast('头像已更新'));
    };
    inp.click();
  }

  function editProfile(root) {
    const mask = document.createElement('div'); mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3>编辑资料</h3>
        <div class="field"><label>昵称</label><input type="text" id="pName" value="${App.util.escapeHtml(profile.nickname || '')}" placeholder="例如：了了"></div>
        <div class="field"><label>简介</label><textarea id="pBio" placeholder="一句话介绍你的观影口味">${App.util.escapeHtml(profile.bio || '')}</textarea></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn block" id="pCancel">取消</button>
          <button class="btn primary block" id="pSave">保存</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#pCancel').onclick = () => mask.remove();
    mask.querySelector('#pSave').onclick = () => {
      profile.nickname = mask.querySelector('#pName').value.trim() || '影迷';
      profile.bio = mask.querySelector('#pBio').value.trim();
      App.db.setKV('profile', profile).then(() => { mask.remove(); return reload(); }).then(() => render('', root)).then(() => App.util.toast('已保存'));
    };
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  return { render, reload };
})();
