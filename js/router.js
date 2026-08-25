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
    // 悬浮加号只在「我的电影库」显示
    document.getElementById('fab').style.display = (name === 'list') ? 'flex' : 'none';
    // 深色沉浸视图：电影库 / 我的电影库
    const isDark = name === 'discover' || name === 'list';
    document.body.classList.toggle('dark-view', isDark);
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', isDark ? '#0e1615' : '#3f9d95');

    if (!view) { root.innerHTML = '<div class="empty">页面不存在</div>'; return; }
    try {
      if (view.reload) await view.reload(param);
      view.render(param, root);
      root.classList.remove('anim'); void root.offsetWidth; root.classList.add('anim');
    } catch (e) {
      console.error(e);
      root.innerHTML = '<div class="empty">出错了：' + (e.message || e) + '</div>';
    }
  }

  function go(hash) { location.hash = hash; }

  function start() {
    // 给底部导航栏绑定点击跳转（之前漏了，导致点不动）
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => { App.audio && App.audio.sfx('click'); go(t.dataset.route); });
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/discover';
    else render();
  }

  return { start, go, parse };
})();
