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

  // ===================== 本地文件夹（桌面） =====================
  function supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  async function init() {
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
  function ghEnabled(s) { return !!(s && s.ghToken && s.ghRepo); }
  function ghPath(s) { return (s && s.ghPath) || 'movie-diary-data.json'; }
  function ghBranch(s) { return (s && s.ghBranch) || 'main'; }

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
    if (cloudBusy) { cloudPending = true; return; }
    cloudBusy = true;
    try {
      const payload = await buildPayload();
      const content = utf8ToBase64(JSON.stringify(payload));
      const url = `https://api.github.com/repos/${encodeURIComponent(s.ghRepo)}/contents/${encodeURIComponent(ghPath(s))}?ref=${encodeURIComponent(ghBranch(s))}`;
      const headers = { Authorization: 'Bearer ' + s.ghToken, Accept: 'application/vnd.github+json' };

      // 取当前文件 sha（用于更新；404 表示首次创建）
      let sha = null;
      try {
        const r = await fetch(url, { headers: { Authorization: headers.Authorization, Accept: headers.Accept } });
        if (r.ok) { const j = await r.json(); sha = j.sha; }
        else if (r.status !== 404) { lastError = '读取云端失败 ' + r.status; return; }
      } catch (e) { lastError = '网络错误（读取）'; return; }

      const body = { message: 'movie-diary auto sync', content, branch: ghBranch(s) };
      if (sha) body.sha = sha;

      let r = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
      // 冲突（另一设备先推了）：重新取 sha 再试一次
      if (r.status === 409 && sha) {
        try {
          const r2 = await fetch(url, { headers: { Authorization: headers.Authorization, Accept: headers.Accept } });
          if (r2.ok) { const j = await r2.json(); body.sha = j.sha; r = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) }); }
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
    const url = `https://api.github.com/repos/${encodeURIComponent(s.ghRepo)}/contents/${encodeURIComponent(ghPath(s))}?ref=${encodeURIComponent(ghBranch(s))}`;
    const headers = { Authorization: 'Bearer ' + s.ghToken, Accept: 'application/vnd.github+json' };
    let r;
    try { r = await fetch(url, { headers }); }
    catch (e) { App.util.toast('网络错误，拉取失败'); return false; }
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
      const url = `https://api.github.com/repos/${encodeURIComponent(s.ghRepo)}/contents/${encodeURIComponent(ghPath(s))}?ref=${encodeURIComponent(ghBranch(s))}`;
      const headers = { Authorization: 'Bearer ' + s.ghToken, Accept: 'application/vnd.github+json' };
      const r = await fetch(url, { headers });
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

  async function ghTest() {
    const s = await App.db.getSettings();
    if (!ghEnabled(s)) return '请先填写令牌和仓库';
    try {
      const r = await fetch('https://api.github.com/repos/' + encodeURIComponent(s.ghRepo), {
        headers: { Authorization: 'Bearer ' + s.ghToken, Accept: 'application/vnd.github+json' }
      });
      if (r.ok) { const j = await r.json(); return '✅ 连接成功：' + j.full_name + (j.private ? '（私有）' : '（公开，建议设为私有）'); }
      if (r.status === 401) return '❌ 令牌无效或无权限（检查令牌是否正确、是否授权该仓库）';
      if (r.status === 404) return '❌ 找不到仓库，检查「仓库」格式是否为 用户名/仓库名';
      return '❌ 错误 ' + r.status;
    } catch (e) { return '❌ 网络错误：' + (e && e.message || e); }
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
