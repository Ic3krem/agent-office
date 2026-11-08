import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js'] });
const { TownMap, WorldPath } = ctx;
const real = () => JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
const ov = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('real town.json validates and has exactly the six lots', () => {
  const d = real(), v = TownMap.validate(d);
  assert.deepEqual(JSON.parse(JSON.stringify(v)), { ok: true, errors: [] });
  assert.deepEqual(d.lots.map(l => l.id).sort(), ['friend-1', 'friend-2', 'friend-3', 'games', 'home', 'kain']);
});

test('every door is reachable from spawn; plaza centre is free', () => {
  const d = real(), g = TownMap.grid(d);
  for (const l of d.lots) assert.ok(WorldPath.findPath(g, d.spawn, l.door).length > 0, l.id);
  assert.equal(g.blocked[WorldPath.cellOf(g, { x: 1080, y: 675 })], 0);
});

test('decor stays off buildings, doors, paths and bridges', () => {
  const d = real();
  for (const it of d.decor) {
    const f = [it.x - 5, it.y - 5, it.x + 5, it.y + 5];
    for (const l of d.lots) {
      assert.ok(!ov(f, l.building.footprint), it.type + ' on ' + l.id);
      assert.ok(!ov(f, [l.door.x - 5, l.door.y - 5, l.door.x + 5, l.door.y + 5]), it.type + ' on door ' + l.id);
    }
    for (const b of d.bridges) assert.ok(!ov(f, b), it.type + ' on bridge');
    for (const p of d.paths) assert.ok(!ov(f, p), it.type + ' on path');
  }
  assert.equal(TownMap.decorFootprint({ type: 'flowers', x: 5, y: 5 }), null);
});

test('validate rejects bad maps with readable errors', () => {
  const bad = (mut, re) => { const d = real(); mut(d); const v = TownMap.validate(d); assert.equal(v.ok, false); assert.match(v.errors.join(' | '), re); };
  bad(d => d.lots.pop(), /missing lot friend-3/);
  bad(d => { const l = d.lots[0]; l.door.x = l.building.x; l.door.y = l.building.y; }, /door is inside/);
  bad(d => { d.decor[0].x = 99999; }, /outside the map/);
  bad(d => d.lots.push({ ...JSON.parse(JSON.stringify(d.lots[3])), id: 'friend-4' }), /unexpected lot friend-4/);
});

test('every lot door has an enter target: home/kain/games open their scene, friend lots wait for party mode', () => {
  const want = { home: '/#scene=office', kain: '/#scene=kain', games: '/#scene=games' };
  for (const l of real().lots) {
    const t = TownMap.enterTarget(l);
    assert.ok(t && typeof t.label === 'string' && t.label.length, l.id);
    if (l.kind === 'friend') { assert.equal(t.url, null, l.id); assert.equal(t.label, 'Friend lots open in party mode'); }
    else assert.equal(t.url, want[l.id], l.id);
  }
  assert.deepEqual(['home', 'kain', 'games'].map(id => TownMap.lotOfScene(id === 'home' ? 'office' : id)), ['home', 'kain', 'games']);
  assert.equal(TownMap.lotOfScene('nope'), 'home');
});

test('friendLots: party members get friend-1..3 in join order (the order the party view lists them); the rest get none', () => {
  const m = ids => ids.map(id => ({ id, name: 'N' + id }));
  const P = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(P(TownMap.friendLots(m(['b', 'a', 'c', 'd']))), { b: 'friend-1', a: 'friend-2', c: 'friend-3' });
  assert.deepEqual(P(TownMap.friendLots(m(['a']))), { a: 'friend-1' });
  assert.deepEqual(P(TownMap.friendLots([null, { id: 7 }, { id: 'x' }])), { x: 'friend-1' }, 'bad entries take no lot');
  for (const v of [undefined, null, 'x', {}]) assert.deepEqual(P(TownMap.friendLots(v)), {});
  const lots = real().lots.filter(l => l.kind === 'friend').map(l => l.id);
  assert.deepEqual(Object.values(TownMap.friendLots(m(['a', 'b', 'c']))), lots, 'the real friend lot ids');
});

