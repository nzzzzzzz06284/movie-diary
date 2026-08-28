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

  // 键盘遮挡输入框：聚焦时把输入框顶进可见区；并监听软键盘高度变化重复调整
  function fixKeyboard() {
    const scrollActiveIntoView = () => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        // 下一帧再滚，等键盘把视口压小后定位才准确
        requestAnimationFrame(() => {
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
        });
      }
    };
    document.addEventListener('focusin', scrollActiveIntoView);
    if (window.visualViewport) {
      // 软键盘弹出/收起会让 visualViewport 高度变化，重新把输入框顶上来
      let raf = null;
      window.visualViewport.addEventListener('resize', () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(scrollActiveIntoView);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  fixKeyboard();
})();
