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

test('heightAt: plaza 0, a level-1 terrace 14, level 2 28, a ramp midpoint halfway', () => {
  const H = (x, y) => TownMap.heightAt(hill, x, y);
  assert.equal(TownMap.LEVEL_H, 14);
  assert.equal(TownMap.heightAt(real(), 1080, 675), 0, 'plaza');
  assert.equal(H(1000, 1000), 0);
  assert.equal(H(250, 200), 14, 'level-1 terrace');
  assert.equal(H(50, 50), 28, 'the innermost rect wins');
  assert.equal(H(330, 330), 7, 'ramp midpoint (0 -> 1)');
  assert.equal(H(125, 130), 21, 'ramp midpoint (1 -> 2)');
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
  const bad = (mut, re) => { const d = Object.assign(real(), JSON.parse(JSON.stringify(hill))); mut(d); const v = TownMap.validate(d); assert.equal(v.ok, false); assert.match(v.errors.join(' | '), re); };
  assert.deepEqual(JSON.parse(JSON.stringify(TownMap.validate(Object.assign(real(), hill)))), { ok: true, errors: [] }, 'the fixture itself is valid');
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
      if (TownMap.heightAt(d, x, y) === t.level * 14 && !g.blocked[WorldPath.cellOf(g, { x, y })] && WorldPath.findPath(g, d.spawn, { x, y }).length) found = { x, y };
    assert.ok(found, 'levels[' + i + '] has a path from spawn');
  }
  assert.equal(TownMap.heightAt(d, d.spawn.x, d.spawn.y), 0);
  for (const l of d.lots) assert.equal(TownMap.heightAt(d, l.door.x, l.door.y), 0, l.id);
});
