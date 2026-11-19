import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const { WorldModel: WM, WorldPath: W, OfficeMotion: M } = loadWorld();
const J = (v) => JSON.parse(JSON.stringify(v)); // vm results have a foreign realm prototype
const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/office-golden.json', import.meta.url), 'utf8'));
const errs = (mut) => { const l = J(WM.defaultLayout()); mut(l); return WM.validate(l).errors.join('\n'); };

test('default layout validates', () => {
  const r = WM.validate(WM.defaultLayout());
  assert.deepEqual(J(r.errors), []);
  assert.equal(r.ok, true);
});

test('default layout reproduces every 1.2.9 spot', () => {
  assert.deepEqual(J(WM.spotsOf(WM.defaultLayout())), gold.spots);
});

test('validate rejects bad layouts', () => {
  assert.match(errs((l) => l.objects.push({ id: 'x', type: 'no-such-thing', x: 1, y: 1 })), /unknown type/);
  assert.match(errs((l) => l.objects.push({ ...l.objects[0] })), /duplicate id/);
  assert.match(errs((l) => l.spots.push({ id: 'far', x: 2000, y: 10, face: 'n', zone: 'garden' })), /outside/);
  assert.match(errs((l) => { l.spawn = { x: 225, y: 70 }; }), /spawn/); // the manager's desk
  assert.match(errs((l) => l.objects.push({ id: 'wall', type: 'glass-y', x: 0, y: 470, w: 1240 })), /unreachable/);
  assert.match(errs((l) => { l.version = WM.VERSION + 1; }), /newer version/);
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'bench').colour = 'red'; }), /unknown field/);
  assert.match(errs((l) => l.spots.push({ id: 'swim', x: 790, y: 105, face: 'n', zone: 'garden' })), /water/);
});

test('garden walk goes round the pond, not through it', () => {
  const l = WM.defaultLayout(), s = WM.spotsOf(l), g = WM.gridOf(l);
  const [x0, y0, x1, y1] = l.zones.find((z) => z.id === 'pond').rect;
  const p = W.findPath(g, s['garden:b1'], s['garden:pS']);
  assert.ok(p.length > 1);
  for (let i = 1; i < p.length; i++) for (let k = 0; k <= 40; k++) {
    const x = p[i - 1].x + (p[i].x - p[i - 1].x) * k / 40, y = p[i - 1].y + (p[i].y - p[i - 1].y) * k / 40;
    assert.ok(!(x > x0 && x < x1 && y > y0 && y < y1), `(${x},${y}) is in the pond`);
  }
});

test('validate never throws on malformed input', () => {
  const ok = J(WM.defaultLayout());
  const cases = [null, undefined, 7, 'x', [], {}, { version: 1 }, { version: 1, size: { w: 1, h: 1 } },
    { ...ok, size: { w: 1e9, h: 1e9 } }, { ...ok, spawn: null }, { ...ok, zones: null }, { ...ok, objects: {} }, { ...ok, spots: 'x' },
    { ...ok, objects: [null] }, { ...ok, spots: [5] }, { ...ok, zones: [{ id: 'z', type: 'path' }] },
    { ...ok, objects: [{ id: 3, type: 'bench', x: 0, y: 0 }] }, { ...ok, spots: [{ id: 's', x: 'a', y: 0 }] },
    { ...ok, objects: [{ id: 'c', type: 'constructor', x: 0, y: 0 }] },
    { ...ok, objects: [{ id: 'd', type: 'dept-desk', x: 0, y: 0, desk: 'no-such-desk' }] }];
  for (const c of cases) {
    const r = WM.validate(c);
    assert.equal(r.ok, false, JSON.stringify(c)?.slice(0, 80));
    assert.ok(r.errors.length > 0);
  }
});

test('the main routes walk mostly on path zones', () => {
  const l = WM.defaultLayout(), s = WM.spotsOf(l), g = WM.gridOf(l);
  const paths = l.zones.filter((q) => q.type === 'path').map((q) => q.rect);
  for (const [a, b] of [['desk-1', 'desk-8'], ['desk-2', 'play:pit'], ['hot:1', 'garden:b2']]) {
    const p = W.findPath(g, s[a], s[b]); let n = 0, on = 0;
    for (let i = 1; i < p.length; i++) {
      const m = Math.max(1, Math.round(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)));
      for (let k = 0; k < m; k++) {
        const x = p[i - 1].x + (p[i].x - p[i - 1].x) * k / m, y = p[i - 1].y + (p[i].y - p[i - 1].y) * k / m;
        n++; if (paths.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) on++;
      }
    }
    assert.ok(on / n >= 0.78, `${a} -> ${b}: ${(on / n).toFixed(3)} on paths`);
  }
});

