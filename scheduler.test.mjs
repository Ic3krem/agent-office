import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readScheduler } from './scheduler.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
const put = (name, data) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const NOW = Date.parse('2026-11-03T12:00:00Z');

test('missing, empty or broken file means no data yet', () => {
  assert.deepEqual(readScheduler(path.join(tmp, 'nope.json')), { present: false });
  assert.deepEqual(readScheduler(put('bad.json', '{not json')), { present: false });
  assert.deepEqual(readScheduler(put('arr.json', '[1]')), { present: false });
  assert.deepEqual(readScheduler(put('empty.json', {})), { present: false });
});
test('valid file is normalised', () => {
  const r = readScheduler(put('ok.json', { lastCheck: '2026-11-03T11:30:00Z', itemsFound: 3, lastUpdateToTiro: Date.parse('2026-11-03T11:00:00Z'), note: 'ok',
    items: [{ title: 'Reply to vendor', kind: 'task', at: '2026-11-03T10:00:00Z' }, { title: '  ', kind: 'x' }, { title: 'Odd kind', kind: 'weird' }] }), NOW);
  assert.equal(r.present, true); assert.equal(r.itemsFound, 3); assert.equal(r.lastCheck, '2026-11-03T11:30:00.000Z');
  assert.equal(r.lastUpdateToTiro, '2026-11-03T11:00:00.000Z'); assert.equal(r.stale, false);
  assert.deepEqual(r.items.map(i => [i.title, i.kind]), [['Reply to vendor', 'task'], ['Odd kind', 'info']]);
});
test('stale, clamped and sanitised', () => {
  assert.equal(readScheduler(put('old.json', { lastCheck: '2026-11-01T00:00:00Z', itemsFound: 0 }), NOW).stale, true);
  const r = readScheduler(put('big.json', { lastCheck: 'garbage', itemsFound: -4, items: Array.from({ length: 50 }, (_, i) => ({ title: 'x\u0007' + 'y'.repeat(500) + i })) }), NOW);
  assert.equal(r.lastCheck, null); assert.equal(r.items.length, 20); assert.ok(r.items[0].title.length <= 140 && !/\u0007/.test(r.items[0].title)); assert.equal(r.itemsFound, 20);
});
