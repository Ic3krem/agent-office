import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorldStore } from './world-store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'world-store-'));

test('missing file loads default', () => {
  const r = createWorldStore(tmp()).load();
  assert.equal(r.source, 'default');
  assert.equal(r.warning, undefined);
  assert.equal(r.layout.version, 1);
});

test('corrupt json loads default with warning and leaves the file', () => {
  const d = tmp(), f = path.join(d, 'layout.json');
  fs.writeFileSync(f, '{nope');
  const r = createWorldStore(d).load();
  assert.equal(r.source, 'default');
  assert.match(r.warning, /JSON/);
  assert.equal(fs.readFileSync(f, 'utf8'), '{nope');
});

test('newer version loads default and is not overwritten by load', () => {
  const d = tmp(), f = path.join(d, 'layout.json'), s = createWorldStore(d);
  const text = JSON.stringify({ ...s.load().layout, version: 99 });
  fs.writeFileSync(f, text);
  const r = s.load();
  assert.equal(r.source, 'default');
  assert.match(r.warning, /newer version/);
  assert.equal(fs.readFileSync(f, 'utf8'), text);
});

test('save rejects invalid layout and keeps the old file', () => {
  const d = tmp(), s = createWorldStore(d), good = s.load().layout;
  assert.equal(s.save(good).ok, true);
  const before = fs.readFileSync(path.join(d, 'layout.json'), 'utf8');
  const bad = { ...good, objects: [...good.objects, { id: 'x', type: 'no-such-thing', x: 1, y: 1 }] };
  const r = s.save(bad);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown type/);
  assert.equal(s.save(null).ok, false);
  assert.equal(fs.readFileSync(path.join(d, 'layout.json'), 'utf8'), before);
});

test('save is atomic: no tmp left and reload equals what was saved', () => {
  const d = tmp(), s = createWorldStore(d), l = s.load().layout;
  l.spawn = { ...l.spawn, x: l.spawn.x + 10 };
  assert.equal(s.save(l).ok, true);
  assert.deepEqual(fs.readdirSync(d), ['layout.json']);
  const r = s.load();
  assert.equal(r.source, 'file');
  assert.deepEqual(r.layout, l);
});
