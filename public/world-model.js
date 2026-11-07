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
  PARAMS['dept-desk'].add('role'); // a desk added in build mode names its role; a built-in desk implies it
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

  // True when zones equal the default layout's (id, type, rect): bake then keeps the hand-painted floor.
  const isDefaultZones = zones => { const d = ZONES; return Array.isArray(zones) && zones.length === d.length && d.every((q, i) => zones[i] && zones[i].id === q.id && zones[i].type === q.type && Array.isArray(zones[i].rect) && q.rect.every((v, k) => zones[i].rect[k] === v)); };

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
  // List caps bound the work validate does on untrusted input (today's world: about 40 zones, 160 objects, 70 spots).
  const LIST_MAX = { zones: 2000, objects: 1000, spots: 300 }, MAX_ERRORS = 10, ZONE_TYPES = new Set([...ZONES.map(q => q.type), 'lounge', 'kain']);
  const inside = (x, y, l) => num(x) && num(y) && x >= 0 && x <= l.size.w && y >= 0 && y <= l.size.h;
  const short = v => typeof v === 'string' && v.length <= 64;
  // Values each param may take (painters loop over w and scale by s, so these bound the work validate does).
  const PARAM_OK = {
    w: (v, l) => num(v) && v >= 1 && v <= l.size.w, s: v => num(v) && v >= 0.25 && v <= 4, dd: v => num(v) && Math.abs(v) <= 100,
    home: (v, l) => Array.isArray(v) && v.length === 2 && inside(v[0], v[1], l), col: v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v),
    spot: short, desk: short, role: short,
  };
  // Interiors (town step 2) carry scene: 'kain' | 'games'; the office layout has no scene field.
  const INTERIORS = ['kain', 'games'];
  function malformed(l) {
    if ('scene' in l && !INTERIORS.includes(l.scene)) return 'scene must be kain or games (the office has none)';
    if (!obj(l.size) || !(l.size.w > 0 && l.size.w <= MAX) || !(l.size.h > 0 && l.size.h <= MAX)) return 'size needs w and h in 1..' + MAX;
    if (!obj(l.spawn) || !inside(l.spawn.x, l.spawn.y, l)) return 'spawn needs numeric x and y inside the world';
    for (const k of ['zones', 'objects', 'spots']) {
      if (!Array.isArray(l[k])) return k + ' is not a list';
      if (l[k].length > LIST_MAX[k]) return k + ' has more than ' + LIST_MAX[k] + ' entries';
      for (const e of l[k]) {
        if (!obj(e) || typeof e.id !== 'string') return k + ' has an entry without a string id';
        const at = k + ' entry ' + e.id;
        if (k === 'zones') {
          if (!rect(e.rect) || !inside(e.rect[0], e.rect[1], l) || !inside(e.rect[2], e.rect[3], l)) return at + ' needs a numeric rect inside the world';
          if (!ZONE_TYPES.has(e.type)) return at + ' has unknown zone type ' + e.type;
          continue;
        }
        if (!inside(e.x, e.y, l)) return at + ' is outside the world (needs numeric x and y inside size)';
        if (k === 'objects') { for (const p of Object.keys(PARAM_OK)) if (p in e && !PARAM_OK[p](e[p], l)) return at + ': bad ' + p; continue; }
        if (!['n', 's', 'e', 'w'].includes(e.face)) return at + ': face must be n, s, e or w';
        if ('zone' in e && !short(e.zone)) return at + ': bad zone';
        for (const f of ['seat', 'desk', 'game']) if (f in e && typeof e[f] !== 'boolean') return at + ': ' + f + ' must be true or false';
      }
    }
    return '';
  }

  // A department desk's role: its role param, else the built-in desk's (layouts saved before roles existed).
  const deskRole = o => o.role || root.RoleCatalog.BUILTIN_DESKS[o.desk];
  const MAX_DESKS = 12;
  const desksOf = layout => layout.objects.filter(o => o.type === 'dept-desk');
  // An interior needs only its exit door; the office needs every spot the agent brain reads. Play and garden spots are
  // optional since town step 3: without them PLAY travels to the game hall and THINK stays at the desk.
  const requiredSpots = layout => { const M = root.OfficeMotion; return layout.scene ? ['door'] : M ? [...desksOf(layout).map(o => o.desk), 'tiro:seat', 'tiro:window', 'office:report', 'queue:1', 'queue:2', 'queue:3', 'sched:npc', ...M.COOLER, ...M.HOT, ...M.OVER] : []; };

  // Town step 3: the playroom moved to the game hall and the garden outdoors. An office layout saved before then drops
  // these types (the step 2 play pieces and both ponds), garden trees and benches standing in a garden zone, and the
  // play and garden spots, the play and garden zones (their floor decor goes with them) and the water zones under removed
  // ponds (water with no pond is an invisible wall). Returns a new layout with migrated: 2; world-store backs up and writes it.
  const MIGRATE_V2 = ['arcade', 'arcade-race', 'jukebox', 'sofa3', 'snack-table', 'beanbag', 'ball-pit', 'hoop', 'dartboard', 'toy-bin', 'pond', 'pond-east'];
  const MIGRATE_V2_GARDEN = ['tree', 'bench', 'bench-side'];
  function migrateV2(layout) {
    const M = root.OfficeMotion, spots = new Set([...M.PLAY, ...M.GARDEN]), garden = rectsOf(layout, 'garden');
    const within = (o, [x0, y0, x1, y1]) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1, inGarden = o => garden.some(r => within(o, r));
    const ponds = layout.objects.filter(o => o.type === 'pond' || o.type === 'pond-east');
    return Object.assign({}, layout, {
      zones: layout.zones.filter(q => q.type !== 'play' && q.type !== 'garden' && !(q.type === 'water' && ponds.some(o => within(o, q.rect)))),
      objects: layout.objects.filter(o => !MIGRATE_V2.includes(o.type) && !(MIGRATE_V2_GARDEN.includes(o.type) && inGarden(o))),
      spots: layout.spots.filter(s => !spots.has(s.id)), migrated: 2,
    });
  }
  const officeLayout = () => migrateV2(defaultLayout()); // the office a fresh install, Reset and every page fallback show

  function validate(layout) {
    const errors = [];
    if (!obj(layout) || !num(layout.version)) return { ok: false, errors: ['layout has no version'] };
    if (layout.version > VERSION) return { ok: false, errors: ['layout version ' + layout.version + ' is a newer version than ' + VERSION] };
    const bad = malformed(layout);
    if (bad) return { ok: false, errors: ['malformed: ' + bad] };
    const ids = name => { const seen = new Set(); return id => { if (seen.has(id)) errors.push('duplicate id ' + name + ' ' + id); seen.add(id); }; };
    const extra = (what, o, allowed) => Object.keys(o).forEach(k => allowed.has(k) || errors.push(what + ' ' + o.id + ': unknown field ' + k));
    const zoneId = ids('zone'), objId = ids('object'), spotId = ids('spot'), deskId = ids('desk'), roles = new Set();
    layout.zones.forEach(q => zoneId(q.id));
    for (const o of layout.objects) {
      objId(o.id);
      if (!Object.prototype.hasOwnProperty.call(F.CATALOG, o.type)) errors.push('object ' + o.id + ': unknown type ' + o.type);
      else extra('object', o, PARAMS[o.type] || new Set(['id', 'type', 'x', 'y', 'home']));
      if (/^fixture-/.test(o.type) && F.CATALOG[o.type] && (o.x !== F.CATALOG[o.type].anchor[0] || o.y !== F.CATALOG[o.type].anchor[1] || 'home' in o)) errors.push('object ' + o.id + ': fixture cannot move');
      if (o.type !== 'dept-desk') continue;
      if (!/^desk-\d{1,2}$/.test(o.desk)) { errors.push('object ' + o.id + ': unknown desk ' + o.desk); continue; }
      deskId(o.desk);
      const role = deskRole(o);
      if (!role) errors.push('object ' + o.id + ': desk ' + o.desk + ' needs a role');
      else if (!root.RoleCatalog.get(role)) errors.push('object ' + o.id + ': unknown role ' + role);
      else if (roles.has(role)) errors.push('two desks for ' + role);
      roles.add(role);
    }
    const nDesks = desksOf(layout).length;
    if (layout.scene) { if (nDesks) errors.push('desks belong in the office'); } // agents stay in the office in step 2
    else if (!nDesks) errors.push('no desks');
    if (nDesks > MAX_DESKS) errors.push('too many desks');
    if (errors.length) return { ok: false, errors }; // the checks below draw the objects
    try { geometry(layout, errors, spotId, extra); } catch (e) { errors.push('malformed: ' + e.message); } // bad params can break a painter
    return { ok: !errors.length, errors: errors.slice(0, MAX_ERRORS) };
  }

  function geometry(layout, errors, spotId, extra) {
    Object.keys(F.spotsOf(layout.objects)).forEach(spotId);
    layout.spots.forEach(s => { spotId(s.id); extra('spot', s, SPOT_FIELDS); });

    const { w, h } = layout.size, grid = gridOf(layout), spots = spotsOf(layout), water = rectsOf(layout, 'water');
    const sp0 = layout.spawn;
    requiredSpots(layout).forEach(id => spots[id] || errors.push('missing spot ' + id)); // every spot the agent brain reads must exist
    if (grid.blocked[W.cellOf(grid, sp0)]) errors.push('spawn (' + sp0.x + ',' + sp0.y + ') is blocked');
    const reach = W.reachFrom(grid, sp0); // one flood fill, not one A* per spot
    for (const s of Object.values(spots)) {
      if (errors.length >= MAX_ERRORS) break;
      if (!(s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h)) { errors.push('spot ' + s.id + ' is outside the world'); continue; }
      if (water.some(([x0, y0, x1, y1]) => s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1)) errors.push('spot ' + s.id + ' is in water');
      else if (!reach(s)) errors.push('spot ' + s.id + ' is unreachable from spawn');
    }
  }

  root.WorldModel = { VERSION, INTERIORS, ZONE_TYPES: [...ZONE_TYPES], defaultLayout, isDefaultZones, validate, spotsOf, gridOf, requiredSpots, deskRole, MAX_DESKS, MIGRATE_V2, MIGRATE_V2_GARDEN, migrateV2, officeLayout };
  if (root.OfficeMotion && typeof root.OfficeMotion.useLayout === 'function') root.OfficeMotion.useLayout(defaultLayout());
})(globalThis);
