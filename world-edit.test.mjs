import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

const { WorldModel: WM, WorldEdit: E, OfficeFurniture: F } = loadWorld();
const J = (v) => JSON.parse(JSON.stringify(v)); // vm results have a foreign realm prototype
const obj = (s, id) => J(s.layout()).objects.find((o) => o.id === id);

test('toGround inverts P', () => {
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 1240, y = Math.random() * 780, g = E.toGround(...F.P(x, y, 0));
    assert.ok(Math.abs(g.x - x) < 0.01 && Math.abs(g.y - y) < 0.01, `${x},${y} -> ${g.x},${g.y}`);
  }
});

test('move snaps and is undoable', () => {
  const s = E.createSession(WM.defaultLayout());
  assert.deepEqual(J(s.move('bench-1', 703, 27)), { ok: true });
  assert.deepEqual([obj(s, 'bench-1').x, obj(s, 'bench-1').y], [700, 30]);
  s.undo();
  assert.deepEqual([obj(s, 'bench-1').x, obj(s, 'bench-1').y], [700, 24]);
  assert.ok(s.canRedo());
  s.redo();
  assert.deepEqual([obj(s, 'bench-1').x, obj(s, 'bench-1').y], [700, 30]);
});

test('illegal move changes nothing', () => {
  const s = E.createSession(WM.defaultLayout()), before = J(s.layout());
  const r = J(s.move('bench-1', 790, 105));
  assert.equal(r.ok, false);
  assert.ok(r.reason);
  assert.deepEqual(J(s.layout()), before);
  assert.equal(s.canUndo(), false);
});

test('cannot delete pieces agents need', () => {
  const s = E.createSession(WM.defaultLayout());
  const sofa = J(s.remove('sofa3'));
  assert.equal(sofa.ok, false);
  assert.match(sofa.reason, /play:sofa1/);
  const desk = J(s.remove(J(s.layout()).objects.find((o) => o.type === 'dept-desk').id));
  assert.deepEqual(desk, { ok: false, reason: 'cannot delete department desks yet' });
  assert.equal(s.remove('bird-feeder').ok, true);
  assert.equal(s.canUndo(), true);
});

test('duplicate gets fresh ids and stays valid', () => {
  const s = E.createSession(WM.defaultLayout());
  const d = J(s.duplicate('bench-1'));
  assert.equal(d.ok, true);
  assert.equal(d.id, 'bench-5');
  assert.deepEqual(J(s.move(d.id, 1100, 520)), { ok: true });
  const l = J(s.layout()), spots = J(WM.spotsOf(l));
  assert.ok(spots['garden:b1@bench-5'], 'copy spot gets the @ suffix');
  assert.equal(spots['garden:b1'].x, 700, 'original keeps its spot id');
  assert.deepEqual(J(WM.validate(l).errors), []);
  assert.equal(J(s.add('plant', 1100, 560)).id, 'plant-6');
  assert.equal(J(s.add('dept-desk', 1100, 600)).ok, false);
});

test('zones', () => {
  const s = E.createSession(WM.defaultLayout());
  const z = J(s.addZone('lounge', [100, 600, 140, 640]));
  assert.equal(z.ok, true);
  assert.equal(z.id, 'lounge-1');
  assert.equal(s.setZone(z.id, { rect: [100, 600, 110, 640] }).ok, false);
  assert.equal(s.setZone(z.id, { type: 'nope' }).ok, false);
  assert.equal(s.addZone('garden', [1200, 700, 1300, 780]).ok, false);
  assert.equal(s.setZone(z.id, { rect: [100, 600, 160, 660], type: 'play' }).ok, true);
  assert.equal(s.removeZone(z.id).ok, true);
  assert.equal(J(s.layout()).zones.some((q) => q.id === z.id), false);
  assert.deepEqual(J(WM.validate(s.layout()).errors), []);
});

test('check does not apply', () => {
  const s = E.createSession(WM.defaultLayout()), before = J(s.layout());
  assert.equal(s.check({ op: 'move', id: 'bench-1', x: 700, y: 30 }).ok, true);
  assert.equal(s.check({ op: 'move', id: 'bench-1', x: 790, y: 105 }).ok, false);
  assert.equal(s.check({ op: 'move', id: 'bird-feeder', x: NaN, y: 100 }).ok, false);
  assert.equal(s.check({ op: 'move', id: 'bird-feeder', x: 1300, y: 100 }).ok, false);
  assert.deepEqual(J(s.layout()), before);
  assert.equal(s.canUndo(), false);
});

test('catalog skips fixtures and pins desks', () => {
  const c = J(E.catalog());
  assert.ok(!c.some((t) => /^fixture-/.test(t.type)));
  assert.deepEqual(c.find((t) => t.type === 'dept-desk'), { type: 'dept-desk', label: 'dept-desk', group: 'desk', addable: false, deletable: false });
  assert.ok(c.every((t) => ['furniture', 'decor', 'nature', 'desk'].includes(t.group)));
});

test('dirty and markSaved', () => {
  const s = E.createSession(WM.defaultLayout());
  assert.equal(s.dirty(), false);
  s.move('bench-1', 700, 30);
  assert.equal(s.dirty(), true);
  s.markSaved();
  assert.equal(s.dirty(), false);
  s.undo();
  assert.equal(s.dirty(), true);
});

test('history is capped at 100 and a new op clears redo', () => {
  const s = E.createSession(WM.defaultLayout());
  for (let i = 0; i < 120; i++) assert.equal(s.move('bench-1', 700, i % 2 ? 30 : 40).ok, true);
  let n = 0;
  while (s.canUndo()) { s.undo(); n++; }
  assert.equal(n, 99); // 100 snapshots = 99 steps back
  s.move('bench-1', 700, 30);
  assert.equal(s.canRedo(), false);
});

test('ops are fast', () => {
  const s = E.createSession(WM.defaultLayout()), ids = ['bench-1', 'bench-2', 'plant-2', 'tree-3', 'beanbag-1', 'arcade'];
  s.move('bench-1', 700, 30); // warm the footprint cache once
  // npm test runs files in parallel, so a loaded machine can stall any single op for a whole scheduler slice. The
  // median op is what the editor feels; 50 of them must fit in 250 ms (5 ms each, the per-op budget).
  const times = [];
  for (let i = 0; times.length < 50 && i < 5000; i++) {
    const t = performance.now(), r = s.move(ids[i % ids.length], 40 + Math.random() * 1160, 300 + Math.random() * 200);
    if (r.ok) times.push(performance.now() - t);
  }
  assert.equal(times.length, 50);
  const median = times.sort((a, b) => a - b)[25];
  assert.ok(50 * median < 250, `50 moves at the median ${median.toFixed(2)} ms take ${(50 * median).toFixed(1)} ms`);
});
