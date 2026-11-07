import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
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

// Height (task 8): pixel rows, never scaling. A recording canvas keeps every pixel fill per sprite.
function loadPx() {
  const ops = [];
  const document = { createElement: () => ({ width: 0, height: 0, getContext() { let s; return { set fillStyle(v) { s = v; }, fillRect(x, y) { ops.push(x + ',' + y + ',' + s); } }; } }) };
  const box = { document };
  for (const f of ['role-catalog.js', 'office-sprites.js']) vm.runInNewContext(fs.readFileSync(new URL('./public/' + f, import.meta.url), 'utf8'), box, { filename: f });
  return { C: box.RoleCatalog, SP: box.OfficeSprites, ops };
}
const forgeA = { id: 'a1', key: 'forge', color: '#c0392b', accent: '#f1c40f' };

test('cleanCostume keeps a known height and drops anything else', () => {
  const { C } = load();
  for (const h of ['short', 'average', 'tall']) assert.deepEqual({ ...C.cleanCostume({ hair: 1, height: h }) }, { hair: 1, height: h });
  for (const bad of ['giant', 'Tall', 2, null, ['tall'], { v: 'tall' }]) assert.deepEqual({ ...C.cleanCostume({ hair: 1, height: bad }) }, { hair: 1 });
  assert.deepEqual({ ...C.cleanCostume({ height: 'tall' }) }, { height: 'tall' });
  assert.deepEqual(JSON.parse(JSON.stringify(C.cleanLooks({ it: { height: 'short', junk: 1 } }))), { it: { height: 'short' } });
});

test('height joins the sprite cache key; average and no height share it', () => {
  const { SP } = load();
  const sig = c => SP.lookOf(forgeA, c).sig;
  assert.notEqual(sig({ hair: 1, height: 'tall' }), sig({ hair: 1 }));
  assert.notEqual(sig({ hair: 1, height: 'short' }), sig({ hair: 1, height: 'tall' }));
  assert.equal(sig({ hair: 1, height: 'average' }), sig({ hair: 1 }));
  assert.equal(SP.lookOf({ id: 'v', name: 'visitor' }, undefined).height, 'average', 'visitors stay average');
});

test('short and tall are 2 pixel rows shorter or taller with the feet on the same ground row', () => {
  const { SP } = loadPx();
  for (const pose of ['stand', 'walk', 'sit-front', 'type', 'hand'])
    for (const view of ['f', 'b']) for (const frame of [0, 1, 2]) {
      const sizes = ['short', 'average', 'tall'].map(height => ({ s: SP.get(SP.lookOf(forgeA, { height }), view, pose, frame, 1) }));
      assert.deepEqual(sizes.map(o => o.s.h), [SP.H - 2, SP.H, SP.H + 2], `${pose}/${view}/${frame} canvas rows`);
      assert.deepEqual(sizes.map(o => o.s.cv.height), [SP.H - 2, SP.H, SP.H + 2]);
      assert.deepEqual(sizes.map(o => o.s.w), [SP.W, SP.W, SP.W], 'never wider: no scaling');
    }
  // opaque extent per height, measured from the fills of a fresh cache
  const ext = height => {
    const { SP: S, ops } = loadPx();
    const s = S.get(S.lookOf(forgeA, { height }), 'f', 'stand', 0, 1), ys = ops.map(o => +o.split(',')[1]);
    return { top: Math.min(...ys) - (s.h - S.H), feet: Math.max(...ys) - (s.h - S.H) }; // in average-sprite rows, anchored at the feet
  };
  const [sh, av, ta] = ['short', 'average', 'tall'].map(ext);
  assert.equal(sh.feet, av.feet); assert.equal(ta.feet, av.feet);
  assert.equal(sh.top, av.top + 2); assert.equal(ta.top, av.top - 2);
  assert.ok(ta.top + 2 >= 0, 'nothing above the canvas: the head is not clipped');
});

test('a costume saved before heights (and visitors, the CEO) render byte-identical to before', () => {
  const { SP, ops } = loadPx();
  for (const look of [SP.lookOf(forgeA), SP.lookOf(forgeA, { hair: 4, outfit: 2, prop: 'scarf' }), SP.lookOf({ look: 'ceo' })])
    for (const pose of ['stand', 'walk', 'sit-front', 'type', 'hand', 'celebrate']) for (const view of ['f', 'b']) for (const fr of [0, 1, 2]) { ops.push('|'); SP.get(look, view, pose, fr, 1); }
  // golden: sha256 of the fills at 4642d87, before heights existed
  assert.equal(crypto.createHash('sha256').update(ops.join(';')).digest('hex'), '93f5a4178593e1c3211aedaa8db1c35e275df980484ac56887357aef4413a43f');
});

test('party looks from a friend never carry a height', async () => {
  const { cleanLooks } = await import('./party/protocol.mjs');
  assert.deepEqual(cleanLooks({ forge: { hair: 1, height: 'tall' } }), { forge: { hair: 1 } });
});

test('lookStore (the /api/looks/set path) saves a valid height and drops a bad one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-h-')), st = lookStore(path.join(dir, 'kiro.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(st.set('it', { height: 'tall', hair: 2 }))), { it: { height: 'tall', hair: 2 } });
  assert.deepEqual(JSON.parse(JSON.stringify(st.set('it', { height: '<b>huge</b>' }))), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
