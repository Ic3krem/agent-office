import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorldStore, parseScene } from './world-store.mjs';

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

test('unreadable file: the warning names the error code, not the path', (t) => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'layout.json')); // reading a directory fails with EISDIR
  const logged = [];
  t.mock.method(console, 'error', (...a) => logged.push(a));
  const r = createWorldStore(d).load();
  assert.equal(r.source, 'default');
  assert.match(r.warning, /unreadable \(E[A-Z]+\)/);
  assert.ok(!r.warning.includes(d), 'no absolute path in the toast');
  assert.equal(logged.length, 1, 'the full reason is logged server-side');
});

// Town step 2: one file per scene beside layout.json.
test('scenes: kain and games load their template until saved, then their own file; the office is untouched', () => {
  const d = tmp(), s = createWorldStore(d);
  for (const sc of ['kain', 'games']) {
    const r = s.load(sc);
    assert.equal(r.source, 'default');
    assert.equal(r.layout.scene, sc);
    const l = { ...r.layout, spawn: { ...r.layout.spawn, x: r.layout.spawn.x + 10 } };
    assert.equal(s.save(l, sc).ok, true);
    assert.deepEqual(s.load(sc), { layout: l, source: 'file' });
  }
  assert.equal(s.load().source, 'default');
  assert.equal(s.load('office').source, 'default');
  assert.deepEqual(fs.readdirSync(d).sort(), ['games.json', 'kain.json']);
});

test('a scene file takes only its own scene; corrupt interior falls back to its template', () => {
  const d = tmp(), s = createWorldStore(d), office = s.load().layout, kain = s.load('kain').layout;
  assert.equal(s.save(office, 'kain').ok, false);
  assert.equal(s.save(kain).ok, false, 'the office file never takes an interior');
  assert.equal(s.save(kain, 'games').ok, false);
  fs.writeFileSync(path.join(d, 'kain.json'), '{nope');
  const r = s.load('kain');
  assert.equal(r.source, 'default');
  assert.equal(r.layout.scene, 'kain');
  assert.match(r.warning, /kain\.json is not valid JSON/);
});

test('scene names outside office|kain|games are refused before any path is built', () => {
  const d = tmp(), s = createWorldStore(d), l = s.load().layout;
  assert.equal(parseScene(null), 'office', 'no scene parameter = the office');
  for (const sc of ['office', 'kain', 'games']) assert.equal(parseScene(sc), sc);
  for (const bad of ['', 'x', '../layout', 'kain/../../x', 'KAIN', 'templates', 'layout', '__proto__', 'constructor', 'toString', 'kain.json']) {
    assert.equal(parseScene(bad), null, bad);
    assert.throws(() => s.load(bad), /unknown scene/, bad);
    assert.throws(() => s.save(l, bad), /unknown scene/, bad);
  }
  assert.deepEqual(fs.readdirSync(d), [], 'nothing written');
});

test("an interior's default is fetchable by id (Build's reset) but never listed or shadowed", () => {
  const s = createWorldStore(tmp());
  assert.equal(s.getTemplate('interior-kain').layout.scene, 'kain');
  assert.equal(s.saveTemplate('interior kain', s.load('kain').layout).id, 'interior-kain-mine');
  assert.equal(s.getTemplate('interior-kain').layout.scene, 'kain');
});
