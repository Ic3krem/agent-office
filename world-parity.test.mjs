import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordOffice, recorder } from './world-golden.mjs';
import { loadWorld } from './world-vm.mjs';

const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/office-golden.json', import.meta.url), 'utf8'));
const pick = a => a.map(i => ({ d: i.d, fp: i.fp, log: i.log }));
const norm = a => pick(a).sort((a, b) => a.d - b.d || (a.log < b.log ? -1 : a.log > b.log ? 1 : 0));

test('static office draws exactly as 1.2.9', () => {
  const now = JSON.parse(JSON.stringify(recordOffice()));
  assert.deepEqual(pick(now.items), pick(gold.items)); // draw order is exact, not just the set of draws
  assert.deepEqual(now.objects, gold.objects);
  assert.deepEqual(now.spots, gold.spots);
});

// office-world.js runs OfficeFurniture.measure, which fills derived footprints the fixture (recorded without it) lacks:
// draw logs and depths must equal the fixture, footprints must equal a fresh boot of the same scripts.
test('applyLayout(defaultLayout()) keeps the golden scene', () => {
  const rec = prep => JSON.parse(JSON.stringify(recordOffice({ extra: ['office-world.js'], prep })));
  const boot = rec(), now = rec(w => w.OfficeWorld.applyLayout(w.WorldModel.defaultLayout()));
  const drawn = a => norm(a).map(i => ({ d: i.d, log: i.log }));
  assert.deepEqual(drawn(now.items), drawn(gold.items));
  assert.deepEqual(norm(now.items), norm(boot.items));
  assert.deepEqual(now.objects, gold.objects);
  assert.deepEqual(now.spots, gold.spots);
});

test('applyLayout moves desks in furniture, motion and click areas', () => {
  const w = loadWorld({ extra: ['office-world.js'] }), OW = w.OfficeWorld, L = w.WorldModel.defaultLayout();
  const hot = () => OW.hotspots().find(h => h.id === 'desk-1');
  const l0 = hot().l, d0 = w.OfficeFurniture.items.map(i => i.d).sort((a, b) => a - b);
  L.objects.find(o => o.id === 'desk-1').x += 40;
  OW.applyLayout(L);
  assert.equal(w.OfficeMotion.SPOTS['desk-1'].x, 195);
  assert.ok(hot().l > l0, 'click area follows the desk');
  assert.notDeepEqual(w.OfficeFurniture.items.map(i => i.d).sort((a, b) => a - b), d0);
});

test('applyLayout snaps a seated character to its desk at the new place', () => {
  const w = loadWorld({ extra: ['office-world.js'], globals: { OfficeSprites: { lookOf: () => ({}), W: 32, H: 48 } } });
  w.document.documentElement = { dataset: {} };
  const OW = w.OfficeWorld, L = w.WorldModel.defaultLayout(), at = () => OW.debug().agents.find(a => a.spot === 'desk-1');
  OW.setDemo('work'); OW.advance(20);
  assert.equal(at().x, 155);
  L.objects.find(o => o.id === 'desk-1').x += 40;
  OW.applyLayout(L); OW.advance(0.1);
  assert.equal(at().x, 195);
});

test('a piece placed 40 units east draws translated and shifts its footprint', () => {
  const calls = [];
  const w = loadWorld({ ctxFactory: () => ({}) }), F = w.OfficeFurniture;
  const [ax, ay] = F.CATALOG.bench.anchor;
  F.place([{ id: 'b', type: 'bench', x: ax, y: ay }]);
  const d0 = F.items[0].d, fp0 = JSON.parse(JSON.stringify(F.footprints([{ id: 'b', type: 'bench', x: ax, y: ay }])));
  F.place([{ id: 'b', type: 'bench', x: ax + 40, y: ay }]);
  assert.equal(F.items.length, 1);
  assert.equal(F.items[0].d, d0 + 40);
  const fp1 = JSON.parse(JSON.stringify(F.footprints([{ id: 'b', type: 'bench', x: ax + 40, y: ay }])));
  assert.ok(fp0.length > 0);
  assert.deepEqual(fp1, fp0.map(q => [q[0] + 40, q[1], q[2] + 40, q[3]]));
  F.items[0].fn(recorder(calls));
  assert.deepEqual(calls[0], ['translate', 28.28, 14.14]);
});

