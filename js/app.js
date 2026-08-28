// 入口：初始化数据库、注册 Service Worker、绑定 FAB、启动路由
window.App = window.App || {};

(function () {
  // 开屏动画：约 1.2s 后淡出移除（尊重系统「减弱动效」）
  function hideSplash() {
    const sp = document.getElementById('splash');
    if (!sp) return;
    const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rm && rm.matches) { sp.remove(); return; }
    setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 400); }, 900);
  }

  // 注册 Service Worker，并在检测到新版本时自动刷新页面。
  // 这样线上一更新，手机重开 app 就会静默变成新版，不用手动删图标重装。
  function registerSWWithUpdate() {
    if (!('serviceWorker' in navigator)) return;
    let refreshing = false;
    // 新 SW 激活接管页面时，刷新一次以加载新版资源（防死循环：只刷新一次）
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // 检测到新 SW 正在安装：sw.js 里已有 skipWaiting()，装完会立即激活，
      // 进而触发上面的 controllerchange → 自动刷新。
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // 仅当「有旧版在控制页面」时才算更新（首次安装不刷新）
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            // 等待 skipWaiting 让新 SW 接管，无需手动处理
          }
        });
      });
      // 主动检查一次更新（应对「划掉重开但浏览器没去拉新 sw」的情况）
      reg.update().catch(() => {});
    }).catch(() => {});
  }

  function boot() {
    hideSplash();
    App.db.open()
      .then(() => App.views.list.init())
      .then(() => {
        document.getElementById('fab').onclick = () => App.router.go('#/edit');
        if (location.protocol.startsWith('http')) {
          registerSWWithUpdate();
        } else {
          console.warn('当前以 file:// 打开，Service Worker 不可用；建议托管到 https 以获得最佳体验。');
        }
        App.router.start();
      })
      .catch(err => {
        console.error(err);
        document.getElementById('view').innerHTML = '<div class="empty">初始化失败：' + (err.message || err) + '<br>请使用较新的浏览器（Chrome/Edge/Safari）。</div>';
      });
  }

  // 键盘遮挡输入框：检测真实键盘高度，弹窗/聊天窗/普通页统一适配，保证输入框永远不被盖住
  function fixKeyboard() {
    const root = document.documentElement;
    const isField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const setKb = () => {
      let kh = 0;
      if (window.visualViewport) {
        const vv = window.visualViewport;
        // overlays 模式下 visualViewport 高度变小、layout 视口不变 → 差为键盘高；resizes 模式下差为 0
        kh = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      }
      root.style.setProperty('--kb', kh + 'px');
      const el = document.activeElement;
      const inField = isField(el);
      // 只有真实键盘（高度>阈值）弹起时才切换布局，避免地址栏收缩误触发
      document.body.classList.toggle('kb-open', inField && kh > 80);
      if (inField) {
        // 等两帧：键盘把视口压小、布局稳定后，再把聚焦框滚到可见区正中
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
        }));
      }
    };
    document.addEventListener('focusin', setKb);
    document.addEventListener('focusout', () => setTimeout(() => {
      const el = document.activeElement;
      if (!isField(el)) { document.body.classList.remove('kb-open'); root.style.setProperty('--kb', '0px'); }
    }, 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setKb);
      window.visualViewport.addEventListener('scroll', setKb);
    }
    window.addEventListener('resize', setKb);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  fixKeyboard();
})();