// ---------- town step 4, task 9: land levels (raised terraces, cliffs, ramps) ----------
const hill = { levels: [{ rect: [0, 0, 400, 300], level: 1 }, { rect: [0, 0, 200, 100], level: 2 }], ramps: [{ rect: [300, 290, 360, 370], dir: 'n' }, { rect: [100, 90, 150, 170], dir: 'n' }] };

test('heightAt: plaza 0, a level-1 terrace 28, level 2 56, a ramp midpoint halfway (LEVEL_H 28, user decision 2026-11-08)', () => {
  const H = (x, y) => TownMap.heightAt(hill, x, y);
  assert.equal(TownMap.LEVEL_H, 28);
  assert.equal(TownMap.heightAt(real(), 1080, 675), 0, 'plaza');
  assert.equal(H(1000, 1000), 0);
  assert.equal(H(250, 200), 28, 'level-1 terrace');
  assert.equal(H(50, 50), 56, 'the innermost rect wins');
  assert.equal(H(330, 330), 14, 'ramp midpoint (0 -> 1)');
  assert.equal(H(125, 130), 42, 'ramp midpoint (1 -> 2)');
  assert.ok(H(330, 360) < H(330, 300), 'a north ramp climbs northward');
  assert.equal(TownMap.heightAt({}, 5, 5), 0, 'a map without levels is flat');
});

test('grid: a cliff-edge cell is blocked, a ramp cell is open, a ramp side is blocked', () => {
  const d = Object.assign(real(), hill), g = TownMap.grid(d), at = (x, y) => g.blocked[WorldPath.cellOf(g, { x, y })];
  assert.equal(at(255, 295), 1, 'south cliff edge of the level-1 terrace');
  assert.equal(at(395, 150), 1, 'east cliff edge');
  assert.equal(at(255, 285), 0, 'terrace top behind the edge');
  assert.equal(at(330, 295), 0, 'ramp cell on the cliff line');
  assert.equal(at(295, 330), 1, 'ramp side');
  assert.equal(at(150, 95), 1, 'level-2 edge');
});

test('validate rejects a lot straddling two levels, a terrace with no ramp and a ramp that joins nothing', () => {
  const bad = (mut, re) => { const d = Object.assign(real(), JSON.parse(JSON.stringify(hill)), { spots: undefined }); mut(d); const v = TownMap.validate(d); assert.equal(v.ok, false); assert.match(v.errors.join(' | '), re); };
  assert.deepEqual(JSON.parse(JSON.stringify(TownMap.validate(Object.assign(real(), hill, { spots: undefined })))), { ok: true, errors: [] }, 'the fixture itself is valid (its terraces replace the real ones, so the spots go too)');
  bad(d => d.levels.push({ rect: [1000, 0, 1100, 100], level: 1 }), /lot home straddles two levels/);
  bad(d => d.ramps.pop(), /levels\[1\] is not reachable/);
  bad(d => d.ramps.push({ rect: [1300, 900, 1340, 940], dir: 'e' }), /ramps\[2\] does not join two levels/);
  bad(d => { d.levels[0].level = 3; }, /levels\[0\] level must be 1 or 2/);
  bad(d => { d.ramps[0].dir = 'up'; }, /ramps\[0\] dir must be/);
  bad(d => { d.levels[0].rect = [0, 0, 99999, 300]; }, /outside the map/);
});

test('real town: 2-3 terraces, each walkable from spawn through world-path A*; plaza, lots, spawn and doors stay flat', () => {
  const d = real(), g = TownMap.grid(d);
  assert.ok(d.levels.length >= 2 && d.levels.length <= 3 && d.ramps.length >= d.levels.length);
  for (const [i, t] of d.levels.entries()) {
    let found = null;
    for (let y = t.rect[1] + 5; y < t.rect[3] && !found; y += 10) for (let x = t.rect[0] + 5; x < t.rect[2] && !found; x += 10)
      if (TownMap.heightAt(d, x, y) === t.level * TownMap.LEVEL_H && !g.blocked[WorldPath.cellOf(g, { x, y })] && WorldPath.findPath(g, d.spawn, { x, y }).length) found = { x, y };
    assert.ok(found, 'levels[' + i + '] has a path from spawn');
  }
  assert.equal(TownMap.heightAt(d, d.spawn.x, d.spawn.y), 0);
  for (const l of d.lots) assert.equal(TownMap.heightAt(d, l.door.x, l.door.y), 0, l.id);
});

