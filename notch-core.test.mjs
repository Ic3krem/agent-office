import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SIZES } from './desktop/notch-window.mjs';

vm.runInThisContext(fs.readFileSync(new URL('./public/notch-core.js', import.meta.url), 'utf8'), { filename: 'notch-core.js' }); // same realm, so deepEqual sees plain objects
const C = globalThis.NotchCore;
const now = Date.UTC(2026, 10, 19, 9, 0);
const min = 60e3;

test('tabs and cards: nine tabs, eight cards, Home first', () => {
  assert.deepEqual(C.TABS, ['home', 'approvals', 'agents', 'calendar', 'timer', 'notes', 'music', 'trackers', 'performance']);
  assert.deepEqual(C.CARDS, ['approvals', 'agents', 'calendar', 'timer', 'notes', 'music', 'trackers', 'performance']);
});

test('closedView: what the closed notch shows', () => {
  assert.deepEqual(C.closedView({ now }), { kind: 'closed', left: '', right: '' }, 'nothing going on');
  assert.deepEqual(C.closedView({ now, nextEvent: { title: 'Stand-up', start: now + 12 * min } }), { kind: 'line', left: 'Stand-up in 12 min', right: '' });
  assert.equal(C.closedView({ now, nextEvent: { title: 'Stand-up', start: now + 16 * min } }).kind, 'closed', 'more than 15 minutes away is not shown');
  assert.equal(C.closedView({ now, nextEvent: { title: 'Gone', start: now - min } }).kind, 'closed', 'an event that already started is not "next"');
  const song = { title: 'Song', artist: 'Band', playing: true };
  assert.deepEqual(C.closedView({ now, np: song }), { kind: 'line', left: 'Song · Band', right: '' });
  assert.equal(C.closedView({ now, np: { ...song, playing: false } }).kind, 'closed', 'a paused song is not shown');
  assert.equal(C.closedView({ now, np: song, timer: { name: 'Tea', left: 3 * min + 5e3 } }).left, 'Tea 03:05', 'timer beats song');
  assert.equal(C.closedView({ now, np: song, timer: { name: 'Tea', left: 1e3 }, nextEvent: { title: 'Stand-up', start: now + 5 * min } }).left, 'Stand-up in 5 min', 'event beats timer');
  assert.deepEqual(C.closedView({ now, asks: 2 }), { kind: 'line', left: '', right: '2 approvals' });
  assert.equal(C.closedView({ now, asks: 1 }).right, '1 approval');
  assert.equal(C.closedView({ now, asks: 1, hires: 1 }).right, '2 approvals', 'hires count too');
  const g = C.closedView({ now, game: { fps: 120 }, asks: 1, np: song });
  assert.equal(g.kind, 'game'); assert.equal(g.right, '1 approval', 'game mode still shows the count');
});

test('forcedOpen: waiting things and chat hold the notch open, except in game mode', () => {
  assert.equal(C.forcedOpen({ asks: 1 }), true);
  assert.equal(C.forcedOpen({ hires: 1 }), true);
  assert.equal(C.forcedOpen({ asks: 1, game: true }), false, 'game mode: only the count shows');
  assert.equal(C.forcedOpen({ chatOn: true }), true);
  assert.equal(C.forcedOpen({}), false);
});

test('the page copy of the closed sizes matches the window sizes', () => {
  for (const k of ['closed', 'line', 'game']) assert.deepEqual(C.SIZES[k], SIZES[k], k);
});

test('homeCards from main are filtered to known cards', () => {
  assert.deepEqual(C.knownCards(['notes', 'bogus', 'timer', '__proto__']), ['notes', 'timer']);
  assert.deepEqual(C.knownCards(undefined), []);
});

test('timerView: countdown running, paused, finished; h:mm:ss from one hour', () => {
  const run = { kind: 'countdown', endsAt: now + 90e3, startedAt: now, pausedLeft: null };
  assert.deepEqual({ ...C.timerView(run, now) }, { left: 90e3, done: false, label: '01:30' });
  assert.equal(C.timerView(run, now + 1500).label, '01:29', 'rounds up like a clock');
  const paused = { kind: 'countdown', endsAt: null, startedAt: now, pausedLeft: 45e3 };
  assert.deepEqual({ ...C.timerView(paused, now + 99e6) }, { left: 45e3, done: false, label: '00:45' });
  assert.deepEqual({ ...C.timerView(run, now + 91e3) }, { left: 0, done: true, label: '00:00' });
  assert.equal(C.timerView({ ...run, endsAt: now + 3600e3 }, now).label, '1:00:00');
  assert.equal(C.timerView({ ...run, endsAt: now + 3599e3 }, now).label, '59:59');
  const sw = { kind: 'stopwatch', endsAt: null, startedAt: now, pausedLeft: null };
  assert.deepEqual({ ...C.timerView(sw, now + 61e3) }, { left: 61e3, done: false, label: '01:01' });
  assert.equal(C.timerView({ ...sw, pausedLeft: 3725e3 }, now + 9e9).label, '1:02:05', 'a paused stopwatch holds its elapsed time');
});

