// 入口：初始化数据库、注册 Service Worker、绑定 FAB、启动路由
window.App = window.App || {};

(function () {
  function boot() {
    App.db.open()
      .then(() => App.views.list.init())
      .then(() => {
        document.getElementById('fab').onclick = () => App.router.go('#/edit');
        if (location.protocol.startsWith('http')) {
          navigator.serviceWorker && navigator.serviceWorker.register('sw.js').catch(() => {});
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
