import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorldStore, parseScene } from './world-store.mjs';
import { loadWorld } from './world-vm.mjs';
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });

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

test('versions are per scene: a kain save leaves the office version alone', () => {
  const s = createWorldStore(tmp());
  assert.equal(s.save(s.load('kain').layout, 'kain').ok, true);
  assert.deepEqual([s.version(), s.version('office'), s.version('kain'), s.version('games')], [0, 0, 1, 0]);
  assert.equal(s.save(s.load().layout).ok, true);
  assert.deepEqual([s.version(), s.version('kain')], [1, 1]);
});

test('a missing interior template: one clear error, an empty interior with a door and a spawn, never the office', (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  const s = createWorldStore(tmp(), { builtinDir: tmp() });
  const r = s.load('games');
  assert.equal(r.layout.scene, 'games');
  assert.deepEqual(r.layout.objects, []);
  assert.ok(r.layout.spots.some((q) => q.id === 'door'));
  assert.ok(r.layout.spawn);
  assert.equal(r.source, 'default');
  s.load('games');
  assert.equal(logged.length, 1, 'logged once');
  assert.match(logged[0], /interior-games\.json/);
  const W = loadWorld({ ctxFactory: () => noop }).WorldModel;
  assert.equal(W.validate(JSON.parse(JSON.stringify(r.layout))).ok, true);
});

// ---------- town step 3: the playroom and garden leave the office (layout.v1.json keeps the old file) ----------
const VW = loadWorld({ ctxFactory: () => noop }), WMv = VW.WorldModel, OMv = VW.OfficeMotion;
const Jv = (v) => JSON.parse(JSON.stringify(v));
const PLAYROOM = ['arcade', 'arcade-race', 'jukebox', 'sofa3', 'snack-table', 'beanbag', 'ball-pit', 'hoop', 'dartboard', 'toy-bin'];
const inGarden = (l, o) => l.zones.some((q) => q.type === 'garden' && o.x >= q.rect[0] && o.x <= q.rect[2] && o.y >= q.rect[1] && o.y <= q.rect[3]);
const moved = (l, o) => [...PLAYROOM, 'pond', 'pond-east'].includes(o.type) || (['tree', 'bench', 'bench-side'].includes(o.type) && inGarden(l, o));
// A layout saved before step 3: today's default as it was written to disk.
const oldOffice = (d, l = Jv(WMv.defaultLayout())) => { const text = JSON.stringify(l, null, 1); fs.writeFileSync(path.join(d, 'layout.json'), text); return { l, text }; };

test('migration: a saved default layout loses the playroom and garden pieces and their spots; desks and the rest stay; it validates', () => {
  const d = tmp(), { l, text } = oldOffice(d), r = createWorldStore(d).load();
  assert.equal(r.source, 'file');
  assert.equal(r.layout.migrated, 2);
  assert.deepEqual(r.layout.objects, l.objects.filter((o) => !moved(l, o)), 'exactly the moved pieces are gone, nothing else changed');
  assert.ok(l.objects.filter((o) => moved(l, o)).length >= 25, 'the default had a playroom and a garden');
  assert.deepEqual(r.layout.objects.filter((o) => o.type === 'dept-desk'), l.objects.filter((o) => o.type === 'dept-desk'), 'every desk kept');
  for (const keep of ['tiro-desk', 'tiro-chair', 'water-cooler', 'coffee-counter', 'hot-desk-1', 'hedge-1', 'plant-2', 'garage', 'mailbox', 'pennants']) assert.ok(r.layout.objects.some((o) => o.id === keep), keep);
  const zoneGone = (q) => q.type === 'play' || q.type === 'garden' || (q.type === 'water' && (q.id === 'pond' || q.id === 'pond-east'));
  assert.deepEqual(r.layout.zones, l.zones.filter((q) => !zoneGone(q)), 'playroom, garden and pond-water zones go; the rest stay');
  const g = WMv.gridOf(Jv(r.layout)), reach = VW.WorldPath.reachFrom(g, r.layout.spawn);
  for (const p of [{ x: 790, y: 105 }, { x: 1120, y: 290 }]) assert.ok(!g.blocked[VW.WorldPath.cellOf(g, p)] && reach(p), 'the old pond area is walkable: ' + p.x + ',' + p.y);
  const spots = WMv.spotsOf(Jv(r.layout));
  assert.deepEqual([...OMv.PLAY, ...OMv.GARDEN].filter((id) => spots[id]), [], 'their spots moved with them');
  for (const id of WMv.requiredSpots(Jv(r.layout))) assert.ok(spots[id], 'required ' + id);
  assert.deepEqual(Jv(WMv.validate(Jv(r.layout))), { ok: true, errors: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'layout.json'), 'utf8')), r.layout, 'written back');
  assert.equal(fs.readFileSync(path.join(d, 'layout.v1.json'), 'utf8'), text, 'layout.v1.json is byte-identical to the old file');
  assert.deepEqual(fs.readdirSync(d).sort(), ['layout.json', 'layout.v1.json'], 'no tmp left, no games.json');
});

