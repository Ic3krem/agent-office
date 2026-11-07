import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'agent-travel.js'] });
const T = ctx.AgentTravel;
const town = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
const routes = (a, b) => T.route(town, a, b);
const R = routes('home', 'kain'), TOWN = R.len / T.TOWN_SPEED * 1000;
const lim = (statusAt) => ({ status: 'limited', statusAt });
const plain = v => JSON.parse(JSON.stringify(v));
const W = (trip, now, r = routes) => plain(T.where(trip, now, r));
const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

// Point at distance d along a [[x,y]...] polyline.
const along = (pts, d) => {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], s = Math.hypot(x1 - x0, y1 - y0);
    if (d <= s) return { x: x0 + (x1 - x0) * d / s, y: y0 + (y1 - y0) * d / s };
    d -= s;
  }
  const [x, y] = pts[pts.length - 1]; return { x, y };
};
const near = (p, q, eps = 1e-6) => assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < eps, JSON.stringify([p, q]));

test('constants and route between lot doors', () => {
  assert.deepEqual([T.EXIT_MS, T.ENTER_MS, T.TOWN_SPEED], [6000, 5000, 80]);
  assert.deepEqual(plain(R.pts[0]), [1080, 205]);
  assert.deepEqual(plain(R.pts[R.pts.length - 1]), [1495, 675]);
  assert.ok(R.len > 0);
  assert.equal(routes('home', 'kain'), R, 'cached per pair');
  assert.equal(routes('home', 'nowhere'), null);
  assert.deepEqual(plain(routes('friend-1', 'games').pts[0]), [510, 1115]);
});

test('limited at 0, now 3000 -> walking to the office door', () => {
  const trip = T.trip(null, lim(0), 'kain', 3000);
  assert.deepEqual(plain(trip), { dest: 'kain', fromLot: 'home', departAt: 0, returnAt: null, statusAt: 0 });
  const w = W(trip, 3000);
  assert.equal(w.scene, 'office'); assert.equal(w.leg, 'exit'); assert.equal(w.t, 0.5); assert.equal(w.pos, undefined);
});

test('just past EXIT_MS -> town leg at the home door', () => {
  const w = W(T.trip(null, lim(0), 'kain', 0), T.EXIT_MS + 1);
  assert.equal(w.scene, 'town'); assert.equal(w.leg, 'town'); assert.ok(w.t < 0.01);
  near(w.pos, { x: 1080, y: 205 }, 1);
});

test('halfway along the town leg, pos is on the route at half its length', () => {
  const w = W(T.trip(null, lim(0), 'kain', 0), T.EXIT_MS + TOWN / 2);
  assert.equal(w.leg, 'town'); assert.ok(Math.abs(w.t - 0.5) < 1e-9);
  near(w.pos, along(R.pts, R.len / 2));
});

test('after exit + town + enter -> there', () => {
  const w = W(T.trip(null, lim(0), 'kain', 0), T.EXIT_MS + TOWN + T.ENTER_MS + 1);
  assert.equal(w.scene, 'kain'); assert.equal(w.leg, 'there');
  assert.equal(W(T.trip(null, lim(0), 'games', 0), 1e9).scene, 'games');
});

test('reset while there -> back legs in reverse order, ending home', () => {
  const at = T.EXIT_MS + TOWN + T.ENTER_MS + 60000;
  let trip = T.trip(null, lim(0), 'kain', 0);
  trip = T.trip(trip, { status: 'working', statusAt: at }, null, at);
  assert.equal(trip.returnAt, at);
  const seen = [];
  for (let now = at - 1000; now < at + T.EXIT_MS + TOWN + T.ENTER_MS + 2000; now += 100) {
    const w = W(trip, now), k = w.leg + '@' + w.scene;
    if (seen[seen.length - 1] !== k) seen.push(k);
  }
  assert.deepEqual(seen, ['there@kain', 'back-exit@kain', 'back-town@town', 'back-enter@office', 'home@office']);
  near(W(trip, at + T.EXIT_MS + 1).pos, { x: 1495, y: 675 }, 1);
});

