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
  assert.equal(s.add('karinderya', 1080, 460).ok, true);
  assert.equal(s.add('broom-corner', 240, 240).ok, true);
  return J(s.layout());
}

test('karinderya and broom corner are addable, valid, and carry their spots', () => {
  const l = withPieces(), spots = J(WM.spotsOf(l));
  assert.deepEqual(J(WM.validate(l).errors), []);
  for (const id of ['kain:1', 'kain:2', 'kain:3', 'kain:4', 'npc:sweeper']) assert.ok(spots[id], id);
  assert.ok(spots['kain:1'].seat && spots['kain:1'].face === 'n');
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
