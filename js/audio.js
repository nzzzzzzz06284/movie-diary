// 音频引擎：操作音效（Web Audio 合成）+ 自带环境音景（雨声/森林/轻音乐）+ 用户上传曲目
window.App = window.App || {};
App.audio = (function () {
  let ctx = null;
  let sfxOn = true;
  let musicOn = false;
  let current = null;       // { type:'ambient'|'track', name }
  let ambientStop = null;   // 内置音景的停止函数
  let audioEl = null;       // 用户曲目的 <audio>
  let userList = [];        // 用户上传曲目列表（含 blob 引用缓存）
  let playMode = 'loop';    // 播放模式：loop 单曲循环 | list 列表顺序 | shuffle 随机

  // 内置音景名称（给用户看）
  const BUILTIN = [
    { id: 'rain',  name: '🌧 雨声',   desc: '安心的雨落声' },
    { id: 'forest', name: '🌲 森林',  desc: '林间微风与鸟鸣' },
    { id: 'lofi',  name: '🎹 轻音乐', desc: '柔和的氛围和弦' }
  ];

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- 操作音效 ----------
  function sfx(type) {
    if (!sfxOn) return;
    const c = ensureCtx(); if (!c) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g); g.connect(c.destination);
    if (type === 'click') {
      o.type = 'sine'; o.frequency.setValueAtTime(620, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      o.start(now); o.stop(now + 0.12);
    } else if (type === 'success') {
      o.type = 'triangle';
      o.frequency.setValueAtTime(523.25, now);
      o.frequency.setValueAtTime(783.99, now + 0.09);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      o.start(now); o.stop(now + 0.27);
    } else if (type === 'delete') {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(320, now);
      o.frequency.exponentialRampToValueAtTime(110, now + 0.2);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.13, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.start(now); o.stop(now + 0.23);
    }
  }

  // ---------- 内置音景 ----------
  function makeRain(c) {
    const size = 2 * c.sampleRate;
    const buf = c.createBuffer(1, size, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = c.createGain(); g.gain.value = 0.22;
    src.connect(lp); lp.connect(g); g.connect(c.destination);
    src.start();
    return () => { try { src.stop(); } catch (e) {} };
  }
  function makeForest(c) {
    const size = 2 * c.sampleRate;
    const buf = c.createBuffer(1, size, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.12;
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start();
    // 偶发鸟鸣
    const bird = () => {
      if (current && current.type !== 'ambient') return;
      const t = c.currentTime;
      const o = c.createOscillator(); const og = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1800 + Math.random() * 1200, t);
      o.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 800, t + 0.08);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(og); og.connect(c.destination); o.start(t); o.stop(t + 0.2);
    };
    const timer = setInterval(bird, 3500 + Math.random() * 3000);
    return () => { try { src.stop(); } catch (e) {} clearInterval(timer); };
  }
  function makeLofi(c) {
    // 柔和 Cmaj7 和弦 + 缓慢音量起伏（LFO）
    const freqs = [261.63, 329.63, 392.0, 493.88];
    const os = freqs.map(f => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; return o; });
    const g = c.createGain(); g.gain.value = 0.06;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    os.forEach(o => o.connect(g)); g.connect(c.destination);
    os.forEach(o => o.start()); lfo.start();
    return () => { try { os.forEach(o => o.stop()); lfo.stop(); } catch (e) {} };
  }
  const AMBIENT_MAKERS = { rain: makeRain, forest: makeForest, lofi: makeLofi };

  // ---------- 统一播放控制 ----------
  function stopInternal() {
    if (ambientStop) { try { ambientStop(); } catch (e) {} ambientStop = null; }
    if (audioEl) { audioEl.pause(); try { URL.revokeObjectURL(audioEl.src); } catch (e) {} audioEl = null; }
    musicOn = false; current = null;
  }
  function playAmbient(id) {
    if (current && current.type === 'ambient' && current.id === id) { stopInternal(); return false; }
    stopInternal();
    const c = ensureCtx(); if (!c) return false;
    const maker = AMBIENT_MAKERS[id]; if (!maker) return false;
    try { ambientStop = maker(c); } catch (e) { return false; }
    current = { type: 'ambient', id, name: (BUILTIN.find(b => b.id === id) || {}).name || id };
    musicOn = true;
    return true;
  }
  function playTrack(track) {
    if (current && current.type === 'track' && current.id === track.id) { stopInternal(); return false; }
    stopInternal();
    const c = ensureCtx(); if (!c) return false;
    const url = URL.createObjectURL(track.blob);
    audioEl = new Audio(url); audioEl.loop = (playMode === 'loop'); audioEl.volume = 0.8;
    audioEl.onended = () => nextTrack(track);
    audioEl.play().catch(() => {});
    current = { type: 'track', id: track.id, name: track.name || '我的音乐' };
    musicOn = true;
    return true;
  }
  // 曲目播完：按播放模式切下一首（loop 模式由 audio.loop 自行循环）
  function nextTrack(cur) {
    if (playMode === 'loop' || !userList.length || userList.length < 2) return;
    let next;
    if (playMode === 'shuffle') {
      const rest = userList.filter(t => t.id !== cur.id);
      next = rest[Math.floor(Math.random() * rest.length)];
    } else { // list：顺序播下一首，最后一首回到开头
      const idx = userList.findIndex(t => t.id === cur.id);
      next = userList[(idx + 1) % userList.length];
    }
    if (next && next.id !== cur.id) playTrack(next);
  }
  function setMode(m) { playMode = m; if (audioEl) audioEl.loop = (m === 'loop'); }
  function getMode() { return playMode; }
  function stop() { stopInternal(); }
  function builtinList() { return BUILTIN.slice(); }
  function setSfx(v) { sfxOn = !!v; }
  function state() { return { sfxOn, musicOn, current: current ? current : null }; }

  return { sfx, playAmbient, playTrack, stop, builtinList, setSfx, state, ensureCtx, setMode, getMode,
           _setUserList(list) { userList = list || []; }, _getUserList() { return userList; } };
})();
