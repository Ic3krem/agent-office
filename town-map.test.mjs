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