test('reset mid-town -> finish the town leg, then turn back (ruling 4)', () => {
  const at = T.EXIT_MS + TOWN / 2;
  let trip = T.trip(null, lim(0), 'kain', 0);
  trip = T.trip(trip, { status: 'working', statusAt: at }, null, at);
  const seen = [];
  for (let now = 0; now < at + 2 * TOWN + T.ENTER_MS + 2000; now += 50) {
    const w = W(trip, now);
    assert.ok(typeof w.scene === 'string' && w.scene, 'scene at ' + now);
    if (seen[seen.length - 1] !== w.leg) seen.push(w.leg);
  }
  assert.deepEqual(seen, ['exit', 'town', 'back-town', 'back-enter', 'home']);
  const turn = W(trip, T.EXIT_MS + TOWN + 1);
  assert.equal(turn.leg, 'back-town'); near(turn.pos, { x: 1495, y: 675 }, 1);
});

test('reset during exit -> reach the door, walk back in', () => {
  let trip = T.trip(null, lim(0), 'kain', 0);
  trip = T.trip(trip, { status: 'working', statusAt: 2000 }, null, 2000);
  assert.equal(W(trip, 5000).leg, 'exit');
  assert.deepEqual([W(trip, T.EXIT_MS + 1).leg, W(trip, T.EXIT_MS + 1).scene], ['back-enter', 'office']);
  assert.equal(W(trip, T.EXIT_MS + T.ENTER_MS + 1).leg, 'home');
});

test('flapping limited -> working -> limited within EXIT_MS: one trip, no gap', () => {
  const t0 = T.trip(null, lim(0), 'kain', 0);
  const t1 = T.trip(t0, { status: 'working', statusAt: 1000 }, null, 1000);
  const t2 = T.trip(t1, lim(2000), 'kain', 2000);
  assert.deepEqual(plain({ ...t2, statusAt: 0 }), plain(t0));
  for (let now = 0; now < 30000; now += 100) assert.ok(W(now < 1000 ? t0 : now < 2000 ? t1 : t2, now).scene);
  assert.equal(W(t2, T.EXIT_MS + 1).leg, 'town');
  assert.equal(T.trip(t0, lim(0), 'kain', 9000), t0, 'unchanged need keeps the record');
});

test('needed again after turning back: the new trip starts when the return ends', () => {
  const at = T.EXIT_MS + TOWN / 2;
  let trip = T.trip(null, lim(0), 'kain', 0);
  trip = T.trip(trip, { status: 'working', statusAt: at }, null, at);
  trip = T.trip(trip, lim(at + 1000), 'kain', at + 1000);
  const end = T.EXIT_MS + TOWN + TOWN + T.ENTER_MS;
  assert.equal(W(trip, at + 2000).leg, 'town');
  assert.equal(W(trip, end - 1).leg, 'back-enter');
  assert.equal(W(trip, end + 1).leg, 'exit');
  for (let now = 0; now < end + 40000; now += 100) assert.ok(W(trip, now).scene);
});

test('friend agents start from their lot', () => {
  const trip = T.trip(null, lim(0), 'games', 0, 'friend-1');
  assert.deepEqual([W(trip, 1000).scene, W(trip, 1000).leg], ['friend:friend-1', 'exit']);
  near(W(trip, T.EXIT_MS + 1).pos, { x: 510, y: 1115 }, 1);
});

test('purity: same inputs, same output, no mutation', () => {
  const trip = deepFreeze(T.trip(null, lim(0), 'kain', 0));
  for (const now of [3000, T.EXIT_MS + TOWN / 3, 1e9]) assert.deepEqual(W(trip, now), W(trip, now));
  const prev = deepFreeze({ dest: 'kain', fromLot: 'home', departAt: 0, returnAt: null });
  assert.deepEqual(plain(T.trip(prev, lim(0), null, 5)), plain(T.trip(prev, lim(0), null, 5)));
});

test('unknown dest or no route -> office home, never a throw', () => {
  const home = { scene: 'office', leg: 'home', t: 0 };
  assert.deepEqual(W(null, 5), home);
  assert.deepEqual(W(T.trip(null, lim(0), 'moon', 0), 9000), home);
  assert.deepEqual(W(T.trip(null, lim(0), 'kain', 0), 9000, () => null), home);
  assert.deepEqual(W({}, 9000), home);
  assert.equal(T.trip(null, lim(0), null, 0), null);
});

