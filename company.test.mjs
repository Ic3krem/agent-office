import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goalStore } from './company.mjs';

test('goals carry over to a new day unless finished', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-')), 'goals.json');
  let day = '2026-10-17';
  const g = goalStore(file, () => day);
  const a = g.add('fix retries'), b = g.add('write report'), c = g.add('idea', 'manager', 'proposed', 'why');
  g.update(b.id, { status: 'done', note: 'sent' });
  assert.deepEqual(g.open().map(x => x.id), [a.id]);
  assert.throws(() => g.update('nope', { status: 'done' }));
  assert.equal(goalStore(file, () => day).clear(), 1, 'finished goals leave the board');
  assert.equal(goalStore(file, () => day).list().length, 2);
  day = '2026-10-18';
  assert.deepEqual(goalStore(file, () => day).list().map(x => x.id), [a.id, c.id]);
});

