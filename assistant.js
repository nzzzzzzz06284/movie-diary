// 视图：Hermes 智能助手（可拖动悬浮聊天窗，QQ 风格，拖动后吸附左右边缘）
window.App = window.App || {};
App.views = App.views || {};

// ---------- 聊天核心：消息状态 + 请求逻辑（视图无关） ----------
App.assistant = (function () {
  let messages = [];        // user / bot 消息（system 每次现算）
  let sessionId = null;
  const SKEY = 'hermes_session_id';
  const DEFAULT_URL = 'http://localhost:8642';

  function ensureSession() {
    if (sessionId) return sessionId;
    try { sessionId = localStorage.getItem(SKEY); } catch (e) {}
    if (!sessionId) {
      sessionId = 'md-' + App.util.uid();
      try { localStorage.setItem(SKEY, sessionId); } catch (e) {}
    }
    return sessionId;
  }

  function resetSession() {
    sessionId = 'md-' + App.util.uid();
    try { localStorage.setItem(SKEY, sessionId); } catch (e) {}
    messages = [];
  }

  function getMessages() { return messages; }

  async function buildContext() {
    let records = [];
    try { records = (await App.db.getAllRecords()) || []; } catch (e) { records = []; }
    const n = records.length;
    if (!n) {
      return '用户目前还没有记录任何电影。如果她问推荐，可以给她一些经典通用推荐，' +
             '并鼓励她先在「观影手记」app 里添加看过的电影，这样以后就能基于真实数据帮她总结。';
    }
    const list = records.slice(0, 80).map(r => {
      const e = (App.util.latestEntry && App.util.latestEntry(r)) || (r.entries || [])[0] || {};
      const rating = e.rating || r.rating || 0;
      const dates = App.util.watchDates(r);
      const g = (r.genres && r.genres.length) ? ('[' + r.genres.join('/') + ']') : '';
      const review = e.review ? (' 感受：' + (e.review.length > 36 ? e.review.slice(0, 36) + '…' : e.review)) : '';
      return '- 《' + r.title + '》' + g + ' 评分' + rating + ' 看了' + dates.length + '次' + review;
    }).join('\n');
    return '你是「观影手记」app 里的中文小助手，用户叫了了（四川农业大学学生，喜欢 K-pop、跳舞）。\n' +
           '以下是她真实记录在自己电影库里的电影（共 ' + n + ' 部）：\n' + list + '\n\n' +
           '你的职责：\n' +
           '1. 回答她关于观影的任何问题；\n' +
           '2. 她要推荐时，结合上面的偏好（喜欢的类型、给高分的片）推荐类似电影，并说明理由；\n' +
           '3. 她要年度报告 / 总结时，基于上面的真实数据生成温暖、具体、有温度的总结（提到具体片名），' +
           '绝不要把她没看过的片说成"已看"；\n' +
           '4. 用简体中文、口语化、像朋友聊天，避免 AI 腔和空话。';
  }

  function appendMsg(root, role, text) {
    messages.push({ role, content: text });
    const box = root.querySelector('#cwMsgs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'me' : 'bot');
    const txt = App.util.escapeHtml(String(text));
    div.innerHTML = role === 'user'
      ? '<div class="bubble">' + txt + '</div><span class="avatar me-av">👤</span>'
      : '<span class="avatar bot-av"></span><div class="bubble">' + txt + '</div>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function renderAll(root) {
    const box = root.querySelector('#cwMsgs');
    if (!box) return;
    box.innerHTML = '';
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (m.role === 'user' ? 'me' : 'bot');
      const txt = App.util.escapeHtml(String(m.content));
      div.innerHTML = m.role === 'user'
        ? '<div class="bubble">' + txt + '</div><span class="avatar me-av">👤</span>'
        : '<span class="avatar bot-av"></span><div class="bubble">' + txt + '</div>';
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function showIntro(root) {
    appendMsg(root, 'bot', '嗨了了～我是 084，你的观影小助手\n我连着你的电影库，可以帮你推荐电影、生成年度报告、总结观影口味。\n直接发消息就行，比如「帮我生成观影年度报告」。');
  }

  async function submit(root, text) {
    appendMsg(root, 'user', text);
    const settings = await App.db.getSettings();
    const base = (settings.hermesUrl || DEFAULT_URL).replace(/\/+$/, '');
    let key = settings.hermesKey || '';
    const sys = await buildContext();
    const payload = {
      model: 'hermes',
      stream: false,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: sys },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ]
    };
    const headers = { 'Content-Type': 'application/json', 'X-Hermes-Session-Id': ensureSession() };
    if (key) headers['Authorization'] = 'Bearer ' + key;

    const box = root.querySelector('#cwMsgs');
    const ph = document.createElement('div');
    ph.className = 'chat-msg bot';
    ph.innerHTML = '<span class="avatar bot-av"></span><div class="bubble">思考中…</div>';
    box.appendChild(ph);
    box.scrollTop = box.scrollHeight;

    let reply;
    try {
      const resp = await fetch(base + '/v1/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        let detail = '';
        try { const d = await resp.json(); detail = (d.error && d.error.message) || ''; } catch (e) {}
        reply = '调用失败（HTTP ' + resp.status + '）' + (detail ? '：' + detail : '') +
          '\n\n请到「设置 → Hermes 智能助手」检查网关地址和 API Key。';
      } else {
        const data = await resp.json();
        reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '（空回复）';
      }
    } catch (e) {
      reply = '网络错误：' + e.message + '\n\n请确认 Hermes 正在运行、网关已开启。';
    }
    ph.innerHTML = '<span class="avatar bot-av"></span><div class="bubble">' + App.util.escapeHtml(reply) + '</div>';
    messages.push({ role: 'bot', content: reply });
  }

  async function testConnection() {
    const settings = await App.db.getSettings();
    const base = (settings.hermesUrl || DEFAULT_URL).replace(/\/+$/, '');
    let key = settings.hermesKey || '';
    const keyInput = document.getElementById('hermesKey');
    if (keyInput && keyInput.value && keyInput.value.trim()) key = keyInput.value.trim();
    const headers = { 'Content-Type': 'application/json', 'X-Hermes-Session-Id': 'test' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    try {
      const r = await fetch(base + '/v1/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model: 'hermes', stream: false, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] })
      });
      if (r.ok) return '连接成功 ✅';
      return '连接失败（HTTP ' + r.status + '）' + (r.status === 403 ? '：多为 CORS 未放行' : (r.status === 401 ? '：API Key 不对' : ''));
    } catch (e) {
      return '连接失败：' + e.message + '（请确认 Hermes 已开启 API 网关）';
    }
  }

  // 💬 圆形气泡可拖动：拖动到左右边缘松手吸附，位置记住；短点按=开关聊天窗
  function init() {
    const fab = document.getElementById('fabAssistant');
    if (!fab) return;
    const KEY = 'fab_assistant_pos';
    let startX = null, startY = null, dragMoved = false, suppressClick = false;
    const apply = (p) => {
      if (!p) return;
      fab.style.left = p.left + 'px'; fab.style.top = p.top + 'px';
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
    };
    try { apply(JSON.parse(localStorage.getItem(KEY))); } catch (e) {}
    fab.addEventListener('pointerdown', e => {
      startX = e.clientX; startY = e.clientY; dragMoved = false;
      const r = fab.getBoundingClientRect();
      fab._ox = r.left; fab._oy = r.top;
    });
    window.addEventListener('pointermove', e => {
      if (startX == null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragMoved && Math.hypot(dx, dy) > 8) dragMoved = true;
      if (dragMoved) {
        const w = fab.offsetWidth, vw = window.innerWidth, vh = window.innerHeight;
        let L = fab._ox + dx, T = fab._oy + dy;
        L = Math.max(6, Math.min(vw - w - 6, L));
        T = Math.max(70, Math.min(vh - w - 110, T)); // 不遮顶栏/tabbar
        fab.style.left = L + 'px'; fab.style.top = T + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
      }
    });
    const end = () => {
      if (startX == null) return;
      startX = null;
      if (dragMoved) {
        const r = fab.getBoundingClientRect();
        const m = Math.max(10, (window.innerWidth - 520) / 2);
        const toLeft = (r.left - m) <= (window.innerWidth - m - r.width - r.left);
        const L = toLeft ? m : (window.innerWidth - m - r.width);
        const T = Math.max(70, Math.min(window.innerHeight - r.height - 110, r.top));
        fab.style.left = L + 'px'; fab.style.top = T + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
        try { localStorage.setItem(KEY, JSON.stringify({ left: L, top: T })); } catch (e2) {}
        suppressClick = true;
        dragMoved = false;
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    fab.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; } // 拖完不触发开关
      App.audio && App.audio.sfx('click');
      App.chatWin.toggle();
    });
  }
  init();

  return { testConnection, resetSession, getMessages, renderAll, showIntro, submit };
})();