// Review fixes: determinism, dest change without a status change, whole queued chain, JSON round trip.
const line = { pts: [[0, 0], [800, 0]], len: 800 }; // town leg 10000 ms
const lr = (a, b) => (b === 'kain' || b === 'games') ? line : null;
const feed = (steps, nowOf) => steps.reduce((tr, [statusAt, dest], i) => T.trip(tr, { statusAt }, dest, nowOf(statusAt, i), 'home', lr), null);
// No teleport: town positions move at most walking speed between samples; a scene change happens only at a leg boundary.
const continuous = (trip, from, to, step = 100) => {
  let last = null;
  for (let now = from; now <= to; now += step) {
    const w = W(trip, now, lr);
    assert.ok(typeof w.scene === 'string' && w.scene, 'scene at ' + now);
    if (last && last.pos && w.pos) assert.ok(Math.hypot(w.pos.x - last.pos.x, w.pos.y - last.pos.y) <= T.TOWN_SPEED * step / 1000 + 1e-6, 'jump at ' + now);
    if (last && last.leg === w.leg && last.scene === w.scene && w.t < last.t) assert.fail('went backwards at ' + now);
    last = w;
  }
};

test('fix 1: same statusAt history polled at different now builds identical records', () => {
  const hist = [[0, 'kain'], [1000, null], [2000, 'kain'], [40000, null], [41000, 'games']];
  const a = feed(hist, (s) => s), b = feed(hist, (s, i) => s + 7000 + i * 3000);
  assert.deepEqual(plain(a), plain(b));
  const f1 = feed([[0, 'kain'], [1000, null], [2000, 'kain']], s => s), f2 = feed([[0, 'kain'], [1000, null], [2000, 'kain']], s => s + 9000);
  assert.deepEqual(plain(f1), plain(f2));
  assert.equal(f1.returnAt, null, 'flapping inside the exit leg is still one trip');
});

test('fix 2: dest change without a status change waits for the next status change (no jump)', () => {
  const real = routes; // real routes: kain and games paths differ, so a rewrite would jump
  for (const now of [3000, T.EXIT_MS + 4000, 1e9]) { // during exit, mid-town, there
    const t0 = T.trip(null, lim(0), 'kain', 0, 'home', real);
    const t1 = T.trip(t0, lim(0), 'games', now, 'home', real);
    assert.equal(t1, t0, 'same record at ' + now);
    assert.deepEqual(W(t1, now, real), W(t0, now, real));
    const t2 = T.trip(t1, { status: 'idle', statusAt: now + 1 }, 'games', now + 1, 'home', real);
    assert.notEqual(t2, t0, 'the next status change applies it');
    assert.equal(W(t2, now + 1e7, real).scene, 'games');
  }
  // the returning side waits too
  const back = T.trip(T.trip(null, lim(0), 'kain', 0), { statusAt: 9000 }, null, 9000);
  assert.equal(T.trip(back, { statusAt: 9000 }, 'games', 12000), back);
});