test('validate rejects unknown desks and missing brain spots', () => {
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'dept-desk').desk = 'desk-99'; }), /desk-99 needs a role/);
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'dept-desk').desk = 'desk-x'; }), /unknown desk desk-x/);
  assert.match(errs((l) => { l.spots = l.spots.filter((s) => s.id !== 'queue:1'); }), /missing spot queue:1/);
});

test('validate checks param values and list sizes, and answers fast', () => {
  const glass = (l) => l.objects.find((o) => o.type === 'glass-y');
  const cases = [
    [(l) => { glass(l).w = 1e20; }, /bad w/],
    [(l) => { l.objects.find((o) => o.type === 'plant').s = 'x'; }, /bad s/],
    [(l) => { l.spots[0].face = 'x'; }, /face/],
    [(l) => { l.spots[0].face = { n: 1 }; }, /face/],
    [(l) => { l.zones[0].type = 'lava'; }, /unknown zone type/],
    [(l) => { l.objects = Array.from({ length: 2001 }, (_, i) => ({ id: 'p' + i, type: 'plant', x: 10, y: 10 })); }, /more than 1000/],
    [(l) => { l.objects[0].x = -5; }, /outside the world/],
    [(l) => { l.objects.find((o) => o.type === 'beanbag').col = 'red'; }, /bad col/],
    [(l) => { l.spots[0].seat = 'yes'; }, /seat must be/],
  ];
  for (const [mut, re] of cases) {
    const t0 = Date.now(), msg = errs(mut);
    assert.match(msg, re);
    assert.ok(Date.now() - t0 < 1000, re + ' took ' + (Date.now() - t0) + ' ms');
  }
});

test('fixtures stay at their anchor', () => {
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'fixture-pennants').x = 40; }), /fixture cannot move/);
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'fixture-pennants').home = [10, 10]; }), /fixture cannot move/);
});

// ---- department desks: any set of 1..12 roles ----
const BUILTIN = ['pixel', 'forge', 'warden', 'probe', 'atlas', 'cabalan', 'tally', 'scribe'];
const FREE = [1120, 500]; // an auditor desk fits here (east park, south of the pond)
const withDesk = (l, extra) => { l.objects.push({ id: extra.desk, type: 'dept-desk', x: FREE[0], y: FREE[1], ...extra }); return l; };

test('old layouts without role still validate and give the 8 built-in TEAM', () => {
  const l = J(WM.defaultLayout());
  for (const o of l.objects) delete o.role;
  assert.deepEqual(J(WM.validate(l).errors), []);
  assert.deepEqual(J(WM.spotsOf(l)), gold.spots);
  M.useLayout(l);
  assert.deepEqual(J(M.TEAM).map((t) => [t.key, t.desk]), BUILTIN.map((k, i) => [k, 'desk-' + (i + 1)]));
});

test('a layout with an auditor desk at a free spot validates; TEAM includes Vera at that desk', () => {
  const l = withDesk(J(WM.defaultLayout()), { desk: 'desk-9', role: 'auditor' }), team = M.TEAM;
  assert.deepEqual(J(WM.validate(l).errors), []);
  assert.ok(WM.requiredSpots(l).includes('desk-9'));
  M.useLayout(l);
  assert.equal(M.TEAM, team, 'TEAM keeps its identity');
  const vera = J(M.TEAM).find((t) => t.desk === 'desk-9');
  assert.deepEqual(vera, { key: 'auditor', name: 'Vera', role: 'Auditor and compliance reviewer', model: 'opus', color: '#4a4f8c', accent: '#a6aae0', desk: 'desk-9' });
  assert.equal(M.TEAM.length, 9);
  assert.deepEqual(J(M.SPOTS['desk-9']), { id: 'desk-9', x: FREE[0], y: FREE[1], face: 'n', zone: 'focus', seat: true, desk: true });
  M.useLayout(WM.defaultLayout());
  assert.equal(M.TEAM.length, 8);
});

