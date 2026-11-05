// World layout model: the saved layout format, the default layout (today's office), validation, and the walk grid
// and spots a layout yields. Classic script after world-path, office-motion and office-furniture: root.WorldModel.
(function (root) {
  'use strict';
  const VERSION = 1, CELL = 10, PATH_COST = 0.55;
  const F = root.OfficeFurniture, W = root.WorldPath;

  // Fields an object may carry beyond id/type/x/y: the params today's instances of its type use, plus home (put() adds it
  // to any copy drawn away from the type anchor).
  const PARAMS = {};
  for (const p of F.defaultInstances()) for (const k of Object.keys(p)) (PARAMS[p.type] = PARAMS[p.type] || new Set(['id', 'type', 'x', 'y', 'home'])).add(k);
  const SPOT_FIELDS = new Set(['id', 'x', 'y', 'face', 'zone', 'seat', 'desk', 'game']);

  // Spots no catalog piece owns (values from office-motion.js).
  const sp = (id, x, y, face, zone, extra) => Object.assign({ id, x, y, face, zone }, extra);
  const FREE_SPOTS = [
    sp('tiro:window', 45, 150, 'w', 'office'), sp('office:report', 225, 150, 'n', 'office'),
    ...[385, 340, 295].map((x, i) => sp('queue:' + (i + 1), x, 250, 'e', 'door')),
    sp('garden:pS', 790, 178, 'n', 'garden'), sp('garden:pE', 864, 105, 'w', 'garden'), sp('garden:pW', 716, 105, 'e', 'garden'),
    sp('garden:fl', 620, 178, 'n', 'garden'), sp('garden:lamp', 940, 150, 'w', 'garden'), sp('pk:pond', 1120, 372, 'n', 'garden'),
    sp('sched:npc', 1072, 758, 's', 'garage'), sp('play:rug', 700, 745, 's', 'play'), sp('play:plant', 968, 662, 'w', 'play'),
    sp('cool:1', 430, 634, 'n', 'utility'), sp('cool:2', 462, 636, 'n', 'utility'),
    ...[118, 152, 306, 346].map((x, i) => sp('hot:' + (i + 1), x, 650, 'n', 'utility', { seat: true, desk: true })),
    ...[180, 230, 300, 350].map((x, i) => sp('over:' + (i + 1), x, 712, 'n', 'utility')),
  ];

  const z = (id, type, rect) => ({ id, type, rect });
  const strip = (id, x0, y0, x1, y1) => z(id, 'path', [x0, y0, x1, y1]);
  const ROWY = { n: 250, a: 396, s: 568 }, COLX = [30, 270, 500, 730, 970];
  const ZONES = [
    // floor areas, as bake() paints them
    z('office', 'office', [0, 0, 470, 230]), z('garden', 'garden', [470, 0, 1240, 230]), z('park', 'garden', [1000, 230, 1240, 550]),
    z('garage', 'garage', [1000, 550, 1240, 780]), z('focus', 'focus', [0, 230, 1000, 550]),
    z('utility', 'utility', [0, 550, 470, 780]), z('play', 'play', [470, 550, 1000, 780]),
    // ponds: the stone rim's bounding square (ground radius 58 round 790,105; 66 round 1120,290)
    z('pond', 'water', [732, 47, 848, 163]), z('pond-east', 'water', [1054, 224, 1186, 356]),
    // walkways walkers prefer: 30-unit strips
    ...Object.keys(ROWY).map(r => strip('row-' + r, 0, ROWY[r] - 15, 1000, ROWY[r] + 15)),
    ...COLX.map(x => strip('col-' + x, x - 15, ROWY.n, x + 15, ROWY.s)),
    strip('loop-n', 695, 10, 885, 40), strip('loop-s', 695, 170, 885, 200), strip('loop-w', 695, 10, 725, 200), strip('loop-e', 855, 10, 885, 200),
    strip('garden-gate', 485, 185, 515, ROWY.n), strip('garden-hub', 485, 185, 725, 215),
    strip('utility-in', 255, ROWY.s, 285, 683), strip('utility-row', 120, 653, 455, 683),
    strip('play-in', 485, ROWY.s, 515, 670), strip('play-n', 485, 640, 895, 670), strip('play-s', 545, 740, 895, 770),
    strip('play-w', 545, 640, 575, 770), strip('play-e', 865, 640, 895, 770),
    strip('office-door', 405, 180, 435, 265), strip('office-mid', 310, 165, 435, 195), strip('office-desk', 310, 21, 340, 195),
  ];

  const defaultLayout = () => JSON.parse(JSON.stringify({
    version: VERSION, size: { w: 1240, h: 780 }, spawn: { x: 420, y: 250 },
    zones: ZONES, objects: F.defaultInstances(), spots: FREE_SPOTS,
  }));

  function spotsOf(layout) {
    const out = F.spotsOf(layout.objects);
    for (const s of layout.spots) out[s.id] = Object.assign({}, s);
    return out;
  }

  const rectsOf = (layout, type) => layout.zones.filter(q => q.type === type).map(q => q.rect);
  const gridOf = layout => W.buildGrid({
    w: layout.size.w, h: layout.size.h, cell: CELL,
    blocks: F.footprints(layout.objects).concat(rectsOf(layout, 'water')), // footprints() skips walkable types
    costs: rectsOf(layout, 'path').map(rect => ({ rect, cost: PATH_COST })),
  });

  // Shape check for untrusted input (disk, PUT body): the first problem, or '' when the geometry checks can run safely.
  const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = v => typeof v === 'number' && isFinite(v);
  const MAX = 4000; // ponytail: arbitrary cap so a PUT body cannot ask for a huge grid; today's world is 1240x780
  const rect = r => Array.isArray(r) && r.length === 4 && r.every(num);
  function malformed(l) {
    if (!obj(l.size) || !(l.size.w > 0 && l.size.w <= MAX) || !(l.size.h > 0 && l.size.h <= MAX)) return 'size needs w and h in 1..' + MAX;
    if (!obj(l.spawn) || !num(l.spawn.x) || !num(l.spawn.y)) return 'spawn needs numeric x and y';
    for (const k of ['zones', 'objects', 'spots']) {
      if (!Array.isArray(l[k])) return k + ' is not a list';
      for (const e of l[k]) {
        if (!obj(e) || typeof e.id !== 'string') return k + ' has an entry without a string id';
        if (k === 'zones' ? !rect(e.rect) : !num(e.x) || !num(e.y)) return k + ' entry ' + e.id + (k === 'zones' ? ' needs a numeric rect' : ' needs numeric x and y');
      }
    }
    return '';
  }

  function validate(layout) {
    const errors = [];
    if (!obj(layout) || !num(layout.version)) return { ok: false, errors: ['layout has no version'] };
    if (layout.version > VERSION) return { ok: false, errors: ['layout version ' + layout.version + ' is a newer version than ' + VERSION] };
    const bad = malformed(layout);
    if (bad) return { ok: false, errors: ['malformed: ' + bad] };
    const ids = name => { const seen = new Set(); return id => { if (seen.has(id)) errors.push('duplicate id ' + name + ' ' + id); seen.add(id); }; };
    const extra = (what, o, allowed) => Object.keys(o).forEach(k => allowed.has(k) || errors.push(what + ' ' + o.id + ': unknown field ' + k));
    const zoneId = ids('zone'), objId = ids('object'), spotId = ids('spot');
    layout.zones.forEach(q => zoneId(q.id));
    for (const o of layout.objects) {
      objId(o.id);
      if (!Object.prototype.hasOwnProperty.call(F.CATALOG, o.type)) errors.push('object ' + o.id + ': unknown type ' + o.type);
      else extra('object', o, PARAMS[o.type] || new Set(['id', 'type', 'x', 'y', 'home']));
      if (o.type === 'dept-desk' && !(root.OfficeMotion && root.OfficeMotion.TEAM.some(t => t.desk === o.desk))) errors.push('object ' + o.id + ': unknown desk ' + o.desk);
    }
    if (errors.length) return { ok: false, errors }; // the checks below draw the objects
    try { geometry(layout, errors, spotId, extra); } catch (e) { errors.push('malformed: ' + e.message); } // bad params can break a painter
    return { ok: !errors.length, errors };
  }

  function geometry(layout, errors, spotId, extra) {
    Object.keys(F.spotsOf(layout.objects)).forEach(spotId);
    layout.spots.forEach(s => { spotId(s.id); extra('spot', s, SPOT_FIELDS); });

    const { w, h } = layout.size, grid = gridOf(layout), spots = spotsOf(layout), water = rectsOf(layout, 'water');
    const sp0 = layout.spawn, M = root.OfficeMotion;
    if (M) { // every spot the agent brain reads must exist
      const need = [...M.TEAM.map(t => t.desk), 'tiro:seat', 'tiro:window', 'office:report', 'queue:1', 'queue:2', 'queue:3', 'sched:npc', ...M.GARDEN, ...M.PLAY, ...M.COOLER, ...M.HOT, ...M.OVER];
      need.forEach(id => spots[id] || errors.push('missing spot ' + id));
    }
    if (grid.blocked[W.cellOf(grid, sp0)]) errors.push('spawn (' + sp0.x + ',' + sp0.y + ') is blocked');
    for (const s of Object.values(spots)) {
      if (!(s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h)) { errors.push('spot ' + s.id + ' is outside the world'); continue; }
      if (water.some(([x0, y0, x1, y1]) => s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1)) errors.push('spot ' + s.id + ' is in water');
      else if (!W.findPath(grid, sp0, s).length) errors.push('spot ' + s.id + ' is unreachable from spawn');
    }
  }

  root.WorldModel = { VERSION, defaultLayout, validate, spotsOf, gridOf };
  if (root.OfficeMotion && typeof root.OfficeMotion.useLayout === 'function') root.OfficeMotion.useLayout(defaultLayout());
})(globalThis);
