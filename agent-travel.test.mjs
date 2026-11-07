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
  assert.deepEqual(plain(trip), { dest: 'kain', fromLot: 'home', departAt: 0, returnAt: null });
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
  assert.deepEqual(plain(t2), plain(t0));
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