test('fix 3: the whole queued chain is kept (A returning, B made and returned, C needed)', () => {
  // A: departs -1000, exit until 5000, town until 15000; reset at 6000 -> turns at 15000, back-town 25000, back-enter 30000.
  let A = T.trip(null, { statusAt: -1000 }, 'kain', -1000, 'home', lr);
  A = T.trip(A, { statusAt: 6000 }, null, 6000, 'home', lr);
  const B = T.trip(A, { statusAt: 15000 }, 'kain', 15000, 'home', lr);
  const Bret = T.trip(B, { statusAt: 16000 }, null, 16000, 'home', lr);
  for (const dest of ['kain', 'games']) {
    const C = T.trip(Bret, { statusAt: 17000 }, dest, 17000, 'home', lr);
    assert.equal(W(C, 20000, lr).leg, 'back-town', dest + ': A still walks home');
    assert.equal(W(C, 29000, lr).leg, 'back-enter');
    const w = W(C, 31000, lr);
    assert.deepEqual([w.leg, w.scene], ['exit', 'office'], dest + ': C leaves after A is home');
    continuous(C, -1000, 80000);
    assert.equal(W(C, 1e9, lr).scene, dest);
  }
  const C = T.trip(Bret, { statusAt: 17000 }, 'games', 17000, 'home', lr);
  assert.ok(C.prev && C.prev.prev, 'three-deep chain kept');
  // pruning: a later transition drops entries that ended, folding their end into departAt
  const D = T.trip(T.trip(C, { statusAt: 90000 }, null, 90000, 'home', lr), { statusAt: 120000 }, 'kain', 120000, 'home', lr);
  assert.equal(D.prev, undefined, 'finished trips pruned');
  assert.equal(D.departAt, 120000);
  assert.ok(!/ponytail/.test(fs.readFileSync(new URL('./public/agent-travel.js', import.meta.url), 'utf8')));
});

test('fix 4: records survive JSON', () => {
  let tr = T.trip(null, { statusAt: -1000 }, 'kain', 0, 'home', lr);
  tr = T.trip(tr, { statusAt: 6000 }, null, 0, 'home', lr);
  tr = T.trip(tr, { statusAt: 15000 }, 'games', 0, 'home', lr);
  const back = JSON.parse(JSON.stringify(tr));
  for (let now = -2000; now < 80000; now += 250) assert.deepEqual(W(back, now, lr), W(tr, now, lr));
  assert.deepEqual(W(JSON.parse(JSON.stringify(T.trip(null, lim(0), 'kain', 0))), 9000), W(T.trip(null, lim(0), 'kain', 0), 9000));
});

test('statusAt stays current: a status change with the same dest, then a layout edit, does not jump', () => {
  const t0 = T.trip(null, lim(0), 'kain', 0, 'home', routes);
  const t1 = T.trip(t0, { status: 'limited', statusAt: 100 }, 'kain', 100, 'home', routes);
  assert.equal(t1.statusAt, 100);
  const t2 = T.trip(t1, { status: 'limited', statusAt: 100 }, 'games', 50000, 'home', routes);
  assert.equal(t2, t1);
  assert.deepEqual(W(t2, 50000), W(t0, 50000));
});

test('statusAt stays current on the way home: a layout edit after a non-travel status change starts no retroactive trip', () => {
  const ret = T.trip(T.trip(null, lim(0), 'kain', 0), { status: 'working', statusAt: 100 }, null, 100);
  assert.equal(ret.statusAt, 100);
  const t1 = T.trip(ret, { status: 'thinking', statusAt: 200 }, null, 200);
  assert.equal(t1.statusAt, 200);
  const t2 = T.trip(t1, { status: 'thinking', statusAt: 200 }, 'games', 30000);
  assert.equal(t2, t1);
  for (const now of [200, 5000, 30000, 1e9]) assert.deepEqual(W(t2, now), W(ret, now));
});

test('without routes the queued chain is capped at 4', () => {
  let tr = null;
  for (let i = 0; i < 50; i++) {
    tr = T.trip(tr, { statusAt: i * 2000 }, 'kain', i * 2000);
    tr = T.trip(tr, { statusAt: i * 2000 + 1000 }, null, i * 2000 + 1000);
    tr = T.trip(tr, { statusAt: i * 2000 + 1500 }, 'games', i * 2000 + 1500);
  }
  let depth = 0; for (let t = tr; t; t = t.prev) depth++;
  assert.ok(depth <= 4, 'depth ' + depth);
  assert.ok(W(tr, 1e6).scene);
});

// Task 3: the per-snapshot update the pages share (office, interiors, town) and the office-layout destination rule.
const OM = loadWorld().OfficeMotion;
const none = { kain: false, play: false };