test('catalog spots reproduce the 1.2.9 spots they own', () => {
  const w = loadWorld({ ctxFactory: () => ({}) }), F = w.OfficeFurniture;
  const own = JSON.parse(JSON.stringify(F.spotsOf(F.defaultInstances())));
  assert.ok(Object.keys(own).length > 0);
  for (const id of Object.keys(own)) assert.deepEqual(own[id], gold.spots[id], id);
});

test('default footprints block whole pieces but keep the gate, door and hedge gaps open', () => {
  const F = loadWorld({ ctxFactory: () => ({}) }).OfficeFurniture, inst = F.defaultInstances();
  const fps = JSON.parse(JSON.stringify(F.footprints(inst)));
  const covers = (q, r) => q[0] <= r[0] && q[1] <= r[1] && q[2] >= r[2] && q[3] >= r[3];
  assert.ok(fps.some(q => covers(q, [1068, 704, 1140, 730])), 'mail bench');
  for (const [x, y] of [[1000, 396], [420, 230], [500, 230]]) assert.ok(!fps.some(q => q[0] < x && x < q[2] && q[1] < y && y < q[3]), x + ',' + y);
  const walk = inst.filter(p => F.CATALOG[p.type].walkable);
  assert.ok(walk.some(p => p.type === 'ball-pit'));
  assert.equal(F.footprints(walk).length, 0);
  const pit = gold.spots['play:pit'];
  assert.ok(!fps.some(q => q[0] < pit.x && pit.x < q[2] && q[1] < pit.y && pit.y < q[3]), 'play:pit');
});

// ---- floors follow layout zones ----
import { hashLog } from './world-golden.mjs';
const bakeLog = (w) => { const calls = []; w.OfficeFurniture.state.night = 0; w.OfficeFurniture.bake(recorder(calls)); return calls; };

test('bake with default zones is unchanged', () => {
  const w = loadWorld(), before = hashLog(bakeLog(w));
  w.OfficeFurniture.setZones(w.WorldModel.defaultLayout().zones);
  assert.equal(hashLog(bakeLog(w)), before);
  assert.ok(w.WorldModel.isDefaultZones(w.WorldModel.defaultLayout().zones));
  const z = w.WorldModel.defaultLayout().zones; z[0].rect[2] += 10;
  assert.ok(!w.WorldModel.isDefaultZones(z));
});

test('without the office art, bake still draws the 1.2.9 floor and walls (draw-log pin)', () => {
  const calls = bakeLog(loadWorld());
  assert.equal(calls.length, 3670);
  assert.equal(hashLog(calls), '6e7a22f9c25e593d6924cfc3810085866ffc7978');
});

// ---- the office art room shell (floor tiles, wall strips) ----
const KINDS = ['wood', 'carpet', 'grass', 'concrete', 'asphalt', 'pavers', 'water', 'rug', 'terracotta'];
const SHELL = Object.fromEntries([...KINDS.map(k => ['floor@' + k, { x: 0, y: 0, w: 128, h: 64, ax: 64, ay: 32 }]),
  ['wall@x', { x: 0, y: 100, w: 560, h: 440, ax: 8, ay: 10, glow: true }], ['wall@y', { x: 0, y: 600, w: 890, h: 600, ax: 10, ay: 12, glow: true }]]);
const shellWorld = () => { const w = loadWorld({ ctxFactory: () => recorder([]) }); w.OfficeFurniture.useAtlas({ image: { tag: 'IMG' }, glow: { tag: 'GLOW' }, frames: SHELL }); return w; };
// the polygon each pattern fill paints: the moveTo/lineTo run that the fill closes
const patternFills = calls => calls.flatMap((c, i) => {
  if (c[0] !== 'fill' || !calls.slice(Math.max(0, i - 4), i).some(a => a[0] === '=' && a[1] === 'fillStyle' && a[2] === 'pattern')) return [];
  let k = i; while (k > 0 && calls[k][0] !== 'moveTo') k--;
  return [calls.slice(k, i).filter(a => a[0] === 'moveTo' || a[0] === 'lineTo').map(a => [a[1], a[2]])];
});

