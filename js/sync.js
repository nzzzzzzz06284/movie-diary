// 数据同步：两路
//  1) 本地文件夹同步（File System Access API，仅 Edge/Chrome 桌面版，供 Hermes 摄入知识库）
//  2) GitHub 云端同步（任意浏览器含手机 PWA，自动防丢；每次变动自动存私有仓库，清手机后重开即恢复）
window.App = window.App || {};
App.sync = (function () {
  let dirHandle = null;     // 当前会话的目录句柄（桌面）
  let dirName = '';         // 目录显示名
  const DEBOUNCE = 800;     // 多次写操作合并成一个写

  let lastPush = 0;         // 上次云端推送时间
  let lastError = '';       // 上次云端错误

  // 从扫码链接自动配置 GitHub 同步（避免手动复制长串令牌出错）：?synctoken=xxx&syncrepo=用户名/仓库
  async function applySyncFromUrl() {
    try {
      const p = new URLSearchParams(location.search);
      const t = (p.get('synctoken') || '').trim();
      const r = (p.get('syncrepo') || '').trim();
      const px = (p.get('syncproxy') || '').trim();
      if (!t || !r) return;
      const s = await App.db.getSettings();
      s.ghToken = t; s.ghRepo = r;
      if (px) s.ghProxy = px;
      if (!s.ghBranch) s.ghBranch = 'main';
      if (!s.ghPath) s.ghPath = 'movie-diary-data.json';
      await App.db.saveSettings(s);
      // 清掉 URL 里的令牌，避免泄露与重复触发
      try { history.replaceState({}, '', location.pathname + (location.hash || '')); } catch (e) {}
      App.util.toast('已从扫码链接自动配置同步，正在连接测试…');
      setTimeout(async () => {
        const msg = await ghTest();
        App.util.toast((msg || '').split('\n')[0]);
        if ((msg || '').indexOf('✅') === 0) App.sync.push();
      }, 1000);
    } catch (e) { console.warn('[sync] applySyncFromUrl failed', e); }
  }

  // ===================== 本地文件夹（桌面） =====================
  function supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  async function init() {
    await applySyncFromUrl();
    if (supported()) {
      try {
        const rec = await App.db.getKV('syncDir');
        if (rec && rec.handle) {
          const ok = await verify(rec.handle);
          if (ok) { dirHandle = rec.handle; dirName = rec.handle.name || '已选文件夹'; }
          else { await App.db.setKV('syncDir', { handle: null }); }
        }
      } catch (e) { /* 忽略，下次手动选 */ }
    }
    // 云端自动恢复：仅当本地为空时拉取，避免覆盖本机更新
    autoRestore().catch(() => {});
  }

  async function verify(handle) {
    try {
      const opt = { type: 'file-system-access', handle };
      const st = await navigator.permissions.query(opt);
      if (st.state === 'granted') return true;
      return (await navigator.permissions.request(opt)).state === 'granted';
    } catch (e) { return false; }
  }

  async function chooseDir() {
    if (!supported()) {
      App.util.toast('当前浏览器不支持文件夹同步，请用 Edge/Chrome 桌面版，或用 GitHub 云端同步');
      return false;
    }
    try {
      const h = await window.showDirectoryPicker();
      dirHandle = h; dirName = h.name;
      await App.db.setKV('syncDir', { handle: h });
      App.util.toast('已选择同步文件夹：' + h.name);
      await pushNow();
      return true;
    } catch (e) {
      if (e && e.name !== 'AbortError') App.util.toast('选择失败：' + (e.message || e));
      return false;
    }
  }

  let folderTimer = null;
  function scheduleFolder() {
    if (!dirHandle) return;
    clearTimeout(folderTimer);
    folderTimer = setTimeout(() => { pushNow().catch(() => {}); }, DEBOUNCE);
  }

  async function pushNow() {
    if (!dirHandle) return;
    try {
      const [records, shots] = await Promise.all([App.db.getRecords(), App.db.getAllScreenshots()]);
      const shots64 = await Promise.all(
        shots.map(s => App.util.blobToDataURL(s.blob).then(d => ({ ...s, dataURL: d })))
      );
      const payload = { app: 'movie-diary', version: 2, exportedAt: new Date().toISOString(), records, screenshots: shots64 };
      const fileHandle = await dirHandle.getFileHandle('movie-diary-latest.json', { create: true });
      const w = await fileHandle.createWritable();
      await w.write(JSON.stringify(payload));
      await w.close();
    } catch (e) { /* 桌面同步失败不影响主流程 */ }
  }

  function status() {
    return { connected: !!dirHandle, name: dirName, supported: supported() };
  }

  // ===================== GitHub 云端同步（全平台含手机） =====================
  function ghEnabled(s) { return !!(s && s.ghToken && s.ghToken.trim() && s.ghRepo && s.ghRepo.trim()); }
  function ghPath(s) { return ((s && s.ghPath) || 'movie-diary-data.json').trim() || 'movie-diary-data.json'; }
  function ghBranch(s) { return ((s && s.ghBranch) || 'main').trim() || 'main'; }
  // 读取并清洗配置：去掉复制粘贴带入的首尾空格/换行，避免 Authorization 头非法导致 fetch 抛「网络错误」
  function ghCreds(s) { return { token: (s.ghToken || '').trim(), repo: (s.ghRepo || '').trim(), branch: ghBranch(s), path: ghPath(s) }; }

  // 中转中继（可选）：把请求转发到 GitHub 并带回 CORS 头，规避国内网络对 api.github.com 跨域预检的拦截。
  // 默认留空走直连；若已配置中继地址（如自建 Cloudflare Worker），直连失败自动改走中继。中继会原样转发 Authorization 头。
  let lastVia = '';
  function ghProxy(s) { return ((s && s.ghProxy) || '').trim(); }

  // 发送 GitHub 请求：先直连；若被网络/CORS 预检拦截（fetch 抛错），自动改走中继（若已配置）
  async function ghFetch(url, opts, token, proxy) {
    try {
      const r = await fetch(url, opts);
      lastVia = '直连';
      return r;
    } catch (e) { /* 直连被拦，试中继 */ }
    if (!proxy) throw new Error('直连失败（无中继）');
    try {
      const sep = proxy.includes('?') ? '&' : '?';
      const proxied = proxy + sep + 'u=' + encodeURIComponent(url);
      lastVia = '中继';
      return await fetch(proxied, opts);
    } catch (e2) {
      throw new Error('直连与中继均失败');
    }
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function buildPayload() {
    const [records, shots] = await Promise.all([App.db.getRecords(), App.db.getAllScreenshots()]);
    const shots64 = await Promise.all(
      shots.map(s => App.util.blobToDataURL(s.blob).then(d => ({ ...s, dataURL: d })))
    );
    return { app: 'movie-diary', version: 2, exportedAt: new Date().toISOString(), records, screenshots: shots64 };
  }

  let cloudTimer = null, cloudBusy = false, cloudPending = false;
  function scheduleCloud() {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => { cloudPush().catch(e => { lastError = '' + (e && e.message || e); console.warn('[sync] gh push failed', e); }); }, DEBOUNCE);
  }

  // 把全量数据 PUT 到仓库文件（自动处理新建 / 更新 sha / 冲突重试）
  async function cloudPush() {
    const s = await App.db.getSettings();
    if (!ghEnabled(s)) return;
    const g = ghCreds(s);
    const proxy = ghProxy(s);
    if (cloudBusy) { cloudPending = true; return; }
    cloudBusy = true;
    try {
      const payload = await buildPayload();
      const content = utf8ToBase64(JSON.stringify(payload));
      const url = `https://api.github.com/repos/${encodeURIComponent(g.repo)}/contents/${encodeURIComponent(g.path)}?ref=${encodeURIComponent(g.branch)}`;
      const headers = { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' };

      // 取当前文件 sha（用于更新；404 表示首次创建）
      let sha = null;
      try {
        const r = await ghFetch(url, { headers: { Authorization: headers.Authorization, Accept: headers.Accept } }, g.token, proxy);
        if (r.ok) { const j = await r.json(); sha = j.sha; }
        else if (r.status !== 404) { lastError = '读取云端失败 ' + r.status; return; }
      } catch (e) { lastError = '网络错误（读取）'; return; }

      const body = { message: 'movie-diary auto sync', content, branch: ghBranch(s) };
      if (sha) body.sha = sha;

      let r = await ghFetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) }, g.token, proxy);
      // 冲突（另一设备先推了）：重新取 sha 再试一次
      if (r.status === 409 && sha) {
        try {
          const r2 = await ghFetch(url, { headers: { Authorization: headers.Authorization, Accept: headers.Accept } }, g.token, proxy);
          if (r2.ok) { const j = await r2.json(); body.sha = j.sha; r = await ghFetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) }, g.token); }
        } catch (e) { /* ignore */ }
      }
      if (r.ok) { lastPush = Date.now(); lastError = ''; }
      else { const t = await r.text().catch(() => ''); lastError = '推送到云端失败 ' + r.status + ' ' + t.slice(0, 120); }
    } finally {
      cloudBusy = false;
      if (cloudPending) { cloudPending = false; scheduleCloud(); }
    }
  }

  function ghPushNow() { return cloudPush().then(() => true).catch(() => false); }

  // 把一份 payload 写入本地库（merge=true 时按 id + updatedAt 合并，不删本机独有记录）
  async function importPayload(data, merge) {
    const incoming = data.records || [];
    const incomingShots = (data.screenshots || []).map(s => ({ ...s, blob: App.util.dataURLToBlob(s.dataURL) }));
    if (!merge) {
      const db = await App.db.open();
      await new Promise((res, rej) => {
        const t = db.transaction(['records', 'screenshots'], 'readwrite');
        t.objectStore('records').clear();
        t.objectStore('screenshots').clear();
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      await Promise.all(incoming.map(r => App.db.saveRecord(r)));
      await Promise.all(incomingShots.map(s => App.db.saveScreenshot(s)));
      return;
    }
    const local = await App.db.getRecords();
    const localMap = new Map(local.map(r => [r.id, r]));
    const toPut = incoming.filter(r => {
      const loc = localMap.get(r.id);
      return !loc || (r.updatedAt || 0) >= (loc.updatedAt || 0);
    });
    await Promise.all(toPut.map(r => App.db.saveRecord(r)));
    const localShots = await App.db.getAllScreenshots();
    const shotMap = new Map(localShots.map(s => [s.id, s]));
    const shotPut = incomingShots.filter(s => !shotMap.has(s.id) || (s.updatedAt || 0) >= (shotMap.get(s.id).updatedAt || 0));
    await Promise.all(shotPut.map(s => App.db.saveScreenshot(s)));
  }

  async function cloudPull() {
    const s = await App.db.getSettings();
    if (!ghEnabled(s)) { App.util.toast('请先在设置里配置 GitHub 同步'); return false; }
    const g = ghCreds(s);
    const proxy = ghProxy(s);
    const url = `https://api.github.com/repos/${encodeURIComponent(g.repo)}/contents/${encodeURIComponent(g.path)}?ref=${encodeURIComponent(g.branch)}`;
    const headers = { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' };
    let r;
    try { r = await ghFetch(url, { headers }, g.token, proxy); }
    catch (e) { App.util.toast('网络错误，拉取失败（直连与代理都失败，确认 VPN 已开且能打开 api.github.com）'); return false; }
    if (!r.ok) {
      if (r.status === 404) App.util.toast('GitHub 上还没有备份，先在有数据的设备同步一次');
      else App.util.toast('拉取失败：' + r.status);
      return false;
    }
    const j = await r.json();
    let data;
    try { data = JSON.parse(base64ToUtf8(j.content)); }
    catch (e) { App.util.toast('备份文件解析失败'); return false; }
    if (!data.records) { App.util.toast('文件格式不正确'); return false; }
    await importPayload(data, true);
    App.util.toast('已从 GitHub 恢复 ' + data.records.length + ' 部 🎉');
    App.audio.sfx('success');
    return true;
  }

  // 启动时的自动恢复：仅当本地为空
  async function autoRestore() {
    try {
      const s = await App.db.getSettings();
      if (!ghEnabled(s)) return;
      const local = await App.db.getRecords();
      if (local.length) return; // 本机有数据就不覆盖
      const g = ghCreds(s);
      const proxy = ghProxy(s);
      const url = `https://api.github.com/repos/${encodeURIComponent(g.repo)}/contents/${encodeURIComponent(g.path)}?ref=${encodeURIComponent(g.branch)}`;
      const headers = { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' };
      const r = await ghFetch(url, { headers }, g.token, proxy);
      if (!r.ok) return;
      const j = await r.json();
      const data = JSON.parse(base64ToUtf8(j.content));
      if (data.records && data.records.length) {
        await importPayload(data, true);
        App.util.toast('已从 GitHub 自动恢复 ' + data.records.length + ' 部');
        setTimeout(() => location.reload(), 400); // 让界面反映恢复出的数据
      }
    } catch (e) { console.warn('[sync] autoRestore failed', e); }
  }

  // 诊断：区分「整个跨域 fetch 被挡」与「仅带 Authorization 头的预检被挡」
  async function runNetDiag(g) {
    const lines = [];
    const probe = async (label, url, opts) => {
      try {
        const r = await fetch(url, opts);
        return label + ' → HTTP ' + r.status + '（拿到响应，网络通）';
      } catch (e) {
        return label + ' → 失败 ' + (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : e);
      }
    };
    lines.push(await probe('① 无头GET rate_limit', 'https://api.github.com/rate_limit'));
    lines.push(await probe('② 带Authorization头', 'https://api.github.com/repos/' + encodeURIComponent(g.repo), { headers: { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' } }));
    lines.push(await probe('③ 用?access_token=参数', 'https://api.github.com/repos/' + encodeURIComponent(g.repo) + '?access_token=' + encodeURIComponent(g.token)));
    return lines.join('\n');
  }

  async function ghTest() {
    const s = await App.db.getSettings();
    if (!ghEnabled(s)) return '请先填写令牌和仓库';
    const g = ghCreds(s);
    const proxy = ghProxy(s);
    const base = 'https://api.github.com/repos/' + encodeURIComponent(g.repo);
    const authHeaders = { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' };
    try {
      // 先直连；被网络/CORS 预检拦截则自动走中继（若已配置）
      const r = await ghFetch(base, { headers: authHeaders }, g.token, proxy);
      if (r.ok) {
        const j = await r.json();
        return '✅ 连接成功（' + lastVia + '）：' + j.full_name + (j.private ? '（私有）' : '（公开，建议设为私有）');
      }
      let msg = '';
      try { const b = await r.json(); if (b && b.message) msg = b.message; } catch (e) {}
      if (r.status === 401) return '❌ 令牌无效：' + (msg || 'GitHub 拒绝了这个令牌') + '（与网络/中继无关，是令牌本身问题——请确认复制的是完整 ghp_/github_pat_ 整串，且未过期、未撤销）';
      if (r.status === 403) return '❌ 权限不足(403)：' + (msg || '令牌没有该仓库权限') + '｜经典 ghp_ 需勾 repo；Fine-grained 需在 Contents 设 Read and write 并重新生成';
      if (r.status === 404) return '❌ 找不到仓库(404)：仓库名需为 用户名/仓库名、且已创建、与令牌同账号';
      return '❌ 错误 ' + r.status + (msg ? '：' + msg : '') + '（' + lastVia + '）';
    } catch (e) {
      const detail = (e && e.message) ? e.message : ('' + e);
      let out = '❌ 网络错误：' + detail + '。\n';
      if (!proxy) out += '当前「中转地址」为空——你的网络拦截了浏览器直连 api.github.com。请按说明自建一个免费中继并填入「中转地址」，或改用能直连该域名的环境。';
      else out += '已配置中转但仍失败，请检查中转地址是否正确、以及该地址能否从本机正常访问。';
      return out;
    }
  }

  async function ghStatus() {
    const s = await App.db.getSettings().catch(() => ({}));
    return { enabled: ghEnabled(s), repo: (s && s.ghRepo) || '', lastPush, lastError };
  }

  // 任意数据写入后由 db.js 调用：两路都调度
  function push() {
    scheduleFolder();
    scheduleCloud();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    supported, init, chooseDir, push, pushNow, status,
    ghPushNow, restore: cloudPull, ghTest, ghStatus
  };
})();