test('migration: a second load is a no-op; a migrated layout with its own playroom is never touched', () => {
  const d = tmp(), f = path.join(d, 'layout.json'), v1 = path.join(d, 'layout.v1.json');
  oldOffice(d); const first = createWorldStore(d).load();
  const after = fs.readFileSync(f, 'utf8'), backup = fs.readFileSync(v1, 'utf8'), mt = fs.statSync(f).mtimeMs;
  assert.deepEqual(createWorldStore(d).load(), first);
  assert.equal(fs.readFileSync(f, 'utf8'), after);
  assert.equal(fs.statSync(f).mtimeMs, mt, 'not rewritten');
  assert.equal(fs.readFileSync(v1, 'utf8'), backup);
  // a user who builds a playroom after the move keeps it (ruling 3): migrated: 2 is never migrated again
  const d2 = tmp(), mine = { ...Jv(WMv.defaultLayout()), migrated: 2 };
  fs.writeFileSync(path.join(d2, 'layout.json'), JSON.stringify(mine));
  assert.deepEqual(createWorldStore(d2).load(), { layout: mine, source: 'file' });
  assert.deepEqual(fs.readdirSync(d2), ['layout.json'], 'no backup written');
});

test('migration: a layout with no playroom or garden pieces gets only migrated: 2', () => {
  const d = tmp(), base = Jv(WMv.defaultLayout());
  const l = { ...base, zones: base.zones.filter((q) => q.type !== 'play' && q.type !== 'garden'), objects: base.objects.filter((o) => !moved(base, o)), spots: base.spots.filter((q) => !/^(play|garden|pk):/.test(q.id)) };
  oldOffice(d, l);
  assert.deepEqual(createWorldStore(d).load().layout, { ...l, migrated: 2 });
});

test('migration safety: an existing different layout.v1.json is never overwritten and the layout is left as it is', (t) => {
  const logged = []; t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  const d = tmp(), f = path.join(d, 'layout.json'), v1 = path.join(d, 'layout.v1.json'), { l, text } = oldOffice(d);
  fs.writeFileSync(v1, 'an older backup');
  assert.deepEqual(createWorldStore(d).load(), { layout: l, source: 'file' });
  assert.equal(fs.readFileSync(v1, 'utf8'), 'an older backup');
  assert.equal(fs.readFileSync(f, 'utf8'), text);
  assert.match(logged.join('\n'), /not migrated.*layout\.v1\.json/);
  // the same bytes already backed up (a run that stopped before the rewrite): migrate, v1 untouched
  fs.writeFileSync(v1, text); const st = fs.statSync(v1).mtimeMs;
  assert.equal(createWorldStore(d).load().layout.migrated, 2);
  assert.equal(fs.readFileSync(v1, 'utf8'), text);
  assert.equal(fs.statSync(v1).mtimeMs, st);
});

test('migration safety: a failed backup leaves the layout as it is and says why', (t) => {
  const logged = []; t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  const d = tmp(), f = path.join(d, 'layout.json'), { l, text } = oldOffice(d);
  fs.mkdirSync(path.join(d, 'layout.v1.json.tmp')); // the backup's temp file cannot be opened
  assert.deepEqual(createWorldStore(d).load(), { layout: l, source: 'file' });
  assert.equal(fs.readFileSync(f, 'utf8'), text);
  assert.ok(!fs.existsSync(path.join(d, 'layout.v1.json')));
  assert.match(logged.join('\n'), /not migrated.*backup/);
});

test('migration safety: a migrated layout that fails validate is not written; the original stays', (t) => {
  const logged = []; t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  const d = tmp(), f = path.join(d, 'layout.json'), { l, text } = oldOffice(d);
  const s = createWorldStore(d, { migrateV2: (x) => ({ ...x, objects: x.objects.filter((o) => o.type !== 'dept-desk') }) });
  assert.deepEqual(s.load(), { layout: l, source: 'file' });
  assert.equal(fs.readFileSync(f, 'utf8'), text);
  assert.deepEqual(fs.readdirSync(d), ['layout.json'], 'no backup either');
  assert.match(logged.join('\n'), /not migrated.*no desks/);
});

test('migration: only the office; interiors, a fresh install and a save after the move', () => {
  const d = tmp(), s = createWorldStore(d), games = s.load('games').layout;
  fs.writeFileSync(path.join(d, 'games.json'), JSON.stringify(games));
  assert.deepEqual(s.load('games'), { layout: games, source: 'file' }, 'game hall untouched');
  const fresh = s.load();
  assert.equal(fresh.source, 'default');
  assert.equal(fresh.layout.migrated, 2);
  assert.ok(!fresh.layout.objects.some((o) => PLAYROOM.includes(o.type)), 'a fresh office has no playroom');
  assert.deepEqual(fs.readdirSync(d), ['games.json'], 'loading writes nothing for a missing office');
  // Build's reset brings back the classic office: once saved it is the user's own and stays
  assert.equal(s.save(Jv(WMv.defaultLayout())).ok, true);
  const r = s.load();
  assert.equal(r.layout.migrated, 2);
  assert.ok(r.layout.objects.some((o) => o.type === 'arcade'));
  assert.ok(!fs.existsSync(path.join(d, 'layout.v1.json')));
});
