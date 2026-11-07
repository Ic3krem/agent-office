// Office movement: layout (spots, desks, walk grid), path finding, walkers and the state machine that decides where each
// agent should be. Pure logic with no DOM, so it is unit tested (office-motion.test.mjs loads this file in a vm).
// The server snapshot is the only input; everything below is derived from it every tick, so a reload never desyncs.
(function (root) {
  'use strict';
  const WX = 1240, WY = 780; // world size in ground units (isometric 2:1, x runs right-down, y runs left-down)

  // ---------- the team: one entry per department desk, from RoleCatalog (drift test against ROSTER in office-motion.test.mjs) ----------
  const RC = root.RoleCatalog;
  const member = (r, desk) => ({ key: r.key, name: r.name, role: r.role, model: r.model, color: r.color, accent: r.accent, desk });
  // Built-in desks until useLayout() applies a layout; useLayout refills it in place (other modules hold this array).
  const TEAM = Object.keys(RC.BUILTIN_DESKS).map(desk => member(RC.get(RC.BUILTIN_DESKS[desk]), desk));
  const TIRO = { key: 'tiro', name: 'Tiro', role: 'Office manager', model: 'sonnet', color: '#e8793a', accent: '#ffcf6b', desk: 'office' };

  // ---------- layout ----------
  // Built-in values until useLayout() applies a layout (office-furniture.js reads DESKS and SPOTS at load).
  const CX = [155, 385, 615, 845];                  // desk block centres (x) of the built-in office
  // A department desk from its seat: the block is the floor it owns, the rect the furniture walkers must not cross.
  const deskAt = (id, key, x, y) => {
    const top = y < 396; // seat north of the aisle: top row
    return { id, key, col: Math.round((x - 155) / 230), top, cx: x,
      block: { x0: x - 95, x1: x + 95, y0: y - (top ? 90 : 89), y1: y + (top ? 20 : 24) },
      rect: { x0: x - 50, x1: x + 50, y0: y - (top ? 77 : 76), y1: y - (top ? 25 : 24) },
      seat: { x, y } };
  };
  const DESKS = TEAM.map((t, i) => deskAt(t.desk, t.key, CX[i % 4], i < 4 ? 352 : 516));
  const TIRO_DESK = { x0: 150, x1: 300, y0: 46, y1: 96 };
  // Furniture rectangles walkers must never cross (checked by the tests): desks and the manager's desk.
  const OBSTACLES = [...DESKS.map(d => d.rect), TIRO_DESK];

  // Spots: where a character can be. face: e=+x (down-right), s=+y (down-left), w=-x (up-left), n=-y (up-right).
  // e and s show the front of the character, w and n the back.
  const SPOTS = {};
  const spot = (id, x, y, face, zone, extra) => (SPOTS[id] = Object.assign({ id, x, y, face, zone }, extra || {}));
  DESKS.forEach(d => spot(d.id, d.seat.x, d.seat.y, 'n', 'focus', { seat: true, desk: true }));
  spot('tiro:seat', 225, 30, 's', 'office', { seat: true, desk: true });
  spot('tiro:window', 45, 150, 'w', 'office');
  spot('office:report', 225, 150, 'n', 'office');
  [385, 340, 295].forEach((x, i) => spot('queue:' + (i + 1), x, 250, 'e', 'door'));
  // garden
  spot('garden:b1', 700, 24, 's', 'garden', { seat: true });
  spot('garden:b2', 860, 24, 's', 'garden', { seat: true });
  spot('garden:b3', 585, 118, 'e', 'garden', { seat: true });
  spot('garden:pS', 790, 178, 'n', 'garden');
  spot('garden:pE', 864, 105, 'w', 'garden');
  spot('garden:pW', 716, 105, 'e', 'garden');
  spot('garden:fl', 620, 178, 'n', 'garden');
  spot('garden:lamp', 940, 150, 'w', 'garden');
  // east park (x 1000..1240, y 0..550) beside the focus band, reached through the fence gate at the aisle's east end
  spot('pk:b1', 1050, 440, 's', 'garden', { seat: true });
  spot('pk:b2', 1150, 440, 's', 'garden', { seat: true });
  spot('pk:pond', 1120, 372, 'n', 'garden');
  // the scheduler's station on the garage forecourt: a fixed non-agent character stands here (see office-world.js)
  spot('sched:npc', 1072, 758, 's', 'garage');
  const GARDEN = ['garden:b1', 'garden:b2', 'garden:b3', 'garden:pS', 'garden:pE', 'garden:pW', 'garden:fl', 'garden:lamp', 'pk:b1', 'pk:b2', 'pk:pond'];
  // playroom
  spot('play:sofa1', 628, 616, 's', 'play', { seat: true });
  spot('play:sofa2', 686, 616, 's', 'play', { seat: true });
  spot('play:sofa3', 744, 616, 's', 'play', { seat: true });
  spot('play:bean1', 775, 715, 's', 'play', { seat: true });
  spot('play:bean2', 850, 748, 's', 'play', { seat: true });
  spot('play:arcade1', 934, 618, 'w', 'play', { game: true });   // beside the cabinet so the screen stays visible
  spot('play:arcade2', 850, 654, 'n', 'play', { game: true });
  spot('play:pit', 935, 725, 's', 'play', { seat: true });
  spot('play:hoop', 568, 735, 'w', 'play', { game: true });
  spot('play:dart', 560, 690, 'w', 'play', { game: true });
  spot('play:juke', 545, 640, 'n', 'play');
  spot('play:table', 705, 690, 'w', 'play');
  spot('play:rug', 700, 745, 's', 'play');
  spot('play:toy', 545, 668, 's', 'play');
  spot('play:plant', 968, 662, 'w', 'play');
  // ordered so consecutive claims land far apart: eight agents spread over the whole room instead of piling on the sofa
  const PLAY = ['play:arcade1', 'play:sofa1', 'play:pit', 'play:hoop', 'play:bean2', 'play:sofa3', 'play:dart', 'play:table', 'play:bean1', 'play:plant', 'play:rug', 'play:toy', 'play:juke', 'play:sofa2', 'play:arcade2'];
  // utility: water cooler corner and hot desks for visitors
  spot('cool:1', 430, 634, 'n', 'utility');
  spot('cool:2', 462, 636, 'n', 'utility');
  const COOLER = ['cool:1', 'cool:2'];
  [118, 152, 306, 346].forEach((x, i) => spot('hot:' + (i + 1), x, 650, 'n', 'utility', { seat: true, desk: true }));
  [180, 230, 300, 350].forEach((x, i) => spot('over:' + (i + 1), x, 712, 'n', 'utility'));
  const HOT = ['hot:1', 'hot:2', 'hot:3', 'hot:4'], OVER = ['over:1', 'over:2', 'over:3', 'over:4'];

  const SPAWN = { x: 420, y: 250 }; // newcomers appear at the manager's door and walk in
  // Town step 3: travellers leave and arrive at the layout's door spot, else at SPAWN (the pseudo spot 'exit', kept out of
  // SPOTS so the layout's spot set stays exactly WorldModel.spotsOf).
  const EXIT = 'exit';
  const exitId = () => SPOTS.door ? 'door' : EXIT;
  const spotOf = id => SPOTS[id] || (id === EXIT ? { id: EXIT, x: SPAWN.x, y: SPAWN.y, face: 'n', zone: 'door' } : undefined);
  // Does a spots map (the office layout's) have its own stools / play spots? Then nobody travels for that state (ruling 3).
  const travelFlags = spots => { spots = spots || SPOTS; return { kain: Object.keys(spots).some(id => id.startsWith('kain:')), play: PLAY.some(id => !!spots[id]) }; };

  // ---------- paths ----------
  let GRID = null; // walk grid of the current layout, built once per useLayout()
  // Apply a layout (WorldModel format). Refills TEAM, SPOTS, DESKS, OBSTACLES and SPAWN in place so held references stay valid.
  function useLayout(layout) {
    const WM = root.WorldModel;
    const desks = layout.objects.filter(o => o.type === 'dept-desk').map(o => [o, RC.get(WM.deskRole(o))]).filter(([, r]) => r);
    TEAM.splice(0, TEAM.length, ...desks.map(([o, r]) => member(r, o.desk)));
    DESKS.splice(0, DESKS.length, ...desks.map(([o, r]) => deskAt(o.desk, r.key, o.x, o.y)));
    OBSTACLES.splice(0, OBSTACLES.length, ...DESKS.map(d => d.rect), TIRO_DESK);
    for (const k of Object.keys(SPOTS)) delete SPOTS[k];
    Object.assign(SPOTS, WM.spotsOf(layout));
    SPAWN.x = layout.spawn.x; SPAWN.y = layout.spawn.y;
    GRID = WM.gridOf(layout);
    if (layout.scene) standSpots(); // interiors only: an office with its own karinderya keeps exactly its layout's spots
    if (layout.scene === 'games') floorSpots();
  }
  // Game hall standing room: open floor on a 40-unit lattice, clear of every spot and the door, nearest the play spots
  // first, capped at twice the desk limit (room for a full team plus a party's).
  function floorSpots() {
    const P = PLAY.map(id => SPOTS[id]).filter(Boolean), all = Object.values(SPOTS), pts = [];
    if (!P.length) return;
    const cx = P.reduce((t, q) => t + q.x, 0) / P.length, cy = P.reduce((t, q) => t + q.y, 0) / P.length;
    for (let x = 20; x < GRID.cols * GRID.cell; x += 40) for (let y = 20; y < GRID.rows * GRID.cell; y += 40) {
      if (GRID.blocked[root.WorldPath.cellOf(GRID, { x, y })] || all.some(q => Math.hypot(q.x - x, q.y - y) < (q.id === 'door' ? 50 : 28))) continue;
      pts.push([Math.hypot(x - cx, y - cy), x, y]);
    }
    pts.sort((a, b) => a[0] - b[0]).slice(0, 2 * root.WorldModel.MAX_DESKS).forEach(([, x, y], i) => spot('play-stand:' + (i + 1), x, y, faceOf(cx - x, cy - y, 's'), 'play'));
  }
  // Standing room for eaters past the stools: open floor beside the table (south of the back row, then east and west of
  // the rows), never a seat. Derived here (kain-stand:N), not layout spots.
  function standSpots() {
    const st = Object.values(SPOTS).filter(s => s.id.startsWith('kain:'));
    if (!st.length || !GRID) return;
    const xs = st.map(s => s.x), ys = st.map(s => s.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys), rows = [...new Set(ys)];
    const cand = [...st.filter(s => s.y === y1).map(s => [s.x, y1 + 36, 'n']), ...rows.map(y => [x1 + 36, y, 'w']), ...rows.map(y => [x0 - 36, y, 'e'])];
    let n = 0;
    for (const [x, y, face] of cand) {
      if (x < 0 || y < 0 || x >= GRID.cols * GRID.cell || y >= GRID.rows * GRID.cell || GRID.blocked[root.WorldPath.cellOf(GRID, { x, y })]) continue;
      if (Object.values(SPOTS).some(q => Math.hypot(q.x - x, q.y - y) < 20)) continue;
      spot('kain-stand:' + (++n), x, y, face, 'kain');
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const resolve = t => typeof t === 'string' ? (spotOf(t) ? { x: spotOf(t).x, y: spotOf(t).y } : null) : t;

  // A* over the layout grid. Returns points from `from` to `to` (inclusive); a straight line when there is no route.
  function pathTo(from, to) {
    const A = resolve(from), B = resolve(to);
    if (!A || !B) return [];
    const pts = GRID ? root.WorldPath.findPath(GRID, A, B) : [];
    if (!pts.length) return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
    return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5); // drop duplicates
  }
  const pathLen = pts => pts.reduce((s, p, i) => s + (i ? dist(p, pts[i - 1]) : 0), 0);

  // ---------- walkers ----------
  const BASE_SPEED = 110, MAX_SPEED = 260, BUDGET_MS = 6000;
  const faceOf = (dx, dy, fallback) => (dx === 0 && dy === 0) ? fallback : Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  const lane = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return ((Math.abs(h) % 5) - 2) * 3; }; // small sideways offset so opposing walkers pass

  function createWalker(id, x, y, face) {
    return { id, x, y, face: face || 's', path: [], pi: 0, moving: false, speed: BASE_SPEED, target: null, elapsed: 0, waited: 0, ignore: 0, fade: 1, fadeDir: 0, teleTo: null, hold: 0 };
  }
  function setTarget(w, to, opt) {
    const spotId = typeof to === 'string' ? to : null, B = resolve(to);
    w.target = spotId || 'pt'; w.goal = B; w.elapsed = 0; w.waited = 0; w.ignore = 0;
    if (opt && opt.instant) { w.x = B.x; w.y = B.y; w.path = []; w.moving = false; if (spotId && spotOf(spotId)) w.face = spotOf(spotId).face; return w; }
    const pts = pathTo({ x: w.x, y: w.y }, to);
    w.path = pts; w.pi = 1; w.moving = pts.length > 1;
    w.speed = Math.max(BASE_SPEED, Math.min(MAX_SPEED, pathLen(pts) / 4.2));
    if (!w.moving && spotId && spotOf(spotId)) w.face = spotOf(spotId).face;
    return w;
  }
  const arrivedAt = (w, spotId) => w.target === spotId && !w.moving && w.fadeDir === 0 && w.fade === 1;
  // Advance one walker by dt seconds. `others` are other walkers that block softly (wait, then slip past after 1.2 s).
  function stepWalker(w, dt, others) {
    if (w.fadeDir) { // fade-teleport fallback
      w.fade += w.fadeDir * dt / 0.22;
      if (w.fadeDir < 0 && w.fade <= 0) { w.fade = 0; w.fadeDir = 1; if (w.goal) { w.x = w.goal.x; w.y = w.goal.y; } w.path = []; w.moving = false; if (spotOf(w.target)) w.face = spotOf(w.target).face; }
      else if (w.fadeDir > 0 && w.fade >= 1) { w.fade = 1; w.fadeDir = 0; }
      return w;
    }
    if (!w.moving) return w;
    w.elapsed += dt * 1000;
    if (w.elapsed > BUDGET_MS) { w.fadeDir = -1; return w; }
    let left = w.speed * dt;
    while (left > 0 && w.pi < w.path.length) {
      const t = w.path[w.pi], dx = t.x - w.x, dy = t.y - w.y, d = Math.hypot(dx, dy);
      const last = w.pi === w.path.length - 1;
      // ease: slow slightly into corners and the final stop
      const k = last ? Math.min(1, 0.4 + d / 40) : Math.min(1, 0.7 + d / 40);
      if (d < 0.01) { w.pi++; continue; }
      const ux = dx / d, uy = dy / d;
      w.face = faceOf(dx, dy, w.face);
      // soft collision: someone ahead and close
      if (w.ignore <= 0 && others) {
        let hit = null;
        for (const o of others) {
          if (o === w || o.fade < 1) continue;
          const ox = o.x - w.x, oy = o.y - w.y, od = Math.hypot(ox, oy);
          if (od < 26 && (ox * ux + oy * uy) / (od || 1) > 0.5 && (o.moving ? String(o.id) < String(w.id) : true) && od < d + 2) { hit = o; break; }
        }
        if (hit) { w.waited += dt; if (w.waited > 1.2) { w.ignore = 2.2; w.waited = 0; } else { return w; } }
      }
      if (w.ignore > 0) w.ignore -= dt;
      const step = Math.min(left, d), mv = step * k;
      w.x += ux * mv; w.y += uy * mv; left -= step;
      if (mv >= d - 0.01) { w.x = t.x; w.y = t.y; w.pi++; }
      if (k < 1) break;
    }
    if (w.pi >= w.path.length) { w.moving = false; w.path = []; if (spotOf(w.target)) w.face = spotOf(w.target).face; }
    return w;
  }

  // ---------- state machine ----------
  const THINK_AFTER = 6000, MIN_DWELL = 3000, TOOL_GRACE = 90000, IDLE_DELAY = 20000, REPORT_MS = 4000, REPORT_FRESH = 15000, PLAY_ROTATE = 22000;
  const S = { DESK: 'AT_DESK', IDLE_DESK: 'IDLE_DESK', THINK: 'THINKING', PLAY: 'PLAYROOM', COOLER: 'COOLER', BLOCKED: 'BLOCKED', ERROR: 'ERROR', WINDOW: 'IDLE_WINDOW', GO: 'WALK_TO_OFFICE', REPORT: 'REPORTING', BACK: 'WALK_BACK', QUEUE: 'QUEUED' };

  function boardOf(snap) {
    const goals = (snap && snap.goals) || [], agents = (snap && snap.agents) || [];
    const open = goals.filter(g => g.status === 'todo' || g.status === 'doing').length;
    const running = (snap && snap.boss && snap.boss.running) || 0;
    const workingN = agents.filter(a => !a.isManager && (a.status === 'working' || a.status === 'nudged')).length;
    const done = goals.filter(g => g.status === 'done').length;
    return { open, running, workingN, done, total: goals.filter(g => g.status !== 'dismissed' && g.status !== 'proposed').length,
      todo: goals.filter(g => g.status === 'todo').length, doing: goals.filter(g => g.status === 'doing').length,
      empty: open === 0 && running === 0 && workingN === 0 };
  }

  // Rules 1-9 for one agent (reporting is a sequence handled by the brain).
  // a: { isManager, status, perm, quietMs, toolInFlight, prev, prevSince, first }   board: from boardOf(), plus emptyFor (ms)
  function nextState(a, board, now) {
    const st = a.status === 'nudged' ? 'working' : a.status;
    if (st === 'limited' && !a.isManager) return S.COOLER;                       // 7: plan limit stands at the cooler
    if (a.perm || st === 'blocked') return S.BLOCKED;                              // 6: stay seated, amber badge
    if (st === 'error') return S.ERROR;                                            // 7: stay at the desk, red badge
    if (st === 'working') {                                                        // 1: working wins
      const mayThink = a.isManager || board.open > 0;                              // 2: only while the board is not empty (Tiro may plan)
      const enter = mayThink && a.quietMs >= THINK_AFTER && !a.toolInFlight;
      if (a.prev === S.THINK) {                                                    // 3 s hysteresis back to the desk
        const back = a.quietMs < THINK_AFTER - MIN_DWELL || a.toolInFlight || !mayThink;
        return back && (now - (a.prevSince || 0) >= MIN_DWELL || !mayThink) ? S.DESK : S.THINK;
      }
      return enter ? S.THINK : S.DESK;
    }
    if (a.isManager) return board.empty ? S.WINDOW : S.IDLE_DESK;                  // 9: no goals left, Tiro stands at the window
    if (board.empty && (a.first || a.prev === S.PLAY || (board.emptyFor || 0) >= (board.idleDelay || IDLE_DELAY))) return S.PLAY; // 4: empty board, after 20 s
    return S.IDLE_DESK;                                                            // 3: open goals, stay seated
  }

  function createBrain(opts) {
    const o = Object.assign({ wall: () => Date.now() }, opts || {});
    const cfg = { idleDelay: IDLE_DELAY };
    const mem = new Map();       // per agent: observation + state
    const deskOwner = {};        // desk spot id -> agent id
    const hotOwner = {};         // visitors
    const gardenOf = {}, playOf = {}, coolOf = {};
    const seenGoal = new Map();  // goal id -> last status
    const reported = new Set();
    let reps = [], emptySince = null, updateN = 0, lastRotate = 0, rotIdx = 0, lastBackAt = -1e9;
    const reportLog = [];

    // plan limit: agents eat at a karinderya when the layout has one (its stools are kain:* spots), else stand at the cooler
    const eatSpots = () => { const k = Object.keys(SPOTS).filter(id => id.startsWith('kain:')); return k.length ? k : COOLER; };
    const claim = (map, list, id) => { if (map[id] && list.includes(map[id])) return map[id]; const used = Object.values(map); const s = list.find(x => !used.includes(x)); if (s) map[id] = s; else delete map[id]; return map[id] || null; };
    // Visiting eaters (a.at, an interior): stools in the order agents are fed (own agents before party friends'), and a
    // stander takes a stool that frees up. Overflow stands beside the table, then at the cooler, then on any open floor
    // spot nobody holds: never two on one spot. Eaters in the office keep the old rule (overflow goes home to the desk).
    const held = id => new Set([playOf, gardenOf, coolOf].flatMap(m => Object.entries(m).filter(([k]) => k !== id).map(([, v]) => v)));
    const openFloor = () => Object.values(SPOTS).filter(q => !q.seat && !q.desk && q.id !== 'door' && !/^(npc|office|queue|tiro):/.test(q.id)).map(q => q.id);
    const claimEat = (id, visiting) => {
      if (!visiting) return claim(coolOf, eatSpots(), id);
      const stools = Object.keys(SPOTS).filter(k => k.startsWith('kain:')), cur = coolOf[id], used = held(id);
      if (stools.includes(cur)) return cur;
      const free = stools.find(x => !used.has(x));
      if (free) return (coolOf[id] = free);
      // own agents before party friends' (ids 'friend:…'): an own eater with no stool takes one a friend holds, and the
      // friend (fed later in the same update) stands
      const isFriend = k => String(k).startsWith('friend:'), guest = !isFriend(id) && Object.keys(coolOf).find(k => isFriend(k) && stools.includes(coolOf[k]));
      if (guest) { coolOf[id] = coolOf[guest]; delete coolOf[guest]; return coolOf[id]; }
      if (cur && SPOTS[cur] && !used.has(cur)) return cur;
      const open = openFloor(), s = [...open.filter(x => x.startsWith('kain-stand:')), ...COOLER, ...open].find(x => SPOTS[x] && !used.has(x));
      if (s) coolOf[id] = s; else delete coolOf[id];
      return coolOf[id] || null;
    };
    // Visiting players past the game hall's play spots stand on its free open floor (play-stand:N), never the door.
    const standPlay = (id, cur) => { const used = held(id); if (cur && SPOTS[cur] && !used.has(cur)) return (playOf[id] = cur); const s = openFloor().filter(x => x.startsWith('play-stand:')).find(x => !used.has(x)); if (s) playOf[id] = s; return s || null; };

    // playroom: take the free spot farthest from everyone already playing (ties keep list order), so the room fills evenly
    const plays = () => PLAY.filter(x => SPOTS[x]); // the game hall has only some of the office's play spots
    const farFrom = (map, id) => { const P = plays(), taken = Object.entries(map).filter(([k]) => k !== id).map(([, v]) => v), used = taken.map(v => SPOTS[v]).filter(Boolean); let best = null, bd = -1; for (const x of P) { if (taken.includes(x) || map[id] === x) continue; const sp = SPOTS[x], d = used.length ? Math.min(...used.map(u => Math.hypot(u.x - sp.x, u.y - sp.y))) : 1e6 - P.indexOf(x); if (d > bd) { bd = d; best = x; } } return best; };
    const claimPlay = (map, id) => { if (map[id] && plays().includes(map[id])) return map[id]; const f = farFrom(map, id); if (f) map[id] = f; else delete map[id]; return map[id] || null; };

    function pickReporter(g, present, now) {
      present = present.filter(a => !a.at && !a.leave); // travellers do not carry reports
      const mentions = a => (a.logs || []).slice(-8).some(l => l && String(l.text || '').includes(g.id));
      let c = present.find(a => !a.isManager && mentions(a));
      if (c) return c;
      c = present.filter(a => !a.isManager && mem.get(a.id) && mem.get(a.id).lastWorkEnd).sort((x, y) => mem.get(y.id).lastWorkEnd - mem.get(x.id).lastWorkEnd)[0];
      if (c) return c;
      return present.filter(a => !a.isManager).sort((x, y) => (mem.get(y.id) ? mem.get(y.id).busyMs : 0) - (mem.get(x.id) ? mem.get(x.id).busyMs : 0))[0] || null;
    }

    function update(snap, now, ctx) {
      ctx = ctx || {};
      const arrived = ctx.arrived || (() => false);
      const agentsIn = (snap && snap.agents) || [];
      const goals = (snap && snap.goals) || [];
      const board = boardOf(ctx.all || snap); // ctx.all: the whole snapshot when `snap` holds only this scene's agents
      if (board.empty) { if (emptySince == null) emptySince = now; } else emptySince = null;
      board.emptyFor = emptySince == null ? 0 : now - emptySince; board.idleDelay = cfg.idleDelay;
      const wall = o.wall();

      // observe
      const ids = new Set(agentsIn.map(a => a.id));
      for (const id of [...mem.keys()]) if (!ids.has(id)) { mem.delete(id); for (const m of [deskOwner, hotOwner, gardenOf, playOf, coolOf]) for (const k of Object.keys(m)) if (m[k] === id || k === id) delete m[k]; reps = reps.filter(r => r.agentId !== id); }
      for (const a of agentsIn) {
        let m = mem.get(a.id);
        const logs = a.logs || [], last = logs[logs.length - 1];
        const sig = logs.length + '|' + (last ? last.t + last.text.slice(0, 40) : '') + '|' + a.status + '|' + (a.task || '').slice(0, 30);
        if (!m) { m = { id: a.id, born: now, first: updateN === 0, sig, lastChange: now, state: null, since: now, busyMs: 0, lastWorkEnd: 0, wasWorking: false, lastTick: now }; mem.set(a.id, m); }
        if (m.sig !== sig) { m.sig = sig; m.lastChange = now; }
        m.lastKind = last ? last.k : null;
        const working = a.status === 'working' || a.status === 'nudged';
        if (working) m.busyMs = Math.min(60000, m.busyMs + (now - m.lastTick)); else m.busyMs = Math.max(0, m.busyMs - (now - m.lastTick));
        if (m.wasWorking && !working) m.lastWorkEnd = now;
        m.wasWorking = working; m.lastTick = now;
      }

      // goal completion -> reports
      for (const g of goals) {
        const was = seenGoal.get(g.id);
        if (g.status === 'done' && g.report && !reported.has(g.id)) {
          const stale = (was === undefined && updateN === 0) && (wall - (g.at || 0) > REPORT_FRESH);
          reported.add(g.id);
          if (!stale) {
            const who = pickReporter(g, agentsIn, now);
            if (who) {
              const ex = reps.find(r => r.agentId === who.id);
              if (ex) ex.goalIds.push(g.id); else reps.push({ agentId: who.id, goalIds: [g.id], phase: 'wait', t0: now });
            }
          }
        }
        seenGoal.set(g.id, g.status);
      }
      // advance the report sequence (one in the office at a time, others queue at the door)
      for (const r of reps) {
        if (r.phase === 'go' && (arrived(r.agentId, 'office:report') || now - r.t1 > 9000)) { r.phase = 'report'; r.until = now + REPORT_MS; }
        else if (r.phase === 'report' && now >= r.until) { r.phase = 'back'; r.t2 = now; lastBackAt = now; }
        else if (r.phase === 'back' && now - r.t2 > 5000) r.done = true;
      }
      reps = reps.filter(r => !r.done);
      if (!reps.find(r => r.phase === 'go' || r.phase === 'report') && now - lastBackAt > 1200) {
        const nxt = reps.find(r => r.phase === 'wait'); if (nxt) { nxt.phase = 'go'; nxt.t1 = now; }
      }

      // state per agent
      const out = [];
      const sorted = agentsIn.slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));
      // desks: profile desk is owned by one agent; extras and profile-less helpers become visitors
      for (const a of sorted) {
        if (a.isManager) continue;
        const d = a.profile && !a.profile.helper && DESKS.find(x => x.id === a.profile.desk);
        if (d && (!deskOwner[d.id] || deskOwner[d.id] === a.id || !ids.has(deskOwner[d.id]))) deskOwner[d.id] = a.id;
      }
      const hotIndex = {}; let ovN = 0;
      for (const a of sorted) {
        if (a.isManager) continue;
        const m = mem.get(a.id);
        const d = a.profile && !a.profile.helper && DESKS.find(x => x.id === a.profile.desk);
        m.visitor = !(d && deskOwner[d.id] === a.id);
        if (m.visitor) { const s = claim(hotOwner, HOT, a.id); if (s) hotIndex[a.id] = s; else hotIndex[a.id] = OVER[ovN++ % OVER.length]; }
      }
      const rotateNow = now - lastRotate > PLAY_ROTATE;
      if (rotateNow) { lastRotate = now; rotIdx++; }
      let rotated = false;

      for (const a of agentsIn) {
        const m = mem.get(a.id);
        const quietMs = now - m.lastChange, toolInFlight = m.lastKind === 'tool' && quietMs < TOOL_GRACE;
        let st = nextState({ isManager: !!a.isManager, status: a.status, perm: a.perm, quietMs, toolInFlight, prev: m.state, prevSince: m.since, first: m.first }, board, now);
        // TRAVEL seam (town step 3), hints from the page: at = the interior this agent is visiting (its trip decides: eat
        // or play), leave = walk to the exit and drop out, arrive = appear at the exit and walk in.
        if (a.at && !a.leave) st = a.at === 'kain' ? S.COOLER : S.PLAY;
        // reporting overrides everything except a working agent (rule 1)
        const rep = !a.at && !a.leave && reps.find(r => r.agentId === a.id);
        const working = a.status === 'working' || a.status === 'nudged';
        let spotId, wasRep = false;
        if (rep && !working && !a.isManager) {
          if (rep.phase === 'wait') { st = S.QUEUE; } else if (rep.phase === 'go') st = S.GO; else if (rep.phase === 'report') st = S.REPORT; else if (rep.phase === 'back') st = S.BACK;
          wasRep = true;
        }
        const home = () => a.isManager ? 'tiro:seat' : m.visitor ? hotIndex[a.id] : a.profile.desk;
        if (a.leave) spotId = exitId();
        else if (st === S.GO || st === S.REPORT) spotId = 'office:report';
        else if (st === S.QUEUE) { const q = reps.filter(r => r.phase === 'wait').findIndex(r => r.agentId === a.id); spotId = 'queue:' + Math.min(3, q + 1); }
        else if (st === S.BACK) { // return by the normal rules, but not the playroom until the walk back finishes
          const back = nextState({ isManager: false, status: a.status, perm: a.perm, quietMs, toolInFlight, prev: null, prevSince: 0, first: false }, board, now);
          spotId = back === S.PLAY ? claimPlay(playOf, a.id) : back === S.COOLER ? claimEat(a.id, !!a.at) : home();
        } else if (st === S.THINK) spotId = a.isManager ? 'tiro:window' : (claim(gardenOf, GARDEN.filter(id => SPOTS[id]), a.id) || home());
        else if (st === S.WINDOW) spotId = 'tiro:window';
        else if (st === S.PLAY) {
          let s = playOf[a.id];
          const stand = s && s.startsWith('play-stand:') ? s : null; // a stander keeps its spot unless a play spot frees up
          if (!s || !PLAY.includes(s)) s = claimPlay(playOf, a.id);
          else if (rotateNow && !rotated && (rotIdx % Math.max(1, agentsIn.length)) === agentsIn.indexOf(a)) {
            const f = farFrom(playOf, a.id);
            if (f) { s = f; playOf[a.id] = s; rotated = true; }
          }
          spotId = s || (a.at && standPlay(a.id, stand)) || home();
        } else if (st === S.COOLER) spotId = claimEat(a.id, !!a.at) || home();
        else spotId = home();
        if (st !== S.PLAY || a.leave) delete playOf[a.id];
        if (st !== S.THINK || a.leave) delete gardenOf[a.id];
        if ((st !== S.COOLER && st !== S.BACK) || a.leave) delete coolOf[a.id];
        if (!SPOTS[spotId] && !SPOTS['tiro:seat']) spotId = exitId(); // an interior has no desks: wait by the door
        if (m.state !== st) { m.state = st; m.since = now; }
        const sp = spotOf(spotId) || SPOTS['tiro:seat'];
        const look = a.isManager ? TIRO : (a.profile || null);
        let pose;
        if (sp.desk) pose = st === S.BLOCKED ? 'hand' : st === S.ERROR ? 'sit' : working ? 'type' : 'sit-idle';
        else if (st === S.THINK) pose = sp.seat ? 'sit-think' : 'think';
        else if (st === S.PLAY) pose = sp.game ? 'play' : sp.seat ? 'sit-play' : 'stand';
        else if (st === S.REPORT || st === S.GO) pose = 'report';
        else if (st === S.COOLER) pose = sp.seat ? 'sit-front' : 'cooler';
        else if (st === S.WINDOW) pose = 'cup';
        else pose = sp.seat ? 'sit-front' : 'stand';
        const badge = st === S.BLOCKED ? 'perm' : st === S.ERROR ? 'error' : st === S.COOLER || a.status === 'limited' ? 'limited' : null;
        out.push({ id: a.id, isManager: !!a.isManager, key: look ? look.key : null, name: a.name, role: a.role, model: a.model, color: look ? look.color : null, accent: look ? look.accent : null,
          visitor: !!m.visitor, state: st, spot: spotId, face: sp.face, pose, badge, status: a.status, working, spawn: !m.first && now - m.born < 100,
          first: m.first, arrive: a.arrive ? exitId() : null, leave: !!a.leave, quietMs, task: a.task || '', turnTok: a.turnTok || 0, errText: a.errText || '', perm: a.perm || null, reporting: wasRep, goalIds: rep ? rep.goalIds : null });
      }
      const rp = reps.find(r => r.phase === 'report'), going = reps.find(r => r.phase === 'go');
      const desksTaken = {}; out.forEach(a => { if (!a.isManager && !a.visitor) desksTaken[a.spot] = a.id; });
      for (const a of out) if (a.isManager) a.lookUp = !!rp;
      for (const m of mem.values()) m.first = false;
      updateN++;
      return { agents: out, board, reps: reps.map(r => ({ agentId: r.agentId, phase: r.phase })), reporter: rp ? rp.agentId : going ? going.agentId : null,
        reportIcon: !!(rp || going), occupiedDesks: desksTaken, playActive: out.some(a => a.state === S.PLAY) };
    }
    return { update, mem, cfg, reports: reportLog };
  }

  // ---------- demo / preview mode: fake snapshots that exercise every state without live agents ----------
  const DEMO_SCENES = ['work', 'think', 'blocked', 'empty', 'report', 'tour'];
  const TASKS = { pixel: 'Polish the onboarding screen', forge: 'Add retry to the sync job', warden: 'Audit secrets in config', probe: 'Run the regression suite', atlas: 'Compare 3 vendor APIs', cabalan: 'Find the Toast menu endpoint', tally: 'Check goals against done', scribe: 'Draft the SOP for deploys' };
  function demoSnapshot(scene, t) {
    t = t || 0;
    const mk = (m, i, status, extra) => Object.assign({ id: 'demo-' + m.key, name: m.name, role: 'Helper · ' + m.key, profile: { key: m.key, name: m.name, role: m.role, color: m.color, accent: m.accent, desk: m.desk },
      model: m.model, status, task: status === 'idle' ? '' : TASKS[m.key], turnTok: 1200 + i * 700, logs: [{ t: '10:0' + i + ':' + String(Math.floor((t + i) / 3) % 60), k: Math.floor((t + i) / 3) % 2 ? 'out' : 'tool', text: 'step ' + Math.floor((t + i) / 3) }], perm: null, canSend: false }, extra || {});
    const boss = (status, extra) => Object.assign({ isManager: true, id: 'demo-tiro', name: 'Tiro', role: 'Manager', profile: TIRO, model: 'sonnet', status, task: status === 'idle' ? '' : 'Checking the board', turnTok: 4200, logs: [{ t: '10:00:' + String(Math.floor(t / 4) % 60), k: 'sys', text: 'Tiro step ' + Math.floor(t / 4) }], perm: null, canSend: false }, extra || {});
    const goal = (id, text, status, extra) => Object.assign({ id, text, status, by: 'you', note: '', at: Date.now() }, extra || {});
    const base = { agents: [], goals: [], boss: { active: true, running: 0, max: 8 }, demo: true };
    const quiet = { logs: [{ t: '10:00:00', k: 'out', text: 'Working on it' }] };
    let s = scene;
    if (scene === 'tour') { const order = ['work', 'think', 'blocked', 'report', 'empty']; s = order[Math.floor(t / 26) % order.length]; t = t % 26; }
    if (s === 'work') {
      return Object.assign(base, { goals: [goal('gd1', 'Ship the onboarding screen', 'doing'), goal('gd2', 'Review the sync job', 'todo')], boss: { active: true, running: 8, max: 8 },
        agents: [boss('working'), ...TEAM.map((m, i) => mk(m, i, 'working'))] });
    }
    if (s === 'think') {
      const thinkers = ['pixel', 'warden', 'atlas', 'scribe'];
      return Object.assign(base, { goals: [goal('gd1', 'Ship the onboarding screen', 'doing')], boss: { active: true, running: 4, max: 8 },
        agents: [boss('working', quiet), ...TEAM.map((m, i) => thinkers.includes(m.key) ? mk(m, i, 'working', quiet) : mk(m, i, i % 2 ? 'working' : 'idle'))] });
    }
    if (s === 'limit') { // plan limit: three agents on a lunch break (karinderya if the layout has one, else the cooler)
      return Object.assign(base, { goals: [goal('gd1', 'Ship the onboarding screen', 'doing')], boss: { active: true, running: 3, max: 8 },
        agents: [boss('working'), ...TEAM.map((m, i) => [1, 4, 6].includes(i) ? mk(m, i, 'limited', { errText: 'Plan limit reached' }) : mk(m, i, i % 3 ? 'idle' : 'working'))] });
    }
    if (s === 'blocked') {
      return Object.assign(base, { goals: [goal('gd1', 'Deploy the report job', 'doing')], boss: { active: true, running: 4, max: 8 },
        agents: [boss('working'), ...TEAM.map((m, i) => i === 1 ? mk(m, i, 'blocked', { perm: { askId: 'q1', short: 'Bash', cmd: 'ssh root@host', why: 'deploy' } })
          : i === 3 ? mk(m, i, 'error', { errText: 'Tests crashed' }) : i === 5 ? mk(m, i, 'limited', { errText: 'Plan limit reached' }) : i === 0 || i === 6 ? mk(m, i, 'working') : mk(m, i, 'idle'))] });
    }
    if (s === 'empty') {
      return Object.assign(base, { goals: [goal('gd1', 'Ship the onboarding screen', 'done', { report: 'r1.md', at: Date.now() - 3600e3 })], boss: { active: true, running: 0, max: 8 },
        agents: [boss('idle'), ...TEAM.map((m, i) => mk(m, i, 'idle'))] });
    }
    if (s === 'report') {
      const done = t > 2.5;
      return Object.assign(base, { goals: [goal('gd1', 'Ship the onboarding screen', done ? 'done' : 'doing', done ? { report: 'r1.md' } : {}), goal('gd2', 'Review the sync job', 'todo')], boss: { active: true, running: 2, max: 8 },
        agents: [boss('working'), ...TEAM.map((m, i) => i === 1 ? mk(m, i, done ? 'idle' : 'working', { logs: [{ t: '10:00:00', k: 'out', text: 'Finished gd1: filed the report' }] }) : mk(m, i, i < 4 ? 'working' : 'idle'))] });
    }
    return base;
  }

  // ---------- camera (pure): zoom 1..3 and pan, in px relative to the centred stage ----------
  const ZMIN = 1, ZMAX = 3;
  const clampView = (v, vw, vh, sc, sw, sh) => { // sw x sh = stage size in stage units, sc = fit scale, vw x vh = viewport px
    const z = Math.min(ZMAX, Math.max(ZMIN, v.z || 1));
    if (z <= ZMIN + 0.001) return { z: ZMIN, x: 0, y: 0 };
    const mx = Math.max(0, (sw * sc * z - vw) / 2) + 80, my = Math.max(0, (sh * sc * z - vh) / 2) + 80;
    return { z, x: Math.min(mx, Math.max(-mx, v.x || 0)), y: Math.min(my, Math.max(-my, v.y || 0)) };
  };
  // zoom by factor about the point (cx, cy) given relative to the viewport centre; the stage point under the cursor stays put
  const zoomAt = (v, factor, cx, cy) => { const z = Math.min(ZMAX, Math.max(ZMIN, v.z * factor)), k = z / v.z; return { z, x: cx - k * (cx - v.x), y: cy - k * (cy - v.y) }; };

  // ---------- frame scheduler (pure) ----------
  // How long to wait before the next canvas frame, in ms; -1 = paused (hidden or minimised window, nothing to draw).
  // state: { hidden, reduced, saver, dirty, interactMs, moving, active, blurred }
  //   dirty      something changed (data, hover, click, zoom): draw at once (never faster than MIN_GAP)
  //   interactMs ms since the last pointer / key input over the stage
  //   moving     a character, fade, bubble or easing is mid-motion: needs smooth frames
  //   active     seated animations (typing, playing, thinking, music, pulses) but nothing travelling
  //   blurred    the window is visible but not focused: everything runs slower
  // saver off keeps the old behaviour (30 fps flat). Reduced motion never animates, only follows changes.
  const FRAME = { MIN_GAP: 16, SMOOTH: 33, WORK: 125, IDLE: 500, INTERACT_MS: 1500, BLUR_SMOOTH: 66, BLUR_WORK: 250, BLUR_IDLE: 1000 };
  function nextFrameDelay(s) {
    if (s.hidden) return -1;
    if (s.reduced) return s.dirty ? 0 : 500;
    if (s.dirty) return 0;
    if (!s.saver) return FRAME.SMOOTH;
    const bl = !!s.blurred;
    if (s.moving) return bl ? FRAME.BLUR_SMOOTH : FRAME.SMOOTH;
    if (s.interactMs < FRAME.INTERACT_MS) return FRAME.SMOOTH;
    if (s.active) return bl ? FRAME.BLUR_WORK : FRAME.WORK;
    return bl ? FRAME.BLUR_IDLE : FRAME.IDLE;
  }

  // ms to wait before drawing, given the time since the last draw; never faster than MIN_GAP; -1 = paused
  const frameWait = (st, since) => { const d = nextFrameDelay(st); return d < 0 ? -1 : Math.max(FRAME.MIN_GAP - since, d - since, 0); };
  const api = { clampView, nextFrameDelay, frameWait, FRAME, zoomAt, ZMIN, ZMAX, WX, WY, TEAM, TIRO, DESKS, deskAt, TIRO_DESK, OBSTACLES, SPOTS, SPAWN, GARDEN, PLAY, COOLER, HOT, OVER, CX, S, THINK_AFTER, MIN_DWELL, IDLE_DELAY, REPORT_MS, PLAY_ROTATE, TOOL_GRACE,
    boardOf, nextState, createBrain, useLayout, EXIT, exitId, spotOf, travelFlags, grid: () => GRID, pathTo, pathLen, createWalker, setTarget, stepWalker, arrivedAt, faceOf, lane, demoSnapshot, DEMO_SCENES, dist };
  root.OfficeMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
