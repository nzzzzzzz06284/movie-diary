// 视图：设置 / 帮助 —— TMDB Key、导出导入、使用说明
window.App = window.App || {};
App.views = App.views || {};

App.views.settings = (function () {
  let settings = null;

  async function reload() { settings = await App.db.getSettings(); }

  function render(param, root) {
    root.innerHTML = `
      <h2 style="margin:4px 2px 14px">设置</h2>

      <div class="view-block">
        <div class="section-title">🔑 TMDB 密钥（自动搜资料）</div>
        <div class="field">
          <label>API Key（v3 auth）</label>
          <input type="text" id="apiKey" value="${App.util.escapeHtml(settings.tmdbApiKey || '')}" placeholder="在 themoviedb.org 注册后获取">
        </div>
        <button class="btn primary block" id="saveKey">保存密钥</button>
        <p class="muted" style="margin-top:8px"><b>免费获取步骤（约 1 分钟）：</b><br>① 打开 <b>themoviedb.org</b> 用邮箱注册并登录；<br>② 点右上角头像 → <b>设置（Settings）</b> → 左侧 <b>API</b>；<br>③ 申请 API 密钥（选 Developer，用途随便填"个人电影记录"）；<br>④ 复制 <b>v3 API Key</b>（一长串字母数字）粘到上面保存。<br>密钥只存在你本地浏览器，用于搜片名自动填海报/导演/演员；没有也能手动添加。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">💾 数据备份</div>
        <button class="btn block" id="exportBtn">导出备份（JSON）</button>
        <div style="height:10px"></div>
        <button class="btn block" id="importBtn">导入备份（JSON）</button>
        <input type="file" id="importFile" accept="application/json" hidden>
        <p class="muted" style="margin-top:8px">备份文件包含全部电影和截图，请妥善保存、不要公开分享。</p>

        <div class="section-title" style="margin-top:14px">📂 数据同步（自动防丢 · 进知识库）</div>
        <div id="syncStatus" class="muted" style="font-size:12px;margin-bottom:8px">未连接同步文件夹</div>
        <button class="btn block" id="chooseSync">选择同步文件夹</button>
        <div style="height:10px"></div>
        <button class="btn block" id="pushSync">立即同步</button>
        <p class="muted" style="margin-top:8px">仅 Edge / Chrome 桌面版支持。选择后会把数据自动写成 <b>movie-diary-latest.json</b> 到该文件夹（含截图，可完整恢复）。配云盘同步该文件夹即自动上云。手机端请用上方「导出备份」。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">🤖 Hermes 智能助手</div>
        <div class="field">
          <label>网关地址</label>
          <input type="text" id="hermesUrl" value="${App.util.escapeHtml(settings.hermesUrl || 'http://localhost:8642')}" placeholder="http://localhost:8642">
        </div>
        <div class="field">
          <label>API Key（可选，仅当 Hermes 网关设了 key 才填）</label>
          <input type="text" id="hermesKey" value="${App.util.escapeHtml(settings.hermesKey || '')}" placeholder="留空也行（取决于 Hermes 配置）">
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn primary block" id="saveHermes">保存</button>
          <button class="btn block" id="testHermes">测试连接</button>
        </div>
        <div id="hermesTest" class="muted" style="font-size:12px;margin-top:8px"></div>
        <p class="muted" style="margin-top:8px">助手会读取你电影库的真实数据，让 Hermes 帮你推荐电影、生成年度报告。<b>前置：</b>需在 Hermes 里开启 API 网关（默认端口 8642），并把网关 CORS 设为 <b>*</b>（否则网页跨域被拦）。详见《开启 Hermes 网关指引》。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">🎵 音乐和音效</div>

        <div class="switch-row">
          <div><b>操作音效</b><div class="muted" style="font-size:12px">点击、保存等时的轻提示音</div></div>
          <label class="switch"><input type="checkbox" id="sfxOn" ${settings.sfxOn !== false ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="section-title" style="margin-top:14px">背景音乐</div>
        <div class="play-modes" id="playModes">
          <button class="pm" data-mode="loop" title="循环播放">🔁</button>
          <button class="pm" data-mode="list" title="列表播放">📃</button>
          <button class="pm" data-mode="shuffle" title="随机播放">🔀</button>
        </div>
        <div id="musicList" class="music-list"></div>

        <div style="display:flex;gap:10px;margin-top:10px">
          <button class="btn block" id="addMusic">＋ 添加我的音乐</button>
          <button class="btn block" id="stopMusic">⏹ 停止</button>
        </div>
        <input type="file" id="musicFile" accept="audio/*" hidden>
        <p class="muted" style="margin-top:8px">自带「雨声 / 森林 / 轻音乐」三种环境音，零流量；也可上传你自己的音频（仅存本机）。数据都不联网。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">📖 使用说明</div>
        <div class="help-step"><div class="n">1</div><div class="t"><b>添加电影</b>：首页搜索栏输入片名 → 电影海报自动弹出 → 点一下选观影时间即进电影库（需先在“设置”填 TMDB 免费密钥）。没有密钥也可手动添加。</div></div>
        <div class="help-step"><div class="n">2</div><div class="t"><b>记录内容</b>：点进电影，用四个分栏写——<b>观影感受</b>、<b>喜欢的台词</b>、<b>最美定格</b>（上传截图+评论+标最美）、<b>评论区</b>（评分+短评）。</div></div>
        <div class="help-step"><div class="n">3</div><div class="t"><b>看统计</b>：底部“统计”看今年观影数、平均分、<b>观影偏好</b>（各类型看了多少）、按月趋势和评分分布。</div></div>
        <div class="help-step"><div class="n">4</div><div class="t"><b>定期备份</b>：在“设置”里点导出备份，防止数据丢失。</div></div>
      </div>

      <hr class="sep">
      <p class="muted" style="text-align:center">观影手记 · 你的私人电影日记</p>
    `;

    document.getElementById('saveKey').onclick = () => {
      settings.tmdbApiKey = document.getElementById('apiKey').value.trim();
      App.db.saveSettings(settings).then(() => { App.util.toast('密钥已保存'); App.audio.sfx('success'); });
    };
    document.getElementById('exportBtn').onclick = () => App.util.exportAll();
    const fileInput = document.getElementById('importFile');
    document.getElementById('importBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files[0]) App.util.importAll(fileInput.files[0]); };

    // ---- 数据同步 ----
    const syncStatus = document.getElementById('syncStatus');
    function paintSync() {
      const st = App.sync.status();
      if (!st.supported) { syncStatus.textContent = '当前浏览器不支持自动同步（请用 Edge/Chrome 桌面版）'; return; }
      syncStatus.textContent = st.connected ? ('已连接：' + st.name + '（数据变动自动同步）') : '未连接同步文件夹';
    }
    paintSync();
    document.getElementById('chooseSync').onclick = () => App.sync.chooseDir().then(() => paintSync());
    document.getElementById('pushSync').onclick = () => App.sync.pushNow();

    // ---- Hermes 智能助手 ----
    const hermesUrlEl = document.getElementById('hermesUrl');
    const hermesKeyEl = document.getElementById('hermesKey');
    const hermesTestEl = document.getElementById('hermesTest');
    document.getElementById('saveHermes').onclick = () => {
      settings.hermesUrl = hermesUrlEl.value.trim();
      settings.hermesKey = hermesKeyEl.value.trim();
      App.db.saveSettings(settings).then(() => { App.util.toast('已保存'); App.audio.sfx('success'); });
    };
    document.getElementById('testHermes').onclick = async () => {
      hermesTestEl.textContent = '测试中…';
      const r = await App.assistant.testConnection();
      hermesTestEl.textContent = r;
    };

    // ---- 音乐和音效 ----
    App.audio.setSfx(settings.sfxOn !== false);
    // 播放模式：循环 / 列表 / 随机
    App.audio.setMode(settings.playMode || 'loop');
    const pmBox = document.getElementById('playModes');
    function paintModes() {
      pmBox.querySelectorAll('.pm').forEach(b => b.classList.toggle('active', b.dataset.mode === App.audio.getMode()));
    }
    pmBox.querySelectorAll('.pm').forEach(b => b.onclick = () => {
      App.audio.setMode(b.dataset.mode);
      settings.playMode = b.dataset.mode;
      App.db.saveSettings(settings);
      paintModes();
      App.util.toast({ loop: '🔁 循环播放', list: '📃 列表播放', shuffle: '🔀 随机播放' }[b.dataset.mode] || '');
    });
    paintModes();
    const sfxEl = document.getElementById('sfxOn');
    sfxEl.onchange = () => {
      settings.sfxOn = sfxEl.checked;
      App.db.saveSettings(settings);
      App.audio.setSfx(sfxEl.checked);
      App.util.toast(sfxEl.checked ? '操作音效已开启' : '操作音效已关闭');
    };
    const musicListEl = document.getElementById('musicList');
    const musicFile = document.getElementById('musicFile');
    document.getElementById('addMusic').onclick = () => musicFile.click();
    musicFile.onchange = () => {
      const f = musicFile.files[0]; if (!f) return;
      App.db.saveTrack({ id: App.util.uid(), name: f.name, blob: f, createdAt: Date.now() })
        .then(() => { musicFile.value = ''; return renderMusic(); })
        .then(() => App.util.toast('已添加'));
    };
    document.getElementById('stopMusic').onclick = () => { App.audio.stop(); renderMusic(); };

    async function renderMusic() {
      const st = App.audio.state();
      const tracks = await App.db.getTracks();
      App.audio._setUserList(tracks);
      const builtin = App.audio.builtinList().map(b => {
        const playing = st.musicOn && st.current && st.current.type === 'ambient' && st.current.id === b.id;
        return `<div class="music-item">
          <div class="m-info"><div class="m-name">${b.name}</div><div class="m-desc">${b.desc}</div></div>
          <button class="btn sm ${playing ? 'primary' : ''}" data-amb="${b.id}">${playing ? '⏸' : '▶'}</button>
        </div>`;
      }).join('');
      const user = tracks.length ? tracks.map(t => {
        const playing = st.musicOn && st.current && st.current.type === 'track' && st.current.id === t.id;
        return `<div class="music-item">
          <div class="m-info"><div class="m-name">🎵 ${App.util.escapeHtml(t.name)}</div></div>
          <button class="btn sm ${playing ? 'primary' : ''}" data-track="${t.id}">${playing ? '⏸' : '▶'}</button>
          <span class="m-del" data-del="${t.id}">✕</span>
        </div>`;
      }).join('') : '<div class="muted" style="padding:4px 0">还没有添加自己的音乐</div>';
      musicListEl.innerHTML = builtin + user;
      musicListEl.querySelectorAll('[data-amb]').forEach(b => b.onclick = () => { App.audio.playAmbient(b.dataset.amb); renderMusic(); });
      musicListEl.querySelectorAll('[data-track]').forEach(b => b.onclick = async () => {
        const t = (await App.db.getTracks()).find(x => x.id === b.dataset.track);
        if (t) { App.audio.playTrack(t); renderMusic(); }
      });
      musicListEl.querySelectorAll('[data-del]').forEach(d => d.onclick = () => {
        if (!confirm('删除这首音乐？')) return;
        App.db.deleteTrack(d.dataset.del).then(() => renderMusic());
      });
    }
    renderMusic();
  }

  return { render, reload };
})();