test('unknown role, duplicate role, 13 desks, zero desks are rejected', () => {
  assert.match(errs((l) => withDesk(l, { desk: 'desk-9', role: 'chef' })), /unknown role chef/);
  assert.match(errs((l) => withDesk(l, { desk: 'desk-9', role: 'warden' })), /two desks for warden/);
  assert.match(errs((l) => { l.objects.find((o) => o.desk === 'desk-2').role = 'pixel'; }), /two desks for pixel/);
  assert.match(errs((l) => withDesk(l, { id: 'dd', desk: 'desk-1', role: 'it' })), /duplicate id desk desk-1/);
  assert.match(errs((l) => {
    ['it', 'accounting', 'marketing', 'auditor', 'notetaker'].forEach((role, i) => withDesk(l, { desk: 'desk-' + (9 + i), role }));
  }), /too many desks/);
  assert.match(errs((l) => { l.objects = l.objects.filter((o) => o.type !== 'dept-desk'); }), /no desks/);
});

test("removing desk-3 is allowed; desk-3's spot is no longer required", () => {
  const l = J(WM.defaultLayout());
  l.objects = l.objects.filter((o) => o.desk !== 'desk-3');
  assert.deepEqual(J(WM.validate(l).errors), []);
  assert.ok(!WM.requiredSpots(l).includes('desk-3'));
  assert.ok(WM.requiredSpots(l).includes('desk-4') && WM.requiredSpots(l).includes('tiro:seat'));
});

test('town step 3: play and garden spots are optional in the office (PLAY travels to the game hall)', () => {
  const req = WM.requiredSpots(J(WM.defaultLayout()));
  assert.ok(req.includes('cool:1') && req.includes('queue:1'));
  assert.deepEqual(J(req.filter((id) => /^(play|garden|pk):/.test(id))), []);
});

// Task 5 fix round 1: the migrated office is what the page shows by default, with no leftover playroom, garden or pond.
test('officeLayout(): the migrated default; no play or garden zones (their decor goes too), no pond water, the old pond area is walkable', () => {
  const d = J(WM.defaultLayout()), o = J(WM.officeLayout());
  assert.deepEqual(o, J(WM.migrateV2(WM.defaultLayout())));
  assert.deepEqual(J(WM.validate(o)), { ok: true, errors: [] });
  // fix round 2: play/garden zones become office floor; the walk strips wholly inside them and the pond water go
  const old = d.zones.filter((q) => q.type === 'play' || q.type === 'garden');
  const inside = (q) => old.some((z) => z.rect[0] <= q.rect[0] && z.rect[1] <= q.rect[1] && z.rect[2] >= q.rect[2] && z.rect[3] >= q.rect[3]);
  const dropped = (q) => (q.type === 'water' && (q.id === 'pond' || q.id === 'pond-east')) || (q.type === 'path' && inside(q));
  assert.deepEqual(o.zones, d.zones.filter((q) => !dropped(q)).map((q) => old.some((z) => z.id === q.id) ? { ...q, type: 'office' } : q));
  assert.deepEqual(d.zones.filter((q) => q.type === 'path' && inside(q)).map((q) => q.id).sort(), ['garden-hub', 'loop-e', 'loop-n', 'loop-s', 'loop-w', 'play-e', 'play-in', 'play-n', 'play-s', 'play-w']);
  assert.ok(o.zones.some((q) => q.id === 'garden-gate'), 'a strip that only crosses into the garden stays');
  assert.deepEqual(o.zones.filter((q) => q.type === 'play' || q.type === 'garden'), []);
  assert.deepEqual(['garden', 'park', 'play'].map((id) => o.zones.find((q) => q.id === id).type), ['office', 'office', 'office']);
  assert.equal(WM.isDefaultZones(o.zones), false, 'so the default play rug and garden beds are not drawn');
  assert.deepEqual(o.objects.filter((x) => ['hedge', 'picnic-table', 'lamp-post', 'bird-feeder'].includes(x.type)), [], 'no stray hedges or garden furniture');
  assert.ok(o.objects.some((x) => x.id === 'server-plant') && o.objects.some((x) => x.id === 'plant-4'), 'plants stay');
  const g = WM.gridOf(o), reach = W.reachFrom(g, o.spawn);
  for (const p of [{ x: 790, y: 105 }, { x: 1120, y: 290 }]) {
    assert.equal(g.blocked[W.cellOf(g, p)], 0, 'not blocked at ' + p.x + ',' + p.y);
    assert.ok(reach(p), 'reachable from spawn: ' + p.x + ',' + p.y);
  }
  const dg = WM.gridOf(d);
  assert.ok(dg.blocked[W.cellOf(dg, { x: 790, y: 105 })], 'it was water before');
});

