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
        <p class="muted" style="margin-top:8px">免费获取：注册 themoviedb.org → 设置 → API → 复制 v3 key。密钥只存在你本地，用于搜索电影资料；搜不到时会自动改为手动填写。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">💾 数据备份</div>
        <button class="btn block" id="exportBtn">导出备份（JSON）</button>
        <div style="height:10px"></div>
        <button class="btn block" id="importBtn">导入备份（JSON）</button>
        <input type="file" id="importFile" accept="application/json" hidden>
        <p class="muted" style="margin-top:8px">备份文件包含全部电影和截图，请妥善保存、不要公开分享。</p>
      </div>

      <hr class="sep">

      <div class="view-block">
        <div class="section-title">📖 使用说明</div>
        <div class="help-step"><div class="n">1</div><div class="t"><b>添加电影</b>：首页搜索栏输入片名 → 点结果的“添加” → 选观影时间 → 进电影库。没有密钥也可手动添加。</div></div>
        <div class="help-step"><div class="n">2</div><div class="t"><b>记录内容</b>：点进电影，用四个分栏写——<b>观影感受</b>、<b>喜欢的台词</b>、<b>最美定格</b>（上传截图+评论+标最美）、<b>评论区</b>（评分+短评）。</div></div>
        <div class="help-step"><div class="n">3</div><div class="t"><b>看统计</b>：底部“统计”看今年观影数、平均分、<b>观影偏好</b>（各类型看了多少）、按月趋势和评分分布。</div></div>
        <div class="help-step"><div class="n">4</div><div class="t"><b>定期备份</b>：在“设置”里点导出备份，防止数据丢失。</div></div>
      </div>

      <hr class="sep">
      <p class="muted" style="text-align:center">观影手记 · 你的私人电影日记</p>
    `;

    document.getElementById('saveKey').onclick = () => {
      settings.tmdbApiKey = document.getElementById('apiKey').value.trim();
      App.db.saveSettings(settings).then(() => App.util.toast('密钥已保存'));
    };
    document.getElementById('exportBtn').onclick = () => App.util.exportAll();
    const fileInput = document.getElementById('importFile');
    document.getElementById('importBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files[0]) App.util.importAll(fileInput.files[0]); };
  }

  return { render, reload };
})();