test('grid: the low ground hidden behind an away-facing (west/north) cliff is blocked 4 cells deep', () => {
  const d = real(), g = TownMap.grid(d), at = (x, y) => g.blocked[WorldPath.cellOf(g, { x, y })];
  for (const x of [1285, 1295, 1305, 1315]) assert.equal(at(x, 200), 1, 'covered at ' + x);
  assert.equal(at(1275, 200), 0, 'open past the covered strip');
  assert.equal(at(1325, 200), 1, 'the cliff band on top');
  assert.equal(at(1335, 200), 0, 'the hill top');
  const north = Object.assign(real(), { levels: [{ rect: [0, 100, 300, 300], level: 1 }], ramps: [{ rect: [100, 290, 160, 370], dir: 'n' }] });
  const gn = TownMap.grid(north), atn = (x, y) => gn.blocked[WorldPath.cellOf(gn, { x, y })];
  assert.deepEqual([atn(250, 65), atn(250, 75), atn(250, 85), atn(250, 95), atn(250, 55)], [1, 1, 1, 1, 0], 'north-facing cliff');
  assert.ok(TownMap.validate(d).ok);
});

test('real town ramps stay gentle at LEVEL_H 28: at least 150 units of run per level climbed, both ends on their levels', () => {
  const d = real();
  for (const [i, r] of d.ramps.entries()) {
    const [x0, y0, x1, y1] = r.rect, run = r.dir === 'n' || r.dir === 's' ? y1 - y0 : x1 - x0;
    const mid = r.dir === 'n' || r.dir === 's' ? [(x0 + x1) / 2, null] : [null, (y0 + y1) / 2];
    const lo = { n: [mid[0], y1 + 1], s: [mid[0], y0 - 1], e: [x0 - 1, mid[1]], w: [x1 + 1, mid[1]] }[r.dir];
    const hi = { n: [mid[0], y0 - 1], s: [mid[0], y1 + 1], e: [x1 + 1, mid[1]], w: [x0 - 1, mid[1]] }[r.dir];
    const rise = (TownMap.heightAt(d, ...hi) - TownMap.heightAt(d, ...lo)) / TownMap.LEVEL_H;
    assert.ok(rise >= 1, 'ramps[' + i + '] joins two levels');
    assert.ok(run / rise >= 150, 'ramps[' + i + '] run ' + run + ' per level');
  }
});

test('grid: a ramp in each direction (n, s, e, w) is walkable from its foot to the terrace top', () => {
  const base = { size: { w: 600, h: 600 }, cell: 10, lots: [], decor: [], water: [], bridges: [], paths: [], plaza: [0, 0, 10, 10] };
  for (const [dir, lv, rect, foot, top] of [
    ['n', [0, 0, 600, 200], [280, 190, 340, 350], { x: 310, y: 400 }, { x: 310, y: 100 }],
    ['s', [0, 400, 600, 600], [280, 250, 340, 410], { x: 310, y: 200 }, { x: 310, y: 500 }],
    ['e', [400, 0, 600, 600], [250, 280, 410, 340], { x: 200, y: 310 }, { x: 500, y: 310 }],
    ['w', [0, 0, 200, 600], [190, 280, 350, 340], { x: 400, y: 310 }, { x: 100, y: 310 }]]) {
    const d = { ...base, levels: [{ rect: lv, level: 1 }], ramps: [{ rect, dir }] }, g = TownMap.grid(d);
    assert.ok(WorldPath.findPath(g, foot, top).length > 0, dir + ' ramp: a path from foot to top');
  }
});