test('with the office art, bake fills every default zone with one pattern clipped to its frozen floor polygon', () => {
  const want = JSON.parse(fs.readFileSync(new URL('./fixtures/office-bake-golden.json', import.meta.url), 'utf8')).zones;
  for (const zones of [null, 'default']) {
    const w = shellWorld(), F = w.OfficeFurniture, Z = w.WorldModel.defaultLayout().zones;
    if (zones) F.setZones(Z);
    const fills = patternFills(bakeLog(w));
    assert.equal(fills.length, Z.length, 'one pattern fill per zone');
    Z.forEach((q, i) => { if (q.type !== 'water') assert.deepEqual(fills[i], want[q.id], q.id); });
  }
});

test('with the office art, bake draws both wall strips, and lays the glow sheet over them after dusk', () => {
  const w = shellWorld(), F = w.OfficeFurniture, img = c => c.filter(a => a[0] === 'drawImage').map(a => a[1] + ' ' + a[3]);
  const day = bakeLog(w);
  assert.deepEqual(img(day), ['IMG 600', 'IMG 100'], 'wall@y then wall@x, no glow by day');
  assert.ok(!day.some(a => a[0] === 'createLinearGradient'), 'no procedural wall or window gradients');
  const calls = [], ctx = recorder(calls); ctx.globalAlpha = 1; F.state.night = .6; F.bake(ctx);
  assert.deepEqual(img(calls), ['IMG 600', 'GLOW 600', 'IMG 100', 'GLOW 100']);
  const i = calls.findIndex(a => a[0] === 'drawImage' && a[1] === 'GLOW');
  assert.ok(calls.slice(i - 3, i).some(a => a[0] === '=' && a[1] === 'globalAlpha'), 'glow fades in with the night'); // (the recorder has no save/restore, so the value is not checked)
});

test('with the office art, paths are pavers in the garden and only a faint borderless tint indoors; the left-wall prints stay', () => {
  const w = shellWorld(), F = w.OfficeFurniture, Z = w.WorldModel.defaultLayout().zones, calls = bakeLog(w);
  const alphas = calls.filter((a, i) => a[0] === '=' && a[1] === 'globalAlpha' && calls.slice(i, i + 12).some(b => b[0] === '=' && b[1] === 'fillStyle' && b[2] === 'pattern')).map(a => a[2]);
  const inside = (q, t) => Z.some(z => z.type === t && z.rect[0] <= (q.rect[0] + q.rect[2]) / 2 && (q.rect[0] + q.rect[2]) / 2 <= z.rect[2] && z.rect[1] <= (q.rect[1] + q.rect[3]) / 2 && (q.rect[1] + q.rect[3]) / 2 <= z.rect[3]);
  const indoor = Z.filter(q => q.type === 'path' && !inside(q, 'garden'));
  assert.ok(indoor.length > 10 && Z.some(q => q.type === 'path' && inside(q, 'garden')));
  assert.equal(alphas.filter(a => a === .15).length, indoor.length, 'one faint fill per indoor path');
  const borders = calls.filter(a => a[0] === 'fillRect' && (a[3] === 1 || a[4] === 1)).length;
  assert.equal(borders, 4 * Z.filter(q => q.type !== 'water' && !indoor.includes(q)).length, '1-unit borders, none on indoor paths');
  assert.ok(calls.some(a => a[0] === 'fillRect' && a[1] === 8 && a[3] === 50 && a[4] === 40), 'framed prints on the left wall');
});

