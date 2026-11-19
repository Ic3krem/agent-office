import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeStore, readStore, writeStore, acceptStore, MAX_BYTES } from './desktop/notch-store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notch-store-'));
const T = { id: 'abc123', name: 'Tea', kind: 'countdown', endsAt: 1.8e12, startedAt: 1.79e12, pausedLeft: null, round: 1, phase: 'focus' };

test('empty store has defaults', () => {
  assert.deepEqual(normalizeStore({}), { notes: [], timers: [], counters: [], pomodoro: { focus: 25, rest: 5, rounds: 4 } });
  assert.deepEqual(normalizeStore(null), normalizeStore({}));
});

test('round trip through a temp dir', () => {
  const d = tmp(), s = normalizeStore({ notes: [{ id: 'n00001', text: 'hi' }], timers: [T], counters: [{ id: 'c00001', name: 'Water', goal: 8, count: 2, day: '2026-11-19' }], pomodoro: { focus: 30, rest: 10, rounds: 3 } });
  writeStore(d, s);
  assert.deepEqual(readStore(d), s);
  assert.deepEqual(fs.readdirSync(d), ['notch-store.json'], 'no temp file left behind');
  assert.equal(s.timers.length, 1);
});

test('the brief example normalizes to empty', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'notch-store.json'), '{"notes": "x", "timers": [{"id":"../x"}], "counters":[{"id":"abc123","name":"Water","goal":5000,"count":2,"day":"2026-11-19"}]}');
  const s = readStore(d);
  assert.deepEqual([s.notes, s.timers, s.counters], [[], [], []]);
});

test('caps: 100 notes, 500 chars, 10 timers, 12 counters, 40-char names', () => {
  const notes = Array.from({ length: 150 }, (_, i) => ({ id: 'n' + String(i).padStart(5, '0'), text: 'x'.repeat(600) }));
  const timers = Array.from({ length: 15 }, (_, i) => ({ ...T, id: 't' + String(i).padStart(5, '0'), name: 'n'.repeat(80) }));
  const counters = Array.from({ length: 20 }, (_, i) => ({ id: 'c' + String(i).padStart(5, '0'), name: 'w', goal: 999, count: 1, day: '2026-11-19' }));
  const s = normalizeStore({ notes, timers, counters });
  assert.equal(s.notes.length, 100); assert.equal(s.notes[0].text.length, 500);
  assert.equal(s.timers.length, 10); assert.equal(s.timers[0].name.length, 40);
  assert.equal(s.counters.length, 12);
  assert.equal(normalizeStore({ counters: [{ id: 'c00001', name: 'w', goal: 0, count: 0, day: '2026-11-19' }] }).counters.length, 0);
});

test('bad ids, duplicate ids, bad kinds and days are dropped', () => {
  const s = normalizeStore({
    notes: [{ id: 'n00001', text: 'a' }, { id: 'n00001', text: 'dup' }, { id: 'ABC', text: 'b' }, { id: 'n00002', text: 5 }],
    timers: [{ ...T, kind: 'bogus' }, { ...T, id: 't00002', phase: 'x' }],
    counters: [{ id: 'c00001', name: 'w', goal: 3, count: 1, day: 'yesterday' }],
  });
  assert.equal(s.notes.length, 1); assert.equal(s.timers.length, 0); assert.equal(s.counters.length, 0);
});

test('timer numbers: finite, year 2020..2100 for times, 0..24h pausedLeft, round 0..99', () => {
  const t = o => normalizeStore({ timers: [{ ...T, ...o }] }).timers[0];
  assert.equal(t({ endsAt: Infinity }).endsAt, null); assert.equal(t({ endsAt: NaN }).endsAt, null);
  assert.equal(t({ endsAt: 1e9 }).endsAt, null); assert.equal(t({ endsAt: 5e12 }).endsAt, null);
  assert.equal(t({ endsAt: '1800000000000' }).endsAt, null);
  assert.equal(t({ startedAt: 1e20 }).startedAt, null);
  assert.equal(t({ pausedLeft: -1 }).pausedLeft, null); assert.equal(t({ pausedLeft: 86400001 }).pausedLeft, null);
  assert.equal(t({ pausedLeft: 86400000 }).pausedLeft, 86400000);
  assert.equal(t({ round: 100 }).round, 0); assert.equal(t({ round: 99 }).round, 99); assert.equal(t({ round: 1.5 }).round, 0);
  assert.equal(t({ endsAt: 1.8e12 }).endsAt, 1.8e12);
});

test('truncated JSON and oversize files read as defaults', () => {
  const d = tmp(), f = path.join(d, 'notch-store.json');
  fs.writeFileSync(f, '{"notes":[{"id":"n00001","te');
  assert.deepEqual(readStore(d), normalizeStore({}));
  fs.writeFileSync(f, JSON.stringify({ notes: [{ id: 'n00001', text: 'x'.repeat(MAX_BYTES) }] }));
  assert.deepEqual(readStore(d), normalizeStore({}));
  assert.deepEqual(readStore(path.join(d, 'missing')), normalizeStore({}));
});

test('a whole-file JSON error keeps the file as notch-store.json.bad (replacing an older one) before defaults are used', () => {
  const d = tmp(), f = path.join(d, 'notch-store.json'), bad = f + '.bad';
  fs.writeFileSync(bad, 'older');
  fs.writeFileSync(f, '{"notes":[{"id":"n00001","te');
  assert.deepEqual(readStore(d), normalizeStore({}));
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.readFileSync(bad, 'utf8'), '{"notes":[{"id":"n00001","te');
  writeStore(d, normalizeStore({}));
  assert.equal(fs.readFileSync(bad, 'utf8'), '{"notes":[{"id":"n00001","te', "the next commit leaves the user's file alone");
  fs.writeFileSync(f, JSON.stringify({ notes: 'not a list' }));
  readStore(d);
  assert.equal(fs.existsSync(f), true, 'valid JSON with bad fields is normalized, not set aside');
});

test('acceptStore: rejects payloads over 256 KB before normalizing, normalizes the rest', () => {
  assert.equal(MAX_BYTES, 256 * 1024);
  assert.equal(acceptStore({ notes: [{ id: 'n00001', text: 'x'.repeat(MAX_BYTES) }] }), null);
  assert.equal(acceptStore({ notes: Array.from({ length: 1e5 }, () => ({ id: 'n00001', text: '' })) }), null);
  assert.equal(acceptStore(undefined), null);
  const circ = {}; circ.self = circ; assert.equal(acceptStore(circ), null);
  assert.equal(acceptStore({ notes: [{ id: 'n00001', text: 'ok', extra: 1 }] }).notes[0].extra, undefined);
});
