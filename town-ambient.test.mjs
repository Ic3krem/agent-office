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

test('particles reuse the caller buffer (no per-frame objects) and carry their emitter for depth sorting', () => {
  const p = A.plan(map, 'particles'), buf = [];
  const a = A.particles(p.particles, 1000, buf), first = a[0];
  assert.equal(a, buf);
  const b = A.particles(p.particles, 2000, buf);
  assert.equal(b, buf); assert.equal(b[0], first, 'same object reused');
  for (const q of b) assert.ok(p.particles.includes(q.e) && q.e.x === q.x && q.e.y === q.y && q.e.kind === q.kind);
  assert.deepEqual(JSON.parse(JSON.stringify(A.particles(p.particles, 2000).map(({ e, ...q }) => q))), JSON.parse(JSON.stringify(b.map(({ e, ...q }) => q))), 'same values as a fresh call');
  assert.equal(A.particles([], 5, buf).length, 0, 'buffer is truncated');
});

// ---------- town step 5: the waterfall and spot visitors ----------
test('plan: the waterfall animates at water and above, visitors at all and above', () => {
  const off = A.plan(map, 'off'), water = A.plan(map, 'water'), all = A.plan(map, 'all');
  assert.equal(off.falls.length, 0); assert.equal(off.visitors, false);
  assert.ok(water.falls.length > 0); assert.equal(water.visitors, false);
  assert.ok(all.falls.length > 0); assert.equal(all.visitors, true);
  assert.equal(A.plan(map, 'particles').visitors, true);
  const fall = map.spots.find(s => s.id === 'waterfall').props.find(p => p.type === 'waterfall');
  assert.deepEqual(JSON.parse(JSON.stringify(water.falls[0])), { x: fall.x, y: fall.y });
  assert.equal(A.isEmpty(A.plan({ ...map, water: [], decor: [], spots: [] }, 'water')), true);
  assert.equal(A.isEmpty(A.plan({ ...map, water: [], decor: [] }, 'water')), false, 'a waterfall alone keeps the loop');
});

const P = v => JSON.parse(JSON.stringify(v));
const court = map.spots.find(s => s.id === 'court'), park = map.spots.find(s => s.id === 'park');
const shooter = { id: 'a1', ...court.points.find(p => p.act === 'shoot'), pose: 'shoot', spot: 'court' };
const walker = { id: 'a2', ...park.points.find(p => p.act === 'dogwalk'), pose: 'dogwalk', spot: 'park' };

test('visit: a shooter moves the ball every ambient frame, and with ambient off it stays at rest by the feet', () => {
  const at = t => A.visit(shooter, t, map, true).ball;
  const seen = new Set();
  for (let t = 0; t < 3000; t += 66) seen.add(Math.round(at(t).x) + ',' + Math.round(at(t).y) + ',' + Math.round(at(t).z));
  assert.ok(seen.size > 20, 'the ball moves: ' + seen.size + ' positions');
  const hoop = court.props.find(p => p.type === 'hoop');
  const peak = Math.max(...Array.from({ length: 50 }, (_, i) => at(i * 60).z));
  assert.ok(peak > 30, 'arcs up to the rim: ' + peak);
  let made = 0, missed = 0;
  for (let i = 0; i < 30; i++) { const v = A.visit(shooter, i * A.SHOT_MS, map, true); if (v.made) made++; else missed++; }
  assert.ok(Array.from({ length: 60 }, (_, i) => A.visit(shooter, i * 50, map, true).ball).some(b => Math.hypot(b.x - hoop.x, b.y - hoop.y) < 12 && b.z > 28), 'the ball reaches the hoop');
  assert.ok(made > 0 && missed > 0, 'not every shot goes in: ' + made + '/' + missed);
  const r1 = A.visit(shooter, 0, map, false), r2 = A.visit(shooter, 1234, map, false);
  assert.deepEqual(P(r1), P(r2), 'off: no motion');
  assert.equal(r1.ball.z, 0); assert.ok(Math.hypot(r1.ball.x - shooter.x, r1.ball.y - shooter.y) < 8);
  assert.equal(r1.pose, 'stand');
});

test('visit: a dog walker goes round the park loop with the dog on a leash behind; off, both rest at the point', () => {
  const a = A.visit(walker, 0, map, true), b = A.visit(walker, 1000, map, true);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - A.DOG_SPEED) < 3, 'walks DOG_SPEED units a second');
  assert.equal(a.pose, 'walk');
  for (const v of [a, b]) assert.ok(Math.abs(Math.hypot(v.dog.x - v.x, v.dog.y - v.y) - A.LEASH) < 3, 'the dog trails by the leash');
  const off = A.visit(walker, 5000, map, false);
  assert.deepEqual([off.x, off.y, off.pose], [walker.x, walker.y, 'stand']);
  assert.ok(off.dog && Math.hypot(off.dog.x - walker.x, off.dog.y - walker.y) < 20);
  const sit = A.visit({ id: 's', x: 5, y: 6, face: 's', pose: 'sit', spot: 'park' }, 99, map, true);
  assert.deepEqual(P(sit), { x: 5, y: 6, face: 's', pose: 'sit', frame: 0 });
  assert.equal(A.visit({ id: 'l', x: 5, y: 6, face: 'n', pose: 'lean', spot: 'pasture' }, 0, map, true).pose, 'stand');
  assert.equal(A.visit({ id: 'g', x: 5, y: 6, face: 'n', pose: 'dogwalk', spot: 'gone' }, 0, map, true).pose, 'stand', 'no loop: stands');
});
