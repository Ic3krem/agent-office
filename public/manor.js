// Manor themes (beta.6): a preset = a town building style + a palette; colours are optional #rrggbb overrides. Pure, no DOM.
// The three classic styles look as they always did (no wash, no tint) unless a colour is overridden.
// Classic script before town-map.js and office-world.js: root.Manor. Theme names match party/protocol.mjs MANOR_THEMES.
(function (root) {
  'use strict';
  const THEMES = {
    modern: { label: 'Modern', base: 'office-modern', colors: { wall: '#d9dde3', floor: '#b9a58a', roof: '#4a5566', accent: '#3a8ae0' } },
    country: { label: 'Country', base: 'office-country', colors: { wall: '#e8d9b8', floor: '#a0703f', roof: '#8a3a2a', accent: '#c9802a' } },
    japanese: { label: 'Japanese', base: 'office-japanese', colors: { wall: '#efe6d2', floor: '#c8b07a', roof: '#3a3f4a', accent: '#c0392b' } },
    beach: { label: 'Beach', base: 'office-modern', colors: { wall: '#f3e3c2', floor: '#e8cf9a', roof: '#2aa3a3', accent: '#ff8a5c' }, wash: true },
    cyber: { label: 'Cyber', base: 'office-modern', colors: { wall: '#5a4a8a', floor: '#3a3060', roof: '#2a2050', accent: '#ff3fd0' }, wash: true },
    cottage: { label: 'Cottage', base: 'office-country', colors: { wall: '#f5ecd7', floor: '#b98a5a', roof: '#4f7a46', accent: '#7bb36a' }, wash: true },
  };
  const HEX = /^#[0-9a-f]{6}$/i, KEYS = ['wall', 'floor', 'roof', 'accent'];
  // -> {theme, base, colors (all four), wash: {wall?, floor?} | null, tint: 0xRRGGBB | 0}. Junk -> modern, unwashed.
  function resolve(m) {
    const theme = m && THEMES[m.theme] ? m.theme : 'modern', t = THEMES[theme], over = {};
    for (const k of KEYS) if (m && m.colors && typeof m.colors[k] === 'string' && HEX.test(m.colors[k])) over[k] = m.colors[k].toLowerCase();
    const colors = Object.assign({}, t.colors, over);
    const wash = t.wash || over.wall || over.floor ? { wall: colors.wall, floor: colors.floor } : null;
    // the town sprite is multiplied by the tint: half way to white keeps the pixel art readable
    const tint = t.wash || over.roof || over.wall ? lighten(over.roof || over.wall ? colors[over.roof ? 'roof' : 'wall'] : colors.roof, 0.5) : 0;
    return { theme, base: t.base, colors, wash, tint };
  }
  function lighten(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return [16, 8, 0].reduce((o, sh) => o | Math.round((n >> sh & 255) + (255 - (n >> sh & 255)) * k) << sh, 0);
  }
  // A lot's building for a manor (null: keep `fallback`, the style the lot had without one).
  const building = (m, fallback) => { if (!m || !THEMES[m.theme]) return { type: fallback, tint: 0 }; const r = resolve(m); return { type: r.base, tint: r.tint }; };
  root.Manor = { THEMES, resolve, building, lighten };
})(globalThis);
