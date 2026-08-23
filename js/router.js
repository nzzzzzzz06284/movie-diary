// 哈希路由：#/list #/stats #/settings #/detail/:id #/edit #/edit/:id
window.App = window.App || {};
App.router = (function () {
  function parse() {
    const raw = location.hash.replace(/^#\/?/, ''); // 去掉 #/ 前缀
    const parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'list', param: parts[1] || null };
  }

  async function render() {
    const { name, param } = parse();
    const view = App.views && App.views[name];
    const root = document.getElementById('view');
    // 底部 tab 高亮
    const activeRoute = (name === 'detail' || name === 'edit') ? '#/list' : '#/' + name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === activeRoute));
    document.getElementById('fab').style.display = (name === 'edit') ? 'none' : 'flex';

    if (!view) { root.innerHTML = '<div class="empty">页面不存在</div>'; return; }
    try {
      if (view.reload) await view.reload(param);
      view.render(param, root);
    } catch (e) {
      console.error(e);
      root.innerHTML = '<div class="empty">出错了：' + (e.message || e) + '</div>';
    }
  }

  function go(hash) { location.hash = hash; }

  function start() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/list';
    else render();
  }

  return { start, go, parse };
})();