test('destOf: limited -> kain, idle on an empty board -> games, only when the office has none of its own; Tiro never travels', () => {
  const a = (status, extra) => ({ id: 'x', status, ...extra });
  assert.equal(T.destOf(a('limited'), none, false), 'kain');
  assert.equal(T.destOf(a('limited'), { kain: true, play: false }, false), null);
  assert.equal(T.destOf(a('idle'), none, true), 'games');
  assert.equal(T.destOf(a('idle'), { kain: false, play: true }, true), null);
  assert.equal(T.destOf(a('idle'), none, false), null);
  assert.equal(T.destOf(a('limited', { isManager: true }), none, true), null);
  assert.equal(T.destOf(a('idle', { isManager: true }), none, true), null);
  // the same states nextState sends to the cooler / playroom once the idle delay has passed; the delay itself is in departAt
  for (const status of ['working', 'nudged', 'idle', 'blocked', 'error', 'limited']) for (const perm of [null, { askId: 'q' }]) for (const empty of [true, false]) {
    const ns = emptyFor => OM.nextState({ isManager: false, status, perm, quietMs: 0, toolInFlight: false, prev: null, prevSince: 0, first: false }, { empty, open: empty ? 0 : 1, emptyFor, idleDelay: OM.IDLE_DELAY }, 0);
    const st = ns(OM.IDLE_DELAY), want = st === OM.S.COOLER ? 'kain' : st === OM.S.PLAY ? 'games' : null;
    assert.equal(T.destOf({ status, perm }, none, empty), want, status + ' ' + !!perm + ' ' + empty);
    if (want === 'games') {
      assert.notEqual(ns(OM.IDLE_DELAY - 1), OM.S.PLAY, 'not before the delay');
      // departAt is the first time nextState plays (emptyFor >= idleDelay) and never before the agent went idle
      for (const [s, e] of [[0, 0], [-3600e3, 0], [0, -3600e3], [5000, 0], [0, 5000], [30000, 0]]) {
        const t = T.departAt({ status, perm, statusAt: s }, 'games', { emptyAt: e });
        assert.equal(ns(t - e), OM.S.PLAY, 'plays at departAt ' + [s, e]);
        assert.ok(t >= s, 'not before going idle');
        if (t > s) assert.notEqual(ns(t - 1 - e), OM.S.PLAY, 'not a ms earlier ' + [s, e]);
      }
    }
  }
});

test('OfficeMotion.travelFlags reads stools and play spots from a spots map', () => {
  const W = loadWorld().WorldModel;
  assert.deepEqual(plain(OM.travelFlags(W.spotsOf(W.defaultLayout()))), { kain: false, play: true });
  assert.deepEqual(plain(OM.travelFlags({ 'kain:1': {} })), { kain: true, play: false });
  assert.deepEqual(plain(OM.travelFlags({})), { kain: false, play: false });
});

test('sync: one record per travelling agent, ids gone are dropped, nothing changed -> same object', () => {
  const dest = a => T.destOf(a, none, false);
  const agents = [{ id: 'a', status: 'limited', statusAt: 0 }, { id: 'b', status: 'working', statusAt: 0 }, { id: 't', isManager: true, status: 'limited', statusAt: 0 }];
  const r1 = T.sync({}, agents, dest, 1000, routes);
  assert.deepEqual(Object.keys(r1), ['a']);
  assert.deepEqual(plain(r1.a), plain(T.trip(null, agents[0], 'kain', 1000, 'home', routes)));
  assert.equal(T.sync(r1, agents, dest, 5000, routes), r1, 'unchanged -> same object (no storage write)');
  const r2 = T.sync(r1, [{ id: 'a', status: 'working', statusAt: 2000 }], dest, 2000, routes);
  assert.equal(r2.a.returnAt, 2000, 'a reset sends it home');
  assert.equal(T.sync({ ...r2, gone: r2.a }, [{ id: 'a', status: 'working', statusAt: 2000 }], dest, 2000, routes).gone, undefined, 'dropped');
  assert.deepEqual(plain(T.sync(null, agents, dest, 0, routes)), plain(r1), 'null records start empty');
  // JSON round trip (localStorage) gives the same records back
  assert.deepEqual(plain(T.sync(JSON.parse(JSON.stringify(r2)), [{ id: 'a', status: 'working', statusAt: 2000 }], dest, 3000, routes)), plain(r2));
});

