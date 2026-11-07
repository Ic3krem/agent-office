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

const crisp = (dx, dy) => [['save'], ['=', 'imageSmoothingEnabled', false], ['drawImage', 'IMG', 1, 2, 20, 12, dx, dy, 20, 12], ['restore']];
const r2 = v => Math.round(v * 100) / 100;
test('the frame is drawn crisp with its anchor on the home point; a moved copy lands on whole pixels after the translate', () => {
  const w = boot({ image: IMG, frames: { tires: FRAME } }), F = w.OfficeFurniture;
  for (const [x, y] of [[1022, 760], [1034, 766]]) { // the anchor copy and the second copy (its own home)
    const p = F.P(x, y, 0);
    assert.deepEqual(draw(tiresAt(w, x, y)), crisp(Math.round(p[0] - 10), Math.round(p[1] - 8)));
  }
  F.place([{ id: 't', type: 'tires', x: 1062, y: 760 }]);
  const p = F.P(1022, 760, 0), tx = F.K * 40, ty = F.K2 * 40;
  const calls = draw(F.items[0]), dst = calls[3].slice(6, 8);
  assert.deepEqual(calls, [['translate', r2(tx), r2(ty)], ...crisp(r2(Math.round(p[0] - 10 + tx) - tx), r2(Math.round(p[1] - 8 + ty) - ty)), ['translate', r2(-tx), r2(-ty)]]);
  for (const [v, o] of [[dst[0], tx], [dst[1], ty]]) assert.ok(Math.abs(v + r2(o) - Math.round(v + o)) < 0.011, 'translate + destination is a whole pixel'); // r2 rounding only
  assert.deepEqual(J(F.footprints([{ id: 't', type: 'tires', x: 1062, y: 760 }])), [[1054, 752, 1070, 768]]);
});

// The atlas-missing fallback (golden): the piece's footprint geometry drawn as plain placeholder-grey boxes, the old art gone.
test('no frame for the type, or no atlas: the piece draws its geometry as plain placeholder boxes', () => {
  const a = boot(), b = boot({ image: IMG, frames: { other: FRAME } }), calls = draw(tiresAt(a, 1022, 760));
  assert.deepEqual(draw(tiresAt(b, 1022, 760)), calls);
  const styles = [...new Set(calls.filter(c => c[0] === '=' && /Style$/.test(c[1])).map(c => c[2]))].sort();
  assert.deepEqual(styles, ['rgb(122,125,131)', 'rgb(145,149,157)', 'rgb(162,166,175)', 'rgb(176,180,189)', 'rgb(196,201,211)', 'rgba(14,8,26,.38)'], 'placeholder greys and the edge only');
  assert.equal(calls.length, 38);
  assert.equal(hashLog(calls), '1fed0c2130c61db941efe56dc372c6f74c890328');  const Fa = a.OfficeFurniture, desk = Fa.parts(Fa.defaultInstances().find(p => p.id === 'desk-1'))[0].it;
  assert.ok(draw(desk).some(c => c[0] === 'fillText'), 'the live bits (name plate) still draw over the placeholder');
});

test('sprite() applies an optional alpha and reports a missing frame', () => {
  const w = boot({ image: IMG, frames: { tires: FRAME } }), F = w.OfficeFurniture, calls = [];
  assert.equal(F.sprite(recorder(calls), 'tires', 0, 0, 0.5), true);
  assert.deepEqual(calls.map(c => c[0]), ['save', '=', '=', 'drawImage', 'restore']);
  assert.equal(F.sprite(recorder([]), 'nope', 0, 0), false);
});

// ---------- the shipped office atlas (batch A: modern-cozy work furniture) ----------
const REAL = () => JSON.parse(fs.readFileSync(new URL('./public/art/office/atlas.json', import.meta.url), 'utf8'));
const BATCH_A = ['dept-desk', 'tiro-desk', 'tiro-chair', 'guest-chair', 'hot-desk', 'hot-chair', 'inbox', 'side-table', 'filing-cabinet',
  'bookshelf', 'server-rack', 'printer', 'recycling-bin', 'water-cooler', 'coffee-counter', 'trophy-shelf', 'plant', 'server-plant'];
const usesAtlas = calls => calls.some(c => c[0] === 'drawImage' && c[1] === 'IMG');

test('the shipped atlas changes no walk cell, footprint or depth order', () => {
  const a = boot(), b = boot({ image: IMG, frames: REAL().frames });
  const grid = w => Array.from(w.WorldModel.gridOf(w.WorldModel.defaultLayout()).blocked);
  assert.deepEqual(grid(b), grid(a));
  const fa = a.OfficeFurniture, fb = b.OfficeFurniture;
  assert.deepEqual(J(fb.footprints(fb.defaultInstances())), J(fa.footprints(fa.defaultInstances())));
  assert.deepEqual(J(fb.items.map(i => [i.d, i.fp])), J(fa.items.map(i => [i.d, i.fp])));
});