test('ramp ends meet their levels exactly: no height jump stepping onto the terrace or off the foot, in any direction', () => {
  const along = (r, u) => { const [x0, y0, x1, y1] = r.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; // u = 0 at the foot, 1 at the top edge
    return { n: [cx, y1 - u * (y1 - y0)], s: [cx, y0 + u * (y1 - y0)], e: [x0 + u * (x1 - x0), cy], w: [x1 - u * (x1 - x0), cy] }[r.dir]; };
  const base = { size: { w: 600, h: 600 }, cell: 10, lots: [], decor: [], water: [], bridges: [], paths: [], plaza: [0, 0, 10, 10] };
  const maps = [real(), ...[['n', [0, 0, 600, 200], [280, 190, 340, 350]], ['s', [0, 400, 600, 600], [280, 250, 340, 410]],
    ['e', [400, 0, 600, 600], [250, 280, 410, 340]], ['w', [0, 0, 200, 600], [190, 280, 350, 340]]].map(([dir, lv, rect]) => ({ ...base, levels: [{ rect: lv, level: 1 }], ramps: [{ rect, dir }] }))];
  for (const d of maps) for (const r of d.ramps) {
    const H = u => TownMap.heightAt(d, ...along(r, u)), run = r.dir === 'n' || r.dir === 's' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0];
    const step = 0.25 / run, top = H(1 + step), foot = H(-step); // just past each end, off the ramp
    assert.equal(top % TownMap.LEVEL_H, 0, r.dir + ' ramp top is on a level'); assert.equal(foot % TownMap.LEVEL_H, 0);
    assert.ok(Math.abs(H(1 - 1e-9) - top) < 1e-6 && Math.abs(H(0) - foot) < 1e-6, r.dir + ' ramp ' + JSON.stringify(r.rect) + ' meets both levels: ' + [H(0), foot, H(1 - 1e-9), top]);
    const slope = (top - foot) * step;
    for (let u = -4 * step; u < 1 + 4 * step; u += step) assert.ok(Math.abs(H(u + step) - H(u)) <= slope + 1e-6, r.dir + ' no jump at u=' + u.toFixed(4));
  }
});

test('party world: the host owns the main house, everyone else a friend lot in join order; doors lead there', () => {
  const d = real(), lot = (m, id) => m.lots.find(l => l.id === id);
  // Ben's app: Hal hosts, Ana joined first, Ben second, Cy third, Dee fourth (no lot)
  const view = { connected: true, you: { id: 'b0000002', name: 'Ben', host: false, seq: 3 }, members: [
    { id: 'd0000005', name: 'Dee', seq: 5 }, { id: 'a0000001', name: 'Ana', seq: 1 }, { id: 'f00000ff', name: 'Hal', host: true, seq: 2 }, { id: 'c0000004', name: 'Cy', seq: 4 }] };
  const w = TownMap.partyWorld(view);
  assert.deepEqual(Object.fromEntries(Object.entries(w.owners).map(([k, o]) => [k, o.name])), { home: 'Hal', 'friend-1': 'Ana', 'friend-2': 'Ben', 'friend-3': 'Cy' });
  assert.equal(w.mine, 'friend-2');
  // Ana's app sees the same town
  const wa = TownMap.partyWorld({ connected: true, you: { id: 'a0000001', name: 'Ana', seq: 1 }, members: [{ id: 'f00000ff', name: 'Hal', host: true, seq: 2 }, { id: 'b0000002', name: 'Ben', seq: 3 }, { id: 'c0000004', name: 'Cy', seq: 4 }] });
  assert.deepEqual(Object.fromEntries(Object.entries(wa.owners).map(([k, o]) => [k, o.id])), Object.fromEntries(Object.entries(w.owners).map(([k, o]) => [k, o.id])));
  const m = TownMap.withFriends(d, w);
  assert.equal(lot(m, 'friend-2').building.type, TownMap.styleOf('b0000002'));
  assert.equal(lot(m, 'home').building.type, 'office-modern');
  assert.equal(lot(d, 'friend-1').building.type, 'lot-empty'); // the loaded map is not changed
  assert.ok(TownMap.validate(m).ok);
  const t = id => JSON.parse(JSON.stringify(TownMap.friendTarget(lot(m, id), w, true)));
  assert.deepEqual(t('home'), { url: '/#visit=f00000ff', label: "Visit Hal's office (host)" });
  assert.deepEqual(t('friend-2'), { url: '/#scene=office', label: 'Enter your office' });
  assert.deepEqual(t('friend-1'), { url: '/#visit=a0000001', label: "Visit Ana's office" });
  assert.equal(t('kain').url, '/#scene=kain');
  // the host's own app: home is their office, guests on the lots
  const wh = TownMap.partyWorld({ connected: true, you: { id: 'f00000ff', name: 'Hal', host: true, seq: 2 }, members: [{ id: 'a0000001', name: 'Ana', seq: 1 }] });
  assert.equal(wh.mine, 'home'); assert.equal(wh.owners['friend-1'].name, 'Ana');
  assert.equal(TownMap.friendTarget(lot(d, 'home'), wh, true).url, '/#scene=office');
  // no host in the party: you keep your house; outside a party there is no party world
  assert.equal(TownMap.partyWorld({ connected: true, you: { id: 'a0000001', seq: 1 }, members: [{ id: 'b0000002', seq: 2 }] }).mine, 'home');
  assert.equal(TownMap.partyWorld({ connected: false }), null);
  assert.equal(TownMap.friendTarget(lot(d, 'friend-3'), null, false).url, null);
  assert.equal(TownMap.friendTarget(lot(d, 'home'), null, false).url, '/#scene=office');
});

