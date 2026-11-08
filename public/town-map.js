// Town map: validates public/town/town.json and turns it into a walk grid. Classic script after world-path: root.TownMap.
(function (root) {
  'use strict';
  const W = root.WorldPath;
  const LOT_IDS = ['home', 'kain', 'games', 'friend-1', 'friend-2', 'friend-3'];
  const KINDS = ['home', 'kain', 'games', 'friend'];
  const BUILDINGS = ['office-country', 'office-japanese', 'office-modern', 'karinderya', 'gamehall', 'lot-empty'];
  const DECOR = ['tree-round', 'tree-pine', 'bush', 'bench', 'lamp', 'well', 'barrel', 'crate', 'flowers', 'sign'];
  const FACES = ['n', 'e', 's', 'w'];
  const MAX_ERRORS = 20, ZONE_COST = 0.6; // low enough that the roads beat a ~1.3x straight-line detour across grass
  const num = v => typeof v === 'number' && isFinite(v);
  const inside = (p, [x0, y0, x1, y1]) => p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;
  const ov = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  // Land levels (town step 4): terraces raise the ground by LEVEL_H world units per level; ramps climb linearly along dir.
  const LEVEL_H = 28, RAMP_DIRS = ['n', 'e', 's', 'w'];
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  // The level of the innermost (smallest) terrace rect holding p, 0 outside them all; ramps are ignored.
  function levelAt(d, x, y) {
    let best = null;
    for (const t of d.levels || []) if (inside({ x, y }, t.rect) && (!best || area(t.rect) < area(best.rect))) best = t;
    return best ? best.level : 0;
  }
  // A ramp's low and high ends: the level just inside each end, and t = 0..1 climbing along dir at p.
  function rampEnds(d, { rect: [x0, y0, x1, y1], dir }) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, e = 0.5;
    const hi = { n: [cx, y0 + e], s: [cx, y1 - e], e: [x1 - e, cy], w: [x0 + e, cy] }[dir], lo = { n: [cx, y1 - e], s: [cx, y0 + e], e: [x0 + e, cy], w: [x1 - e, cy] }[dir];
    const t = p => ({ n: (y1 - p.y) / (y1 - y0), s: (p.y - y0) / (y1 - y0), e: (p.x - x0) / (x1 - x0), w: (x1 - p.x) / (x1 - x0) })[dir];
    return { lo: levelAt(d, lo[0], lo[1]), hi: levelAt(d, hi[0], hi[1]), t };
  }
  function heightAt(d, x, y) {
    if (!d) return 0;
    for (const r of d.ramps || []) if (inside({ x, y }, r.rect)) { const e = rampEnds(d, r); return (e.lo + (e.hi - e.lo) * e.t({ x, y })) * LEVEL_H; }
    return levelAt(d, x, y) * LEVEL_H;
  }
  // Cliffs: a cell above any 4-neighbour is a 1-cell blocked edge band, except on a ramp; a ramp's two sides are walled too.
  function cliffBlocks(d) {
    if (!(d.levels || []).length) return [];
    const c = d.cell, cols = Math.ceil(d.size.w / c), rows = Math.ceil(d.size.h / c), out = [];
    const lv = (cc, r) => levelAt(d, (cc + 0.5) * c, (r + 0.5) * c), ramps = d.ramps || [];
    const rampOf = (cc, r) => ramps.findIndex(rp => inside({ x: (cc + 0.5) * c, y: (r + 0.5) * c }, rp.rect));
    const h = new Float64Array(cols * rows), ramp = new Int16Array(cols * rows);
    const alongRamp = (i, dr) => i >= 0 && (ramps[i].dir === 'n' || ramps[i].dir === 's') === (dr !== 0);
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) { h[r * cols + cc] = heightAt(d, (cc + 0.5) * c, (r + 0.5) * c); ramp[r * cols + cc] = rampOf(cc, r); }
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
      const v = lv(cc, r), q = r * cols + cc;
      if (v && ramp[q] < 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => { const a = cc + dc, b = r + dr; return a >= 0 && b >= 0 && a < cols && b < rows && lv(a, b) < v; }))
        out.push([cc * c, r * c, cc * c + c, r * c + c]);
      // Ground that faces away from the camera (a west- or north-facing cliff, a lane's east wall, a ramp wedge's west side)
      // is drawn over the lower ground just behind it, (rise) / (2 x 0.3536) units deep, so a walker there would show on
      // top of it. Block that strip, from every cell's heightAt. A step along a ramp's climb (into, along or out of it) is
      // the ramp itself, not a face, so only steps across its axis count; otherwise an s or e ramp would wall off its top.
      for (const [dc, dr] of [[-1, 0], [0, -1]]) {
        const a0 = cc + dc, b0 = r + dr, p = b0 * cols + a0;
        if (a0 < 0 || b0 < 0 || h[p] >= h[q] - 1e-6 || alongRamp(ramp[q], dr) || alongRamp(ramp[p], dr)) continue;
        for (let k = 1, n = Math.ceil((h[q] - h[p]) / 0.7071 / c); k <= n; k++) {
          const a = cc + dc * k, b = r + dr * k;
          if (a >= 0 && b >= 0) out.push([a * c, b * c, a * c + c, b * c + c]);
        }
      }
    }
    for (const { rect: [x0, y0, x1, y1], dir } of d.ramps || [])
      out.push(...(dir === 'n' || dir === 's' ? [[x0 - c, y0, x0, y1], [x1, y0, x1 + c, y1]] : [[x0, y0 - c, x1, y0], [x0, y1, x1, y1 + c]]));
    return out;
  }

  const decorFootprint = it => (!it || it.type === 'flowers' || !num(it.x) || !num(it.y)) ? null : [it.x - 5, it.y - 5, it.x + 5, it.y + 5];

  // Water rects with the bridges cut out; each cut leaves strips left, right, above and below the bridge.
  function waterBlocks(water, bridges) {
    let out = water.map(r => r.slice());
    for (const b of bridges) {
      out = out.flatMap(r => {
        if (b[2] <= r[0] || b[0] >= r[2] || b[3] <= r[1] || b[1] >= r[3]) return [r];
        const parts = [], x0 = Math.max(b[0], r[0]), x1 = Math.min(b[2], r[2]);
        if (b[0] > r[0]) parts.push([r[0], r[1], b[0], r[3]]);
        if (b[2] < r[2]) parts.push([b[2], r[1], r[2], r[3]]);
        if (b[1] > r[1]) parts.push([x0, r[1], x1, b[1]]);
        if (b[3] < r[3]) parts.push([x0, b[3], x1, r[3]]);
        return parts;
      });
    }
    return out;
  }

  function grid(d) {
    const { w, h } = d.size, c = d.cell;
    const blocks = [
      ...d.lots.map(l => l.building.footprint),
      ...d.decor.map(decorFootprint).filter(Boolean),
      ...waterBlocks(d.water, d.bridges),
      ...cliffBlocks(d),
      [0, 0, w, c], [0, h - c, w, h], [0, 0, c, h], [w - c, 0, w, h], // map edge
    ];
    const costs = [d.plaza, ...d.paths].map(rect => ({ rect, cost: ZONE_COST }));
    return W.buildGrid({ w, h, cell: c, blocks, costs });
  }

  function validate(d) {
    const errors = [];
    const err = m => { if (errors.length < MAX_ERRORS) errors.push(m); };
    if (!d || typeof d !== 'object') return { ok: false, errors: ['not an object'] };
    if (d.version !== 1) err('version must be 1');
    const sz = d.size;
    if (!sz || !num(sz.w) || !num(sz.h) || sz.w <= 0 || sz.h <= 0) return { ok: false, errors: [...errors, 'size must be {w, h} > 0'] };
    if (d.cell !== 10) err('cell must be 10');
    if (!d.block || !num(d.block.depth) || d.block.depth <= 0) err('block.depth must be a positive number');
    const pt = (p, what) => {
      if (!p || !num(p.x) || !num(p.y)) { err(what + ' needs numeric x and y'); return false; }
      if (p.x < 0 || p.y < 0 || p.x > sz.w || p.y > sz.h) { err(what + ' is outside the map'); return false; }
      return true;
    };
    const rect = (r, what) => {
      if (!Array.isArray(r) || r.length !== 4 || !r.every(num)) { err(what + ' must be [x0, y0, x1, y1]'); return false; }
      if (r[0] >= r[2] || r[1] >= r[3]) { err(what + ' has no area'); return false; }
      if (r[0] < 0 || r[1] < 0 || r[2] > sz.w || r[3] > sz.h) { err(what + ' is outside the map'); return false; }
      return true;
    };
    pt(d.spawn, 'spawn');
    rect(d.plaza, 'plaza');
    for (const k of ['paths', 'water', 'bridges']) {
      if (!Array.isArray(d[k])) err(k + ' must be a list'); else d[k].forEach((r, i) => rect(r, k + '[' + i + ']'));
    }
    for (const k of ['levels', 'ramps']) if (d[k] !== undefined && !Array.isArray(d[k])) err(k + ' must be a list');
    const levels = Array.isArray(d.levels) ? d.levels : [], ramps = Array.isArray(d.ramps) ? d.ramps : [];
    levels.forEach((t, i) => {
      if (!t || !rect(t.rect, 'levels[' + i + ']')) return;
      if (t.level !== 1 && t.level !== 2) err('levels[' + i + '] level must be 1 or 2');
    });
    ramps.forEach((r, i) => {
      if (!r || !rect(r.rect, 'ramps[' + i + ']')) return;
      if (!RAMP_DIRS.includes(r.dir)) err('ramps[' + i + '] dir must be n/e/s/w');
    });
    if (!Array.isArray(d.decor)) err('decor must be a list');
    else d.decor.forEach((it, i) => {
      if (!it || !DECOR.includes(it.type)) err('decor[' + i + '] has an unknown type');
      else pt(it, 'decor[' + i + ']');
    });
    if (!Array.isArray(d.lots)) { err('lots must be a list'); return { ok: false, errors }; }
    const ids = d.lots.map(l => l && l.id);
    for (const id of LOT_IDS) if (!ids.includes(id)) err('missing lot ' + id);
    for (const id of ids) if (!LOT_IDS.includes(id)) err('unexpected lot ' + id);
    if (new Set(ids).size !== ids.length) err('duplicate lot id');
    for (const l of d.lots) {
      if (!l || typeof l !== 'object') { err('lot is not an object'); continue; }
      const n = 'lot ' + l.id;
      if (!KINDS.includes(l.kind)) err(n + ' has an unknown kind');
      rect(l.rect, n + ' rect');
      const b = l.building;
      if (!b || !BUILDINGS.includes(b.type)) err(n + ' has an unknown building type');
      else { pt(b, n + ' building'); rect(b.footprint, n + ' footprint'); }
      if (!l.door || !FACES.includes(l.door.face)) err(n + ' door needs a face n/e/s/w');
      else if (pt(l.door, n + ' door') && b && Array.isArray(b.footprint) && inside(l.door, b.footprint)) err(n + ' door is inside its building footprint');
    }
    if (errors.length) return { ok: false, errors };
    // one level per lot and for the plaza: a terrace either holds the whole rect or misses it
    const straddles = r => levels.some(t => ov(t.rect, r) && !(t.rect[0] <= r[0] && t.rect[1] <= r[1] && t.rect[2] >= r[2] && t.rect[3] >= r[3]));
    for (const l of d.lots) if (straddles(l.rect)) err('lot ' + l.id + ' straddles two levels');
    if (straddles(d.plaza)) err('the plaza straddles two levels');
    ramps.forEach((r, i) => { const e = rampEnds(d, r); if (e.hi <= e.lo) err('ramps[' + i + '] does not join two levels (its high end must be the ' + r.dir + ' end)'); });
    const g = grid(d), at = p => g.blocked[W.cellOf(g, p)];
    if (at(d.spawn)) err('spawn is on a blocked cell');
    const reach = W.reachFrom(g, d.spawn);
    for (const l of d.lots) {
      if (at(l.door)) err('lot ' + l.id + ' door is not on a walkable cell');
      else if (!reach(l.door)) err('lot ' + l.id + ' door is not reachable from spawn');
    }
    // every terrace needs a ramp: some open cell at its own level is reachable from spawn
    levels.forEach((t, i) => {
      const [x0, y0, x1, y1] = t.rect, c = d.cell;
      for (let y = Math.floor(y0 / c) * c + c / 2; y < y1; y += c) for (let x = Math.floor(x0 / c) * c + c / 2; x < x1; x += c)
        if (x >= x0 && y >= y0 && levelAt(d, x, y) === t.level && !at({ x, y }) && reach({ x, y })) return;
      err('levels[' + i + '] is not reachable from spawn (no ramp?)');
    });
    return { ok: !errors.length, errors };
  }

  async function load(url) {
    const res = await root.fetch(url);
    if (!res.ok) throw new Error('town map: HTTP ' + res.status);
    const data = await res.json();
    const v = validate(data);
    if (!v.ok) throw new Error('town map: ' + v.errors[0]);
    return data;
  }

  // Doors (town step 2): where each lot's door leads, and the lot a scene's exit comes back to.
  const ENTER = { home: ['/#scene=office', 'Enter the office'], kain: ['/#scene=kain', 'Enter the karinderya'], games: ['/#scene=games', 'Enter the game hall'] };
  const enterTarget = lot => { const e = lot && Object.prototype.hasOwnProperty.call(ENTER, lot.kind) ? ENTER[lot.kind] : null; return e ? { url: e[0], label: e[1] } : { url: null, label: 'Friend lots open in party mode' }; };
  const lotOfScene = scene => scene === 'kain' || scene === 'games' ? scene : 'home';

  // Party lots: members (the party view's list, which keeps join order) -> {[memberId]: 'friend-1'..'friend-3'}.
  // The first three get a lot; later joiners get none. Step 5 assigns lots with this same helper.
  const FRIEND_LOTS = LOT_IDS.filter(id => id.startsWith('friend-'));
  function friendLots(members) {
    const out = {};
    if (!Array.isArray(members)) return out;
    for (const m of members) {
      if (!m || typeof m.id !== 'string' || !m.id || Object.prototype.hasOwnProperty.call(out, m.id)) continue;
      const n = Object.keys(out).length;
      if (n >= FRIEND_LOTS.length) break;
      out[m.id] = FRIEND_LOTS[n];
    }
    return out;
  }

  root.TownMap = { validate, grid, heightAt, LEVEL_H, decorFootprint, load, enterTarget, lotOfScene, friendLots };
})(globalThis);
