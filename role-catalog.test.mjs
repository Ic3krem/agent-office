import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';
import { ROSTER, MANAGER, RoleCatalog, activeKeys, managerPrompt, specialists, teamFromSops, profileOf, setAgentName, sanitizeNames, MANAGER_PROMPT, SPECIALISTS, LEGACY_MANAGER_PROMPT, teamNote, migrateBrief } from './company.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
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

test('LEGACY_MANAGER_PROMPT is the b08dbef built-in brief, byte for byte', () => {
  // sha256 of b08dbef's MANAGER_PROMPT with ${MAX_SPECIALISTS} = 8 (git show b08dbef:company.mjs).
  assert.equal(crypto.createHash('sha256').update(LEGACY_MANAGER_PROMPT).digest('hex'), '1c9c08f4f963713aa6a90db31ee57087085c327e19144a3a187b7e90995d5a19');
  assert.equal(LEGACY_MANAGER_PROMPT.length, 5736);
  assert.ok(LEGACY_MANAGER_PROMPT.includes('- The team is exactly eight specialists, hired by subagent_type: pixel (frontend: UI, HTML/CSS/JS, accessibility), forge (backend'));
  assert.ok(LEGACY_MANAGER_PROMPT.includes('(a second forge is a "Forge helper" and needs'));
  assert.notEqual(LEGACY_MANAGER_PROMPT, MANAGER_PROMPT);
  assert.equal(migrateBrief(LEGACY_MANAGER_PROMPT), null, 'the legacy brief is current for the hiring migration; the server replaces it whole');
});

test('server: an unedited legacy brief is replaced and re-pinned; an edited one gets the live team appended', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(V\.sop\('kiro-brief', MANAGER_PROMPT\)\.replace\(\/\\r\\n\/g, '\\n'\)\.trim\(\) === LEGACY_MANAGER_PROMPT\.trim\(\)\) \{ V\.saveSop\('kiro-brief', MANAGER_PROMPT\); PINS\['kiro-brief'\] = sopHash\(V\.sop\('kiro-brief', MANAGER_PROMPT\)\); \}/);
  assert.ok(src.indexOf('let PINS') < src.indexOf('LEGACY_MANAGER_PROMPT.trim()'), 'PINS exist before the legacy rewrite');
  assert.ok(src.indexOf('LEGACY_MANAGER_PROMPT.trim()') < src.indexOf('const savePins'), 'the new pin is saved with the startup savePins()');
  assert.match(src, /if \(PINS\['kiro-brief'\] === sopHash\(t\)\) return t \+ teamNote\(currentKeys\(\)\);/);
  // The rewritten brief is MANAGER_PROMPT, which briefText turns into today's team.
  const live = managerPrompt(['pixel', 'forge', 'it', 'auditor']);
  assert.match(live, /The team is these 4 specialists: pixel \(.*it \(IT support.*auditor \(/);
  assert.doesNotMatch(live, /exactly eight/);
});

test('teamNote: empty for the built-in eight (any order), names the live team otherwise', () => {
  assert.equal(teamNote(BUILTIN), '');
  assert.equal(teamNote([...BUILTIN].reverse()), '');
  const n = teamNote([...BUILTIN, 'it']);
  assert.match(n, /^\n\n## The team now \(from the office desks; this replaces any other team list above\)\n- The team is these 9 specialists: pixel \(/);
  assert.ok(n.includes('it (IT support'));
  assert.match(teamNote(['pixel']), /this 1 specialist: pixel \(/);
  assert.doesNotMatch(teamNote(['pixel']), /forge/);
});

test('the helper example in the brief uses the display name, not the key', () => {
  assert.ok(managerPrompt(['it', 'pixel']).includes('(a second Byte is a "Byte helper" and needs'));
  assert.ok(MANAGER_PROMPT.includes('(a second Forge is a "Forge helper" and needs'));
  assert.doesNotMatch(managerPrompt(['it']), /a second it\b/);
});
