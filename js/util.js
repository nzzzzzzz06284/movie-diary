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
    const max = scale === 10 ? 5 : 5;
    // 10分制按每2分一星显示；5分制一星一分
    const full = scale === 10 ? Math.round((rating || 0) / 2) : Math.round(rating || 0);
    let h = '<span class="rate">';
    for (let i = 1; i <= 5; i++) h += i <= full ? '★' : '☆';
    h += `</span>`;
    return h;
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
  function watchCount(rec) { return watchDates(rec).length; }

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

  return { uid, today, fmtDate, escapeHtml, starsHtml, toast,
           compressImage, blobToDataURL, dataURLToBlob, exportAll, importAll,
           watchDates, latestWatch, firstWatch, watchCount,
           entries, entryBySeq, latestEntry, latestRating, entryLabel };
})();
