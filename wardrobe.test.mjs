import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { lookStore } from './company.mjs';

// role-catalog.js + office-sprites.js in a sandbox with a fake canvas that records fills.
function load() {
  const fills = [];
  const document = { createElement: () => ({ getContext: () => ({ set fillStyle(v) { fills.push(v); }, fillRect() {} }) }) };
  const box = { document };
  for (const f of ['role-catalog.js', 'office-sprites.js']) vm.runInNewContext(fs.readFileSync(new URL('./public/' + f, import.meta.url), 'utf8'), box, { filename: f });
  return { C: box.RoleCatalog, SP: box.OfficeSprites, fills };
}

test('cleanCostume keeps only known fields with in-range preset values', () => {
  const { C } = load();
  assert.deepEqual({ ...C.cleanCostume({ hair: 2, skin: 7, style: 1, outfit: 3, prop: 'scarf' }) }, { hair: 2, skin: 7, style: 1, outfit: 3, prop: 'scarf' });
  assert.equal(C.cleanCostume({ hair: 8, skin: -1, style: 1.5, outfit: '2', prop: 'jetpack', shirt: '#fff' }), null);
  assert.deepEqual({ ...C.cleanCostume({ hair: 0, evil: '<script>' }) }, { hair: 0 });
  for (const bad of [null, 'x', 5, [], [1]]) assert.equal(C.cleanCostume(bad), null);
});

test('cleanLooks drops unknown agents and prototype keys', () => {
  const { C } = load();
  const out = C.cleanLooks(JSON.parse('{"ceo":{"hair":1},"tiro":{"prop":"tie"},"it":{"outfit":2},"nobody":{"hair":1},"__proto__":{"hair":1}}'));
  assert.deepEqual(Object.keys(out).sort(), ['ceo', 'it', 'tiro']);
  assert.equal(Object.keys(C.cleanLooks([{ hair: 1 }])).length, 0);
});

test('lookOf: role default accessory, saved costume, preview costume', () => {
  const { C, SP } = load();
  const forge = { id: 'a1', key: 'forge', color: '#c0392b', accent: '#f1c40f' };
  const base = SP.lookOf(forge);
  assert.equal(base.prop, 'hardhat');
  assert.equal(SP.lookOf({ look: 'ceo' }).prop, 'suit');
  assert.equal(SP.lookOf({ id: 'v', name: 'visitor' }).prop, 'none');
  SP.setCostumes({ forge: { hair: 4, outfit: 2, prop: 'glasses' } });
  const dressed = SP.lookOf(forge);
  assert.equal(dressed.hair, C.WARDROBE.hair[4]);
  assert.equal(dressed.shirt, C.WARDROBE.outfits[2].shirt);
  assert.equal(dressed.prop, 'glasses');
  assert.notEqual(dressed.sig, base.sig, 'the sprite cache key changes with the costume');
  assert.equal(SP.lookOf({ id: 'v', name: 'visitor' }).prop, 'none', 'visitors never pick up a costume');
  assert.equal(SP.lookOf(forge, { prop: 'tie' }).prop, 'tie', 'a preview costume wins over the saved one');
  SP.setCostumes({});
  assert.equal(SP.lookOf(forge).sig, base.sig);
});

test('every accessory and outfit draws', () => {
  const { C, SP, fills } = load();
  for (const prop of C.WARDROBE.props) for (let outfit = 0; outfit < C.WARDROBE.outfits.length; outfit++) for (const view of ['f', 'b']) {
    const before = fills.length;
    SP.get(SP.lookOf({ id: 'x', key: 'pixel', color: '#3dd6ff', accent: '#ff4d6d' }, { prop, outfit }), view, 'stand', 0, 1);
    assert.ok(fills.length > before, `${prop}/${outfit}/${view} drew pixels`);
  }
});

test('lookStore keeps other kiro.json settings, validates, resets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-')), file = path.join(dir, 'kiro.json');
  fs.writeFileSync(file, JSON.stringify({ agentNames: { tiro: 'Boss' }, workDir: 'x' }));
  const st = lookStore(file);
  assert.deepEqual(JSON.parse(JSON.stringify(st.set('ceo', { hair: 3, junk: 1 }))), { ceo: { hair: 3 } });
  st.set('it', { prop: 'headphones' });
  assert.throws(() => st.set('mallory', { hair: 1 }), /Unknown agent/);
  assert.throws(() => st.set('__proto__', { hair: 1 }), /Unknown agent/);
  st.set('ceo', null);
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(disk.looks, { it: { prop: 'headphones' } });
  assert.deepEqual(disk.agentNames, { tiro: 'Boss' });
  assert.equal(disk.workDir, 'x');
  fs.rmSync(dir, { recursive: true, force: true });
});
