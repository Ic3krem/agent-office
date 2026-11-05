import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

const { WorldModel: WM, WorldPlayer: P, WorldPath: WP, OfficeMotion: OM } = loadWorld();
const layout = WM.defaultLayout();
OM.useLayout(layout);
const g = OM.grid();
const free = (x, y) => !g.blocked[WP.cellOf(g, { x, y })];
const run = (p, secs, input) => { for (let i = 0; i < secs * 60; i++) P.step(p, 1 / 60, input, g); return p; };

test('screen-right moves along +x -y', () => {
  const p = P.create(420, 250), x0 = p.x, y0 = p.y;
  run(p, 0.2, { dx: 1, dy: 0 });
  assert.ok(p.x > x0 && p.y < y0 && p.moving);
});

test('cannot enter a desk, slides along its edge', () => {
  const d = layout.objects.find((o) => o.id === 'desk-1');
  const p = P.create(d.x - 200, d.y + 60); // screen-right is (+x,-y): aim the diagonal into the desk
  const y0 = p.y;
  run(p, 2, { dx: 1, dy: 0 });
  assert.ok(free(p.x, p.y));
  assert.notEqual(p.y, y0);
});

test('never enters water', () => {
  const pond = layout.objects.find((o) => o.type === 'pond');
  for (const input of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
    const p = P.create(pond.x + 120, pond.y + 120);
    P.unstick(p, g);
    for (let i = 0; i < 240; i++) { P.step(p, 1 / 60, input, g); assert.ok(free(p.x, p.y), `${p.x},${p.y}`); }
  }
});

test('click path reaches a far spot without teleport', () => {
  const p = P.create(OM.SPOTS['desk-1'].x, OM.SPOTS['desk-1'].y), target = 'garden:b2';
  assert.equal(P.walkTo(p, target, OM.pathTo), true);
  const len = OM.pathLen(JSON.parse(JSON.stringify(p.path)));
  let maxJump = 0, n = 0;
  while (p.path.length && n < 60 * 60) {
    const x = p.x, y = p.y; P.step(p, 1 / 60, { dx: 0, dy: 0 }, g); n++;
    maxJump = Math.max(maxJump, Math.hypot(p.x - x, p.y - y));
  }
  const b = OM.SPOTS[target];
  assert.ok(Math.hypot(p.x - b.x, p.y - b.y) < 1);
  assert.ok(maxJump < 4, `jump ${maxJump}`);
  assert.ok(Math.abs(n / 60 - len / P.SPEED) < 0.2, `${n / 60}s vs ${len / P.SPEED}s`);
});

test('input cancels a click path', () => {
  const p = P.create(420, 250);
  P.walkTo(p, 'garden:b2', OM.pathTo);
  P.step(p, 1 / 60, { dx: 0, dy: 1 }, g);
  assert.equal(p.path.length, 0);
});

test('unreachable target returns false and leaves no path', () => {
  const p = P.create(420, 250), c = WP.cellOf(g, { x: 1000, y: 700 }), saved = new Uint8Array(g.blocked);
  for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) if (dr || dc) g.blocked[c + dr * g.cols + dc] = 1;
  try { assert.equal(P.walkTo(p, { x: 1000, y: 700 }, OM.pathTo), false); } finally { g.blocked.set(saved); }
  assert.equal(p.path.length, 0);
});

test('a seat inside a blocked cell is still reachable', () => {
  const s = OM.SPOTS['desk-1'], p = P.create(420, 250);
  assert.equal(P.walkTo(p, { x: s.x - 30, y: s.y }, OM.pathTo), true);
  assert.ok(p.path.length > 1);
});

test('large dt never tunnels into a desk or the pond', () => {
  const d = layout.objects.find((o) => o.id === 'desk-1'), pond = layout.objects.find((o) => o.type === 'pond');
  for (const [sx, sy] of [[d.x - 200, d.y + 60], [d.x + 200, d.y - 60], [pond.x + 120, pond.y + 120], [pond.x - 120, pond.y - 120]]) {
    for (const input of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
      const p = P.create(sx, sy); P.unstick(p, g);
      for (let i = 0; i < 20; i++) { P.step(p, 0.5, input, g); assert.ok(free(p.x, p.y), `${p.x},${p.y}`); }
    }
  }
});

test('half-tilt stick walks at half speed', () => {
  const a = P.create(420, 250), b = P.create(420, 250);
  P.step(a, 0.1, { dx: 1, dy: 0 }, g); P.step(b, 0.1, { dx: 0.5, dy: 0 }, g);
  assert.ok(Math.abs(Math.hypot(b.x - 420, b.y - 250) * 2 - Math.hypot(a.x - 420, a.y - 250)) < 0.01);
});

test('nearest picks Tiro within REACH and nothing beyond', () => {
  const p = P.create(100, 100);
  const c = [{ kind: 'agent', id: 'a', x: 130, y: 100 }, { kind: 'tiro', id: 't', x: 110, y: 100 }, { kind: 'desk', id: 'd', x: 400, y: 100 }];
  const n = JSON.parse(JSON.stringify(P.nearest(p, c)));
  assert.equal(n.kind, 'tiro');
  assert.equal(P.nearest(P.create(0, 0), c), null);
});

test('unstick moves out of a blocked cell', () => {
  const d = layout.objects.find((o) => o.id === 'desk-1');
  const p = P.create(d.x, d.y);
  assert.ok(!free(p.x, p.y));
  P.unstick(p, g);
  assert.ok(free(p.x, p.y));
});

test('large dt cannot jump a one-cell wall', () => {
  const wc = 60, blocked = new Uint8Array(g.blocked.length); // custom grid: free except a one-cell-thick wall at column wc
  for (let r = 0; r < g.rows; r++) blocked[r * g.cols + wc] = 1;
  const wall = { ...g, blocked }, p = P.create(wc * g.cell - 60, 300);
  for (let i = 0; i < 6; i++) P.step(p, 0.5, { dx: 1, dy: 1 }, wall); // pure +x, 85 units per step
  assert.ok(p.x < wc * g.cell, `crossed the wall: x=${p.x}`);
});
