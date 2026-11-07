import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'town-render.js'] });
const { TownRender: R } = ctx;
const terrain = JSON.parse(fs.readFileSync(new URL('./public/art/town/terrain.json', import.meta.url), 'utf8'));
const plain = v => JSON.parse(JSON.stringify(v));

test('loads without PIXI', () => {
  assert.equal(ctx.PIXI, undefined);
  assert.equal(typeof R.mount, 'function');
});

test('project uses terrain originPx and the art projection', () => {
  assert.deepEqual(plain(R.project(0, 0, 0)), terrain.originPx);
  const [a, b] = R.project(0, 0, 0), [c, d] = R.project(10, 0, 0);
  assert.ok(Math.abs(c - a - 7.071) < 1e-3 && Math.abs(d - b - 3.536) < 1e-3);
  assert.equal(R.project(0, 0, 10)[1], terrain.originPx[1] - 10);
});

test('zoomFor is an integer >= 1 that keeps 900x560 css px of map in view', () => {
  const rs = { renderScale: 1 };
  assert.equal(R.zoomFor(1280, 800, 1, rs), 1); // 1280/2 < 900: the map would not fit at 2
  for (const dpr of [1.25, 1.5, 2]) {
    const z = R.zoomFor(1280, 800, dpr, rs);
    assert.ok(Number.isInteger(z) && z >= 1, 'dpr ' + dpr);
    assert.ok(1280 * dpr / z >= 900 && 800 * dpr / z >= 560, 'dpr ' + dpr);
  }
  assert.equal(R.zoomFor(1280, 800, 2, rs), 2);
  assert.equal(R.zoomFor(200, 150, 1, rs), 1);
  assert.equal(R.zoomFor(200, 150, 1, { renderScale: 0.5 }), 1);
});

test('visibleChunks returns the covered chunk plus a 1-chunk margin, clamped to the grid', () => {
  const key = l => plain(l).map(o => o.r + ',' + o.c).sort();
  // view inside chunk r1c2 only
  const mid = R.visibleChunks({ x: 1030, y: 520 }, { w: 400, h: 400 }, terrain);
  const want = [];
  for (let r = 0; r <= 2; r++) for (let c = 1; c <= 3; c++) want.push(r + ',' + c);
  assert.deepEqual(key(mid), want.sort());
  // view inside the corner chunk r0c0: margin is clamped
  assert.deepEqual(key(R.visibleChunks({ x: 10, y: 10 }, { w: 100, h: 100 }, terrain)), ['0,0', '0,1', '1,0', '1,1']);
  // view past the far edge stays inside the grid
  for (const { r, c } of plain(R.visibleChunks({ x: 2400, y: 1250 }, { w: 900, h: 900 }, terrain)))
    assert.ok(r >= 0 && r < terrain.rows && c >= 0 && c < terrain.cols);
});

test('depthOf draws a tree behind a player standing in front of it', () => {
  const tree = { x: 500, y: 500 }, player = { x: 505, y: 510 };
  assert.ok(R.depthOf(tree.x, tree.y) < R.depthOf(player.x, player.y));
  assert.equal(R.depthOf(3, 4), 7);
});

test('unproject inverts project at ground level', () => {
  for (const [x, y] of [[0, 0], [1085, 585], [300, 900]]) {
    const [sx, sy] = R.project(x, y, 0), [ux, uy] = R.unproject(sx, sy);
    assert.ok(Math.abs(ux - x) < 1e-6 && Math.abs(uy - y) < 1e-6);
  }
});

// ---------- town step 3: travellers ----------
test('syncPool: n travellers -> n visible sprites; one fewer -> one hidden, not destroyed; ids keep their sprite', () => {
  const pool = R.pool(), made = [];
  const make = () => { const s = { visible: false, n: made.length }; made.push(s); return s; };
  const list = n => Array.from({ length: n }, (_, i) => ({ id: 'a' + i }));
  const p1 = R.syncPool(pool, list(3), make);
  assert.equal(made.length, 3);
  assert.equal(made.filter(s => s.visible).length, 3);
  const keep = new Map(p1.map(([t, s]) => [t.id, s]));
  const p2 = R.syncPool(pool, list(2), make);
  assert.equal(made.length, 3, 'nothing new made');
  assert.equal(made.filter(s => s.visible).length, 2);
  assert.equal(made.find(s => !s.visible), keep.get('a2'), 'the gone id is hidden, kept for reuse');
  for (const [t, s] of p2) assert.equal(s, keep.get(t.id), 'same sprite for the same id');
  R.syncPool(pool, [{ id: 'a0' }, { id: 'b' }], make);
  assert.equal(made.length, 3, 'a hidden sprite is reused before making one');
  assert.equal(R.syncPool(pool, [], make).length, 0);
  assert.equal(made.filter(s => s.visible).length, 0);
});

test('charPlace: z-order x+y (after sprites at the same depth), view/flip from the face', () => {
  const s = R.charPlace(500, 510, 's'), n = R.charPlace(500, 510, 'w');
  assert.equal(s.z, 1010 + 1e-3);
  assert.ok(R.charPlace(500, 500, 'e').z < s.z, 'a character further back draws first');
  assert.deepEqual([s.view, s.dir, s.flip], ['f', -1, false]);
  assert.deepEqual([n.view, n.dir, n.flip], ['b', 0, true]);
  assert.deepEqual([R.charPlace(0, 0, 'e').view, R.charPlace(0, 0, 'n').flip], ['f', false]);
});

test('faceAlong: facing follows the path segment direction', () => {
  assert.equal(R.faceAlong({ x: 0, y: 0 }, { x: 10, y: 1 }, 's'), 'e');
  assert.equal(R.faceAlong({ x: 0, y: 0 }, { x: -10, y: 1 }, 's'), 'w');
  assert.equal(R.faceAlong({ x: 0, y: 0 }, { x: 1, y: -10 }, 's'), 'n');
  assert.equal(R.faceAlong({ x: 0, y: 0 }, { x: 0, y: 0 }, 'w'), 'w', 'no movement keeps the old face');
});

test('walkFrame advances with distance travelled, as the player does', () => {
  const S = R.STRIDE;
  assert.deepEqual([0, S * 0.5, S, S * 1.5, S * 2].map(R.walkFrame), [1, 1, 2, 2, 1]);
});
