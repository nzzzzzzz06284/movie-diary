// 哈希路由：#/list #/stats #/settings #/detail/:id #/edit #/edit/:id
window.App = window.App || {};
App.router = (function () {
  let viewScroll = {};     // 各视图离开时的滚动位置（切回时恢复）
  let pendingTop = null;   // 双击底部 tab 时设此值 → 进入该视图后强制回到顶部
  let tabLastClick = {};   // 记录 tab 上次点击时间，用于识别双击

  function parse() {
    const raw = location.hash.replace(/^#\/?/, ''); // 去掉 #/ 前缀
    const parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'list', param: parts[1] || null };
  }

  async function render() {
    const { name, param } = parse();
    const view = App.views && App.views[name];
    const root = document.getElementById('view');
    // 记录当前（旧）视图的滚动位置，供切换回来时恢复
    const prev = document.body.dataset.curView;
    if (prev && prev !== name) viewScroll[prev] = window.scrollY;
    document.body.dataset.curView = name;
    // 底部 tab 高亮
    const activeRoute = (name === 'detail' || name === 'edit') ? '#/list' : '#/' + name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === activeRoute));
    // 悬浮加号只在「我的电影库」显示
    document.getElementById('fab').style.display = (name === 'list') ? 'flex' : 'none';
    // 深色沉浸视图：电影库 / 我的电影库
    const isDark = name === 'discover' || name === 'list';
    document.body.classList.toggle('dark-view', isDark);
    // theme-color 与头部渐变顶部同色（浅蓝），让手机状态栏（电量/WiFi 区）自然融入，
    // 不出现生硬分界线；渐变左上角固定为 --blue，所有视图都保持一致
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', '#a9d6e5');

    if (!view) { root.innerHTML = '<div class="empty">页面不存在</div>'; return; }
    try {
      if (view.reload) await view.reload(param);
      view.render(param, root);
      root.classList.remove('anim'); void root.offsetWidth; root.classList.add('anim');
      // 滚动位置：双击强制回顶；否则恢复上次离开的位置
      if (pendingTop === ('#/' + name)) {
        window.scrollTo(0, 0); pendingTop = null;
      } else if (viewScroll[name] != null) {
        const y = viewScroll[name];
        requestAnimationFrame(() => window.scrollTo(0, y));
        setTimeout(() => window.scrollTo(0, y), 500); // 异步视图（电影库）加载后兜底恢复
      }
    } catch (e) {
      console.error(e);
      root.innerHTML = '<div class="empty">出错了：' + (e.message || e) + '</div>';
    }
  }

  function go(hash) { location.hash = hash; }

  function start() {
    // 给底部导航栏绑定点击跳转；双击同一个 tab → 回到顶部
    document.querySelectorAll('.tab').forEach(t => {
      const route = t.dataset.route;
      t.onclick = () => {
        const now = Date.now();
        if (tabLastClick[route] && now - tabLastClick[route] < 320) {
          // 识别为双击：已在当前视图则直接回顶；否则下次进入时回顶
          tabLastClick[route] = 0;
          if (location.hash === route) window.scrollTo(0, 0);
          else { pendingTop = route; go(route); }
        } else {
          tabLastClick[route] = now;
          go(route);
        }
        App.audio && App.audio.sfx('click');
      };
    });
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/discover';
    else render();
  }

  return { start, go, parse };
})();
