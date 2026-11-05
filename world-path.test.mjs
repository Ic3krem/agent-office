import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

const { WorldPath: W } = loadWorld();
const J = (v) => JSON.parse(JSON.stringify(v)); // vm results have a foreign realm prototype
const len = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);

test('blocks a cell only on real overlap', () => {
  let g = W.buildGrid({ w: 40, h: 20, cell: 10, blocks: [[0, 0, 10, 10]] });
  assert.equal(g.blocked[0], 1); assert.equal(g.blocked[1], 0);
  g = W.buildGrid({ w: 40, h: 20, cell: 10, blocks: [[9.5, 0, 20, 10]] });
  assert.equal(g.blocked[0], 0); assert.equal(g.blocked[1], 1);
});

test('finds a path around a wall', () => {
  const g = W.buildGrid({ w: 200, h: 100, cell: 10, blocks: [[95, 0, 105, 80]] });
  const p = W.findPath(g, { x: 20, y: 20 }, { x: 180, y: 20 });
  assert.deepEqual(J(p[0]), { x: 20, y: 20 });
  assert.deepEqual(J(p.at(-1)), { x: 180, y: 20 });
  for (let i = 1; i < p.length; i++) assert.ok(W.lineClear(g, p[i - 1], p[i]));
  assert.ok(p.some((q) => q.y >= 80));
});

test('enters a blocked goal cell', () => {
  const g = W.buildGrid({ w: 200, h: 100, cell: 10, blocks: [[140, 10, 170, 40]] });
  const p = W.findPath(g, { x: 20, y: 20 }, { x: 155, y: 25 });
  assert.ok(p.length > 0);
  assert.deepEqual(J(p.at(-1)), { x: 155, y: 25 });
  const q = W.findPath(g, { x: 155, y: 25 }, { x: 20, y: 20 });
  assert.deepEqual(J(q[0]), { x: 155, y: 25 });
  assert.deepEqual(J(q.at(-1)), { x: 20, y: 20 });
});

test('prefers cheap cost zones', () => {
  const g = W.buildGrid({ w: 200, h: 100, cell: 10, costs: [{ rect: [0, 60, 200, 80], cost: 0.5 }] });
  const p = W.findPath(g, { x: 10, y: 20 }, { x: 190, y: 20 });
  let inside = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s < 20; s++) {
      const y = a.y + (b.y - a.y) * (s + 0.5) / 20;
      if (y >= 60 && y <= 80) inside += d / 20;
    }
  }
  assert.ok(inside > 0.5 * len(p), `${inside} of ${len(p)}`);
});

test('unreachable returns []', () => {
  const g = W.buildGrid({ w: 200, h: 100, cell: 10, blocks: [[120, 20, 180, 30], [120, 60, 180, 70], [120, 20, 130, 70], [170, 20, 180, 70]] });
  assert.equal(W.findPath(g, { x: 20, y: 20 }, { x: 150, y: 45 }).length, 0);
});

test('full-size grid is fast', () => {
  const g = W.buildGrid({ w: 1240, h: 780, cell: 10, blocks: [[300, 0, 320, 600], [700, 180, 720, 780]] });
  const t0 = performance.now();
  const p = W.findPath(g, { x: 20, y: 20 }, { x: 1200, y: 20 });
  const ms = performance.now() - t0;
  assert.ok(p.length > 0 && ms < 50, `${ms} ms`);
});
