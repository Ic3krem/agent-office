// Town animals (town step 5): where the cows, dogs and cats are at a given time. Pure functions of (animal, time, grid), so
// every page shows them alike and nothing is stored. Classic script after world-path and town-map: root.TownAnimals.
// Each animal has an anchor (its home's centre, on an open cell). Every EPOCH ms it walks out to a waypoint picked by a hash
// of (id, epoch), rests there and walks back, so an epoch starts and ends at the anchor and the walk never jumps.
(function (root) {
  'use strict';
  const EPOCH = 20000, SPEED = { cow: 12, dog: 30, cat: 20 }, STEP = 6; // units per second; walk frame stride
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; }; // = AgentTravel.hash
  const inR = (p, r) => p.x >= r[0] && p.x < r[2] && p.y >= r[1] && p.y < r[3];

  // -> [{id, kind, home: [x0, y0, x1, y1]}]: 3 cows in the pasture pen, 2 dogs in the park, 2 cats on the plaza, 1 by the karinderya.
  function herd(map) {
    const spot = id => (map.spots || []).find(s => s.id === id), out = [];
    const pen = spot('pasture') && (spot('pasture').pen || spot('pasture').rect), park = spot('park') && spot('park').rect;
    const kain = (map.lots || []).find(l => l.kind === 'kain');
    if (pen) for (let i = 1; i <= 3; i++) out.push({ id: 'cow-' + i, kind: 'cow', home: pen });
    if (park) for (let i = 1; i <= 2; i++) out.push({ id: 'dog-' + i, kind: 'dog', home: park });
    if (map.plaza) for (let i = 1; i <= 2; i++) out.push({ id: 'cat-' + i, kind: 'cat', home: map.plaza });
    if (kain) out.push({ id: 'cat-3', kind: 'cat', home: kain.rect });
    return out;
  }

  const W = () => root.WorldPath;
  const open = (g, p) => !g.blocked[W().cellOf(g, p)];
  const cache = new WeakMap(); // grid -> Map(id -> {anchor, legs: Map(epoch -> leg)})
  function memo(a, g) {
    let m = cache.get(g); if (!m) cache.set(g, m = new Map());
    let e = m.get(a.id);
    if (!e) { // the anchor: the open cell nearest the home's centre (rings outward), spread a little per animal
      const [x0, y0, x1, y1] = a.home, h = fnv(a.id), c = { x: (x0 + x1) / 2 + (h % 41 - 20) * (x1 - x0) / 120, y: (y0 + y1) / 2 + ((h >> 8) % 41 - 20) * (y1 - y0) / 120 };
      let anchor = null;
      for (let r = 0; r < 200 && !anchor; r += 10) for (let k = 0; k < Math.max(1, r) && !anchor; k += 5) {
        const q = { x: c.x + r * Math.cos(k / Math.max(1, r) * 2 * Math.PI), y: c.y + r * Math.sin(k / Math.max(1, r) * 2 * Math.PI) };
        if (inR(q, a.home) && open(g, q)) anchor = { x: Math.round(q.x), y: Math.round(q.y) };
      }
      m.set(a.id, e = { anchor: anchor || c, legs: new Map() });
    }
    return e;
  }
  // The epoch's walk: the anchor -> a waypoint inside home (shrunk by 15) whose path stays inside home and is short enough
  // to walk out and back within 80% of the epoch; after 8 misses the animal stays at its anchor. -> {pts, len}
  function legOf(a, epoch, g) {
    const e = memo(a, g);
    if (e.legs.has(epoch)) return e.legs.get(epoch);
    const [x0, y0, x1, y1] = a.home, max = SPEED[a.kind] * EPOCH * 0.4 / 1000;
    let leg = { pts: [e.anchor], len: 0 };
    for (let k = 0; k < 8; k++) {
      const h = fnv(a.id + '|' + epoch + '|' + k), q = { x: x0 + 15 + (h % 1000) / 1000 * (x1 - x0 - 30), y: y0 + 15 + ((h >>> 10) % 1000) / 1000 * (y1 - y0 - 30) };
      if (!open(g, q) || Math.hypot(q.x - e.anchor.x, q.y - e.anchor.y) > max) continue;
      const pts = W().findPath(g, e.anchor, q);
      if (!pts.length || !pts.every(p => inR(p, a.home))) continue;
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (len <= max) { leg = { pts, len }; break; }
    }
    if (e.legs.size > 4) e.legs.delete(e.legs.keys().next().value); // keep a few epochs
    e.legs.set(epoch, leg);
    return leg;
  }
  function along(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], s = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= s) return s ? { x: a.x + (b.x - a.x) * d / s, y: a.y + (b.y - a.y) * d / s, dx: b.x - a.x, dy: b.y - a.y } : { x: a.x, y: a.y, dx: 0, dy: 0 };
      d -= s;
    }
    const p = pts[pts.length - 1]; return { x: p.x, y: p.y, dx: 0, dy: 0 };
  }

  // -> {x, y, face: 'l' | 'r' (on screen), frame: 'rest' | 'walk0' | 'walk1' | 'sleep'}. night: Graphics.nightOf (cats nap by day).
  function at(a, tMs, grid, night = 0) {
    const epoch = Math.floor(tMs / EPOCH), u = tMs - epoch * EPOCH, leg = legOf(a, epoch, grid), sp = SPEED[a.kind] / 1000;
    const wo = leg.len / sp; // ms to walk out (and back)
    let p, d, dir;
    if (u < wo) { d = u * sp; p = along(leg.pts, d); dir = 1; }
    else if (u >= EPOCH - wo) { d = (EPOCH - u) * sp; p = along(leg.pts, d); dir = -1; }
    else { p = along(leg.pts, leg.len); d = null; dir = 1; }
    const sdx = (p.dx - p.dy) * dir, face = sdx < 0 ? 'l' : 'r'; // screen x grows with x - y
    const frame = d != null ? 'walk' + Math.floor(d / STEP) % 2 : a.kind === 'cat' && night < 0.5 && u >= EPOCH / 2 ? 'sleep' : 'rest';
    return { x: p.x, y: p.y, face, frame };
  }

  // The dog on the leash of a dog walker (town step 5): dog-1 goes with the first parked 'dogwalk' visitor by id, dog-2 the
  // second. visitors: the parked traveller entries ({id, pose}). -> visitor id or null.
  function leashed(dogId, visitors) {
    const walkers = (visitors || []).filter(v => v && v.pose === 'dogwalk').map(v => v.id).sort();
    const i = /^dog-(\d+)$/.exec(dogId); return i ? walkers[+i[1] - 1] || null : null;
  }

  // Every free animal for a frame: on (ambient visitors) moves them, else each rests at its t = 0 spot. Leashed dogs are
  // left out: the walker's visit draws them. -> [{id, kind, x, y, face, frame}]
  function frame(list, t, grid, { on = false, night = 0, visitors = [] } = {}) {
    const out = [];
    for (const a of list) {
      if (a.kind === 'dog' && leashed(a.id, visitors)) continue;
      const p = at(a, on ? t : 0, grid, night);
      out.push({ id: a.id, kind: a.kind, x: p.x, y: p.y, face: p.face, frame: on ? p.frame : (p.frame === 'sleep' ? 'sleep' : 'rest') });
    }
    return out;
  }

  root.TownAnimals = { herd, at, leashed, frame, EPOCH, SPEED };
})(globalThis);
