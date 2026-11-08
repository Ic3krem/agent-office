import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ROSTER, MANAGER } from './company.mjs';
import { loadWorld } from './world-vm.mjs';

const { WorldModel: WM, WorldEdit: E, OfficeMotion: M } = loadWorld();
const J = v => JSON.parse(JSON.stringify(v));
const prof = key => ({ key, ...Object.fromEntries(['name', 'role', 'color', 'accent', 'desk'].map(k => [k, ROSTER[key][k]])) });
const ag = (key, status) => ({ id: 'a-' + key, name: ROSTER[key].name, role: 'Helper', profile: prof(key), model: 'sonnet', status, task: 't', logs: [{ t: '10:00:00', k: 'out', text: 'x' }], perm: null });
const tiro = { id: 'a-tiro', isManager: true, name: 'Tiro', role: 'Manager', profile: MANAGER, model: 'sonnet', status: 'working', task: '', logs: [{ t: '10:00:00', k: 'sys', text: 'hi' }], perm: null };
const snap = agents => ({ agents, goals: [{ id: 'g1', text: 'g1', status: 'doing', at: Date.now() }], boss: { active: true, running: 2, max: 8 } });

function withPieces() {
  const s = E.createSession(WM.defaultLayout());
  // the room needs the east park: two trees go, the two park benches move to the garden
  for (const id of ['tree-5', 'tree-6']) assert.equal(s.remove(id).ok, true);
  assert.equal(s.move('bench-3', 560, 20).ok, true); assert.equal(s.move('bench-4', 620, 20).ok, true);
  assert.equal(s.add('karinderya', 1010, 370).ok, true);
  assert.equal(s.add('broom-corner', 240, 240).ok, true);
  return J(s.layout());
}

test('karinderya and broom corner are addable, valid, and carry their spots', () => {
  const l = withPieces(), spots = J(WM.spotsOf(l));
  assert.deepEqual(J(WM.validate(l).errors), []);
  for (const id of ['kain:1', 'kain:2', 'kain:3', 'kain:4', 'kain:5', 'kain:6', 'npc:sweeper']) assert.ok(spots[id], id);
  assert.ok(spots['kain:1'].seat && spots['kain:1'].face === 's' && spots['kain:4'].face === 'n');
  assert.ok(spots['npc:cook'], 'the cook has a spot behind the counter');
  const cat = J(E.catalog()).filter(c => ['karinderya', 'broom-corner'].includes(c.type));
  assert.deepEqual(cat.map(c => c.addable), [true, true]);
});

test('limited agents eat at the karinderya stools when there is one, else the cooler', () => {
  try {
    M.useLayout(withPieces());
    const f = M.createBrain({ wall: () => 1e12 }).update(snap([tiro, ag('tally', 'limited'), ag('forge', 'limited')]), 0);
    const ta = f.agents.find(a => a.id === 'a-tally'), fo = f.agents.find(a => a.id === 'a-forge');
    assert.ok(ta.spot.startsWith('kain:') && fo.spot.startsWith('kain:'), ta.spot + ' ' + fo.spot);
    assert.notEqual(ta.spot, fo.spot);
    assert.deepEqual([ta.pose, ta.badge], ['sit-front', 'limited']);
    M.useLayout(WM.defaultLayout());
    const g = M.createBrain({ wall: () => 1e12 }).update(snap([tiro, ag('tally', 'limited')]), 0).agents.find(a => a.id === 'a-tally');
    assert.ok(g.spot.startsWith('cool:'));
  } finally { M.useLayout(WM.defaultLayout()); }
});

test('the chismis bank is all canned and fits a bubble', () => {
  const box = {};
  vm.runInNewContext(fs.readFileSync(new URL('./public/chismis-tl.js', import.meta.url), 'utf8'), box);
  const C = box.Chismis, all = [...C.SOLO, ...C.PAIRS.flat(), ...C.COOK, ...C.SWEEP];
  assert.ok(all.length >= 100, 'at least 100 lines, got ' + all.length);
  assert.ok(C.PAIRS.every(p => p.length === 2));
  for (const l of all) assert.ok(typeof l === 'string' && l.trim() && l.length <= 60, l);
});

test('ruling 3: an office with its own karinderya keeps limited agents on its stools and never asks where()', () => {
  const town = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
  const w = loadWorld({ extra: ['town-map.js', 'agent-travel.js', 'office-world.js'], globals: { OfficeSprites: { lookOf: () => ({}), W: 32, H: 48 } } });
  w.document.documentElement = { dataset: {} };
  const AT = w.AgentTravel, where = AT.where; let asked = 0;
  AT.where = (...a) => { asked++; return where(...a); };
  const OW = w.OfficeWorld;
  w.OfficeWorld.applyLayout(withPieces());
  OW.setTravel({ routes: (a, b) => AT.route(town, a, b) });
  const t0 = Date.now() - 3000;
  OW.setSnapshot(snap([tiro, { ...ag('tally', 'limited'), statusAt: t0 }, { ...ag('forge', 'limited'), statusAt: t0 }]));
  OW.advance(8);
  const d = OW.debug().agents;
  assert.ok(d.find(a => a.id === 'a-tally').spot.startsWith('kain:') && d.find(a => a.id === 'a-forge').spot.startsWith('kain:'));
  assert.equal(asked, 0);
});