test('pomodoroNext: a four-round cycle ends stopped', () => {
  const cfg = { focus: 25, rest: 5, rounds: 4 };
  let t = { kind: 'pomodoro', phase: 'focus', round: 1, startedAt: now, endsAt: now + 25 * min, pausedLeft: null };
  const seen = [];
  let at = now;
  for (let i = 0; i < 10 && t.endsAt != null; i++) {
    at = t.endsAt; t = C.pomodoroNext(t, cfg, at);
    seen.push(t.endsAt == null ? 'stop' : `${t.phase}${t.round}:${(t.endsAt - at) / min}`);
  }
  assert.deepEqual(seen, ['break1:5', 'focus2:25', 'break2:5', 'focus3:25', 'break3:5', 'focus4:25', 'stop']);
  assert.equal(t.pausedLeft, 0); assert.equal(C.timerView(t, at).done, true);
});

test('dueTimers: each timer fires once, even after a 3 hour sleep', () => {
  const ts = [{ id: 'aaaaaa', kind: 'countdown', endsAt: now + 10 * min }, { id: 'bbbbbb', kind: 'countdown', endsAt: now + 5 * 3600e3 }, { id: 'cccccc', kind: 'countdown', endsAt: null }, { id: 'dddddd', kind: 'countdown', endsAt: now - 1 }];
  const later = now + 3 * 3600e3;
  assert.deepEqual(C.dueTimers(ts, now, later), ['aaaaaa']);
  assert.deepEqual(C.dueTimers(ts, later, later + 1e3), []);
  assert.deepEqual(C.dueTimers(ts, now, now + 10 * min), ['aaaaaa'], 'endsAt equal to now is due');
  assert.deepEqual(C.dueTimers(ts, now + 10 * min, now + 20 * min), [], 'not again');
});

test('closedView: a finished timer reads as done', () => {
  assert.equal(C.closedView({ now, timer: { name: 'Tea', done: true } }).left, 'Tea done');
});

test('timerRunning: only a started stopwatch or a countdown with its end ahead', () => {
  assert.equal(C.timerRunning({ kind: 'countdown', endsAt: now + 1 }, now), true);
  assert.equal(C.timerRunning({ kind: 'countdown', endsAt: now }, now), false, 'ended');
  assert.equal(C.timerRunning({ kind: 'countdown', endsAt: null, pausedLeft: 5 }, now), false, 'paused');
  assert.equal(C.timerRunning({ kind: 'stopwatch', startedAt: now, pausedLeft: null }, now), true);
  assert.equal(C.timerRunning({ kind: 'stopwatch', startedAt: now, pausedLeft: 1e3 }, now), false);
});

test('closedView: an hour or more reads h:mm:ss', () => {
  assert.equal(C.closedView({ now, timer: { name: 'Roast', left: 90 * min } }).left, 'Roast 1:30:00');
});

test('storeGate: no write before a good load, none after a failed one, until a retry works', async () => {
  const saved = { notes: [{ id: 'aaaaaa', text: 'keep me' }] };
  let sets = 0, mode = 'ok', release;
  const g = C.storeGate(() => mode === 'ok' ? new Promise(r => { release = () => r(saved); }) : mode === 'null' ? null : Promise.reject(new Error('x')), s => { sets++; return s; });
  assert.equal(g.write({ notes: [] }), null, 'before load');
  const p = g.load(); assert.equal(g.write({ notes: [] }), null, 'while loading'); release(); assert.equal(await p, 'ready');
  assert.deepEqual(g.data, saved); assert.notEqual(g.write(saved), null); assert.equal(sets, 1);
  mode = 'null'; assert.equal(await g.load(), 'failed'); assert.equal(g.write({ notes: [] }), null, 'null read');
  mode = 'throw'; assert.equal(await g.load(), 'failed'); assert.equal(g.write({ notes: [] }), null, 'rejected read');
  assert.equal(sets, 1, 'set never called after a failed load');
  mode = 'ok'; const q = g.load(); release(); assert.equal(await q, 'ready'); assert.notEqual(g.write(saved), null); assert.equal(sets, 2);
});

