import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'town-render.js'], globals: { setInterval, clearInterval } });
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

test('lruEvict: oldest first, never a key in use this frame; all in use -> the cache grows instead', () => {
  const m = new Map(['k0', 'k1', 'k2', 'k3', 'k4'].map(k => [k, { k }]));
  const out = R.lruEvict(m, 3, new Set(['k0', 'k1', 'k4']));
  assert.deepEqual(plain(out).map(t => t.k), ['k2', 'k3']);
  assert.deepEqual([...m.keys()], ['k0', 'k1', 'k4']);
  const all = new Map([['a', 1], ['b', 2]]);
  assert.equal(R.lruEvict(all, 1, new Set(['a', 'b'])).length, 0);
  assert.equal(all.size, 2);
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

// ---------- town step 4: graphics ----------
test('blobOf: ellipse at the frame anchor, half-axes from the projected footprint', () => {
  const r2 = v => Math.round(v * 100) / 100;
  const rx = Math.max(1.4 * R.K * 10, 5.4);
  assert.deepEqual(plain(R.blobOf({ w: 12, ax: 6, ay: 13, footprint: [-5, -5, 5, 5] })), { cx: 6, cy: 13, rx: r2(rx), ry: r2(rx / 2) });
  // a wide frame on a small footprint: the 0.45 x frame width floor wins
  assert.deepEqual(plain(R.blobOf({ w: 60, ax: 30, ay: 40, footprint: [-2, -2, 2, 2] })), { cx: 30, cy: 40, rx: 27, ry: 13.5 });
});

test('lightAt: tint, window glow and lamp pools by hour and lighting level', () => {
  assert.deepEqual(plain(R.lightAt(12, 'glow')), { tint: 0xffffff, glow: 0, pools: 0 });
  assert.equal(R.lightAt(22, 'glow').glow, 1);
  assert.equal(R.lightAt(22, 'tint').glow, 0);
  assert.notEqual(R.lightAt(22, 'tint').tint, 0xffffff);
  assert.equal(R.lightAt(22, 'off').tint, 0xffffff);
  assert.equal(R.lightAt(22, 'pools').pools, 1);
  assert.equal(R.lightAt(22, 'glow').pools, 0);
});

test('zoomFor: render scale shrinks the backing store the zoom is computed from', () => {
  assert.equal(R.zoomFor(1000, 600, 1, { renderScale: .5 }), R.zoomFor(500, 300, 1, { renderScale: 1 }));
  assert.equal(R.zoomFor(1800, 1120, 1, { renderScale: .5 }), R.zoomFor(900, 560, 1, { renderScale: 1 }));
  assert.equal(R.zoomFor(1800, 1120, 1, { renderScale: 1 }), 2);
});

// ---------- town step 4: shared by the GPU and Canvas2D renderers ----------
test('cameraRect: centred on the camera, clamped at the map edges, centred when the map is smaller', () => {
  const t = { size: [2000, 1000] }, [px, py] = R.project(1085, 585, 0);
  const mid = R.cameraRect(1085, 585, 800, 400, 2, t); // view 400 x 200 terrain px
  assert.deepEqual(plain(mid), { left: px - 200, top: py - 100, w: 400, h: 200 });
  const tl = R.cameraRect(-5000, 0, 800, 400, 1, t); // far top-left: pinned to 0,0
  assert.deepEqual([tl.left, tl.top], [0, 0]);
  const br = R.cameraRect(5000, 0, 800, 400, 1, t); // far bottom-right: right/bottom edges meet the map's
  assert.equal(br.left + br.w, 2000); assert.equal(br.top + br.h, 1000);
  const big = R.cameraRect(1085, 585, 3000, 1500, 1, t); // view larger than the map: the map sits centred
  assert.deepEqual([big.left, big.top], [-500, -250]);
});

test('backingSize: css px x renderScale, at least 1, with the zoom for that scale', () => {
  assert.deepEqual(plain(R.backingSize({ clientWidth: 1280, clientHeight: 800 }, { renderScale: .5 })), { w: 640, h: 400, zoom: 1 });
  assert.deepEqual(plain(R.backingSize({ clientWidth: 1800, clientHeight: 1120 }, { renderScale: 1 })), { w: 1800, h: 1120, zoom: 2 });
  assert.deepEqual(plain(R.backingSize({ clientWidth: 0, clientHeight: 0 }, { renderScale: 1 })), { w: 1, h: 1, zoom: 1 });
});

test('lightClock: changed once per light key, stale when the night tenth moves', () => {
  const c = R.lightClock(22, () => {});
  try {
    assert.equal(c.stale(), true, 'nothing applied yet');
    assert.equal(c.changed({ lighting: 'tint', shadows: 'off' }), true);
    assert.equal(c.changed({ lighting: 'tint', shadows: 'off' }), false);
    assert.equal(c.stale(), false);
    assert.equal(c.changed({ lighting: 'glow', shadows: 'off' }), true, 'a setting change re-applies');
    c.reset(); assert.equal(c.changed({ lighting: 'glow', shadows: 'off' }), true);
    assert.equal(c.now(), 22);
  } finally { c.stop(); }
});

// ---------- town step 4, task 9: land levels ----------
test('placement follows the ground: ground() lifts by TownMap.heightAt; charPlace, toWorldAt and travellerHit use it', () => {
  const hill = { levels: [{ rect: [0, 0, 400, 300], level: 1 }], ramps: [{ rect: [300, 290, 360, 370], dir: 'n' }] };
  R.setMap(hill);
  try {
    assert.deepEqual(plain(R.ground(250, 200)), plain(R.project(250, 200, 14)));
    assert.deepEqual(plain(R.ground(1000, 1000)), plain(R.project(1000, 1000, 0)));
    assert.equal(R.charPlace(250, 200, 's').py, Math.round(R.project(250, 200, 14)[1]) - 25, 'feet on the terrace top');
    for (const [x, y] of [[250, 200], [330, 330], [1000, 1000], [395, 150]]) {
      const [sx, sy] = R.ground(x, y), [wx, wy] = R.toWorldAt(sx, sy, 0, 0, 1, 1);
      assert.ok(Math.hypot(wx - x, wy - y) < 1, `toWorld(${x},${y}) -> ${wx},${wy}`);
    }
    const [sx, sy] = R.ground(250, 200), shown = new Map([['a', { x: 250, y: 200, name: 'A' }]]);
    assert.equal(R.travellerHit(shown, sx, sy - 15, 0, 0, 1, 1).id, 'a', 'hit at the raised head');
  } finally { R.setMap(null); }
});

test('toWorld on the real town: a hill top by its west (away-facing) edge stays on the hill; a click on a cliff face snaps to its base', () => {
  const town = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
  R.setMap(town);
  try {
    for (const [x, y] of [[1325, 200], [1335, 200], [1330, 420], [700, 300], [10, 10]]) {
      const [sx, sy] = R.ground(x, y), [wx, wy] = R.toWorldAt(sx, sy, 0, 0, 1, 1);
      assert.ok(Math.hypot(wx - x, wy - y) < 1, `toWorld(${x},${y}) -> ${wx | 0},${wy | 0}`);
    }
    const g = ctx.TownMap.grid(town);
    for (const [x, edgeY] of [[500, 460], [1800, 440]]) { // halfway up a south-facing cliff
      const [sx, sy] = R.project(x, edgeY, 7), [wx, wy] = R.toWorldAt(sx, sy, 0, 0, 1, 1);
      assert.ok(Math.hypot(wx - x, wy - edgeY) < 3 && wy >= edgeY, `face click -> ${wx},${wy}`);
      assert.equal(ctx.TownMap.heightAt(town, wx, wy), 0);
      assert.equal(g.blocked[ctx.WorldPath.cellOf(g, { x: wx, y: wy })], 0, 'an open cell at the cliff base');
    }
  } finally { R.setMap(null); }
});
