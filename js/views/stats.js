// 视图：统计看板 —— 观影偏好 / 趋势 / 分布（轻量 SVG 自绘，无第三方依赖）
window.App = window.App || {};
App.views = App.views || {};

App.views.stats = (function () {
  let records = [];

  async function reload() { records = await App.db.getRecords(); }

  function hBars(data) {
    if (!data.length) return '<div class="muted">还没有标签数据，去给电影打标签吧</div>';
    const max = Math.max(...data.map(d => d.value), 1);
    return `<div style="display:flex;flex-direction:column;gap:9px">` + data.map(d => `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px">
        <div style="width:64px;flex:none;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${App.util.escapeHtml(d.label)}</div>
        <div style="flex:1;height:14px;background:var(--bg-soft);border-radius:8px;overflow:hidden">
          <div style="width:${(d.value / max * 100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,var(--blue),var(--green));border-radius:8px"></div>
        </div>
        <div style="width:22px;text-align:right;color:var(--primary-deep);font-weight:600">${d.value}</div>
      </div>`).join('') + `</div>`;
  }

  function lineChart(months) {
    const max = Math.max(...months, 1);
    const W = 300, H = 120, pad = 18;
    const step = (W - pad * 2) / 11;
    const pts = months.map((v, i) => {
      const x = pad + i * step;
      const y = H - pad - (v / max) * (H - pad * 2);
      return [x, y];
    });
    const line = pts.map(p => p.join(',')).join(' ');
    const area = `${pad},${H - pad} ` + line + ` ${W - pad},${H - pad}`;
    const dots = pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="var(--primary-deep)"></circle>`).join('');
    const labels = [1, 6, 12].map(m => `<text x="${pad + (m - 1) * step}" y="${H - 4}" font-size="9" fill="var(--muted)" text-anchor="middle">${m}月</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
      <polygon points="${area}" fill="rgba(124,196,192,.15)"></polygon>
      <polyline points="${line}" fill="none" stroke="var(--primary-deep)" stroke-width="2"></polyline>
      ${dots}${labels}</svg>`;
  }

  function vBars(data) {
    const max = Math.max(...data.map(d => d.value), 1);
    return `<div style="display:flex;align-items:flex-end;gap:10px;height:120px">` + data.map(d => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
        <div style="font-size:12px;color:var(--primary-deep);font-weight:600">${d.value}</div>
        <div style="width:70%;background:linear-gradient(180deg,var(--green),var(--blue));border-radius:6px 6px 0 0;height:${(d.value / max * 80).toFixed(1)}%"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${d.label}</div>
      </div>`).join('') + `</div>`;
  }

  function render(param, root) {
    const year = new Date().getFullYear();
    const yearStr = String(year);
    // 观影次数（含二刷三刷）：今年所有观影事件总数
    const yearWatchEvents = records.reduce((s, r) =>
      s + App.util.watchDates(r).filter(d => d.slice(0, 4) === yearStr).length, 0);
    const rewatchedMovies = records.filter(r => App.util.watchCount(r) > 1).length;
    const allEntries = records.flatMap(r => App.util.entries(r));
    const rated = allEntries.filter(e => e.rating > 0);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : '—';

    // 观影偏好：标签计数
    const tagCount = {};
    records.forEach(r => (r.tags || []).forEach(t => tagCount[t] = (tagCount[t] || 0) + 1));
    const prefData = Object.entries(tagCount).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10);

    // 按月趋势（今年，按每次观影事件统计）
    const months = Array(12).fill(0);
    records.forEach(r => App.util.watchDates(r).forEach(d => {
      if (d.slice(0, 4) === yearStr) { const m = parseInt(d.slice(5, 7), 10); if (m >= 1 && m <= 12) months[m - 1]++; }
    }));

    // 评分分布
    const dist = [1, 2, 3, 4, 5].map(i => ({ label: i + '★', value: rated.filter(r => r.rating === i).length }));

    root.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><div class="num">${yearWatchEvents}</div><div class="lbl">${year}年观影·次</div></div>
        <div class="stat-card"><div class="num">${avg}</div><div class="lbl">平均评分</div></div>
        <div class="stat-card"><div class="num">${records.length}</div><div class="lbl">累计电影</div></div>
      </div>

      <div class="view-block">
        <div class="section-title">🎯 观影偏好 <span class="hint">看的类型多少 · 二刷${rewatchedMovies}部</span></div>
        ${hBars(prefData)}
      </div>

      <div class="view-block">
        <div class="section-title">📈 按月趋势 <span class="hint">${year}年</span></div>
        ${records.length ? lineChart(months) : '<div class="muted">还没有数据</div>'}
      </div>

      <div class="view-block">
        <div class="section-title">⭐ 评分分布</div>
        ${rated.length ? vBars(dist) : '<div class="muted">还没有评分</div>'}
      </div>`;
  }

  return { render, reload };
})();