const dayStr = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const mkDays = n => Array.from({ length: n }, (_, i) => ({ day: dayStr(now - (n - 1 - i) * 864e5), cost: i + 1, tokens: 1000 * (i + 1), out: 100 * (i + 1), models: {} }));
const byId = a => Object.fromEntries(a.map(g => [g.id, g]));

test('gauges: full fixture', () => {
  const usage = { days: mkDays(7), limits: { plan: 'max', available: true, session: { pct: 41.6, resets: now + 2 * 3600e3 }, weekly: { pct: 80, resets: now + 3 * 864e5 } } };
  const g = byId(C.gauges({ usage, limits: usage.limits, now }));
  assert.deepEqual(Object.keys(g), ['session', 'weekly', 'costToday', 'costWeek', 'tokensToday']);
  assert.equal(g.session.value, '42%'); assert.equal(g.session.pct, 41.6); assert.match(g.session.note, /^Resets in 2 h/);
  assert.equal(g.weekly.value, '80%');
  assert.equal(g.costToday.value, '$7.00'); assert.equal(g.costToday.pct, null); assert.match(g.costToday.note, /API value/);
  assert.equal(g.costWeek.value, '$28.00', 'sum of 7 buckets: 1+..+7');
  assert.equal(g.tokensToday.value, '700'); assert.match(g.tokensToday.note, /output/i);
});
test('gauges: cost week sums only the last 7 buckets', () => {
  const g = byId(C.gauges({ usage: { days: mkDays(9) }, limits: null, now }));
  assert.equal(g.costWeek.value, '$' + (3 + 4 + 5 + 6 + 7 + 8 + 9).toFixed(2));
});
test('gauges: no limits means Not available, never 0%', () => {
  const g = byId(C.gauges({ usage: { days: mkDays(7) }, limits: null, now }));
  for (const k of ['session', 'weekly']) { assert.equal(g[k].value, 'Not available'); assert.equal(g[k].pct, null); assert.ok(g[k].note); }
});
test('gauges: an error object, an unavailable plan and a missing window each give a reason', () => {
  let g = byId(C.gauges({ usage: { days: [] }, limits: { error: 'timeout', at: now }, now }));
  assert.equal(g.session.pct, null); assert.match(g.session.note, /timeout/);
  g = byId(C.gauges({ usage: { days: [] }, limits: { available: false, at: now }, now }));
  assert.equal(g.weekly.value, 'Not available'); assert.match(g.weekly.note, /login/);
  g = byId(C.gauges({ usage: { days: [] }, limits: { available: true, session: { pct: 5, resets: now + 60e3 } }, now }));
  assert.equal(g.session.value, '5%'); assert.equal(g.weekly.pct, null); assert.equal(g.weekly.value, 'Not available');
});
test('gauges: no usage data at all', () => {
  const g = byId(C.gauges({ usage: null, limits: null, now }));
  assert.equal(g.costToday.value, 'Not available'); assert.equal(g.costWeek.pct, null);
});
test('counterToday: resets across midnight, keeps the same day', () => {
  const c = { id: 'abcdef', name: 'Water', goal: 8, count: 5, day: '2026-11-18' };
  assert.equal(C.counterToday(c, '2026-11-18'), c);
  assert.deepEqual(C.counterToday(c, '2026-11-19'), { ...c, count: 0, day: '2026-11-19' });
  assert.equal(c.count, 5, 'input untouched');
});
test('dayOf: local calendar day', () => { assert.equal(C.dayOf(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05'); });

test('gauges: resets may be an ISO string or epoch ms; bad values leave the note out; far dates show a time', () => {
  const at = v => byId(C.gauges({ usage: null, limits: { available: true, session: { pct: 5, resets: v } }, now })).session.note;
  assert.equal(at(new Date(now + 2 * 36e5).toISOString()), 'Resets in 2 h');
  assert.equal(at(now + 2 * 36e5), 'Resets in 2 h');
  assert.equal(at(new Date(now + 30 * 60e3).toISOString()), 'Resets in 30 min');
  assert.equal(at(new Date(now - 1000).toISOString()), 'Resets soon');
  assert.equal(at('not a date'), ''); assert.equal(at(undefined), '');
  const far = at(new Date(now + 3 * 864e5).toISOString()); assert.match(far, /^Resets on .+\d:\d\d/); assert.doesNotMatch(far, /Invalid/);
});
