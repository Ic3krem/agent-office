import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, pickDisplay, isleBoundsFor, inPeekZone, isFullscreenState, normalizeSettings, applyPatch, themeVars, pinnedActions, formatClock, monthGrid, weekdayNames, peekReady, DEFAULT_SETTINGS, ACTIONS, MAX_PINNED } from './desktop/island-logic.mjs';

const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const B = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };

test('resolveMode honours islandMode, then legacy islandOff', () => {
  assert.equal(resolveMode({}), 'always');
  assert.equal(resolveMode({ islandOff: true }), 'off');
  assert.equal(resolveMode({ islandMode: 'smart', islandOff: true }), 'smart');
  assert.equal(resolveMode({ islandMode: 'bogus' }), 'always');
});

test('pickDisplay follows cursor, primary, or a saved id', () => {
  assert.equal(pickDisplay([A, B], 1, { x: 3000, y: 10 }, 'cursor').id, 2);
  assert.equal(pickDisplay([A, B], 1, { x: 3000, y: 10 }, undefined).id, 2);
  assert.equal(pickDisplay([A, B], 1, { x: 3000, y: 10 }, 'primary').id, 1);
  assert.equal(pickDisplay([A, B], 1, { x: 10, y: 10 }, 2).id, 2);
  assert.equal(pickDisplay([A, B], 1, { x: 10, y: 10 }, 99).id, 1); // unplugged display
  assert.equal(pickDisplay([A, B], 1, { x: -500, y: 10 }, 'cursor').id, 1); // off every display
});

test('island is centred on the top edge of its display', () => {
  assert.deepEqual(isleBoundsFor(B.bounds), { x: 1920 + (2560 - 620) / 2, y: 0, width: 620, height: 470 });
});

test('peek zone is the top edge near centre, wider once open', () => {
  assert.equal(inPeekZone(A.bounds, { x: 960, y: 1 }), true);
  assert.equal(inPeekZone(A.bounds, { x: 960, y: 30 }), false);
  assert.equal(inPeekZone(A.bounds, { x: 960, y: 30 }, true), true);
  assert.equal(inPeekZone(A.bounds, { x: 200, y: 1 }), false);
  assert.equal(inPeekZone(A.bounds, null), false);
});

test('fullscreen notification states', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 7].map(isFullscreenState), [false, true, true, true, false, false]);
});

test('normalizeSettings: defaults, validation, unknown keys dropped', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  const s = normalizeSettings({ theme: 'nope', accent: 'red', physics: 'x', hour12: 'yes', weekStart: 5, edgeDelay: 99999, leaveDelay: -4, evil: 1, zone2: 'Not/AZone', zone2Label: 'x' });
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, edgeDelay: 1000, leaveDelay: 300 });
  assert.equal('evil' in s, false);
  const z = normalizeSettings({ zone2: 'Asia/Tokyo', zone2Label: 'Tokyo<b>', accent: '#ABCDEF', theme: 'custom' });
  assert.equal(z.zone2, 'Asia/Tokyo'); assert.equal(z.zone2Label, 'Tokyob'); assert.equal(z.accent, '#abcdef'); assert.equal(z.theme, 'custom');
});

test('pinned list keeps order, drops unknown and duplicates, caps length', () => {
  assert.deepEqual(normalizeSettings({ pinned: ['chat', 'bogus', 'today', 'chat'] }).pinned, ['chat', 'today']);
  assert.deepEqual(normalizeSettings({ pinned: [] }).pinned, []);
  assert.equal(normalizeSettings({ pinned: Object.keys(ACTIONS).concat(Object.keys(ACTIONS)) }).pinned.length <= MAX_PINNED, true);
  assert.deepEqual(normalizeSettings({ pinned: 'today' }).pinned, DEFAULT_SETTINGS.pinned);
  assert.equal(pinnedActions(normalizeSettings({ pinned: ['mute'] }), { mute: true })[0].label, 'Muted');
});

test('applyPatch changes only named keys and re-validates', () => {
  const a = applyPatch({ theme: 'midnight' }, { hour12: true });
  assert.equal(a.theme, 'midnight'); assert.equal(a.hour12, true);
  assert.equal(applyPatch(a, { theme: 'bad' }).theme, 'ember');
  assert.deepEqual(applyPatch(a, null), a);
});

test('themeVars: named theme and custom accent', () => {
  assert.equal(themeVars(normalizeSettings({ theme: 'midnight' }))['--bg'], '#080b12');
  const c = themeVars(normalizeSettings({ theme: 'custom', accent: '#112233' }));
  assert.equal(c['--accent'], '#112233'); assert.equal(c['--bg'], '#0b0807');
});

test('formatClock in zones and 12h', () => {
  const d = new Date(Date.UTC(2026, 10, 2, 15, 5));
  assert.equal(formatClock(d, { zone: 'UTC' }), '15:05');
  assert.equal(formatClock(d, { zone: 'Asia/Tokyo' }), '00:05');
  assert.equal(formatClock(d, { zone: 'UTC', hour12: true }), '03:05 PM');
});

test('monthGrid: Nov 2026 starts on Sunday', () => {
  const mon = monthGrid(2026, 10, 1), sun = monthGrid(2026, 10, 0);
  assert.deepEqual(mon[0], [null, null, null, null, null, null, 1]);
  assert.deepEqual(sun[0], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(mon.flat().filter(Boolean).length, 30);
  assert.equal(mon.every(w => w.length === 7), true);
  assert.deepEqual(weekdayNames(1), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  assert.equal(monthGrid(2028, 1, 1).flat().filter(Boolean).length, 29); // leap year
});

test('peekReady waits for the edge delay', () => {
  assert.equal(peekReady(null, 1000, 0), false);
  assert.equal(peekReady(1000, 1000, 0), true);
  assert.equal(peekReady(1000, 1150, 200), false);
  assert.equal(peekReady(1000, 1200, 200), true);
});
