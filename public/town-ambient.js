// Town ambient animation (town step 4): what moves for a Graphics ambient level, and when a frame is due. Pure, no PIXI or
// DOM; town-render.js draws it. Classic script after town-map.js: root.TownAmbient. All offsets are whole pixels.
(function (root) {
  'use strict';
  const GRID = 40, MAX_WATER = 64, MAX_LIVE = 24;
  const inR = (x, y, [x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1;

  // Sparkle points on the 40-unit grid inside map.water, never on a bridge; past 64, an even spread across all of them.
  function waterPoints(map) {
    const pts = [], seen = new Set();
    for (const r of map.water || []) {
      for (let y = Math.ceil(r[1] / GRID) * GRID; y < r[3]; y += GRID) for (let x = Math.ceil(r[0] / GRID) * GRID; x < r[2]; x += GRID) {
        const k = x + ',' + y;
        if (seen.has(k) || (map.bridges || []).some(b => inR(x, y, b))) continue;
        seen.add(k); pts.push({ x, y });
      }
    }
    if (pts.length <= MAX_WATER) return pts;
    return Array.from({ length: MAX_WATER }, (_, i) => pts[Math.floor(i * pts.length / MAX_WATER)]);
  }

  // ambient: 'off' | 'water' | 'all' (water + tree sway) | 'particles' (all + falling leaves and karinderya steam).
  // trees[].id is the index in map.decor (the renderer's sprite key).
  function plan(map, ambient) {
    const out = { water: [], trees: [], particles: [] };
    if (ambient === 'off' || !ambient) return out;
    out.water = waterPoints(map);
    if (ambient === 'water') return out;
    map.decor.forEach((d, id) => { if (/^tree/.test(d.type)) out.trees.push({ id, x: d.x, y: d.y }); });
    if (ambient !== 'particles') return out;
    out.trees.forEach((t, k) => { if (k % 4 === 3) out.particles.push({ kind: 'leaf', x: t.x, y: t.y }); }); // 1 per 4 trees
    const kain = map.lots.find(l => l.building && l.building.type === 'karinderya');
    if (kain) out.particles.push({ kind: 'steam', x: kain.building.x, y: kain.building.y });
    return out;
  }
  const isEmpty = p => !p.water.length && !p.trees.length && !p.particles.length;

  const frameDue = (lastMs, nowMs, fps) => nowMs - lastMs >= 1000 / fps - 1;

  // Tree i's sway at t ms: -1, 0 or +1 px at the crown.
  const sway = (i, t) => Math.round(Math.sin(t / 2600 * 2 * Math.PI + i * 1.7)) || 0;
  // Sparkle i shows a quarter of each 1.6 s cycle, staggered.
  const sparkleOn = (i, t) => (t / 1600 + i * 0.618) % 1 < 0.25;

  // Live particles at t ms, stateless: 6 steam and 18 leaf slots, each cycling over its emitters. -> [{kind, x, y, dx, dy, a}]
  // x, y: the emitter (world units); dx, dy: whole screen px from the particle's start point; a: alpha.
  const LIFE = { steam: 2400, leaf: 4000 }, SLOTS = { steam: 6, leaf: MAX_LIVE - 6 };
  const PATH = {
    steam: (age, i) => ({ dx: Math.round(Math.sin(age * 5 + i) * 2), dy: -Math.round(age * 26), a: Math.round((1 - age) * 4) / 5 }),
    leaf: (age, i) => ({ dx: Math.round(Math.sin(age * 7 + i) * 3 + age * 6), dy: Math.round(age * 38), a: age > 0.85 ? 0.5 : 1 }),
  };
  function particles(emitters, t) {
    const out = [];
    for (const kind of ['steam', 'leaf']) {
      const list = emitters.filter(e => e.kind === kind), n = SLOTS[kind];
      if (!list.length) continue;
      for (let i = 0; i < n; i++) {
        const u = t / LIFE[kind] + i / n, cyc = Math.floor(u), e = list[(cyc * 7 + i * 13) % list.length];
        out.push({ kind, x: e.x, y: e.y, ...PATH[kind](u - cyc, i) });
      }
    }
    return out;
  }

  root.TownAmbient = { GRID, MAX_WATER, MAX_LIVE, plan, isEmpty, frameDue, sway, sparkleOn, particles };
})(globalThis);
