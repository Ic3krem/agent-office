import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'town-ambient.js'] });
const { TownAmbient: A } = ctx;
const map = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
const counts = p => [p.water.length, p.trees.length, p.particles.length];

test('plan per ambient level', () => {
  assert.deepEqual(counts(A.plan(map, 'off')), [0, 0, 0]);
  const w = A.plan(map, 'water');
  assert.ok(w.water.length > 0);
  assert.deepEqual([w.trees.length, w.particles.length], [0, 0]);
  const all = A.plan(map, 'all');
  assert.ok(all.water.length > 0 && all.trees.length > 0);
  assert.equal(all.particles.length, 0);
  const p = A.plan(map, 'particles');
  assert.equal(p.particles.filter(e => e.kind === 'steam').length, 1);
  const leaves = p.particles.filter(e => e.kind === 'leaf').length;
  assert.ok(leaves > 0 && leaves <= p.trees.length / 4, 'at most 1 leaf emitter per 4 trees');
});

test('water sparkles: 40-unit grid, inside water, never on a bridge, at most 64', () => {
  const p = A.plan(map, 'water'), inR = (q, [x0, y0, x1, y1]) => q.x >= x0 && q.x < x1 && q.y >= y0 && q.y < y1;
  assert.ok(p.water.length <= 64);
  for (const q of p.water) {
    assert.ok(q.x % 40 === 0 && q.y % 40 === 0, JSON.stringify(q));
    assert.ok(map.water.some(r => inR(q, r)) && !map.bridges.some(r => inR(q, r)), JSON.stringify(q));
  }
});

test('water sparkles past 64 take an even spread, not the first 64', () => {
  const big = { ...map, water: [[0, 0, 4000, 400]], bridges: [] }; // 100 x 10 grid points
  const w = A.plan(big, 'water').water;
  assert.equal(w.length, 64);
  assert.ok(Math.max(...w.map(q => q.y)) >= 320, 'spread reaches the far rows');
});

test('steam sits at the karinderya building', () => {
  const kain = map.lots.find(l => l.building.type === 'karinderya').building;
  const s = A.plan(map, 'particles').particles.find(e => e.kind === 'steam');
  assert.deepEqual([s.x, s.y], [kain.x, kain.y]);
});

test('frameDue', () => {
  assert.equal(A.frameDue(0, 33, 30), true);
  assert.equal(A.frameDue(0, 20, 30), false);
  assert.equal(A.frameDue(0, 66, 15), true);
});

test('animation offsets are whole pixels', () => {
  const p = A.plan(map, 'particles');
  for (const t of [0, 123, 4567, 98765]) {
    for (let i = 0; i < 20; i++) assert.ok([-1, 0, 1].includes(A.sway(i, t)));
    for (const q of A.particles(p.particles, t)) assert.ok(Number.isInteger(q.dx) && Number.isInteger(q.dy), JSON.stringify(q));
    assert.ok(A.particles(p.particles, t).length <= 24);
  }
});