// ---------- town step 5: spots (places to wander) ----------
test('spots validate: the shipped map passes; bad kinds, points outside, overlaps and too few points fail', () => {
  const d = real();
  assert.deepEqual(d.spots.map(s => s.id).sort(), ['court', 'park', 'pasture', 'tree', 'waterfall']);
  for (const s of d.spots) { assert.equal(s.kind, s.id); assert.ok(s.points.length >= 8, s.id); }
  const bad = (mut, re) => { const m = real(); mut(m); const v = TownMap.validate(m); assert.equal(v.ok, false, String(re)); assert.match(v.errors.join(' | '), re); };
  const sp = (m, id) => m.spots.find(s => s.id === id);
  bad(m => { sp(m, 'park').kind = 'zoo'; }, /spot park has an unknown kind/);
  bad(m => { sp(m, 'park').points[0].x = 5; }, /spot park point 0 is outside its rect/);
  bad(m => { sp(m, 'park').points[0].act = 'fly'; }, /spot park point 0/);
  bad(m => { sp(m, 'court').rect = [1050, 205, 1110, 300]; }, /spot court overlaps/); // the path to the office
  bad(m => { sp(m, 'park').rect = [600, 300, 800, 400]; }, /spot park overlaps/); // the ramp at x 620-680
  bad(m => { sp(m, 'tree').points.length = 7; }, /spot tree needs at least 8 points/);
  bad(m => { sp(m, 'tree').props.push({ type: 'castle', x: 190, y: 98 }); }, /spot tree prop 1 has an unknown type/);
  bad(m => { m.spots.push(JSON.parse(JSON.stringify(sp(m, 'tree')))); }, /duplicate spot/);
  const noSpots = real(); delete noSpots.spots;
  assert.ok(TownMap.validate(noSpots).ok, 'spots are optional');
});

test('spot props block cells: the tree of life, a fence run and the waterfall pool', () => {
  const d = real(), g = TownMap.grid(d), at = (x, y) => g.blocked[WorldPath.cellOf(g, { x, y })];
  const tree = d.spots.find(s => s.id === 'tree').props.find(p => p.type === 'tree-of-life');
  assert.equal(at(tree.x, tree.y), 1, 'under the tree of life');
  const fence = d.spots.find(s => s.id === 'pasture').props.find(p => p.type === 'fence-x');
  assert.equal(at(fence.x, fence.y), 1, 'under a fence run');
  assert.equal(at(fence.x + 25, fence.y), 1, 'along the fence run');
  const pool = d.spots.find(s => s.id === 'waterfall').pool;
  assert.equal(at((pool[0] + pool[2]) / 2, (pool[1] + pool[3]) / 2), 1, 'in the pool');
  const noSpots = real(); delete noSpots.spots;
  assert.equal(TownMap.grid(noSpots).blocked[WorldPath.cellOf(g, tree)], 0, 'without spots the cell is open');
  for (const t of ['tree-of-life', 'waterfall', 'hoop', 'fence-x', 'fence-y', 'cow-trough', 'flowerbed', 'bench-s', 'lamp']) assert.ok(TownMap.SPOT_PROPS.includes(t), t);
});

