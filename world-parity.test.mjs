import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordOffice } from './world-golden.mjs';

const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/office-golden.json', import.meta.url), 'utf8'));
const norm = a => a.map(i => ({ d: i.d, fp: i.fp, log: i.log })).sort((a, b) => a.d - b.d || (a.log < b.log ? -1 : a.log > b.log ? 1 : 0));

test('static office draws exactly as 1.2.9', () => {
  const now = JSON.parse(JSON.stringify(recordOffice()));
  assert.deepEqual(norm(now.items), norm(gold.items));
  assert.deepEqual(now.objects, gold.objects);
  assert.deepEqual(now.spots, gold.spots);
});
