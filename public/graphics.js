// Graphics settings (town step 4): presets, validation, resolved settings and auto-detect. Pure functions, no DOM.
// Classic script before office-world.js and the town page: root.Graphics.
(function (root) {
  'use strict';
  const PRESETS = {
    low: { renderScale: .5, fps: 15, shadows: 'off', ambient: 'off', lighting: 'off', renderer: 'canvas' },
    medium: { renderScale: .75, fps: 30, shadows: 'blob', ambient: 'water', lighting: 'tint', renderer: 'auto' },
    high: { renderScale: 1, fps: 30, shadows: 'soft', ambient: 'all', lighting: 'glow', renderer: 'gpu' },
    ultra: { renderScale: 2, fps: 60, shadows: 'tint', ambient: 'particles', lighting: 'pools', renderer: 'gpu' },
  };
  const OK = { renderScale: [.5, .75, 1, 2], fps: [15, 30, 60], shadows: ['off', 'blob', 'soft', 'tint'],
    ambient: ['off', 'water', 'all', 'particles'], lighting: ['off', 'tint', 'glow', 'pools'], renderer: ['canvas', 'auto', 'gpu'] };

  // Panel rows: [value, label] per allowed value, same order as OK (the test compares them).
  const L = {
    renderScale: ['50%', '75%', '100%', '100% (2× HiDPI)'], fps: ['15', '30', '60'],
    shadows: ['Off', 'Simple', 'Soft', 'Soft + time of day'], ambient: ['Off', 'Water only', 'All', 'All + particles'],
    lighting: ['Off', 'Tint', 'Tint + window glow', 'Tint + glow + lamp light'], renderer: ['Canvas2D', 'GPU if available', 'GPU'],
  };
  const NAMES = { renderScale: 'Render scale', fps: 'Frame rate cap', shadows: 'Shadows', ambient: 'Ambient animation', lighting: 'Day and night', renderer: 'Renderer' };
  const UI = Object.keys(OK).map(key => ({ key, label: NAMES[key], options: OK[key].map((v, i) => [v, L[key][i]]) }));

  // Stored value -> {preset, custom?}, or null (junk = not set, so detect).
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.preset === 'custom') {
      if (!raw.custom || typeof raw.custom !== 'object') return null;
      const custom = { ...PRESETS.high };
      for (const k in OK) if (OK[k].includes(raw.custom[k])) custom[k] = raw.custom[k];
      return { preset: 'custom', custom };
    }
    return Object.prototype.hasOwnProperty.call(PRESETS, raw.preset) ? { preset: raw.preset } : null;
  }

  function resolve(stored, env) {
    env = env || {};
    const s = normalize(stored) || { preset: 'medium' }; // not set yet: load() stores detect()'s pick
    const p = s.preset === 'custom' ? s.custom : PRESETS[s.preset];
    const gpu = !!env.webgl && p.renderer !== 'canvas';
    return {
      renderScale: p.renderScale > 1 ? Math.max(1, Math.min(p.renderScale, env.dpr || 1)) : p.renderScale, // HiDPI cap
      fps: p.fps, ambientFps: env.saver ? Math.min(p.fps, 8) : p.fps,
      shadows: p.shadows, ambient: env.reduced ? 'off' : p.ambient, lighting: p.lighting,
      renderer: gpu ? 'gpu' : 'canvas',
    };
  }

  // Integrated GPUs: Intel, Mali/Adreno/PowerVR, or AMD's unnamed "Radeon(TM) Graphics" iGPU.
  const isIntegrated = name => /intel|mali|adreno|powervr|radeon\(tm\) graphics/i.test(name || '');
  function detect({ webgl, gpuName, deviceMemory, cores } = {}) {
    const low = v => typeof v === 'number' && v <= 4; // unknown (undefined/null) is not low
    if (!webgl || low(deviceMemory) || low(cores)) return 'low';
    return isIntegrated(gpuName) ? 'medium' : 'high';
  }

  const nightOf = h => h >= 20 || h < 5 ? 1 : h >= 18 ? (h - 18) / 2 : h < 7 ? (7 - h) / 2 : 0;
  const mix = (a, b, t) => [16, 8, 0].reduce((n, sh) => n | Math.round(((a >> sh & 255) * (1 - t) + (b >> sh & 255) * t)) << sh, 0);
  const tintOf = n => n <= .5 ? mix(0xffffff, 0xffd2a8, n * 2) : mix(0xffd2a8, 0x6f7fb8, (n - .5) * 2);

  // ---- client side (browser only; the pure functions above stay DOM-free) ----
  const KEY = 'ao.graphics', subs = new Set();
  const lsGet = k => { try { return root.localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { root.localStorage.setItem(k, v); } catch {} };
  const nonce = () => (String(root.document.cookie).match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '';
  let probed;
  // One throwaway WebGL context per page, released straight away. Only a success is cached: a failed probe (context busy or lost) retries next call.
  function probe() {
    if (probed) return probed;
    const out = { webgl: false, gpuName: '', deviceMemory: root.navigator.deviceMemory, cores: root.navigator.hardwareConcurrency };
    try {
      const gl = root.document.createElement('canvas').getContext('webgl');
      if (gl) {
        out.webgl = true;
        const x = gl.getExtension('WEBGL_debug_renderer_info');
        out.gpuName = String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '');
        const l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext();
      }
    } catch {}
    if (out.webgl) probed = out;
    return out;
  }
  const env = () => ({
    dpr: root.devicePixelRatio || 1,
    reduced: !!(root.matchMedia('(prefers-reduced-motion: reduce)').matches || root.document.documentElement.dataset.anim === 'off'),
    saver: lsGet('ao.powerSaver') !== '0',
    webgl: root.Graphics.probe().webgl,
  });
  const emit = s => subs.forEach(fn => { try { fn(s); } catch {} });
  async function save(stored) {
    const r = await root.fetch('/api/graphics/set', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': nonce() }, body: JSON.stringify(stored) });
    if (!r.ok) throw new Error('graphics save failed');
    const g = normalize((await r.json()).graphics) || stored;
    lsSet(KEY, JSON.stringify(g)); emit(g); return g;
  }
  async function load() {
    let g = null;
    try {
      const r = await root.fetch('/api/graphics', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': nonce() }, body: '{}' }); // the server only reads state over POST
      if (!r.ok) throw new Error('graphics load failed');
      g = normalize((await r.json()).graphics);
      if (!g) g = await save({ preset: detect(root.Graphics.probe()) }); // first run: pick for this machine
    } catch {
      try { g = normalize(JSON.parse(lsGet(KEY))); } catch {}
      g = g || { preset: detect(root.Graphics.probe()) };
    }
    lsSet(KEY, JSON.stringify(g)); return g;
  }
  function onChange(fn) {
    if (!subs.size) root.addEventListener('storage', onStorage);
    subs.add(fn);
    return () => { subs.delete(fn); if (!subs.size) root.removeEventListener('storage', onStorage); };
  }
  function onStorage(e) { if (e.key === KEY) { let g = null; try { g = normalize(JSON.parse(e.newValue)); } catch {} if (g) emit(g); } }

  root.Graphics = { PRESETS, VALUES: OK, UI, normalize, resolve, detect, isIntegrated, nightOf, tintOf, probe, load, save, onChange, env };
})(globalThis);
