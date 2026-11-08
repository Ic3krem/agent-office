// Agent travel (town step 3): where an agent walking to the karinderya or game hall is at a given time. Pure functions of
// their inputs, so every page (office, kain, games, town) computes the same position, even after a reload. Classic script
// after world-path and town-map: root.AgentTravel.
(function (root) {
  'use strict';
  const EXIT_MS = 6000, ENTER_MS = 5000, TOWN_SPEED = 80; // walk to a door; walk in from a door; town units per second
  const DESTS = ['kain', 'games'], MAX_CHAIN = 4, IDLE_DELAY = 20000; // IDLE_DELAY = OfficeMotion.IDLE_DELAY (tested)
  const cache = new WeakMap(); // town data -> { grid, pairs }
  // Town step 5: an idle trip may end at an outdoor spot, dest 'spot:<id>:<n>' (n: the agent's roster index; the point is
  // n mod the spot's point count, agents past the count stand CROWD units further on per lap). Its 'there' leg is in town.
  const isSpot = d => typeof d === 'string' && /^spot:[a-z-]+:\d+$/.test(d), idleTrip = d => d === 'games' || isSpot(d), CROWD = [6, 4];

  // A* path between two lot doors as {pts: [[x,y]...], len}, or null for an unknown lot or no path. Cached per pair.
  function route(town, fromLot, toLot) {
    let c = cache.get(town);
    if (!c) cache.set(town, c = { grid: root.TownMap.grid(town), pairs: {} });
    const key = fromLot + '>' + toLot;
    if (key in c.pairs) return c.pairs[key];
    const door = id => (town.lots.find(l => l.id === id) || {}).door;
    const sp = isSpot(toLot) ? root.TownMap.spotPoint(town, toLot) : null; // a spot: door -> its activity point
    const a = door(fromLot), b = sp ? { x: sp.x + sp.k * CROWD[0], y: sp.y + sp.k * CROWD[1] } : door(toLot);
    const path = a && b ? root.WorldPath.findPath(c.grid, a, b) : [];
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return (c.pairs[key] = path.length ? Object.assign({ pts: path.map(p => [p.x, p.y]), len }, sp ? { spot: { spot: sp.spot, point: sp.point, act: sp.act, face: sp.face, x: b.x, y: b.y } } : null) : null);
  }

  // Trip reducer: the page keeps the returned record per agent and passes it back next tick. Times come only from
  // agent.statusAt (when the status changed; `now` only if it is missing), so pages polling the same history at different
  // times build identical records. dest null means stay home. Record (plain JSON): {dest, fromLot, departAt, returnAt,
  // statusAt, prev?}; statusAt is the status time the record last applied, `prev` the chain of trips still walking home
  // when the agent was needed again (the new one waits for them). With `routes`, chain entries that ended by the
  // transition time are pruned; without it the chain is kept whole.
  function trip(prev, agent, dest, now, fromLot = 'home', routes) {
    const at = agent && typeof agent.statusAt === 'number' ? agent.statusAt : now;
    // A dest change without a status change (a layout edit mid-trip) waits for the next status change: no jump.
    if (prev && prev.statusAt === at) return prev;
    const fresh = p => prune(Object.assign({ dest, fromLot, departAt: at, returnAt: null, statusAt: at }, p ? { prev: p } : {}), at, routes);
    if (!prev) return dest ? fresh() : null;
    if (prev.returnAt == null) {
      if (dest === prev.dest) return Object.assign({}, prev, { statusAt: at });
      const back = Object.assign({}, prev, { returnAt: at, statusAt: at });
      return dest ? fresh(back) : back;
    }
    if (!dest) return Object.assign({}, prev, { statusAt: at });
    // Flapping inside the exit leg: the agent has not turned yet, so the return is simply cancelled (one trip, no gap).
    if (dest === prev.dest && at < prev.departAt + EXIT_MS) return Object.assign({}, prev, { returnAt: null, statusAt: at });
    return fresh(prev);
  }

  // Drop chain entries that ended by `at`, folding their end into the next trip's departAt (the start where() would use).
  function prune(tr, at, routes, depth = 1) {
    if (!tr.prev) return tr;
    // Without routes the end times are unknown: keep the newest MAX_CHAIN entries (dropping older ones may make one jump).
    if (typeof routes !== 'function') { const out = Object.assign({}, tr); if (depth >= MAX_CHAIN) delete out.prev; else out.prev = prune(tr.prev, at, routes, depth + 1); return out; }
    const e = endOf(tr.prev, routes), out = Object.assign({}, tr);
    if (e > at) { out.prev = prune(tr.prev, at, routes); return out; }
    delete out.prev;
    if (e > out.departAt) out.departAt = e;
    return out;
  }

  // Leg plan of a trip: [{leg, scene, ms, dir?: 1 | -1 (town legs)}], ending at the turn (forward) or back home.
  function plan(tr, r) {
    const home = tr.fromLot && tr.fromLot !== 'home' && !tr.mine ? 'friend:' + tr.fromLot : 'office'; // mine: your agent, from your lot
    const tms = r.len / TOWN_SPEED * 1000, spot = isSpot(tr.dest);
    // a spot has no building: no enter/exit leg there, and fwd and back stay the same length (the turn rule in timeline)
    const fwd = [{ leg: 'exit', scene: home, ms: EXIT_MS }, { leg: 'town', scene: 'town', ms: tms, dir: 1 },
      ...(spot ? [] : [{ leg: 'enter', scene: tr.dest, ms: ENTER_MS }])];
    const back = [...(spot ? [] : [{ leg: 'back-exit', scene: tr.dest, ms: EXIT_MS }]), { leg: 'back-town', scene: 'town', ms: tms, dir: -1 },
      { leg: 'back-enter', scene: home, ms: ENTER_MS }];
    return { home, fwd, back, there: spot ? 'town' : tr.dest };
  }

  // Timeline: [{leg, scene, from, to, dir?}] from departAt; the last entry is open-ended ('there' or 'home').
  function timeline(tr, r, start) {
    const { home, fwd, back, there } = plan(tr, r), out = [];
    let t = start, i = 0;
    const until = tr.returnAt == null ? Infinity : tr.returnAt;
    for (; i < fwd.length && t < until; i++) { out.push(Object.assign({}, fwd[i], { from: t, to: t + fwd[i].ms })); t += fwd[i].ms; }
    if (i === fwd.length && t <= until) {
      out.push({ leg: 'there', scene: there, from: t, to: until });
      if (until === Infinity) return out;
      t = until;
    }
    if (!out.length) return [{ leg: 'home', scene: home, from: start, to: Infinity }];
    // Ruling 4: finish the leg in progress, then turn back from where it ends.
    for (const b of back.slice(back.length - i)) { out.push(Object.assign({}, b, { from: t, to: t + b.ms })); t += b.ms; }
    out.push({ leg: 'home', scene: home, from: t, to: Infinity });
    return out;
  }

  const homeAt = scene => ({ scene, leg: 'home', t: 0 });
  const endOf = (tr, routes) => { const r = valid(tr, routes); if (!r) return -Infinity; const l = timeline(tr, r, startOf(tr, routes)).pop(); return l.leg === 'home' ? l.from : Infinity; };
  const startOf = (tr, routes) => tr.prev ? Math.max(tr.departAt, endOf(tr.prev, routes)) : tr.departAt;
  const valid = (tr, routes) => tr && (DESTS.includes(tr.dest) || isSpot(tr.dest)) && typeof tr.departAt === 'number' ? routes(tr.fromLot || 'home', tr.dest) : null;

  function at(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], s = Math.hypot(x1 - x0, y1 - y0);
      if (d <= s) return s ? { x: x0 + (x1 - x0) * d / s, y: y0 + (y1 - y0) * d / s } : { x: x0, y: y0 };
      d -= s;
    }
    const [x, y] = pts[pts.length - 1]; return { x, y };
  }

  // {scene, leg, t (0..1 in the leg), pos? (town legs only)}. routes(fromLot, toLot) -> route() result or null.
  // Scenes: 'office' (home), 'friend:<lot>' (a friend agent's own lot), 'town', 'kain', 'games'. Bad or unknown trip data gives office home.
  function where(tr, now, routes) {
    if (tr && tr.prev && now < endOf(tr.prev, routes)) return where(tr.prev, now, routes);
    const r = valid(tr, routes);
    if (!r) return homeAt('office');
    const tl = timeline(tr, r, startOf(tr, routes));
    if (now < tl[0].from) return homeAt(plan(tr, r).home);
    const l = tl.find(x => now < x.to) || tl[tl.length - 1];
    const t = l.to === Infinity ? 0 : Math.min(1, Math.max(0, (now - l.from) / (l.to - l.from)));
    const out = { scene: l.scene, leg: l.leg, t };
    if (l.dir) out.pos = at(r.pts, (l.dir > 0 ? t : 1 - t) * r.len);
    else if (l.leg === 'there' && r.spot) Object.assign(out, { pos: { x: r.spot.x, y: r.spot.y }, spot: r.spot.spot, point: r.spot.point, act: r.spot.act, face: r.spot.face });
    return out;
  }

  // Where an agent goes, judged against the OFFICE layout. office: {kain, play} (OfficeMotion.travelFlags): the office has
  // its own stools / play spots, so the agent stays (ruling 3). empty: the board is empty (OfficeMotion.boardOf). Mirrors
  // nextState: limited -> cooler, idle on an empty board -> playroom; the manager never travels.
  // ctx (town step 5): {spots: [{id, n: point count}], ids: the snapshot's non-manager ids, sorted}; without it, no spots.
  function destOf(agent, office, empty, ctx) {
    if (!agent || agent.isManager) return null;
    const st = agent.status;
    if (st === 'limited') return office.kain ? null : 'kain';
    if (agent.perm || ['blocked', 'error', 'working', 'nudged'].includes(st)) return null;
    if (!empty) return null;
    if (!ctx || !Array.isArray(ctx.spots) || !ctx.spots.length) return office.play ? null : 'games';
    const i = Math.max(0, (ctx.ids || []).indexOf(agent.id));
    return pickIdle(agent.id, agent.statusAt, ctx.spots.map(s => ({ id: s.id, n: i })), office.play);
  }

  // FNV-1a 32-bit: a stable hash every page computes alike (no Math.random).
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // Where an idle agent goes, from its id and the server's statusAt only, so every page agrees: 120 of 400 buckets the game
  // hall (or, with an office playroom, null: stay), 100 the park, 45 each the other spots. spots: [{id, n: the point index}];
  // a bucket whose spot the map lacks falls back to the game hall / null.
  const BUCKETS = [['park', 100], ['waterfall', 45], ['tree', 45], ['court', 45], ['pasture', 45]];
  function pickIdle(agentId, statusAt, spots, play) {
    let b = hash(agentId + '|' + statusAt) % 400 - 120;
    const home = play ? null : 'games';
    if (b < 0) return home;
    for (const [id, w] of BUCKETS) {
      if (b < w) { const s = (spots || []).find(o => o.id === id); return s ? 'spot:' + id + ':' + s.n : home; }
      b -= w;
    }
    return home;
  }

  // The time a trip decision takes effect (trip()'s statusAt). A games trip starts once the board has been empty for
  // IDLE_DELAY (the office's emptyFor >= idleDelay), never before the agent went idle: max(statusAt, emptyAt + IDLE_DELAY).
  // While a games trip is still out (prev, returnAt null), staying home starts no earlier than the board was first seen
  // full, so the idle agent walks back then; every other case keeps statusAt. board: {emptyAt?, fullAt?}, times the
  // pages store when they first see the board empty / full.
  function departAt(agent, dest, board, prev) {
    const s = agent.statusAt, b = board || {};
    if (idleTrip(dest)) return Math.max(s, (typeof b.emptyAt === 'number' ? b.emptyAt : s) + IDLE_DELAY);
    if (!dest && prev && idleTrip(prev.dest) && prev.returnAt == null && typeof b.fullAt === 'number') return Math.max(s, b.fullAt);
    return s;
  }

  // Per-snapshot update: records {[agentId]: trip record} -> the new records, dropping ids no longer present. Returns
  // `records` itself when nothing changed, so the page can skip its storage write. board: see departAt.
  function sync(records, agents, destFn, now, routes, board, fromLot = 'home') { // fromLot: your lot in a party world
    const prev = records || {}, out = {};
    let same = !!records;
    for (const a of agents || []) {
      const p = prev[a.id] || null, dest = destFn(a), at = typeof a.statusAt === 'number' ? departAt(a, dest, board, p) : a.statusAt;
      let r = trip(p, at === a.statusAt ? a : { statusAt: at }, dest, now, fromLot, routes);
      if (r && r !== p && fromLot !== 'home' && !r.mine) r = Object.assign({}, r, { mine: true });
      if (r) out[a.id] = r;
      if (r !== (prev[a.id] || null)) same = false;
    }
    return same && Object.keys(out).length === Object.keys(prev).length ? records : out;
  }

  // The next time after `now` that a leg of this trip (or of a trip it waits on) starts in `scene`, or Infinity. Lets a
  // page sleep until a traveller next appears there (one timeout instead of polling).
  function nextIn(tr, scene, now, routes) {
    let best = tr && tr.prev ? nextIn(tr.prev, scene, now, routes) : Infinity;
    const r = valid(tr, routes);
    if (r) for (const l of timeline(tr, r, startOf(tr, routes))) if (l.scene === scene && l.from > now && l.from < best) best = l.from;
    return best;
  }

  // The trip records every page of this origin shares: localStorage 'ao.trips', plus 'ao.boardEmptyAt' (when the board was
  // first seen empty). Memory only when storage is unavailable. One store per page; sync(agents, office, empty, now,
  // routes) reads the stored records, runs sync() with destOf, writes them back when they changed, and returns them.
  function store() {
    const TRIPS_KEY = 'ao.trips', EMPTY_KEY = 'ao.boardEmptyAt', FRIENDS_KEY = 'ao.friendTrips';
    // fullAt: when this page first saw the board full again (the return time; the stored records hold it after that).
    let trips = {}, emptyAt = null, fullAt = null, friendRecs = {};
    const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
    function boardTimes(empty, now) {
      if (!empty) {
        emptyAt = null; if (fullAt == null) fullAt = now;
        try { localStorage.removeItem(EMPTY_KEY); } catch (e) { /* memory only */ }
        return { fullAt };
      }
      fullAt = null;
      try { const v = Number(localStorage.getItem(EMPTY_KEY)); if (localStorage.getItem(EMPTY_KEY) != null && isFinite(v)) emptyAt = v; } catch (e) { /* memory only */ }
      if (emptyAt == null) emptyAt = now;
      try { localStorage.setItem(EMPTY_KEY, String(emptyAt)); } catch (e) { /* memory only */ }
      return { emptyAt };
    }
    return {
      // spots (town step 5): TownMap.spotsOf(town), so idle agents may walk out to them; omitted, nobody does.
      sync(agents, office, empty, now, routes, fromLot = 'home', spots) {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(TRIPS_KEY)); } catch (e) { /* no storage: memory only */ }
        let prev = plain(stored) ? stored : trips;
        if (Object.values(prev).some(r => !plain(r))) prev = Object.fromEntries(Object.entries(prev).filter(([, r]) => plain(r))); // drop junk records
        const ctx = Array.isArray(spots) && spots.length ? { spots, ids: (agents || []).filter(a => a && !a.isManager).map(a => a.id).sort() } : null;
        trips = sync(prev, agents, a => destOf(a, office, empty, ctx), now, routes, boardTimes(empty, now), fromLot);
        if (trips !== stored) try { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); } catch (e) { /* memory only */ }
        return trips;
      },
      // Friends' agents, from the party view ({connected, members: [{id, name, crew: [{id, name, key, state, bubble}]}]}).
      // No server time exists for them, so a state counts from when a page of this origin first saw it. Records live
      // apart from ours in 'ao.friendTrips' as {['<member>:<agent>']: {state, at, trip?}}. Only 'limited' travels, to
      // kain, from the member's lot (TownMap.friendLots). Returns [{id: 'friend:<member>:<agent>', name, status, trip}].
      friends(party, now, routes) {
        let raw = null, stored = null;
        try { raw = localStorage.getItem(FRIENDS_KEY); stored = JSON.parse(raw); } catch (e) { /* no storage: memory only */ }
        const prev = plain(stored) ? stored : friendRecs, out = {}, list = [];
        const members = party && party.connected && Array.isArray(party.members) ? party.members : [];
        // Each member's agents leave from that member's lot in the party world (the host's from the main house).
        const world = root.TownMap.partyWorld(party), lots = {};
        if (world) for (const [lot, o] of Object.entries(world.owners)) if (!o.me) lots[o.id] = lot;
        for (const m of members) {
          const lot = m && lots[m.id];
          if (!lot || !Array.isArray(m.crew)) continue;
          for (const a of m.crew) {
            if (!a || typeof a.id !== 'string') continue;
            // limited -> the karinderya; idle (not the manager) -> the game hall once idle for IDLE_DELAY, as in their own office
            const key = m.id + ':' + a.id, q = prev[key], limited = a.state === 'limited', dest = limited ? 'kain' : a.state === 'idle' && a.key !== 'tiro' ? 'games' : null;
            const p = plain(q) && typeof q.at === 'number' && (q.trip === undefined || plain(q.trip)) ? q : null; // junk: start afresh
            if (!p && !dest) continue;
            const at = p && p.state === a.state ? p.at : now;
            const tr = trip(p && p.trip || null, { statusAt: dest === 'games' ? at + IDLE_DELAY : at }, dest, now, lot, routes);
            out[key] = p && p.at === at && (p.trip || null) === tr ? p : Object.assign({ state: a.state, at }, tr ? { trip: tr } : {});
            if (tr) list.push({ id: 'friend:' + key, name: (a.name || 'Helper') + ' · ' + m.name, status: a.state, trip: tr });
          }
        }
        friendRecs = out;
        const s = JSON.stringify(out);
        if (s !== raw) try { localStorage.setItem(FRIENDS_KEY, s); } catch (e) { /* memory only */ }
        return list;
      },
    };
  }

  root.AgentTravel = { route, trip, where, nextIn, destOf, departAt, sync, store, hash, pickIdle, isSpot, EXIT_MS, ENTER_MS, TOWN_SPEED, IDLE_DELAY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