test('floor patterns are made once per atlas, and every zone type has a tile', () => {
  const w = shellWorld(), F = w.OfficeFurniture, made = c => c.filter(a => a[0] === 'createPattern').length;
  assert.equal(made(bakeLog(w)), 7, 'the default layout uses wood, grass, asphalt, water, concrete, carpet and pavers');
  assert.equal(made(bakeLog(w)), 0, 'a second bake reuses them');
  for (const type of w.WorldModel.ZONE_TYPES) {
    F.setZones([{ id: 'z', type, rect: [100, 100, 300, 300] }]);
    assert.equal(patternFills(bakeLog(w)).length, 1, type);
  }
});

test('bake paints custom zones', () => {
  const w = loadWorld(), F = w.OfficeFurniture, strokes = c => c.filter(a => a[0] === 'stroke').length;
  const before = bakeLog(w);
  F.setZones([{ id: 'a', type: 'focus', rect: [0, 0, 400, 400] }]);
  const now = bakeLog(w), P = F.P;
  const want = [P(0, 0, 0), P(400, 0, 0), P(400, 400, 0), P(0, 400, 0)].map(p => p.map(v => Math.round(v * 100) / 100));
  const i = now.findIndex((a, k) => a[0] === 'moveTo' && now[k + 4] && now[k + 4][0] === 'closePath' && want.every((p, j) => now[k + j][1] === p[0] && now[k + j][2] === p[1]));
  assert.ok(i >= 0 && now.slice(i + 5, i + 8).some(a => a[0] === 'fill'), 'zone rect polygon is filled');
  assert.ok(strokes(now) < strokes(before), 'no 1.2.9 office planks');
});

test('bake with a zone removed still paints a base floor under every zone', () => {
  const w = loadWorld(), F = w.OfficeFurniture, P = F.P;
  F.setZones(w.WorldModel.defaultLayout().zones.filter(q => q.type !== 'focus'));
  const now = bakeLog(w), r2 = v => Math.round(v * 100) / 100;
  const corners = [P(0, 0, 0), P(1240, 0, 0), P(1240, 780, 0), P(0, 780, 0)].map(p => p.map(r2));
  const i = now.findIndex((a, k) => a[0] === 'moveTo' && corners.every((p, j) => now[k + j] && now[k + j][1] === p[0] && now[k + j][2] === p[1]));
  assert.ok(i >= 0 && now.slice(i + 5, i + 8).some(a => a[0] === 'fill'), 'whole-world floor is filled');
});

test('drawing a desk for every new role does not throw', () => {
  const w = loadWorld({ ctxFactory: () => recorder([]) }), F = w.OfficeFurniture, M = w.OfficeMotion;
  const roles = ['it', 'accounting', 'marketing', 'auditor', 'notetaker'];
  const L = w.WorldModel.defaultLayout();
  roles.forEach((role, i) => L.objects.push({ id: 'desk-' + (9 + i), type: 'dept-desk', desk: 'desk-' + (9 + i), role, x: 100 + i * 180, y: 700 }));
  M.useLayout(L);
  F.place(L.objects);
  for (const it of F.items) it.fn(recorder([]));
  const labels = F.objects.filter(o => o.key === 'desk').map(o => o.label);
  for (const n of ['Byte', 'Ledger', 'Spark', 'Vera', 'Memo']) assert.ok(labels.includes(n + "'s desk"), n);
});

test('a role without its own painter gets the generic laptop desk', () => {
  const w = loadWorld({ ctxFactory: () => recorder([]) }), F = w.OfficeFurniture, M = w.OfficeMotion;
  w.RoleCatalog.ROLES.push({ key: 'chef', name: 'Chef', role: 'Cook', kind: 'ops', model: 'haiku', color: '#aa5533', accent: '#ffccaa', props: 'chef' });
  const L = w.WorldModel.defaultLayout();
  L.objects.push({ id: 'desk-9', type: 'dept-desk', desk: 'desk-9', role: 'chef', x: 1120, y: 500 });
  M.useLayout(L);
  F.place(L.objects);
  for (const it of F.items) it.fn(recorder([]));
  assert.ok(F.objects.some(o => o.label === "Chef's desk"));
});
