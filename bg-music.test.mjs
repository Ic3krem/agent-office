import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

const B = loadWorld({ extra: ['bg-music.js'], globals: { clearInterval() {} } }).BgMusic;
const J = v => JSON.parse(JSON.stringify(v));

test('plan: the same tune for a place every time, another for each place', () => {
  const places = ['office', 'town', 'kain', 'games'], plans = places.map(p => J(B.plan(p)));
  assert.deepEqual(J(B.plan('town')), plans[1]);
  assert.equal(new Set(plans.map(p => JSON.stringify(p))).size, 4);
  for (const p of plans) {
    assert.ok(p.bpm >= 60 && p.bpm <= 90, 'lo-fi tempo');
    assert.equal(p.chords.length, 4);
    for (const c of p.chords) { assert.ok(c.length >= 3); for (const n of c) assert.ok(n >= 36 && n <= 84); }
  }
});

test('ducking is -12 dB', () => {
  assert.ok(Math.abs(B.DUCK - 10 ** (-12 / 20)) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(B.DUCK) + 12) < 1e-9);
});

test('shuffle is a permutation', () => {
  const s = J(B.shuffle(10, () => 0.3));
  assert.deepEqual([...s].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('hold keeps the tune off (meeting room) even if start is called', async () => {
  B.hold(true);
  assert.equal((await B.start('meet')).on, false);
  assert.equal(B.state().on, false);
});