test('every batch A piece draws from a frame the shipped atlas has (default copies, desk variants, plant growth)', () => {
  const w = boot({ image: IMG, frames: REAL().frames }), F = w.OfficeFurniture;
  const inst = F.defaultInstances().filter(p => BATCH_A.includes(p.type));
  assert.deepEqual([...new Set(inst.map(p => p.type))].sort(), [...BATCH_A].sort());
  // every role's partition height on both desk rows
  for (const role of ['tally', 'atlas', 'pixel']) for (const y of [352, 516]) inst.push({ id: role + y, type: 'dept-desk', desk: 'desk-1', role, x: 155, y });
  for (const p of inst) for (const { it } of F.parts(p)) assert.ok(usesAtlas(draw(it)), p.id + ' draws its sprite');
  const sp = F.parts(inst.find(p => p.type === 'server-plant'))[0].it;
  for (let lv = 0; lv <= 6; lv++) { F.state.ex.plantLevel = lv; assert.ok(usesAtlas(draw(sp)), 'server plant level ' + lv); }
});

test('live bits stay procedural over the sprites', () => {
  const w = boot({ image: IMG, frames: REAL().frames }), F = w.OfficeFurniture, ST = F.state;
  const part = (id, i = 0) => F.parts(F.defaultInstances().find(p => p.id === id))[i].it;
  assert.ok(draw(part('desk-1')).some(c => c[0] === 'fillText'), 'desk name plate');
  const chair = draw(part('desk-1', 1));
  assert.ok(usesAtlas(chair) && chair.some(c => c[0] === 'fill' || c[0] === 'fillRect'), 'chair team accent');
  const n0 = draw(part('printer')).length; ST.printer = 2; assert.ok(draw(part('printer')).length > n0, 'printer paper'); ST.printer = 0;
  const c0 = draw(part('coffee-counter')).length; ST.ex.switches = { espresso: true }; assert.ok(draw(part('coffee-counter')).length > c0, 'coffee steam');
  const t0 = draw(part('trophy-shelf')); assert.ok(t0.some(c => c[0] === 'fillText'), 'goals plaque');
  const i0 = draw(part('inbox')).length; ST.ex.pending = 2; assert.ok(draw(part('inbox')).length > i0, 'inbox paper');
});

// ---------- batch B: play, lounge and break pieces (the karinderya and broom corner are built at their anchors) ----------
const BATCH_B = ['arcade', 'arcade-race', 'jukebox', 'sofa3', 'snack-table', 'beanbag', 'ball-pit', 'hoop', 'dartboard', 'toy-bin', 'karinderya', 'broom-corner'];
const withB = F => { const inst = F.defaultInstances().filter(p => BATCH_B.includes(p.type));
  for (const t of ['karinderya', 'broom-corner']) inst.push({ id: t, type: t, x: F.CATALOG[t].anchor[0], y: F.CATALOG[t].anchor[1] });
  return inst; };

test('every batch B part draws from a frame the shipped atlas has, with unchanged footprints and depths', () => {
  const a = boot(), b = boot({ image: IMG, frames: REAL().frames }), Fa = a.OfficeFurniture, Fb = b.OfficeFurniture, inst = withB(Fb);
  assert.deepEqual([...new Set(inst.map(p => p.type))].sort(), [...BATCH_B].sort());
  for (const p of inst) Fb.parts(p).forEach(({ it }, i) => assert.ok(usesAtlas(draw(it)), p.id + '.' + i + ' draws its sprite'));
  assert.equal(Fb.parts(inst.find(p => p.type === 'karinderya')).length, 14, 'all karinderya parts');
  const shape = F => J(withB(F).map(p => F.parts(p).map(({ it, rec }) => [it.d, it.fp, rec, !!it.o.floor, !!it.o.nofp])));
  assert.deepEqual(shape(Fb), shape(Fa));
});

test('batch B live bits stay procedural over the sprites', () => {
  const w = boot({ image: IMG, frames: REAL().frames }), F = w.OfficeFurniture, ST = F.state;
  const kar = F.parts({ id: 'karinderya', type: 'karinderya', x: 1010, y: 370 }).map(q => q.it);
  const part = id => F.parts(F.defaultInstances().find(p => p.id === id))[0].it;
  const at = (it, T) => { ST.T = T; return JSON.stringify(draw(it)); };
  for (const [name, it] of [['arcade attract mode', part('arcade')], ['pugon fire', kar[3]], ['counter fan', kar[4]], ['cat tail', kar[13]]])
    assert.notEqual(at(it, 0.1), at(it, 0.9), name + ' moves with time');
  ST.ex.music = 0; const quiet = draw(part('jukebox')); ST.ex.music = 1; const loud = draw(part('jukebox'));
  assert.ok(loud.some(c => c[0] === 'fillText') && !quiet.some(c => c[0] === 'fillText'), 'jukebox notes follow the music'); ST.ex.music = 0;
  assert.ok(draw(kar[1]).some(c => c[0] === 'fillText'), 'karinderya sign lettering');
  assert.ok(draw(kar[6]).filter(c => c[0] === 'ellipse').length >= 9, 'plates and food on the long table');
});

