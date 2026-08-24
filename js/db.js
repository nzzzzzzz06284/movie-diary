// 数据层：无第三方依赖的 IndexedDB 封装（records / screenshots / settings）
window.App = window.App || {};
App.db = (function () {
  let _db = null;
  const DB_NAME = 'movie-diary';
  const DB_VER = 2;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('records')) {
          const s = db.createObjectStore('records', { keyPath: 'id' });
          s.createIndex('watchedDate', 'watchedDate');
          s.createIndex('rating', 'rating');
          s.createIndex('tags', 'tags', { multiEntry: true });
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('screenshots')) {
          const s = db.createObjectStore('screenshots', { keyPath: 'id' });
          s.createIndex('recordId', 'recordId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }
  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- records ----
  function _dates(rec) {
    if (rec && Array.isArray(rec.watchDates) && rec.watchDates.length) return rec.watchDates;
    return rec && rec.watchedDate ? [rec.watchedDate] : [];
  }
  function _latest(rec) { return _dates(rec).slice().sort().reverse()[0] || ''; }
  // 把记录规整成「按次 entries」结构，并兼容旧数据（顶层 watchedDate/rating/review/comment/quotes）
  function norm(rec) {
    if (!rec) return rec;
    if (!Array.isArray(rec.entries) || !rec.entries.length) {
      const dates = (Array.isArray(rec.watchDates) && rec.watchDates.length) ? rec.watchDates.slice()
        : (rec.watchedDate ? [rec.watchedDate] : []);
      const base = {
        seq: 1, watchDate: dates[0] || '',
        rating: rec.rating || 0, review: rec.review || '', comment: rec.comment || '',
        quotes: rec.quotes || []
      };
      rec.entries = dates.map((d, i) => i === 0 ? base
        : { seq: i + 1, watchDate: d, rating: 0, review: '', comment: '', quotes: [] });
      if (!rec.entries.length) rec.entries = [base];
    } else {
      rec.entries.forEach((e, i) => {
        e.seq = e.seq || (i + 1);
        e.watchDate = e.watchDate || '';
        e.rating = e.rating || 0;
        e.review = e.review || '';
        e.comment = e.comment || '';
        e.quotes = e.quotes || [];
      });
    }
    rec.watchDates = rec.entries.map(e => e.watchDate).filter(Boolean).sort();
    rec.watchedDate = rec.watchDates[rec.watchDates.length - 1] || (rec.entries[0] && rec.entries[0].watchDate) || '';
    return rec;
  }
  function getRecords() {
    return tx('records', 'readonly').then(os => reqP(os.getAll()))
      .then(list => (list || []).map(norm).sort((a, b) => _latest(b).localeCompare(_latest(a))));
  }
  function getRecord(id) {
    return tx('records', 'readonly').then(os => reqP(os.get(id))).then(norm);
  }
  function saveRecord(rec) {
    rec.updatedAt = Date.now();
    return tx('records', 'readwrite').then(os => reqP(os.put(rec)))
      .then(() => { if (App.sync && App.sync.push) App.sync.push(); return rec; });
  }
  function deleteRecord(id) {
    return tx('records', 'readwrite').then(os => reqP(os.delete(id)))
      .then(() => getScreenshots(id))
      .then(shots => Promise.all(shots.map(s => deleteScreenshot(s.id))))
      .then(() => { if (App.sync && App.sync.push) App.sync.push(); });
  }

  // ---- screenshots ----
  function getAllScreenshots() {
    return tx('screenshots', 'readonly').then(os => reqP(os.getAll()));
  }
  function getScreenshots(recordId) {
    return tx('screenshots', 'readonly').then(os => reqP(os.index('recordId').getAll(recordId)))
      .then(list => (list || []).sort((a, b) => (a.order || 0) - (b.order || 0)));
  }
  function saveScreenshot(shot) {
    return tx('screenshots', 'readwrite').then(os => reqP(os.put(shot)))
      .then(() => { if (App.sync && App.sync.push) App.sync.push(); return shot; });
  }
  function deleteScreenshot(id) {
    return tx('screenshots', 'readwrite').then(os => reqP(os.delete(id)))
      .then(() => { if (App.sync && App.sync.push) App.sync.push(); });
  }

  // ---- settings ----
  function getSettings() {
    return tx('settings', 'readonly').then(os => reqP(os.get('app')))
      .then(s => s || { key: 'app', tmdbApiKey: '', ratingScale: 5, theme: 'light' });
  }
  function saveSettings(obj) {
    obj.key = 'app';
    return tx('settings', 'readwrite').then(os => reqP(os.put(obj)));
  }
  // 通用键值存储（用于个人资料等，key 任意）
  function getKV(key) {
    return tx('settings', 'readonly').then(os => reqP(os.get(key)));
  }
  function setKV(key, obj) {
    obj.key = key;
    return tx('settings', 'readwrite').then(os => reqP(os.put(obj)));
  }

  // ---- audio（用户上传的音乐）----
  function getTracks() {
    return tx('audio', 'readonly').then(os => reqP(os.getAll()))
      .then(list => (list || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
  }
  function saveTrack(t) { return tx('audio', 'readwrite').then(os => reqP(os.put(t))).then(() => t); }
  function deleteTrack(id) { return tx('audio', 'readwrite').then(os => reqP(os.delete(id))); }

  return { open, getRecords, getRecord, saveRecord, deleteRecord,
           getAllScreenshots, getScreenshots, saveScreenshot, deleteScreenshot,
           getSettings, saveSettings, getKV, setKV,
           getTracks, saveTrack, deleteTrack };
})();
