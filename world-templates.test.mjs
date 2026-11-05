import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorldStore } from './world-store.mjs';
import { loadWorld } from './world-vm.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'world-tpl-'));
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
const WM = loadWorld({ ctxFactory: () => noop }).WorldModel;
const J = (v) => JSON.parse(JSON.stringify(v));
const def = J(WM.defaultLayout());

test('built-in templates validate and differ from the default', () => {
  const st = createWorldStore(tmp());
  const list = st.listTemplates().filter((t) => t.builtIn);
  assert.deepEqual(list.map((t) => t.name).sort(), ['Agency Floor', 'Hotel Back-Office', 'Startup Loft']);
  for (const { id } of list) {
    const { layout } = st.getTemplate(id);
    assert.ok(WM.validate(J(layout)).ok, id);
    const moved = layout.objects.filter((o, i) => o.id !== def.objects[i].id || o.x !== def.objects[i].x || o.y !== def.objects[i].y).length;
    assert.ok(moved >= 10, id + ' moved ' + moved);
  }
});

test('save, list, get, delete user template', () => {
  const st = createWorldStore(tmp());
  assert.deepEqual(st.saveTemplate('My Room', def), { ok: true, id: 'my-room' });
  assert.deepEqual(st.listTemplates().find((t) => t.id === 'my-room'), { id: 'my-room', name: 'My Room', builtIn: false });
  assert.deepEqual(st.getTemplate('my-room').layout, def);
  assert.equal(st.deleteTemplate('my-room').ok, true);
  assert.equal(st.getTemplate('my-room'), null);
  assert.equal(st.deleteTemplate('startup-loft').ok, false, 'built-ins stay');
});

test('template id is a safe slug', () => {
  const d = tmp(), st = createWorldStore(d);
  const r = st.saveTemplate('../../x', def);
  assert.match(r.id, /^[a-z0-9-]{1,40}$/);
  assert.ok(fs.existsSync(path.join(d, 'templates', r.id + '.json')));
  assert.equal(st.saveTemplate('Startup Loft', def).id, 'startup-loft-mine');
  assert.match(st.saveTemplate('x'.repeat(100), def).id, /^[a-z0-9-]{1,40}$/);
  assert.equal(st.getTemplate('../layout'), null);
});

test('invalid template rejected', () => {
  const d = tmp(), st = createWorldStore(d);
  const r = st.saveTemplate('bad', { ...def, version: 99 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length);
  assert.equal(fs.existsSync(path.join(d, 'templates')), false);
});

test('version increments on save only', () => {
  const st = createWorldStore(tmp());
  assert.equal(st.version(), 0);
  st.load(); st.saveTemplate('t', def);
  assert.equal(st.version(), 0);
  assert.equal(st.save({ ...def, version: 99 }).ok, false);
  assert.equal(st.version(), 0);
  st.save(def);
  assert.equal(st.version(), 1);
});

test('the page tplSlug matches the server slug (overwrite check)', async () => {
  const src = fs.readFileSync(new URL('./public/Agent Office.html', import.meta.url), 'utf8').match(/const tplSlug=.*?;return id;\};/s)[0];
  const tplSlug = (await import('node:vm')).runInNewContext(src + ';tplSlug');
  const st = createWorldStore(tmp()), built = st.listTemplates().filter((t) => t.builtIn).map((t) => t.id);
  for (const nm of ['My Plan', 'Odd -- Name!!', 'x'.repeat(60), built[0], '!!!']) assert.equal(st.saveTemplate(nm, def).id, tplSlug(nm, built), nm);
});
