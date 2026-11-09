import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyShape, keyHint, saveKey, loadKey, removeKey } from './claude-key.mjs';

const FAKE = 'sk-ant-api03-' + 'A'.repeat(30) + 'wxyz';
const enc = s => Buffer.from('ENC:' + Buffer.from(s).toString('base64'));
const dec = b => { const t = String(b); if (!t.startsWith('ENC:')) throw new Error('bad'); return Buffer.from(t.slice(4), 'base64').toString(); };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-key-')), 'claude-key.enc');

test('keyShape: sk-ant- keys only, one line', () => {
  assert.equal(keyShape(FAKE), true);
  assert.equal(keyShape('sk-ant- ' + 'A'.repeat(30)), false);
  assert.equal(keyShape('sk-xyz-' + 'A'.repeat(30)), false);
  assert.equal(keyShape(FAKE + '\n'), false);
  assert.equal(keyShape('sk-ant-short'), false);
  assert.equal(keyShape(null), false);
});

test('keyHint shows the last four characters only', () => {
  assert.equal(keyHint(FAKE), '…wxyz');
  assert.equal(keyHint(''), '');
});

test('saveKey stores the encrypted bytes, never the key', () => {
  const f = tmp();
  saveKey(f, FAKE, enc);
  assert.ok(!fs.readFileSync(f, 'utf8').includes(FAKE));
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(loadKey(f, dec), FAKE);
  assert.throws(() => saveKey(f, 'nope', enc), /sk-ant-/);
});

test('loadKey: missing, undecryptable or a bad shape is empty', () => {
  const f = tmp();
  assert.equal(loadKey(f, dec), '');
  fs.writeFileSync(f, 'junk'); assert.equal(loadKey(f, dec), '');
  fs.writeFileSync(f, enc('not-a-key')); assert.equal(loadKey(f, dec), '');
  removeKey(f); assert.equal(fs.existsSync(f), false);
  removeKey(f); // already gone: fine
});
