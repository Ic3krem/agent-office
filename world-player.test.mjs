import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';
import fs from 'node:fs';

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

test('ceo candidates include Tiro and seated agents', () => {
  const walkers = [{ id: 'boss', x: 10, y: 10, isManager: true }, { id: 'a1', x: 50, y: 60 }];
  const desks = [{ id: 'desk-1', x: 155, y: 352, agentId: 'a1' }, { id: 'desk-2', x: 255, y: 352, agentId: null }];
  const c = JSON.parse(JSON.stringify(P.candidatesFrom(walkers, desks)));
  assert.deepEqual(c, [
    { kind: 'tiro', id: 'boss', x: 10, y: 10 },
    { kind: 'agent', id: 'a1', x: 50, y: 60 },
    { kind: 'desk', id: 'a1', desk: 'desk-1', x: 155, y: 352 },
  ]);
  assert.equal(P.nearest(P.create(150, 350), c).kind, 'desk');
});

test('a stale one-point path is not active; a live path, keys or the stick are', () => {
  const p = P.create(420, 250);
  assert.equal(P.ceoActive(p, 0, { dx: 0, dy: 0 }), false);
  p.path = [{ x: 420, y: 250 }]; p.pi = 1; // finished or deduped-to-one-point route
  assert.equal(P.ceoActive(p, 0, { dx: 0, dy: 0 }), false);
  p.path = [{ x: 420, y: 250 }, { x: 500, y: 250 }];
  assert.equal(P.ceoActive(p, 0, { dx: 0, dy: 0 }), true);
  p.path = []; p.pi = 0;
  assert.equal(P.ceoActive(p, 1, { dx: 0, dy: 0 }), true);
  assert.equal(P.ceoActive(p, 0, { dx: 0.3, dy: 0 }), true);
  assert.equal(P.ceoActive(null, 0, { dx: 0, dy: 0 }), false);
});

test('takesKey: player keys only outside Build, dialogs and text fields; arrows and E only with nothing focused', () => {
  const body = { tagName: 'BODY' }, canvas = { tagName: 'CANVAS' }, btn = { tagName: 'BUTTON' }, input = { tagName: 'INPUT' };
  const s = { build: false, shown: true, dialog: false, canvas };
  const k = (key, target, extra) => P.takesKey({ key, target, ...extra }, s);
  assert.equal(k('w', body), 'move');
  assert.equal(k('D', canvas), 'move');
  assert.equal(k('ArrowUp', body), 'move');
  assert.equal(k('ArrowUp', canvas), 'move');
  assert.equal(k('ArrowUp', btn), null);
  assert.equal(k('e', body), 'interact');
  assert.equal(k('e', btn), null);
  assert.equal(k('e', body, { repeat: true }), null);
  assert.equal(k('Enter', body), 'interact');
  assert.equal(k('Enter', canvas), null);
  for (const key of ['w', 'ArrowLeft', 'e', 'Enter']) assert.equal(k(key, input), null);
  assert.equal(k('a', { tagName: 'DIV', isContentEditable: true }), null);
  for (const key of ['+', '-', '0', 'Escape', 'y', 'n']) assert.equal(k(key, body), null);
  assert.equal(k('w', body, { ctrlKey: true }), null);
  assert.equal(P.takesKey({ key: 'w', target: body }, { ...s, build: true }), null);
  assert.equal(P.takesKey({ key: 'w', target: body }, { ...s, dialog: true }), null);
  assert.equal(P.takesKey({ key: 'w', target: body }, { ...s, shown: false }), null);
});

test('open windows block CEO keys and only unreachable floor clicks toast', () => {
  const src = fs.readFileSync(new URL('./public/office-world.js', import.meta.url), 'utf8');
  assert.match(src, /\[role=dialog\]\[aria-modal=true\], \.oo-win/);
  assert.match(src, /return onFloor \? 'blocked' : false/);
  assert.match(src, /=== 'blocked'\) opts\.onToast/);
  const html = fs.readFileSync(new URL('./public/Agent Office.html', import.meta.url), 'utf8');
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Usage"/);
});
