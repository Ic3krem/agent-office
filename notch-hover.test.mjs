import test from 'node:test';
import assert from 'node:assert/strict';
import { hoverStep, shrinkDelay } from './desktop/notch-hover.mjs';

const closedRect = { x: 870, y: 0, width: 180, height: 32 }, openRect = { x: 410, y: 0, width: 1100, height: 370 };
const IN_CLOSED = { x: 960, y: 10 }, IN_OPEN_ONLY = { x: 500, y: 300 }, AWAY = { x: 960, y: 900 };
const base = { closedRect, openRect, edgeDelay: 0, leaveDelay: 900, pinned: false, forced: false };
const START = { open: false, enterAt: null, leaveAt: null };
const run = (steps, s = START) => { for (const [now, cursor, extra] of steps) s = hoverStep(s, { ...base, ...extra, now, cursor }); return s; };

test('resting 0 ms in the closed rect opens with edgeDelay 0', () => {
  assert.equal(run([[1000, IN_CLOSED]]).open, true);
});

test('edgeDelay 500: not open at 499, open at 500', () => {
  const d = { edgeDelay: 500 };
  assert.equal(run([[1000, IN_CLOSED, d], [1499, IN_CLOSED, d]]).open, false);
  assert.equal(run([[1000, IN_CLOSED, d], [1500, IN_CLOSED, d]]).open, true);
});

test('leaving the closed rect before the delay resets enterAt', () => {
  const d = { edgeDelay: 500 };
  const s = run([[1000, IN_CLOSED, d], [1300, AWAY, d]]);
  assert.equal(s.enterAt, null);
  assert.equal(run([[1400, IN_CLOSED, d], [1600, IN_CLOSED, d]], s).open, false, 'the delay counts again from the re-entry');
  assert.equal(run([[1400, IN_CLOSED, d], [1900, IN_CLOSED, d]], s).open, true);
});

test('open: inside the open rect but outside the closed rect stays open', () => {
  assert.equal(run([[1000, IN_CLOSED], [1100, IN_OPEN_ONLY], [5000, IN_OPEN_ONLY]]).open, true);
});

test('leaving the open rect: still open at leaveDelay - 1, closed at leaveDelay', () => {
  const s = run([[1000, IN_CLOSED], [2000, AWAY]]);
  assert.equal(run([[2899, AWAY]], s).open, true);
  assert.equal(run([[2900, AWAY]], s).open, false);
});

test('re-entering during the leave delay cancels it', () => {
  const s = run([[1000, IN_CLOSED], [2000, AWAY], [2500, IN_OPEN_ONLY]]);
  assert.equal(s.leaveAt, null);
  assert.equal(run([[9000, IN_OPEN_ONLY]], s).open, true);
});

test('pinned or forced keeps it open with no cursor', () => {
  assert.equal(run([[1000, null, { pinned: true }], [99999, null, { pinned: true }]]).open, true);
  assert.equal(run([[1000, null, { forced: true }], [99999, null, { forced: true }]]).open, true);
  assert.equal(run([[1000, null]]).open, false);
});

test('dismiss (Esc): closes at once under the cursor, stays closed until the cursor leaves the open rect', () => {
  const open = run([[1000, IN_CLOSED], [1100, IN_OPEN_ONLY]]);
  const d = run([[1200, IN_OPEN_ONLY, { dismiss: true }]], open);
  assert.equal(d.open, false, 'Esc while hovering closes immediately');
  assert.equal(run([[1300, IN_OPEN_ONLY], [5000, IN_CLOSED], [9000, IN_CLOSED]], d).open, false, 'staying over the area does not reopen');
  assert.equal(run([[1300, AWAY], [1400, IN_CLOSED]], d).open, true, 'leaving and coming back opens again');
  assert.equal(run([[1300, IN_OPEN_ONLY, { forced: true }]], d).open, true, 'a pending approval still reopens it');
  assert.equal(run([[1300, IN_OPEN_ONLY, { pinned: true }]], d).open, true, 'pinning again (shortcut) opens it');
  assert.equal(run([[1200, IN_CLOSED, { dismiss: true, forced: true }]], open).open, true, 'an unanswered approval stays visible through Esc');
});

test('forced turning false with the cursor away closes after leaveDelay', () => {
  const s = run([[1000, AWAY, { forced: true }], [5000, AWAY, { forced: true }], [6000, AWAY]]);
  assert.equal(s.open, true);
  assert.equal(run([[6899, AWAY]], s).open, true);
  assert.equal(run([[6900, AWAY]], s).open, false);
});

test('shrinkDelay: 220 ms, 0 under reduced motion, Animations off or Power saver', () => {
  assert.equal(shrinkDelay({ animate: true, powerSaver: false, reducedMotion: false }), 220);
  assert.equal(shrinkDelay({ animate: true, powerSaver: false, reducedMotion: true }), 0);
  assert.equal(shrinkDelay({ animate: false, powerSaver: false, reducedMotion: false }), 0);
  assert.equal(shrinkDelay({ animate: true, powerSaver: true, reducedMotion: false }), 0, 'Power saver (on by default) resizes at once');
});

test('smartAway: Smart hides an idle closed notch, never one that is busy, waiting, pinned, open, peeking or in game mode', async () => {
  const { smartAway } = await import('./desktop/notch-hover.mjs');
  const base = { mode: 'smart', fs: false, peek: false, open: false, closedKind: 'closed', busy: false, pinned: false, forced: false };
  assert.equal(smartAway(base), true, 'idle: hidden');
  assert.equal(smartAway({ ...base, busy: true }), false, 'a working agent (page busy): shown, closed view unchanged');
  assert.equal(smartAway({ ...base, busy: true }), false, 'offline is busy too: shown');
  assert.equal(smartAway({ ...base, closedKind: 'line', busy: true, forced: true }), false, 'an approval pending: shown');
  assert.equal(smartAway({ ...base, forced: true }), false, 'forced (approval or hire) is never hidden');
  assert.equal(smartAway({ ...base, pinned: true }), false, 'pinned is never hidden');
  assert.equal(smartAway({ ...base, forced: true, fs: true }), false, 'not even behind a fullscreen app');
  assert.equal(smartAway({ ...base, closedKind: 'line' }), false, 'song only: the line view has something to show, as in Task 2');
  assert.equal(smartAway({ ...base, closedKind: 'line', fs: true }), true, 'a fullscreen app hides the line');
  assert.equal(smartAway({ ...base, busy: true, fs: true }), true, 'and a busy closed notch, as the old page did');
  assert.equal(smartAway({ ...base, closedKind: 'game', fs: true }), false, 'game mode shows over fullscreen');
  assert.equal(smartAway({ ...base, open: true }), false); assert.equal(smartAway({ ...base, peek: true }), false);
  assert.equal(smartAway({ ...base, mode: 'always' }), false, 'Always never hides');
});
