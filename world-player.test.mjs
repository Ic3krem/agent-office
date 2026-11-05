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

test('unreachable target returns false', () => {
  const p = P.create(420, 250);
  const d = layout.objects.find((o) => o.id === 'desk-1');
  assert.equal(P.walkTo(p, { x: d.x, y: d.y }, (a, b) => [a, b]), false); // straight line ending inside the desk
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