test('fix round 1: an office karinderya behaves as before: the 7th and 8th limited agents go to their desks', () => {
  try {
    M.useLayout(withPieces());
    const keys = M.TEAM.map(t => t.key);
    assert.equal(keys.length, 8);
    const f = M.createBrain({ wall: () => 1e12 }).update(snap([tiro, ...keys.map(k => ag(k, 'limited'))]), 0);
    const eat = keys.map(k => f.agents.find(a => a.id === 'a-' + k));
    assert.deepEqual(J(eat.slice(0, 6).map(a => a.spot.startsWith('kain:'))), [true, true, true, true, true, true]);
    assert.deepEqual(J(eat.slice(6).map(a => a.spot)), J(eat.slice(6).map(a => ROSTER[a.key].desk)));
  } finally { M.useLayout(WM.defaultLayout()); }
});

test('fix round 1: the eaters open-floor fallback skips claimed spots and office/queue/tiro spots', () => {
  try {
    M.useLayout(withPieces());
    const eaters = Array.from({ length: 40 }, (_, i) => ({ id: 'v' + String(i).padStart(2, '0'), status: 'limited', at: 'kain', logs: [], profile: null }));
    const players = M.TEAM.slice(0, 3).map(t => ag(t.key, 'idle'));
    const f = M.createBrain({ wall: () => 1e12 }).update({ ...snap([...players, ...eaters]), goals: [], boss: { active: true, running: 0, max: 8 } }, 0); // empty board: players play
    const pl = players.map(p => f.agents.find(a => a.id === p.id).spot);
    assert.ok(pl.every(s => s.startsWith('play:')), String(pl));
    const ea = eaters.map(e => f.agents.find(a => a.id === e.id).spot);
    for (const s of ea) assert.ok(!/^(office|queue|tiro):/.test(s), s);
    const placed = ea.filter(s => s !== M.exitId() && !/^hot:|^over:/.test(s));
    assert.equal(new Set([...placed, ...pl]).size, placed.length + pl.length, 'no spot shared with a player or another eater');
  } finally { M.useLayout(WM.defaultLayout()); }
});

test('R2: an office with its own karinderya gets no derived stand spots', () => {
  try {
    M.useLayout(withPieces());
    assert.ok(!Object.keys(M.SPOTS).some(k => /-stand:/.test(k)));
  } finally { M.useLayout(WM.defaultLayout()); }
});

// ---------- town step 5: twelve seats and a take-out line ----------
const kainTpl = () => JSON.parse(fs.readFileSync(new URL('./public/world-templates/interior-kain.json', import.meta.url), 'utf8'));
test('the kain interior has 12 seats (kain:1..12) and 4 take-out spots (kain:q1..q4), all reachable from the door', () => {
  const l = kainTpl(), spots = J(WM.spotsOf(l)), g = WM.gridOf(l), W = loadWorld().WorldPath;
  assert.deepEqual(J(WM.validate(l).errors), []);
  const seats = Object.keys(spots).filter(k => /^kain:\d+$/.test(k)), q = Object.keys(spots).filter(k => /^kain:q\d$/.test(k));
  assert.deepEqual(seats.map(k => +k.slice(5)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(seats.every(k => spots[k].seat === true), 'seats');
  assert.deepEqual(q.sort(), ['kain:q1', 'kain:q2', 'kain:q3', 'kain:q4']);
  assert.ok(q.every(k => !spots[k].seat), 'take-out spots are not seats');
  const door = spots.door, reach = W.reachFrom(g, door);
  for (const k of [...seats, ...q]) assert.ok(reach(spots[k]), k + ' reachable');
  assert.ok(l.objects.some(o => o.type === 'kain-table'), 'the second table');
});

test('12 visiting eaters take 12 distinct seats; the 13th to 16th stand at the counter (kain:q1..q4)', () => {
  try {
    M.useLayout(kainTpl());
    const eaters = Array.from({ length: 16 }, (_, i) => ({ id: 'v' + String(i).padStart(2, '0'), status: 'limited', at: 'kain', logs: [], profile: null }));
    const f = M.createBrain({ wall: () => 1e12 }).update({ ...snap(eaters), boss: { active: true, running: 0, max: 8 } }, 0);
    const spot = e => f.agents.find(a => a.id === e.id).spot;
    const seated = eaters.slice(0, 12).map(spot);
    assert.equal(new Set(seated).size, 12); assert.ok(seated.every(s => /^kain:\d+$/.test(s)), String(seated));
    assert.deepEqual(J(eaters.slice(12).map(spot)), ['kain:q1', 'kain:q2', 'kain:q3', 'kain:q4']);
  } finally { M.useLayout(WM.defaultLayout()); }
});

test('an office with only the karinderya piece keeps its 6 seats (plus the 4 take-out spots)', () => {
  const spots = J(WM.spotsOf(withPieces())), seats = Object.keys(spots).filter(k => k.startsWith('kain:') && spots[k].seat);
  assert.deepEqual(seats.sort(), ['kain:1', 'kain:2', 'kain:3', 'kain:4', 'kain:5', 'kain:6']);
  assert.equal(Object.keys(spots).filter(k => k.startsWith('kain:q')).length, 4);
  assert.ok(J(E.catalog()).find(c => c.type === 'kain-table').addable, 'the table can be added from Build');
});