// ---------- 可拖动悬浮聊天窗（拖动头部移动，松手吸附左右边缘） ----------
App.chatWin = (function () {
  let win = null, open = false, pos = null;

  function build() {
    win = document.createElement('div');
    win.className = 'chat-win';
    win.innerHTML = `
      <div class="chat-head" id="cwHead">
        <span class="chat-avatar"></span>
        <div class="chat-title">
          <div class="chat-name">Hermes 观影助手</div>
          <div class="chat-status">在线</div>
        </div>
        <button class="chat-reset" id="cwReset" title="开启新对话">↺</button>
        <button class="chat-close" id="cwClose" title="收起">—</button>
      </div>
      <div class="chat-msgs" id="cwMsgs"></div>
      <div class="chat-input-row">
        <textarea id="cwInput" placeholder="输入消息…"></textarea>
        <button class="btn primary" id="cwSend">发送</button>
      </div>`;
    document.body.appendChild(win);

    win.querySelector('#cwClose').onclick = () => close();
    win.querySelector('#cwReset').onclick = () => {
      App.assistant.resetSession();
      const m = win.querySelector('#cwMsgs'); m.innerHTML = '';
      App.assistant.showIntro(win);
    };
    const input = win.querySelector('#cwInput');
    const doSend = () => {
      const t = input.value.trim();
      if (!t) return;
      input.value = '';
      App.assistant.submit(win, t);
    };
    win.querySelector('#cwSend').onclick = doSend;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    initDrag();
  }

  function initDrag() {
    const head = win.querySelector('#cwHead');
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return; // 点按钮不拖拽
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = win.getBoundingClientRect();
      ox = r.left; oy = r.top;
      win.classList.add('dragging');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('pointermove', e => {
      if (!dragging) return;
      let L = ox + (e.clientX - sx), T = oy + (e.clientY - sy);
      const w = win.offsetWidth, h = win.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      L = Math.max(4, Math.min(vw - w - 4, L));
      T = Math.max(4, Math.min(vh - h - 4, T));
      win.style.left = L + 'px'; win.style.top = T + 'px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      win.classList.remove('dragging');
      document.body.style.userSelect = '';
      snap();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // 松手吸附到最近的左/右边缘（横向对齐 app 520px 内容列，纵向限制在视口内）
  function snap() {
    const w = win.offsetWidth, h = win.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const m = Math.max(8, (vw - 520) / 2);
    const cur = win.getBoundingClientRect();
    const toLeft = (cur.left - m) <= (vw - m - w - cur.left);
    const L = toLeft ? m : (vw - m - w);
    const T = Math.max(8, Math.min(vh - h - 8, cur.top));
    win.style.left = L + 'px'; win.style.top = T + 'px';
    win.style.right = 'auto'; win.style.bottom = 'auto';
    pos = { left: L, top: T };
  }

  function openWin() {
    if (!win) build();
    const msgs = win.querySelector('#cwMsgs');
    if (!msgs.childNodes.length) App.assistant.showIntro(win);
    else App.assistant.renderAll(win);
    if (pos) {
      win.style.left = pos.left + 'px'; win.style.top = pos.top + 'px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
    }
    win.classList.add('open');
    open = true;
    setTimeout(() => { try { win.querySelector('#cwInput').focus(); } catch (e) {} }, 120);
  }
  function close() { if (!win) return; win.classList.remove('open'); open = false; }
  function toggle() { App.audio && App.audio.sfx('click'); open ? close() : openWin(); }
  return { toggle, open: openWin, close };
})();