test('departAt: games leave IDLE_DELAY after going idle and not before the board was seen empty; they return when it was seen full', () => {
  assert.equal(T.IDLE_DELAY, OM.IDLE_DELAY);
  const idle = { id: 'a', status: 'idle', statusAt: 1000 };
  assert.equal(T.departAt(idle, 'games', { emptyAt: 0 }), T.IDLE_DELAY, 'R2: emptyAt + IDLE_DELAY, as the office counts emptyFor');
  assert.equal(T.departAt(idle, 'games', { emptyAt: 90000 }), 90000 + T.IDLE_DELAY, 'idle well before the board emptied: waits 20 s after it empties');
  assert.equal(T.departAt({ status: 'idle', statusAt: 500000 }, 'games', { emptyAt: 0 }), 500000, 'just went idle on a long-empty board: goes at statusAt');
  const out = { dest: 'games', returnAt: null };
  assert.equal(T.departAt(idle, null, { fullAt: 150000 }, out), 150000, 'back when the board was first seen full');
  assert.equal(T.departAt({ status: 'working', statusAt: 200000 }, null, { fullAt: 150000 }, out), 200000);
  assert.equal(T.departAt(idle, null, { fullAt: 150000 }), 1000, 'no games trip out: plain statusAt');
  assert.equal(T.departAt({ status: 'limited', statusAt: 5 }, 'kain', { emptyAt: 90000 }), 5, 'kain trips keep statusAt');
  assert.equal(T.departAt(idle, 'games'), 1000 + T.IDLE_DELAY, 'no board info: just the delay');
});

test('sync with board times: an agent idle for an hour starts at the exit leg when the board is first seen empty, and walks back when it fills', () => {
  const dest = a => T.destOf(a, none, true), idle = { id: 'a', status: 'idle', statusAt: -3600e3 };
  const seen = 1e6, r1 = T.sync({}, [idle], dest, seen, routes, { emptyAt: seen });
  assert.equal(W(r1.a, seen + T.IDLE_DELAY + 1000).leg, 'exit', 'walks out, no jump to there');
  assert.equal(W(r1.a, seen + T.IDLE_DELAY - 1).leg, 'home', 'waits 20 s after the board empties');
  assert.equal(T.sync(r1, [idle], dest, seen + 5000, routes, { emptyAt: seen }), r1, 'stable');
  const full = seen + 120000, r2 = T.sync(r1, [idle], a => T.destOf(a, none, false), full, routes, { fullAt: full });
  assert.equal(r2.a.returnAt, full);
  assert.equal(W(r2.a, full + 1000).leg, 'back-exit');
});

test('R2 fullAt scope: a kain return keeps its statusAt; a games return does not flip-flop between windows', () => {
  const kain = T.trip(null, lim(0), 'kain', 0, 'home', routes);
  const back = T.sync({ a: kain }, [{ id: 'a', status: 'working', statusAt: 100 }], a => T.destOf(a, none, false), 9e6, routes, { fullAt: 9e6 });
  assert.equal(back.a.returnAt, 100, 'kain return is not snapped to page-open time');
  const idle = { id: 'a', status: 'idle', statusAt: 0 }, dest = a => T.destOf(a, none, false);
  const g = T.sync({}, [idle], a => T.destOf(a, none, true), 1000, routes, { emptyAt: 0 });
  const F1 = 300000, F2 = 400000, r1 = T.sync(g, [idle], dest, F2, routes, { fullAt: F1 });
  assert.equal(r1.a.returnAt, F1);
  const r2 = T.sync(r1, [idle], dest, F2, routes, { fullAt: F2 }); // another window saw the board full later
  assert.equal(r2.a.returnAt, F1);
  assert.equal(T.sync(r2, [idle], dest, F2, routes, { fullAt: F1 }), r2, 'stable across windows: no flip-flop');
  assert.equal(T.sync(r2, [idle], dest, F2, routes, { fullAt: F2 }), r2);
});

// ---------- town step 3, task 4: the town page shares the office's trip store ----------
const fakeStorage = data => ({ getItem: k => k in data ? data[k] : null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } });
const withStorage = data => loadWorld({ extra: ['town-map.js', 'agent-travel.js'], globals: data ? { localStorage: fakeStorage(data) } : {} }).AgentTravel;

