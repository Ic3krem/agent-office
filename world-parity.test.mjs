import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordOffice, recorder } from './world-golden.mjs';
import { loadWorld } from './world-vm.mjs';

const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/office-golden.json', import.meta.url), 'utf8'));
const norm = a => a.map(i => ({ d: i.d, fp: i.fp, log: i.log })).sort((a, b) => a.d - b.d || (a.log < b.log ? -1 : a.log > b.log ? 1 : 0));

test('static office draws exactly as 1.2.9', () => {
  const now = JSON.parse(JSON.stringify(recordOffice()));
  assert.deepEqual(norm(now.items), norm(gold.items));
  assert.deepEqual(now.objects, gold.objects);
  assert.deepEqual(now.spots, gold.spots);
});

// office-world.js runs OfficeFurniture.measure, which fills derived footprints the fixture (recorded without it) lacks:
// draw logs and depths must equal the fixture, footprints must equal a fresh boot of the same scripts.
test('applyLayout(defaultLayout()) keeps the golden scene', () => {
  const rec = prep => JSON.parse(JSON.stringify(recordOffice({ extra: ['office-world.js'], prep })));
  const boot = rec(), now = rec(w => w.OfficeWorld.applyLayout(w.WorldModel.defaultLayout()));
  const drawn = a => norm(a).map(i => ({ d: i.d, log: i.log }));
  assert.deepEqual(drawn(now.items), drawn(gold.items));
  assert.deepEqual(norm(now.items), norm(boot.items));
  assert.deepEqual(now.objects, gold.objects);
  assert.deepEqual(now.spots, gold.spots);
});

test('applyLayout moves desks in furniture, motion and click areas', () => {
  const w = loadWorld({ extra: ['office-world.js'] }), OW = w.OfficeWorld, L = w.WorldModel.defaultLayout();
  const hot = () => OW.hotspots().find(h => h.id === 'desk-1');
  const l0 = hot().l, d0 = w.OfficeFurniture.items.map(i => i.d).sort((a, b) => a - b);
  L.objects.find(o => o.id === 'desk-1').x += 40;
  OW.applyLayout(L);
  assert.equal(w.OfficeMotion.SPOTS['desk-1'].x, 195);
  assert.ok(hot().l > l0, 'click area follows the desk');
  assert.notDeepEqual(w.OfficeFurniture.items.map(i => i.d).sort((a, b) => a - b), d0);
});

test('a piece placed 40 units east draws translated and shifts its footprint', () => {
  const calls = [];
  const w = loadWorld({ ctxFactory: () => ({}) }), F = w.OfficeFurniture;
  const [ax, ay] = F.CATALOG.bench.anchor;
  F.place([{ id: 'b', type: 'bench', x: ax, y: ay }]);
  const d0 = F.items[0].d, fp0 = JSON.parse(JSON.stringify(F.footprints([{ id: 'b', type: 'bench', x: ax, y: ay }])));
  F.place([{ id: 'b', type: 'bench', x: ax + 40, y: ay }]);
  assert.equal(F.items.length, 1);
  assert.equal(F.items[0].d, d0 + 40);
  const fp1 = JSON.parse(JSON.stringify(F.footprints([{ id: 'b', type: 'bench', x: ax + 40, y: ay }])));
  assert.ok(fp0.length > 0);
  assert.deepEqual(fp1, fp0.map(q => [q[0] + 40, q[1], q[2] + 40, q[3]]));
  F.items[0].fn(recorder(calls));
  assert.deepEqual(calls[0], ['translate', 28.28, 14.14]);
});

test('catalog spots reproduce the 1.2.9 spots they own', () => {
  const w = loadWorld({ ctxFactory: () => ({}) }), F = w.OfficeFurniture;
  const own = JSON.parse(JSON.stringify(F.spotsOf(F.defaultInstances())));
  assert.ok(Object.keys(own).length > 0);
  for (const id of Object.keys(own)) assert.deepEqual(own[id], gold.spots[id], id);
});

test('default footprints block whole pieces but keep the gate, door and hedge gaps open', () => {
  const F = loadWorld({ ctxFactory: () => ({}) }).OfficeFurniture, inst = F.defaultInstances();
  const fps = JSON.parse(JSON.stringify(F.footprints(inst)));
  const covers = (q, r) => q[0] <= r[0] && q[1] <= r[1] && q[2] >= r[2] && q[3] >= r[3];
  assert.ok(fps.some(q => covers(q, [1068, 704, 1140, 730])), 'mail bench');
  for (const [x, y] of [[1000, 396], [420, 230], [500, 230]]) assert.ok(!fps.some(q => q[0] < x && x < q[2] && q[1] < y && y < q[3]), x + ',' + y);
  const walk = inst.filter(p => F.CATALOG[p.type].walkable);
  assert.ok(walk.some(p => p.type === 'ball-pit'));
  assert.equal(F.footprints(walk).length, 0);
  const pit = gold.spots['play:pit'];
  assert.ok(!fps.some(q => q[0] < pit.x && pit.x < q[2] && q[1] < pit.y && pit.y < q[3]), 'play:pit');
});