// ---------- batch C: garden, utility, glass and doors ----------
const BATCH_C = ['pond', 'pond-east', 'bench', 'bench-side', 'tree', 'bird-feeder', 'hedge', 'fence', 'gate', 'lamp-post', 'garage', 'mail-bench',
  'mailbox', 'tires', 'picnic-table', 'glass-x', 'glass-y', 'office-door'];
const withC = F => F.defaultInstances().filter(p => BATCH_C.includes(p.type));

test('every batch C part draws from a frame the shipped atlas has, with unchanged footprints and depths', () => {
  const a = boot(), b = boot({ image: IMG, frames: REAL().frames }), Fa = a.OfficeFurniture, Fb = b.OfficeFurniture, inst = withC(Fb);
  assert.deepEqual([...new Set(inst.map(p => p.type))].sort(), [...BATCH_C].sort());
  for (const p of inst) Fb.parts(p).forEach(({ it }, i) => assert.ok(usesAtlas(draw(it)), p.id + '.' + i + ' draws its sprite'));
  const shape = F => J(withC(F).map(p => F.parts(p).map(({ it, rec }) => [it.d, it.fp, rec, !!it.o.floor, !!it.o.nofp])));
  assert.deepEqual(shape(Fb), shape(Fa));
});

test('batch C live bits stay procedural over the sprites', () => {
  const w = boot({ image: IMG, frames: REAL().frames }), F = w.OfficeFurniture, ST = F.state;
  const part = (id, i = 0) => F.parts(F.defaultInstances().find(p => p.id === id))[i].it;
  const at = (it, T) => { ST.T = T; return JSON.stringify(draw(it)); };
  for (const id of ['pond', 'pond-east', 'bird-feeder']) assert.notEqual(at(part(id), 0.1), at(part(id), 0.9), id + ' moves with time');
  ST.night = 0; const day = JSON.stringify(draw(part('lamp-post-1'))); ST.night = 1;
  assert.notEqual(JSON.stringify(draw(part('lamp-post-1'))), day, 'lamp-post light follows the night'); ST.night = 0;
  assert.ok(draw(part('office-door', 1)).some(c => c[0] === 'fillText'), 'office door sign');
  ST.ex.scheduler = null; const g0 = draw(part('garage')), m0 = JSON.stringify(draw(part('mailbox'))), s0 = JSON.stringify(draw(part('mail-bench')));
  assert.ok(g0.some(c => c[0] === 'fillText'), 'garage status screen');
  ST.ex.scheduler = { present: true, itemsFound: 2, lastCheck: new Date().toISOString() };
  assert.notEqual(JSON.stringify(draw(part('mailbox'))), m0, 'mailbox flag goes up');
  assert.notEqual(JSON.stringify(draw(part('mail-bench'))), s0, 'mail-bench screen follows the scheduler');
  ST.ex.scheduler = null;
});

test('wall fixtures draw their sprite base and keep text, switches and clock hands live', () => {
  const names = ['wall-today', 'wall-usage', 'wall-whiteboard', 'wall-clock', 'wall-cork', 'wall-breaker'];
  const run = atlas => {
    const w = loadWorld({ ctxFactory: () => recorder([]) }), F = w.OfficeFurniture, calls = [];
    if (atlas) F.useAtlas({ image: IMG, frames: Object.fromEntries(names.map(n => [n, FRAME])) });
    F.state.ex.switches = { kiro: false }; for (const p of F.walls) p(recorder(calls));
    return calls;
  };
  const has = (c, k, ...a) => c.some(x => x[0] === k && a.every((v, i) => x[i + 1] === v));
  const art = run(true), drawn = run(false);
  assert.equal(art.filter(c => c[0] === 'drawImage').length, names.length, 'one base sprite per fixture');
  for (const c of [art, drawn]) {
    for (const t of ['TODAY  0/0 done', 'USAGE · TODAY', '0 notes', 'Focus first.']) assert.ok(has(c, 'fillText', t), t);
    assert.ok(has(c, '=', 'fillStyle', '#e0573f'), 'a switch that is off is red');
    assert.ok(c.filter(x => x[0] === 'stroke').length >= 2, 'clock hands');
  }
  assert.ok(has(drawn, 'fillRect', -3, -3, 186, 78) && !has(art, 'fillRect', -3, -3, 186, 78), 'the Today board frame comes from the sprite');
  assert.ok(has(drawn, 'arc', 0, 0, 20, 0, 6.28) && !has(art, 'arc', 0, 0, 20, 0, 6.28), 'the clock case comes from the sprite');
});