test('store: two pages on one storage agree, and the second reuses the records the first wrote', () => {
  const data = {}, A = withStorage(data), B = withStorage(data), rs = (a, b) => A.route(town, a, b);
  const agents = [{ id: 'a', status: 'limited', statusAt: 0 }, { id: 't', isManager: true, status: 'limited', statusAt: 0 }];
  const office = { kain: false, play: false }, sa = A.store(), sb = B.store();
  const ra = sa.sync(agents, office, false, 1000, rs);
  assert.deepEqual(Object.keys(ra), ['a'], 'Tiro never travels');
  assert.deepEqual(plain(JSON.parse(data['ao.trips'])), plain(ra));
  assert.deepEqual(plain(sb.sync(agents, office, false, 9000, rs)), plain(ra), 'same records from the other page');
  // games: the board-empty time is shared through storage
  const idle = [{ id: 'a', status: 'idle', statusAt: 0 }];
  sa.sync(idle, office, true, 5000, rs);
  assert.equal(data['ao.boardEmptyAt'], '5000');
  assert.equal(sb.sync(idle, office, true, 7000, rs).a.departAt, 25000, 'the other page used the stored board time');
  assert.equal(data['ao.boardEmptyAt'], '5000', 'first sighting kept');
  sb.sync(idle, office, false, 8000, rs);
  assert.equal(data['ao.boardEmptyAt'], undefined, 'cleared when full');
});

test('store: no storage -> memory only; junk stored records are dropped', () => {
  const A = withStorage(null), rs = (a, b) => A.route(town, a, b), s = A.store();
  const r = s.sync([{ id: 'a', status: 'limited', statusAt: 0 }], { kain: false, play: false }, false, 10, rs);
  assert.equal(r.a.dest, 'kain');
  assert.equal(s.sync([{ id: 'a', status: 'limited', statusAt: 0 }], { kain: false, play: false }, false, 20, rs), r, 'kept in memory');
  const data = { 'ao.trips': JSON.stringify({ x: [1], y: 'no', z: null }) }, B = withStorage(data);
  assert.deepEqual(plain(B.store().sync([], { kain: false, play: false }, false, 0, (a, b) => B.route(town, a, b))), {});
});

test('nextIn: the next start of a town leg (for one timeout instead of polling), Infinity when none is ahead', () => {
  const tr = T.trip(null, lim(0), 'kain', 0);
  assert.equal(T.nextIn(tr, 'town', 0, routes), T.EXIT_MS);
  assert.equal(T.nextIn(tr, 'town', T.EXIT_MS + 1, routes), Infinity, 'in the town leg now: nothing ahead');
  const back = T.trip(tr, { status: 'working', statusAt: 20000 + TOWN }, null, 0, 'home', routes);
  assert.equal(T.nextIn(back, 'town', 20000 + TOWN, routes), 20000 + TOWN + T.EXIT_MS, 'the walk home');
  // a games trip that departs later
  const g = T.trip(null, { statusAt: 50000 }, 'games', 0);
  assert.equal(T.nextIn(g, 'town', 0, routes), 50000 + T.EXIT_MS);
  assert.equal(T.nextIn(null, 'town', 0, routes), Infinity);
  assert.equal(T.nextIn({ dest: 'nowhere', departAt: 0 }, 'town', 0, routes), Infinity);
});

test('town routes keep to the dirt paths and plaza (under 5% on grass)', () => {
  const onPath = (x, y) => [town.plaza, ...town.paths].some(([a, b, c, e]) => x >= a && x <= c && y >= b && y <= e);
  for (const [a, b] of [['home', 'kain'], ['home', 'games'], ['kain', 'games']]) {
    const { pts, len } = routes(a, b);
    let grass = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / 2);
      for (let s = 0; s < n; s++) if (!onPath(x0 + (x1 - x0) * (s + 0.5) / n, y0 + (y1 - y0) * (s + 0.5) / n)) grass += L / n;
    }
    assert.ok(grass / len < 0.05, `${a}>${b}: ${grass | 0}/${len | 0} on grass`);
  }
});
