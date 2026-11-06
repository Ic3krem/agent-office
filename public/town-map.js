// Town map: validates public/town/town.json and turns it into a walk grid. Classic script after world-path: root.TownMap.
(function (root) {
  'use strict';
  const W = root.WorldPath;
  const LOT_IDS = ['home', 'kain', 'games', 'friend-1', 'friend-2', 'friend-3'];
  const KINDS = ['home', 'kain', 'games', 'friend'];
  const BUILDINGS = ['office-country', 'office-japanese', 'office-modern', 'karinderya', 'gamehall', 'lot-empty'];
  const DECOR = ['tree-round', 'tree-pine', 'bush', 'bench', 'lamp', 'well', 'barrel', 'crate', 'flowers', 'sign'];
  const FACES = ['n', 'e', 's', 'w'];
  const MAX_ERRORS = 20, ZONE_COST = 0.8;
  const num = v => typeof v === 'number' && isFinite(v);
  const inside = (p, [x0, y0, x1, y1]) => p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;

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
    const g = grid(d), at = p => g.blocked[W.cellOf(g, p)];
    if (at(d.spawn)) err('spawn is on a blocked cell');
    const reach = W.reachFrom(g, d.spawn);
    for (const l of d.lots) {
      if (at(l.door)) err('lot ' + l.id + ' door is not on a walkable cell');
      else if (!reach(l.door)) err('lot ' + l.id + ' door is not reachable from spawn');
    }
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

  root.TownMap = { validate, grid, decorFootprint, load };
})(globalThis);
