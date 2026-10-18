import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costOf, usageLedger } from './usage.mjs';

test('cost follows model prices and cache write windows', () => {
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }), 0.2);
  assert.equal(costOf('claude-opus-5-5', { cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }), 5 + 8);
});

test('a response written as several lines is counted once, and only appended lines are read again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-u-')), f = path.join(dir, 's.jsonl');
  const line = id => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-opus-5-5', usage: { output_tokens: 1e6 } } }) + '\n';
  fs.writeFileSync(f, line('m1') + line('m1'));
  const L = usageLedger(dir); L.refresh();
  assert.equal(L.summary().at(-1).cost, 20);
  fs.appendFileSync(f, line('m2')); L.refresh(); L.refresh();
  assert.equal(L.summary().at(-1).cost, 40);
  assert.equal(L.summary().length, 7);
});

import { creditLog } from './usage.mjs';
test('credits spent are the increases between checks, and a monthly reset starts from zero', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-c-')), 'credits.json');
  let c = creditLog(f);
  c.observe(24.66); assert.equal(Object.values(c.days()).at(-1), 0, 'first check is only a baseline');
  c.observe(26.16); c = creditLog(f); c.observe(27);
  assert.equal(+Object.values(c.days()).at(-1).toFixed(2), 2.34);
  c.observe(1.5);
  assert.equal(+Object.values(c.days()).at(-1).toFixed(2), 3.84);
});
