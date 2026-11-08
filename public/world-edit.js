// Build-mode editing engine: screen-to-ground mapping, the catalog the editor offers, and an edit session that applies
// legal ops to a private copy of a layout with undo/redo. No drawing here. Classic script after world-model: root.WorldEdit.
(function (root) {
  'use strict';
  const F = root.OfficeFurniture, WM = root.WorldModel, W = root.WorldPath;
  const SNAP = 10, HISTORY = 100, MIN_ZONE = 20;

  // Inverse of F.P at z = 0.
  function toGround(sx, sy) {
    const a = (sx - F.OXS) / F.K, b = (sy - F.OYS) / F.K2;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  const snap = v => Math.round(v / SNAP) * SNAP;

  const GROUP = {
    'dept-desk': 'desk', 'tiro-desk': 'desk', 'tiro-chair': 'desk', 'guest-chair': 'desk', 'hot-desk': 'desk', 'hot-chair': 'desk', inbox: 'desk',
    plant: 'nature', tree: 'nature', hedge: 'nature', pond: 'nature', 'pond-east': 'nature', 'server-plant': 'nature',
    'trophy-shelf': 'decor', 'bird-feeder': 'decor', 'lamp-post': 'decor', tires: 'decor', 'toy-bin': 'decor', dartboard: 'decor',
  };
  // Locked pieces: fixtures, and the ponds (each owns a water zone that would not follow a move or copy).
  const isFixture = type => /^fixture-|^pond(-|$)/.test(type);
  // One-of-a-kind pieces: they register fixed click keys (or, the pond, a water zone that would not follow a copy).
  const NOT_ADDABLE = new Set(['arcade', 'jukebox', 'server-plant', 'pond', 'pond-east']);
  // What the drawer and messages call each piece.
  const LABELS = {
    'dept-desk': 'Department desk', 'tiro-desk': "Manager's desk", inbox: 'Inbox tray', 'tiro-chair': "Manager's chair", 'guest-chair': 'Guest chair',
    'trophy-shelf': 'Trophy shelf', plant: 'Plant', 'side-table': 'Side table', 'glass-x': 'Glass wall (left\u2013right)', 'glass-y': 'Glass wall (front\u2013back)',
    'office-door': 'Door', pond: 'Pond', bench: 'Bench', 'bench-side': 'Bench (side-on)', tree: 'Tree', 'server-plant': 'Server plant', 'bird-feeder': 'Bird feeder',
    hedge: 'Hedge', arcade: 'Arcade cabinet', 'arcade-race': 'Racing arcade', jukebox: 'Jukebox', sofa3: 'Sofa (3-seat)', 'snack-table': 'Snack table',
    beanbag: 'Beanbag', 'ball-pit': 'Ball pit', hoop: 'Basketball hoop', dartboard: 'Dartboard', 'toy-bin': 'Toy bin', 'filing-cabinet': 'Filing cabinet',
    'server-rack': 'Server rack', bookshelf: 'Bookshelf', 'water-cooler': 'Water cooler', 'coffee-counter': 'Coffee bar', printer: 'Printer',
    'recycling-bin': 'Recycling bin', 'hot-desk': 'Hot desk', 'hot-chair': 'Hot-desk chair', fence: 'Fence', gate: 'Gate', 'pond-east': 'Pond',
    'picnic-table': 'Picnic table', karinderya: 'Karinderya (eat at the plan limit)', 'kain-table': 'Karinderya table (six more seats)', 'broom-corner': 'Broom corner (adds a sweeper)', 'lamp-post': 'Lamp post', garage: 'Garage shed', 'mail-bench': 'Mail sorting bench', mailbox: 'Mailbox', tires: 'Tyre stack',
  };
  const labelOf = type => LABELS[type] || (F.CATALOG[type] && F.CATALOG[type].label) || type;
  const catalog = () => Object.keys(F.CATALOG).filter(t => !isFixture(t)).map(type => ({
    type, label: labelOf(type), group: GROUP[type] || 'furniture', addable: !NOT_ADDABLE.has(type), deletable: true,
    ...(type === 'dept-desk' ? { roles: root.RoleCatalog.ROLES } : {}),
  }));
  const desksOf = l => l.objects.filter(o => o.type === 'dept-desk');
  // Roles that have no desk in layout l yet (what the add-desk picker offers).
  const availableRoles = l => { const taken = new Set(desksOf(l).map(WM.deskRole)); return root.RoleCatalog.ROLES.filter(r => !taken.has(r.key)); };

  // A new piece of a type copies the params of the type's first default piece (bench seat id, plant scale, ...).
  const TEMPLATE = {};
  for (const o of F.defaultInstances()) if (!TEMPLATE[o.type]) { const { id, x, y, home, ...params } = o; TEMPLATE[o.type] = params; }

  const copy = v => JSON.parse(JSON.stringify(v));
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const nextId = (list, prefix) => { const ids = new Set(list.map(e => e.id)); let n = 1; while (ids.has(prefix + '-' + n)) n++; return prefix + '-' + n; };
  const fail = reason => ({ ok: false, reason });

  // The piece under ground point (x, y): the front-most (largest far corner x + y) footprint holding it, else a piece
  // with no footprint (walkable, flat) within 20 units of its x, y. Fixtures never. fps: optional Map id -> rects.
  function pieceAt(objects, x, y, fps) {
    let best = null, far = -Infinity, near = null, nd = 20 * 20;
    for (const o of objects) {
      if (isFixture(o.type)) continue;
      const rs = fps && fps.has(o.id) ? fps.get(o.id) : F.footprints([o]);
      if (!rs.length) { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d <= nd) { nd = d; near = o.id; } continue; }
      for (const r of rs) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3] && r[2] + r[3] > far) { far = r[2] + r[3]; best = o.id; }
    }
    return best || near;
  }

  function createSession(layout) {
    let cur = copy(layout), base = JSON.stringify(cur);
    const past = [], future = [];
    // Footprints painted once per type + params: place() draws a moved piece through a translate, so its footprint is
    // the painted one shifted by the move (exact by construction in office-furniture's add()).
    const fpCache = new Map();
    const fp = o => {
      const k = JSON.stringify(Object.assign({}, o, { id: 0, x: 0, y: 0 }));
      if (!fpCache.has(k)) fpCache.set(k, { x: o.x, y: o.y, rects: F.footprints([o]) });
      const c = fpCache.get(k), dx = o.x - c.x, dy = o.y - c.y;
      return dx || dy ? c.rects.map(r => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]) : c.rects;
    };
    const water = l => l.zones.filter(q => q.type === 'water').map(q => q.rect);

    // Checks 1-3 for piece o standing in layout l (o is not in l.objects, or is skipped by id): every problem as
    // [key, reason]. A move passes the problems the piece already had where it stood, so it only fails on new ones.
    function problems(l, o) {
      const { w, h } = l.size, mine = fp(o), out = [];
      if (!(o.x >= 0 && o.x <= w && o.y >= 0 && o.y <= h) || mine.some(r => !(r[0] >= 0 && r[1] >= 0 && r[2] <= w && r[3] <= h))) out.push(['out', 'outside the world']); // NaN-safe
      const wet = water(l);
      wet.forEach((r, i) => { if (mine.some(m => overlaps(m, r))) out.push(['water:' + i, 'in the water']); });
      const others = [];
      for (const p of l.objects) if (p.id !== o.id) for (const r of fp(p)) {
        if (mine.some(m => overlaps(m, r))) out.push(['obj:' + p.id, 'overlaps ' + p.id]);
        others.push(r);
      }
      const dims = { cols: Math.ceil(w / SNAP), rows: Math.ceil(h / SNAP), cell: SNAP }, blocks = others.concat(wet);
      for (const s of Object.values(F.spotsOf([o]))) {
        if (!(s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h)) { out.push(['spot-out:' + s.id, 'spot ' + s.id + ' is outside the world']); continue; }
        // Is the spot's cell blocked in the full grid? Same answer from a one-cell grid with the blocks shifted onto it,
        // without paying for the whole world's grid on every op.
        const i = W.cellOf(dims, s), cx = (i % dims.cols) * SNAP, cy = Math.floor(i / dims.cols) * SNAP;
        const one = W.buildGrid({ w: SNAP, h: SNAP, cell: SNAP, blocks: blocks.map(r => [r[0] - cx, r[1] - cy, r[2] - cx, r[3] - cy]) });
        if (one.blocked[0]) out.push(['spot:' + s.id, 'spot ' + s.id + ' is blocked']);
      }
      return out;
    }
    const legalPiece = (l, o, had = new Set()) => { const p = problems(l, o).find(([k]) => !had.has(k)); return p ? p[1] : ''; };
    function legalZone(l, z) {
      const [x0, y0, x1, y1] = z.rect;
      if (!WM.ZONE_TYPES.includes(z.type)) return 'unknown zone type ' + z.type;
      if (!(x0 >= 0 && y0 >= 0 && x1 <= l.size.w && y1 <= l.size.h)) return 'zone is outside the world';
      if (x1 - x0 < MIN_ZONE || y1 - y0 < MIN_ZONE) return 'zone needs at least ' + MIN_ZONE + ' x ' + MIN_ZONE;
      return '';
    }
    const findObj = (l, id) => l.objects.find(o => o.id === id);
    const findZone = (l, id) => l.zones.find(q => q.id === id);

    // An op as data -> {ok, reason} or {ok, next, id}; nothing is changed here.
    function plan(op) {
      const l = copy(cur);
      switch (op.op) {
        case 'move': {
          const o = findObj(l, op.id);
          if (!o) return fail('no object ' + op.id);
          if (isFixture(o.type)) return fail('fixtures cannot move');
          const had = new Set(problems(l, o).map(([k]) => k));
          o.x = snap(op.x); o.y = snap(op.y);
          return done(l, legalPiece(l, o, had));
        }
        case 'add': case 'duplicate': {
          const src = op.op === 'add' ? Object.assign({ type: op.type }, TEMPLATE[op.type]) : findObj(l, op.id);
          if (!src || !F.CATALOG[src.type]) return fail(op.op === 'add' ? 'unknown type ' + op.type : 'no object ' + op.id);
          if (isFixture(src.type) || NOT_ADDABLE.has(src.type)) return fail('cannot add ' + src.type);
          const o = Object.assign({}, copy(src), { id: nextId(l.objects, src.type) });
          if (o.type === 'dept-desk' && l.scene) return fail('desks belong in the office');
          if (o.type === 'dept-desk') { // one desk per role, desk ids desk-1.., at most MAX_DESKS
            const role = root.RoleCatalog.get(op.op === 'add' ? (op.params || {}).role : WM.deskRole(src));
            if (!role) return fail('pick a role');
            if (!availableRoles(l).includes(role)) return fail(role.name + ' already has a desk');
            if (desksOf(l).length >= WM.MAX_DESKS) return fail(WM.MAX_DESKS + ' desks is the limit');
            o.id = o.desk = nextId(desksOf(l).map(p => ({ id: p.desk })), 'desk'); o.role = role.key;
          }
          const tries = op.op === 'add' ? [[snap(op.x), snap(op.y)]] : spiral(src.x, src.y);
          let why = '';
          for (const [x, y] of tries) {
            Object.assign(o, { x, y });
            if (!(why = legalPiece(l, o))) { l.objects.push(o); return done(l, '', o.id); }
          }
          return fail(op.op === 'add' ? why : 'no free space nearby');
        }
        case 'remove': {
          const o = findObj(l, op.id);
          if (!o) return fail('no object ' + op.id);
          if (o.type === 'dept-desk' && desksOf(l).length === 1) return fail('keep at least one desk');
          if (isFixture(o.type)) return fail('fixtures cannot be deleted');
          const had = WM.spotsOf(l);
          l.objects = l.objects.filter(p => p !== o);
          const now = WM.spotsOf(l), lost = WM.requiredSpots(l).filter(id => had[id] && !now[id]);
          return done(l, lost.length ? 'needed by agents: ' + lost.join(', ') : '');
        }
        case 'addZone': {
          const z = { id: nextId(l.zones, op.type), type: op.type, rect: (op.rect || []).map(snap) };
          l.zones.push(z);
          return done(l, legalZone(l, z), z.id);
        }
        case 'setZone': {
          const z = findZone(l, op.id);
          if (!z) return fail('no zone ' + op.id);
          if ((op.rect && z.type === 'water') || (op.type && op.type !== z.type && (op.type === 'water' || z.type === 'water'))) return fail('water belongs to its pond');
          if (op.rect) z.rect = op.rect.map(snap);
          if (op.type) z.type = op.type;
          return done(l, legalZone(l, z));
        }
        case 'removeZone': {
          const z = findZone(l, op.id);
          if (!z) return fail('no zone ' + op.id);
          if (z.type === 'water') return fail('water belongs to its pond');
          l.zones = l.zones.filter(q => q.id !== op.id);
          return done(l, '');
        }
        case 'load': { // a whole layout (template, default, another window's save)
          const v = WM.validate(op.layout);
          return v.ok ? done(copy(op.layout), '') : fail('invalid layout: ' + v.errors.slice(0, 3).join('; '));
        }
      }
      return fail('unknown op ' + op.op);
    }
    function done(next, reason, id) {
      if (reason) return fail(reason);
      const r = { ok: true, next }; if (id) r.id = id; return r;
    }
    // Where a copy may land: rings of snapped offsets round the source, nearest first.
    function spiral(x, y) {
      const out = [];
      for (let d = 2 * SNAP; d <= 200; d += 2 * SNAP) for (const [i, j] of [[1, 1], [1, 0], [0, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]) out.push([snap(x + i * d), snap(y + j * d)]);
      return out;
    }

    function apply(op) {
      const r = plan(op);
      if (!r.ok) return r;
      past.push(JSON.stringify(cur)); if (past.length >= HISTORY) past.shift(); // HISTORY snapshots in all, counting the current one
      future.length = 0; cur = r.next;
      return r.id ? { ok: true, id: r.id } : { ok: true };
    }
    const check = op => { const r = plan(op); return r.ok ? (r.id ? { ok: true, id: r.id } : { ok: true }) : r; };

    return {
      layout: () => copy(cur),
      dirty: () => JSON.stringify(cur) !== base,
      markSaved: () => { base = JSON.stringify(cur); },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      undo: () => { if (past.length) { future.push(JSON.stringify(cur)); cur = JSON.parse(past.pop()); } },
      redo: () => { if (future.length) { past.push(JSON.stringify(cur)); cur = JSON.parse(future.pop()); } },
      move: (id, x, y) => apply({ op: 'move', id, x, y }),
      add: (type, x, y, params) => apply({ op: 'add', type, x, y, params }),
      duplicate: id => apply({ op: 'duplicate', id }),
      remove: id => apply({ op: 'remove', id }),
      addZone: (type, rect) => apply({ op: 'addZone', type, rect }),
      setZone: (id, { rect, type } = {}) => apply({ op: 'setZone', id, rect, type }),
      removeZone: id => apply({ op: 'removeZone', id }),
      load: layout => apply({ op: 'load', layout }),
      check,
    };
  }

  root.WorldEdit = { toGround, snap, catalog, availableRoles, labelOf, createSession, pieceAt, isFixture };
})(globalThis);
