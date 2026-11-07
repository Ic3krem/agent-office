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
    const s = normalize(stored) || { preset: env.auto || 'medium' };
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
    if (!webgl || deviceMemory <= 4 || cores <= 4) return 'low'; // undefined compares false: unknown is not low
    return isIntegrated(gpuName) ? 'medium' : 'high';
  }

  const nightOf = h => h >= 20 || h < 5 ? 1 : h >= 18 ? (h - 18) / 2 : h < 7 ? (7 - h) / 2 : 0;
  const mix = (a, b, t) => [16, 8, 0].reduce((n, sh) => n | Math.round(((a >> sh & 255) * (1 - t) + (b >> sh & 255) * t)) << sh, 0);
  const tintOf = n => n <= .5 ? mix(0xffffff, 0xffd2a8, n * 2) : mix(0xffd2a8, 0x6f7fb8, (n - .5) * 2);

  root.Graphics = { PRESETS, normalize, resolve, detect, isIntegrated, nightOf, tintOf };
})(globalThis);