test('the page never falls back to the classic office: reset, visit, Build and boot use the migrated office', () => {
  const src = fs.readFileSync(new URL('./public/Agent Office.html', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /WorldModel\.defaultLayout\(\)/);
  assert.match(src, /resetDefault:.*SCENE==='office'\?WorldModel\.officeLayout\(\)/);
  assert.doesNotMatch(src, /j\.source!=='default'/, 'the server default (migrated) is applied too');
  assert.match(src, /mountWorld/);
});

test('migrateV2 on a user-built layout: containment, not ids; outdoor pieces go only from garden and play zones', () => {
  const l = J(WM.defaultLayout());
  l.zones.push({ id: 'g2', type: 'garden', rect: [20, 300, 120, 400] }, { id: 'p2', type: 'path', rect: [30, 310, 110, 330] }, { id: 'p3', type: 'path', rect: [100, 350, 200, 360] });
  l.objects.push({ id: 'hedge-in', type: 'hedge', x: 60, y: 380 }, { id: 'lamp-in', type: 'lamp-post', x: 600, y: 700 }, { id: 'hedge-out', type: 'hedge', x: 300, y: 300 }, { id: 'table-out', type: 'picnic-table', x: 300, y: 620 });
  const o = J(WM.migrateV2(l)), ids = (a) => a.map((q) => q.id);
  assert.equal(o.zones.find((q) => q.id === 'g2').type, 'office');
  assert.ok(!ids(o.zones).includes('p2'), 'a path inside a garden zone goes');
  assert.ok(ids(o.zones).includes('p3'), 'a path crossing out of it stays');
  assert.ok(!ids(o.objects).includes('hedge-in') && !ids(o.objects).includes('lamp-in'), 'outdoor pieces in garden/play zones go');
  assert.ok(ids(o.objects).includes('hedge-out') && ids(o.objects).includes('table-out'), 'outdoor pieces elsewhere stay');
});

test('zone labels: GARDEN, PARK and PLAYROOM only when a zone of that type exists', () => {
  const w = loadWorld(), F = w.OfficeFurniture, said = [];
  const g = new Proxy({}, { get: (t, k) => k === 'fillText' ? (s) => said.push(s) : k in t ? t[k] : () => ({ width: 0 }), set: (t, k, v) => { t[k] = v; return true; } });
  const labels = (zones) => { said.length = 0; F.setZones(zones); for (const p of F.walls) { try { p(g); } catch {} } return ['GARDEN', 'PARK', 'PLAYROOM', 'GARAGE'].filter((s) => said.includes(s)); };
  assert.deepEqual(labels(J(w.WorldModel.defaultLayout().zones)), ['GARDEN', 'PARK', 'PLAYROOM', 'GARAGE']);
  assert.deepEqual(labels(J(w.WorldModel.officeLayout().zones)), ['GARAGE']);
  assert.deepEqual(labels(null), ['GARAGE'], 'no zones yet: the office as it now is, never the old playroom and garden');
});

test('meet is an interior: its template validates, and its chairs give 10 unique seat spots by the table', () => {
  const l = JSON.parse(fs.readFileSync(new URL('./public/world-templates/interior-meet.json', import.meta.url), 'utf8'));
  assert.deepEqual(J(WM.validate(J(l))), { ok: true, errors: [] });
  assert.match(errs((x) => { x.scene = 'nope'; }), /scene must be kain, games or meet/);
  M.useLayout(J(l));
  const seats = Object.values(J(WM.spotsOf(l))).filter((s) => s.seat);
  assert.equal(seats.length, 10);
  assert.ok(seats.every((s) => /^meet:\d+$/.test(s.id) && s.zone === 'meet' && Math.abs(s.x - 300) <= 100));
});
