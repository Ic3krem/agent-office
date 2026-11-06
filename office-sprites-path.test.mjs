import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';
import { recorder, hashLog } from './world-golden.mjs';
import { freeze, serialize } from './scripts/freeze-footprints.mjs';

const J = v => JSON.parse(JSON.stringify(v));
const IMG = { tag: 'IMG' }, FRAME = { x: 1, y: 2, w: 20, h: 12, ax: 10, ay: 8 };
// A world booted with the default layout, measured (footprints derived from the painters), optionally with an atlas.
function boot(atlas) {
  const w = loadWorld({ ctxFactory: () => recorder([]) }), F = w.OfficeFurniture;
  if (atlas) F.useAtlas(atlas);
  F.place(F.defaultInstances()); F.measure(w.document);
  return w;
}
const draw = it => { const calls = []; it.fn(recorder(calls)); return calls; };
const tiresAt = (w, x, y) => w.OfficeFurniture.items.find(i => i.d === x + y);

test('office-footprints.json is what freeze-footprints.mjs produces today', () => {
  assert.equal(fs.readFileSync(new URL('./fixtures/office-footprints.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), serialize(freeze()));
});

test('a sprite frame changes no footprint, walk cell or depth order', () => {
  const a = boot(), b = boot({ image: IMG, frames: { tires: FRAME } });
  const grid = w => Array.from(w.WorldModel.gridOf(w.WorldModel.defaultLayout()).blocked);
  assert.deepEqual(grid(b), grid(a));
  const fa = a.OfficeFurniture, fb = b.OfficeFurniture;
  assert.deepEqual(J(fb.footprints(fb.defaultInstances())), J(fa.footprints(fa.defaultInstances())));
  assert.deepEqual(J(fb.items.map(i => [i.d, i.fp])), J(fa.items.map(i => [i.d, i.fp])));
});

test('the frame is drawn with its anchor on the home point; a moved copy draws through the translate', () => {
  const w = boot({ image: IMG, frames: { tires: FRAME } }), F = w.OfficeFurniture;
  for (const [x, y] of [[1022, 760], [1034, 766]]) { // the anchor copy and the second copy (its own home)
    const p = F.P(x, y, 0);
    assert.deepEqual(draw(tiresAt(w, x, y)), [['drawImage', 'IMG', 1, 2, 20, 12, Math.round(p[0] - 10), Math.round(p[1] - 8), 20, 12]]);
  }
  F.place([{ id: 't', type: 'tires', x: 1062, y: 760 }]);
  const p = F.P(1022, 760, 0);
  assert.deepEqual(draw(F.items[0]), [['translate', 28.28, 14.14], ['drawImage', 'IMG', 1, 2, 20, 12, Math.round(p[0] - 10), Math.round(p[1] - 8), 20, 12], ['translate', -28.28, -14.14]]);
  assert.deepEqual(J(F.footprints([{ id: 't', type: 'tires', x: 1062, y: 760 }])), [[1054, 752, 1070, 768]]);
});

test('no frame for the type, or no atlas: the procedural painter draws exactly as before', () => {
  const a = boot(), b = boot({ image: IMG, frames: { other: FRAME } });
  assert.equal(hashLog(draw(tiresAt(b, 1022, 760))), hashLog(draw(tiresAt(a, 1022, 760))));
  assert.ok(draw(tiresAt(a, 1022, 760)).some(c => c[0] === 'fillRect'));
});

test('sprite() applies an optional alpha and reports a missing frame', () => {
  const w = boot({ image: IMG, frames: { tires: FRAME } }), F = w.OfficeFurniture, calls = [];
  assert.equal(F.sprite(recorder(calls), 'tires', 0, 0, 0.5), true);
  assert.deepEqual(calls.map(c => c[0]), ['save', '=', 'drawImage', 'restore']);
  assert.equal(F.sprite(recorder([]), 'nope', 0, 0), false);
});