test('every lot door, ramp end and spot point is reachable from spawn; non-seat points stand on open cells; the park loop is open', () => {
  const d = real(), g = TownMap.grid(d), reach = WorldPath.reachFrom(g, d.spawn), open = p => !g.blocked[WorldPath.cellOf(g, p)];
  for (const l of d.lots) assert.ok(reach(l.door), l.id);
  for (const r of d.ramps) { const [x0, y0, x1, y1] = r.rect, cx = (x0 + x1) / 2; for (const y of [y0 - 5, y1 + 5]) assert.ok(open({ x: cx, y }) && reach({ x: cx, y }), 'ramp end ' + cx + ',' + y); }
  for (const s of d.spots) s.points.forEach((p, i) => {
    assert.ok(reach(p), s.id + ' point ' + i);
    if (p.act !== 'sit') assert.ok(open(p), s.id + ' point ' + i + ' on an open cell');
  });
  const loop = d.spots.find(s => s.id === 'park').loop;
  assert.ok(loop.length >= 4);
  loop.forEach((p, i) => { const q = loop[(i + 1) % loop.length]; assert.ok(WorldPath.lineClear(g, { x: p[0], y: p[1] }, { x: q[0], y: q[1] }), 'loop segment ' + i); });
});

test('spot props keep off doors, paths, ramps and bridges', () => {
  const d = real();
  for (const s of d.spots) for (const p of s.props) {
    const f = TownMap.propFootprint(p);
    if (!f) continue;
    for (const l of d.lots) assert.ok(!ov(f, l.rect), p.type + ' on lot ' + l.id);
    for (const r of [...d.paths, ...d.bridges, ...d.ramps.map(r => r.rect)]) assert.ok(!ov(f, r), p.type + ' on ' + r);
  }
});

test('spotPoint: spot:<id>:<n> gives point n mod the point count; unknown or malformed ids give null', () => {
  const d = real(), park = d.spots.find(s => s.id === 'park'), n = park.points.length;
  const p3 = TownMap.spotPoint(d, 'spot:park:3');
  assert.deepEqual(JSON.parse(JSON.stringify(p3)), { spot: 'park', point: 3, x: park.points[3].x, y: park.points[3].y, act: park.points[3].act, face: park.points[3].face, k: 0 });
  const p13 = TownMap.spotPoint(d, 'spot:park:13');
  assert.equal(p13.point, 13 % n); assert.equal(p13.k, Math.floor(13 / n));
  for (const bad of ['spot:gone:0', 'spot:park:x', 'spot:park', 'kain', null, 'spot:park:-1']) assert.equal(TownMap.spotPoint(d, bad), null, String(bad));
  assert.equal(TownMap.spotPoint({}, 'spot:park:1'), null, 'a map without spots');
  assert.deepEqual(JSON.parse(JSON.stringify(TownMap.spotsOf(d))).map(s => s.id).sort(), ['court', 'park', 'pasture', 'tree', 'waterfall']);
  assert.ok(TownMap.spotsOf(d).every(s => s.n === d.spots.find(o => o.id === s.id).points.length));
  assert.deepEqual(JSON.parse(JSON.stringify(TownMap.spotsOf({}))), []);
});

// ---------- town step 5, task 7b: the plaza fountain ----------
test('the plaza has a fountain and no well; the plaza round it stays walkable and every door reachable', () => {
  const d = real(), g = TownMap.grid(d), at = (x, y) => g.blocked[WorldPath.cellOf(g, { x, y })];
  const f = d.decor.filter(it => it.type === 'fountain');
  assert.equal(f.length, 1); assert.equal(d.decor.filter(it => it.type === 'well').length, 0);
  const [x0, y0, x1, y1] = d.plaza, { x, y } = f[0];
  assert.ok(x > x0 && x < x1 && y > y0 && y < y1, 'on the plaza');
  assert.deepEqual(JSON.parse(JSON.stringify(TownMap.decorFootprint(f[0]))), [x - 7.5, y - 7.5, x + 7.5, y + 7.5], '1.5x the well footprint');
  assert.equal(at(x, y), 1, 'the basin blocks');
  for (const [dx, dy] of [[0, -20], [0, 20], [-20, 0], [20, 0]]) assert.equal(at(x + dx, y + dy), 0, 'walkable round it ' + dx + ',' + dy);
  for (const l of d.lots) assert.ok(WorldPath.findPath(g, d.spawn, l.door).length > 0, l.id);
});
