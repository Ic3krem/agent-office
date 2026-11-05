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
  assert.deepEqual(c.find((t) => t.type === 'dept-desk'), { type: 'dept-desk', label: 'Department desk', group: 'desk', addable: false, deletable: false });
  assert.ok(c.every((t) => ['furniture', 'decor', 'nature', 'desk'].includes(t.group)));
  const s = E.createSession(WM.defaultLayout());
  for (const type of ['dept-desk', 'arcade', 'jukebox', 'server-plant']) {
    const t = c.find((q) => q.type === type);
    assert.equal(t.addable, false, type);
    assert.equal(t.deletable, type !== 'dept-desk', type);
    assert.equal(s.add(type, 1100, 520).ok, false, 'add ' + type);
    const id = J(s.layout()).objects.find((o) => o.type === type).id;
    assert.equal(s.duplicate(id).ok, false, 'duplicate ' + type);
  }
  assert.equal(s.canUndo(), false);
  assert.equal(c.find((q) => q.type === 'bench').addable, true);
});

test('a move keeps overlaps the piece already had, and fails on new ones', () => {
  const s = E.createSession(WM.defaultLayout());
  assert.deepEqual(J(s.move('tree-8', 1080, 330)), { ok: true }); // starts in pond-east's water square
  assert.deepEqual(J(s.move('dartboard', 522, 676)), { ok: true }); // starts on the toy bin
  const r = J(s.move('tires-1', 1060, 640)); // starts on tires-2; the garage is new
  assert.equal(r.ok, false);
  assert.match(r.reason, /garage/);
  assert.equal(J(s.add('tires', 1022, 760)).ok, false, 'add stays strict');
});

test('every default piece can be nudged by 10', () => {
  const l = WM.defaultLayout(), s = E.createSession(l), stuck = [];
  for (const o of J(l).objects) {
    if (/^fixture-|^pond/.test(o.type)) continue;
    const tries = [[10, 0], [-10, 0], [0, 10], [0, -10]].map(([dx, dy]) => J(s.check({ op: 'move', id: o.id, x: o.x + dx, y: o.y + dy })));
    if (!tries.some((r) => r.ok)) stuck.push(o.id + ': ' + tries.map((r) => r.reason).join(' / '));
  }
  assert.deepEqual(stuck, []);
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

test('screen point under a placed piece hits it', () => {
  const L = WM.defaultLayout(), bench = L.objects.find((o) => o.id === 'bench-1');
  const [r] = J(F.footprints([bench])), cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
  const g = E.toGround(...F.P(cx, cy, 0));
  assert.ok(g.x >= r[0] && g.x <= r[2] && g.y >= r[1] && g.y <= r[3], `${g.x},${g.y} outside ${r}`);
  assert.equal(E.pieceAt(L.objects, g.x, g.y), 'bench-1');
});

test('load swaps the whole layout as one undoable, dirty op', () => {
  const s = E.createSession(WM.defaultLayout());
  const other = WM.defaultLayout(); other.objects.find((o) => o.id === 'bench-1').x += 40;
  assert.ok(s.load(other).ok);
  assert.equal(obj(s, 'bench-1').x, other.objects.find((o) => o.id === 'bench-1').x);
  assert.ok(s.dirty());
  s.undo();
  assert.ok(!s.dirty());
});

test('catalog labels are words, not raw type ids', () => {
  for (const c of E.catalog()) {
    assert.notEqual(c.label, c.type, c.type);
    assert.ok(!/^[a-z0-9-]+$/.test(c.label), c.type + ' -> ' + c.label);
  }
  assert.equal(E.labelOf('sofa3'), 'Sofa (3-seat)');
});

test('load refuses an invalid layout and changes nothing', () => {
  const s = E.createSession(WM.defaultLayout());
  const bad = WM.defaultLayout(); bad.zones.push({ id: 'x', type: 'nope', rect: [0, 0, 50, 50] });
  const r = s.load(bad);
  assert.equal(r.ok, false);
  assert.match(r.reason, /invalid layout/);
  assert.ok(!s.dirty() && !s.canUndo());
});

test('ponds are locked: not pickable, movable, deletable, copyable or in the catalog', () => {
  const s = E.createSession(WM.defaultLayout()), L = J(s.layout());
  for (const type of ['pond', 'pond-east']) {
    assert.ok(!J(E.catalog()).some((t) => t.type === type), type + ' not in catalog');
    const o = L.objects.find((q) => q.type === type);
    assert.equal(s.move(o.id, o.x + 40, o.y).ok, false, 'move ' + type);
    assert.equal(s.remove(o.id).ok, false, 'remove ' + type);
    assert.equal(s.duplicate(o.id).ok, false, 'duplicate ' + type);
    assert.equal(s.add(type, 1100, 520).ok, false, 'add ' + type);
    assert.equal(E.pieceAt([o], o.x, o.y), null, 'pick ' + type);
  }
  assert.equal(s.canUndo(), false);
});

test('water zones follow their pond: no retype, resize, delete, or painting over', () => {
  const s = E.createSession(WM.defaultLayout()), L = J(s.layout()), w = L.zones.find((q) => q.type === 'water'), g = L.zones.find((q) => q.type === 'garden');
  assert.ok(w && g);
  for (const r of [s.setZone(w.id, { type: 'garden' }), s.setZone(g.id, { type: 'water' }), s.setZone(w.id, { rect: [w.rect[0], w.rect[1], w.rect[2] + 10, w.rect[3]] }), s.removeZone(w.id)]) {
    assert.equal(J(r).ok, false);
    assert.match(J(r).reason, /water belongs to its pond/);
  }
  assert.equal(s.canUndo(), false);
  assert.equal(J(s.setZone(w.id, { type: 'water' })).ok, true, 'a no-op keeps working');
});
