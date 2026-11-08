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
  // trees[].id is the index in map.decor (the renderer's sprite key). Town step 5: falls (the waterfall props) from 'water',
  // visitors (spot activities: hoop shots, dog walks) from 'all'.
  function plan(map, ambient) {
    const out = { water: [], trees: [], particles: [], falls: [], visitors: false };
    if (ambient === 'off' || !ambient) return out;
    out.water = waterPoints(map);
    for (const sp of map.spots || []) for (const p of sp.props || []) if (p.type === 'waterfall') out.falls.push({ x: p.x, y: p.y });
    if (ambient === 'water') return out;
    out.visitors = true;
    map.decor.forEach((d, id) => { if (/^tree/.test(d.type)) out.trees.push({ id, x: d.x, y: d.y }); });
    if (ambient !== 'particles') return out;
    out.trees.forEach((t, k) => { if (k % 4 === 3) out.particles.push({ kind: 'leaf', x: t.x, y: t.y }); }); // 1 per 4 trees
    const kain = map.lots.find(l => l.building && l.building.type === 'karinderya');
    if (kain) out.particles.push({ kind: 'steam', x: kain.building.x, y: kain.building.y });
    return out;
  }
  const isEmpty = p => !p.water.length && !p.trees.length && !p.particles.length && !(p.falls || []).length && !p.visitors;

  const frameDue = (lastMs, nowMs, fps) => nowMs - lastMs >= 1000 / fps - 1;

  // Tree i's sway at t ms: -1, 0 or +1 px at the crown.
  const sway = (i, t) => Math.round(Math.sin(t / 2600 * 2 * Math.PI + i * 1.7)) || 0;
  // Sparkle i shows a quarter of each 1.6 s cycle, staggered.
  const sparkleOn = (i, t) => (t / 1600 + i * 0.618) % 1 < 0.25;

  // Live particles at t ms, stateless: 6 steam and 18 leaf slots, each cycling over its emitters. -> [{kind, x, y, dx, dy, a, e}]
  // x, y: the emitter (world units), e: the emitter itself; dx, dy: whole screen px from the particle's start point; a: alpha.
  // out: a buffer reused frame to frame (its objects are overwritten, its length set), so the ambient loop allocates nothing.
  const LIFE = { steam: 2400, leaf: 4000 }, SLOTS = { steam: 6, leaf: MAX_LIVE - 6 }, KINDS = ['steam', 'leaf'];
  const PATH = {
    steam: (o, age, i) => { o.dx = Math.round(Math.sin(age * 5 + i) * 2); o.dy = -Math.round(age * 26); o.a = Math.round((1 - age) * 4) / 5; },
    leaf: (o, age, i) => { o.dx = Math.round(Math.sin(age * 7 + i) * 3 + age * 6); o.dy = Math.round(age * 38); o.a = age > 0.85 ? 0.5 : 1; },
  };
  const byKind = new WeakMap(); // emitters array -> {steam: [], leaf: []}, split once
  function particles(emitters, t, out = []) {
    let split = byKind.get(emitters);
    if (!split) byKind.set(emitters, split = { steam: emitters.filter(e => e.kind === 'steam'), leaf: emitters.filter(e => e.kind === 'leaf') });
    let k = 0;
    for (let j = 0; j < KINDS.length; j++) {
      const kind = KINDS[j], list = split[kind], n = SLOTS[kind];
      if (!list.length) continue;
      for (let i = 0; i < n; i++) {
        const u = t / LIFE[kind] + i / n, cyc = Math.floor(u), e = list[(cyc * 7 + i * 13) % list.length];
        const o = out[k] || (out[k] = {}); k++;
        o.kind = kind; o.x = e.x; o.y = e.y; o.e = e; PATH[kind](o, u - cyc, i);
      }
    }
    out.length = k;
    return out;
  }

  // ---- town step 5: what an agent parked at a spot is doing at t ms ----
  const SHOT_MS = 3000, FLIGHT_MS = 1200, DOG_SPEED = 30, LEASH = 14, STEP = 28; // a hoop shot every 3 s; dog walk units/s; walk frame stride
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; }; // = AgentTravel.hash
  const faceOf = (dx, dy, f) => !dx && !dy ? f : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  const spotOf = (map, id) => (map.spots || []).find(s => s.id === id);
  // Point at arc length s along a closed loop [[x, y]...] (s wraps), with the segment direction.
  function loopAt(loop, s) {
    let L = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    s = ((s % L) + L) % L;
    for (let i = 0; ; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= d || i === loop.length - 1) { const k = d ? Math.min(1, s / d) : 0; return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dx: b[0] - a[0], dy: b[1] - a[1], L }; }
      s -= d;
    }
  }
  // v: a parked traveller {id, x, y, face, pose: its act, spot}. on: plan.visitors (else the rest frame at its point).
  // -> {x, y, face, pose (an OfficeSprites pose), frame, ball?: {x, y, z}, dog?: {x, y, face, frame}}
  function visit(v, t, map, on) {
    const sp = spotOf(map, v.spot);
    if (v.pose === 'dogwalk' && sp && Array.isArray(sp.loop) && sp.loop.length > 1) {
      let s0 = 0, best = Infinity, acc = 0; // start where the loop passes the point
      sp.loop.forEach((a, i) => { const d = Math.hypot(a[0] - v.x, a[1] - v.y); if (d < best) { best = d; s0 = acc; } const b = sp.loop[(i + 1) % sp.loop.length]; acc += Math.hypot(b[0] - a[0], b[1] - a[1]); });
      if (!on) { const q = loopAt(sp.loop, s0 - LEASH); return { x: v.x, y: v.y, face: v.face, pose: 'stand', frame: 0, dog: { x: q.x, y: q.y, face: faceOf(v.x - q.x, v.y - q.y, 'e'), frame: 'rest' } }; }
      const s = s0 + t / 1000 * DOG_SPEED, p = loopAt(sp.loop, s), q = loopAt(sp.loop, s - LEASH);
      return { x: p.x, y: p.y, face: faceOf(p.dx, p.dy, v.face), pose: 'walk', frame: 1 + Math.floor(s / STEP) % 2, dog: { x: q.x, y: q.y, face: faceOf(q.dx, q.dy, 'e'), frame: 'walk' + Math.floor(s / 9) % 2 } };
    }
    if (v.pose === 'shoot') {
      const hoop = sp && (sp.props || []).find(p => p.type === 'hoop');
      if (!on || !hoop) return { x: v.x, y: v.y, face: v.face, pose: 'stand', frame: 0, ball: { x: v.x + 4, y: v.y + 4, z: 0 } };
      const u = t + fnv(v.id) % SHOT_MS, i = Math.floor(u / SHOT_MS), ph = u - i * SHOT_MS, made = fnv(v.id + i) % 3 !== 0;
      const rim = made ? { x: hoop.x, y: hoop.y + 4, z: 31 } : { x: hoop.x + 7, y: hoop.y + 8, z: 33 };
      let ball;
      if (ph < FLIGHT_MS) { const k = ph / FLIGHT_MS; ball = { x: v.x + (rim.x - v.x) * k, y: v.y + (rim.y - v.y) * k, z: 18 + (rim.z - 18) * k + Math.sin(Math.PI * k) * 26 }; }
      else { const k = (ph - FLIGHT_MS) / (SHOT_MS - FLIGHT_MS); ball = { x: rim.x + (v.x + 4 - rim.x) * k, y: rim.y + (v.y + 4 - rim.y) * k, z: rim.z * Math.abs(Math.cos(k * Math.PI * 1.5)) * (1 - k) }; }
      return { x: v.x, y: v.y, face: v.face, pose: ph < 300 ? 'celebrate' : 'stand', frame: 0, ball, made };
    }
    return { x: v.x, y: v.y, face: v.face, pose: v.pose === 'sit' ? 'sit' : 'stand', frame: 0 };
  }

  root.TownAmbient = { GRID, MAX_WATER, MAX_LIVE, plan, isEmpty, frameDue, sway, sparkleOn, particles, visit, loopAt, SHOT_MS, FLIGHT_MS, DOG_SPEED, LEASH };
})(globalThis);
