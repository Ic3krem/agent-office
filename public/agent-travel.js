// Agent travel (town step 3): where an agent walking to the karinderya or game hall is at a given time. Pure functions of
// their inputs, so every page (office, kain, games, town) computes the same position, even after a reload. Classic script
// after world-path and town-map: root.AgentTravel.
(function (root) {
  'use strict';
  const EXIT_MS = 6000, ENTER_MS = 5000, TOWN_SPEED = 80; // walk to a door; walk in from a door; town units per second
  const DESTS = ['kain', 'games'];
  const cache = new WeakMap(); // town data -> { grid, pairs }

  // A* path between two lot doors as {pts: [[x,y]...], len}, or null for an unknown lot or no path. Cached per pair.
  function route(town, fromLot, toLot) {
    let c = cache.get(town);
    if (!c) cache.set(town, c = { grid: root.TownMap.grid(town), pairs: {} });
    const key = fromLot + '>' + toLot;
    if (key in c.pairs) return c.pairs[key];
    const door = id => (town.lots.find(l => l.id === id) || {}).door;
    const a = door(fromLot), b = door(toLot);
    const path = a && b ? root.WorldPath.findPath(c.grid, a, b) : [];
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return (c.pairs[key] = path.length ? { pts: path.map(p => [p.x, p.y]), len } : null);
  }

  // Trip reducer: the page keeps the returned record per agent and passes it back next tick. Times come only from
  // agent.statusAt (when the status changed) or `now`; dest null means stay home. Record: {dest, fromLot, departAt,
  // returnAt, prev?}; `prev` is a trip still walking home when the agent was needed again (the new one waits for it).
  function trip(prev, agent, dest, now, fromLot = 'home') {
    const at = agent && typeof agent.statusAt === 'number' ? agent.statusAt : now;
    const fresh = p => Object.assign({ dest, fromLot, departAt: at, returnAt: null }, p ? { prev: p } : {});
    if (!prev) return dest ? fresh() : null;
    if (prev.returnAt == null) {
      if (dest === prev.dest) return prev;
      const back = Object.assign({}, prev, { returnAt: at });
      return dest ? fresh(back) : back;
    }
    if (!dest) return prev;
    // Flapping inside the exit leg: the agent has not turned yet, so the return is simply cancelled (one trip, no gap).
    if (dest === prev.dest && now < prev.departAt + EXIT_MS) return Object.assign({}, prev, { returnAt: null });
    // ponytail: keeps one level of `prev`; a third change while the oldest trip still walks may make it jump.
    const p = Object.assign({}, prev); delete p.prev;
    return fresh(p);
  }

  // Leg plan of a trip: [{leg, scene, ms, dir?: 1 | -1 (town legs)}], ending at the turn (forward) or back home.
  function plan(tr, r) {
    const home = tr.fromLot && tr.fromLot !== 'home' ? 'friend:' + tr.fromLot : 'office';
    const tms = r.len / TOWN_SPEED * 1000;
    const fwd = [{ leg: 'exit', scene: home, ms: EXIT_MS }, { leg: 'town', scene: 'town', ms: tms, dir: 1 },
      { leg: 'enter', scene: tr.dest, ms: ENTER_MS }];
    const back = [{ leg: 'back-exit', scene: tr.dest, ms: EXIT_MS }, { leg: 'back-town', scene: 'town', ms: tms, dir: -1 },
      { leg: 'back-enter', scene: home, ms: ENTER_MS }];
    return { home, fwd, back };
  }

  // Timeline: [{leg, scene, from, to, dir?}] from departAt; the last entry is open-ended ('there' or 'home').
  function timeline(tr, r, start) {
    const { home, fwd, back } = plan(tr, r), out = [];
    let t = start, i = 0;
    const until = tr.returnAt == null ? Infinity : tr.returnAt;
    for (; i < fwd.length && t < until; i++) { out.push(Object.assign({}, fwd[i], { from: t, to: t + fwd[i].ms })); t += fwd[i].ms; }
    if (i === fwd.length && t <= until) {
      out.push({ leg: 'there', scene: tr.dest, from: t, to: until });
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
  const valid = (tr, routes) => tr && DESTS.includes(tr.dest) && typeof tr.departAt === 'number' ? routes(tr.fromLot || 'home', tr.dest) : null;

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
    return out;
  }

  root.AgentTravel = { route, trip, where, EXIT_MS, ENTER_MS, TOWN_SPEED };
})(typeof globalThis !== 'undefined' ? globalThis : this);
