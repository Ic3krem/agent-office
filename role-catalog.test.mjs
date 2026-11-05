import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';
import { ROSTER, MANAGER, RoleCatalog, activeKeys, managerPrompt, specialists, teamFromSops, profileOf, setAgentName, sanitizeNames, MANAGER_PROMPT, SPECIALISTS } from './company.mjs';
import { KEYS } from './agent-home.mjs';

const BUILTIN = ['pixel', 'forge', 'warden', 'probe', 'atlas', 'cabalan', 'tally', 'scribe'];
const NEW = ['it', 'accounting', 'marketing', 'auditor', 'notetaker'];

test('the page and the server read the same catalog', () => {
  const C = loadWorld().RoleCatalog;
  assert.ok(C, 'world-vm loads role-catalog.js');
  assert.deepEqual(JSON.parse(JSON.stringify(C.ROLES)), JSON.parse(JSON.stringify(RoleCatalog.ROLES)));
});

test('catalog matches ROSTER for the built-ins', () => {
  for (const [desk, key] of Object.entries(RoleCatalog.BUILTIN_DESKS)) {
    const c = RoleCatalog.get(key), r = ROSTER[key];
    assert.deepEqual([c.name, c.role, c.kind, c.model, c.color, c.accent], [r.name, r.role, r.kind, r.model, r.color, r.accent], key);
    assert.equal(r.desk, desk, key);
  }
  assert.deepEqual(Object.values(RoleCatalog.BUILTIN_DESKS), BUILTIN);
});

test('13 roles, unique keys, names and colours', () => {
  const R = RoleCatalog.ROLES;
  assert.equal(R.length, 13);
  assert.deepEqual([...RoleCatalog.keys()], [...BUILTIN, ...NEW]);
  for (const f of ['key', 'name', 'color', 'accent']) assert.equal(new Set(R.map(r => r[f].toLowerCase())).size, 13, f);
  assert.ok(!R.some(r => r.color === MANAGER.color), 'no role takes Tiro\'s colour');
  for (const r of R) {
    assert.ok(['haiku', 'sonnet', 'opus'].includes(r.model), r.key);
    assert.ok(['coder', 'research', 'ops', 'writer'].includes(r.kind), r.key);
    assert.equal(typeof r.props, 'string', r.key);
    assert.equal(ROSTER[r.key].brief.length, 3, r.key);
    assert.ok(ROSTER[r.key].tools.length, r.key);
  }
  assert.deepEqual(NEW.map(k => RoleCatalog.get(k).name), ['Byte', 'Ledger', 'Spark', 'Vera', 'Memo']);
  assert.deepEqual(NEW.map(k => [RoleCatalog.get(k).kind, RoleCatalog.get(k).model]), [['ops', 'sonnet'], ['ops', 'sonnet'], ['writer', 'sonnet'], ['research', 'opus'], ['writer', 'haiku']]);
  assert.equal(RoleCatalog.get('nope'), null);
  for (const k of NEW) assert.equal(ROSTER[k].desk, undefined, k + ' has no built-in desk');
});

test('activeKeys falls back to built-in desks when role is absent', () => {
  assert.deepEqual(activeKeys(), BUILTIN);
  const objs = Object.keys(RoleCatalog.BUILTIN_DESKS).map((desk, i) => ({ id: 'd' + i, type: 'dept-desk', x: 0, y: 0, desk }));
  assert.deepEqual(activeKeys({ objects: [{ id: 'p', type: 'plant' }, ...objs.reverse()] }), BUILTIN);
});

test('activeKeys reads role params in desk order', () => {
  const layout = { objects: [
    { type: 'dept-desk', desk: 'desk-10', role: 'auditor' },
    { type: 'dept-desk', desk: 'desk-2' },
    { type: 'dept-desk', desk: 'desk-9', role: 'it' },
    { type: 'dept-desk', desk: 'desk-1', role: 'notetaker' },
    { type: 'sofa' },
  ] };
  assert.deepEqual(activeKeys(layout), ['notetaker', 'forge', 'it', 'auditor']);
});

test('managerPrompt lists exactly the given keys', () => {
  const p = managerPrompt(['pixel', 'auditor']);
  assert.match(p, /The team is these 2 specialists: pixel \(/);
  assert.ok(p.includes('auditor ('));
  assert.ok(!/forge/i.test(p), 'forge is not on this team');
  for (const k of ['warden', 'probe', 'cabalan', 'scribe', 'notetaker']) assert.ok(!p.includes(k + ' ('), k);
  assert.match(p, /- Pixel is the only coder\./);
  assert.match(p, /You are Tiro/);
  assert.match(p, /ONE person/);
  assert.ok(p.includes('At most 8 work'), 'hire cap is not the desk count');
  assert.equal(MANAGER_PROMPT, managerPrompt(BUILTIN));
  assert.match(MANAGER_PROMPT, /The team is these 8 specialists: pixel \(frontend/);
  assert.match(MANAGER_PROMPT, /Pixel, forge, warden and probe are the four coders; hire warden or probe/);
  assert.match(MANAGER_PROMPT, /Old names still work: researcher=cabalan, builder=forge, ops=forge, writer=scribe, reviewer=probe\./);
});

test('specialists(keys) has exactly those keys', () => {
  const s = specialists(['it', 'pixel', 'notetaker']);
  assert.deepEqual(Object.keys(s), ['it', 'pixel', 'notetaker']);
  assert.match(s.it.prompt, /You are Byte/);
  assert.match(s.it.prompt, /do not spawn/);
  assert.equal(s.pixel, SPECIALISTS.pixel);
  assert.deepEqual(Object.keys(SPECIALISTS), BUILTIN);
  const team = teamFromSops([{ name: 'specialist-forge', text: 'x' }, { name: 'specialist-it', text: 'You fix laptops.' }], ['it']);
  assert.deepEqual(Object.keys(team), ['it'], 'SOPs for keys not on the team are ignored');
  assert.equal(team.it.prompt, 'You fix laptops.');
});

test('profileOf takes the desk from the active layout', () => {
  assert.equal(profileOf('pixel').desk, 'desk-1');
  assert.deepEqual(profileOf('auditor', k => ({ auditor: 'desk-9' })[k]), { key: 'auditor', name: 'Vera', role: 'Auditor and compliance reviewer', color: RoleCatalog.get('auditor').color, accent: RoleCatalog.get('auditor').accent, desk: 'desk-9' });
});

test('names accept new role keys', () => {
  assert.deepEqual(setAgentName({}, 'auditor', 'Judy'), { auditor: 'Judy' });
  assert.throws(() => setAgentName({}, 'pixel', 'Ledger'), /already used/);
  assert.deepEqual(sanitizeNames({ it: 'Bit', memo: 'x' }), { it: 'Bit' });
});

test('agent-home KEYS cover every catalog key', () => {
  assert.deepEqual(KEYS, ['tiro', ...RoleCatalog.keys()]);
});
