// 数据同步：把全量数据自动写到本地文件夹（File System Access API，仅 Edge/Chrome 桌面版）
// 该文件夹里的 movie-diary-latest.json 既是防丢备份，也是 WorkBuddy / Hermes 读取进知识库的中间文件
window.App = window.App || {};
App.sync = (function () {
  let dirHandle = null;     // 当前会话的目录句柄
  let dirName = '';         // 目录显示名
  let timer = null;         // 防抖定时器
  const DEBOUNCE = 800;     // 多次写操作合并成一个文件写

  function supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  // 页面加载时尝试恢复上次授权的目录（跨会话需重新请求权限）
  async function init() {
    if (!supported()) return;
    try {
      const rec = await App.db.getKV('syncDir');
      if (rec && rec.handle) {
        const ok = await verify(rec.handle);
        if (ok) { dirHandle = rec.handle; dirName = rec.handle.name || '已选文件夹'; }
        else { await App.db.setKV('syncDir', { handle: null }); }
      }
    } catch (e) { /* 忽略，下次手动选 */ }
  }

  async function verify(handle) {
    try {
      const opt = { type: 'file-system-access', handle };
      const st = await navigator.permissions.query(opt);
      if (st.state === 'granted') return true;
      return (await navigator.permissions.request(opt)).state === 'granted';
    } catch (e) { return false; }
  }

  // 由用户点击触发：选目录并持久化
  async function chooseDir() {
    if (!supported()) {
      App.util.toast('当前浏览器不支持自动同步，请用 Edge/Chrome 桌面版，或用「导出备份」');
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

  // 防抖写盘：数据库任意写操作后调用，连续写会被合并
  function push() {
    if (!dirHandle) return;
    clearTimeout(timer);
    timer = setTimeout(() => { pushNow().catch(() => {}); }, DEBOUNCE);
  }

  // 立即把全量数据写成 movie-diary-latest.json（含截图 base64，可完整恢复）
  async function pushNow() {
    if (!dirHandle) { App.util.toast('请先选择同步文件夹'); return; }
    try {
      const [records, shots] = await Promise.all([App.db.getRecords(), App.db.getAllScreenshots()]);
      // 截图转 base64 内嵌，保留完整备份（摄入知识库时只取文字）
      const shots64 = await Promise.all(
        shots.map(s => App.util.blobToDataURL(s.blob).then(d => ({ ...s, dataURL: d })))
      );
      const payload = {
        app: 'movie-diary', version: 2, exportedAt: new Date().toISOString(),
        records, screenshots: shots64
      };
      const fileHandle = await dirHandle.getFileHandle('movie-diary-latest.json', { create: true });
      const w = await fileHandle.createWritable();
      await w.write(JSON.stringify(payload));
      await w.close();
      App.util.toast('已同步到本地文件夹');
    } catch (e) {
      App.util.toast('同步失败：' + (e.message || e));
    }
  }

  function status() {
    return { connected: !!dirHandle, name: dirName, supported: supported() };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { supported, init, chooseDir, push, pushNow, status };
})();
