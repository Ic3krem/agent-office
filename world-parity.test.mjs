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
