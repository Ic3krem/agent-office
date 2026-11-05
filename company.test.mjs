import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goalStore } from './company.mjs';

test('goals carry over to a new day unless finished', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-')), 'goals.json');
  let day = '2026-10-17';
  const g = goalStore(file, () => day);
  const a = g.add('fix retries'), b = g.add('write report'), c = g.add('idea', 'manager', 'proposed', 'why');
  g.update(b.id, { status: 'done', note: 'sent' });
  assert.deepEqual(g.open().map(x => x.id), [a.id]);
  assert.throws(() => g.update('nope', { status: 'done' }));
  assert.equal(goalStore(file, () => day).clear(), 1, 'finished goals leave the board');
  assert.equal(goalStore(file, () => day).list().length, 2);
  day = '2026-10-18';
  assert.deepEqual(goalStore(file, () => day).list().map(x => x.id), [a.id, c.id]);
});


import { teamFromSops, SPECIALISTS, ROSTER, ALIASES, MAX_SPECIALISTS, MANAGER, MANAGER_PROMPT, profileOf, withAliases } from './company.mjs';
test('SOP notes edit the eight specialists but cannot add or revive others', () => {
  const team = teamFromSops([
    { name: 'kiro-brief', text: 'ignored here' },
    { name: 'specialist-cabalan', text: '# Role: Cabalan\nRead only.' },
    { name: 'specialist-designer', text: '---\ndescription: Designs UI mockups\n---\nYou design screens.' },
    { name: 'specialist-researcher', text: 'legacy note' },
    { name: 'specialist-scribe', text: '' },
    { name: 'specialist-pixel', text: '---\ndescription: UI\ntools: Read, Write\nmodel: haiku\n---\nYou build UI.' },
  ]);
  assert.equal(team.cabalan.prompt, '# Role: Cabalan\nRead only.');
  assert.deepEqual(team.cabalan.tools, SPECIALISTS.cabalan.tools, 'built-in keeps its tools');
  assert.deepEqual([team.pixel.description, team.pixel.tools, team.pixel.model], ['UI', ['Read', 'Write'], 'haiku']);
  assert.equal(team.scribe, SPECIALISTS.scribe, 'an empty note falls back');
  assert.deepEqual(Object.keys(team).sort(), Object.keys(SPECIALISTS).sort(), 'no ninth specialist, no legacy keys');
});

test('roster: exactly 8 built-in specialists, distinct desks and colors, 3-line briefs, cap 8', () => {
  const r = Object.keys(SPECIALISTS).map(k => ROSTER[k]);
  assert.equal(r.length, 8);
  assert.equal(MAX_SPECIALISTS, 8);
  assert.equal(new Set(r.map(x => x.desk)).size, 8);
  assert.equal(new Set([...r.map(x => x.color), MANAGER.color]).size, 9);
  assert.equal(new Set(r.map(x => x.name)).size, 8);
  for (const x of r) { assert.equal(x.brief.length, 3, x.name); assert.ok(['haiku', 'sonnet', 'opus'].includes(x.model)); }
  assert.equal(MANAGER.name, 'Tiro');
});

test('read-only roles have no write tools; coders and writers do', () => {
  for (const k of ['warden', 'probe', 'atlas', 'cabalan']) assert.ok(!SPECIALISTS[k].tools.some(t => ['Edit', 'Write'].includes(t)), k);
  for (const k of ['pixel', 'forge', 'scribe', 'tally']) assert.ok(SPECIALISTS[k].tools.includes('Write'), k);
});

test('old subagent_type names still resolve to the new roster', () => {
  const all = withAliases(SPECIALISTS);
  for (const [old, k] of Object.entries(ALIASES)) { assert.equal(all[old], SPECIALISTS[k]); assert.equal(profileOf(old).key, k); }
  assert.equal(profileOf('pixel').name, 'Pixel');
  assert.equal(profileOf('general-purpose'), null);
});

test('the manager brief is Tiro and names all eight', () => {
  assert.match(MANAGER_PROMPT, /You are Tiro/);
  assert.doesNotMatch(MANAGER_PROMPT, /Kiro/);
  for (const k of Object.keys(SPECIALISTS)) assert.ok(MANAGER_PROMPT.includes(k), k);
  assert.ok(MANAGER_PROMPT.includes('At most ' + MAX_SPECIALISTS + ' work'));
});

import { cleanName, sanitizeNames, setAgentName, displayNames, nameStore, hireGate, migrateBrief, OLD_HIRE_LINE, NAME_MAX } from './company.mjs';

test('display names are cleaned, limited and validated', () => {
  assert.equal(cleanName('  <b>Ada</b> 	 Lovelace '), 'Ada Lovelace');
  assert.equal(cleanName('<b>Zed</b>'), 'Zed');
  assert.equal(cleanName('x'.repeat(50)).length, NAME_MAX);
  assert.equal(cleanName(null), '');
  assert.deepEqual(sanitizeNames({ forge: ' Bolt ', nope: 'x', tiro: '', pixel: 'bolt' }), { pixel: 'bolt' }, 'unknown types, blanks and duplicates dropped');
  let n = setAgentName({}, 'forge', 'Bolt');
  assert.equal(displayNames(n).forge, 'Bolt');
  assert.equal(displayNames(n).pixel, 'Pixel');
  assert.throws(() => setAgentName(n, 'pixel', 'bolt'), /already used/);
  assert.throws(() => setAgentName(n, 'pixel', 'Tiro'), /already used/, 'cannot take the manager default name');
  assert.throws(() => setAgentName(n, 'ghost', 'Zed'), /Unknown agent type/);
  n = setAgentName(setAgentName(n, 'tiro', 'Boss'), 'forge', '');
  assert.deepEqual(n, { tiro: 'Boss' }, 'blank resets to default');
});

test('names persist in kiro.json without touching other prefs', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-')), 'kiro.json');
  fs.writeFileSync(file, JSON.stringify({ x: 5, islandMode: 'smart' }));
  const st = nameStore(file);
  st.set('tiro', 'Boss'); st.set('atlas', 'Sage');
  assert.deepEqual(nameStore(file).get(), { tiro: 'Boss', atlas: 'Sage' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).islandMode, 'smart');
  st.reset();
  assert.deepEqual(st.get(), {});
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).x, 5);
});

test('hiring needs one explicit approval per hire', async () => {
  const g = hireGate({ ttl: 5000 });
  assert.equal(g.consume('forge'), false, 'no approval, no hire');
  const { id, promise } = g.request({ key: 'forge', goalId: 'g1', why: 'long job' });
  assert.equal(g.pending().length, 1);
  assert.equal(g.pending()[0].resolve, undefined);
  assert.equal(g.consume('forge'), false, 'pending is not approved');
  g.decide(id, true);
  assert.equal((await promise).approved, true);
  assert.equal(g.consume('builder'), true, 'old names resolve to the same specialist');
  assert.equal(g.consume('forge'), false, 'one approval buys one hire');
  const r2 = g.request({ key: 'scribe', goalId: 'g1', why: 'docs' });
  g.decide(r2.id, false, 'do it yourself');
  const d = await r2.promise;
  assert.equal(d.approved, false); assert.match(d.reason, /do it yourself/);
  assert.equal(g.consume('scribe'), false);
  assert.equal(g.decide('nope', true), false);
});

test('hire approval expires', async () => {
  let t = 0; const g = hireGate({ ttl: 1000, now: () => t });
  const r = g.request({ key: 'pixel' }); g.decide(r.id, true);
  t = 2000;
  assert.equal(g.consume('pixel'), false);
});

test('manager brief enforces the approval flow, and old briefs migrate', () => {
  assert.match(MANAGER_PROMPT, /request_hire/);
  assert.match(MANAGER_PROMPT, /Reuse a specialist/);
  assert.equal(migrateBrief(MANAGER_PROMPT), null);
  const old = '# brief\n' + OLD_HIRE_LINE.replace('${MAX_SPECIALISTS}', MAX_SPECIALISTS) + '\nmore';
  const m = migrateBrief(old);
  assert.match(m, /request_hire/); assert.doesNotMatch(m, /Hire specialists with the Agent tool/); assert.match(m, /more$/m);
  assert.match(migrateBrief('# custom brief'), /Hiring policy/);
});

import { assignHelpers } from './company.mjs';
test('each roster specialist is one person; same-type extras are labelled helpers', () => {
  const p = type => profileOf(type);
  const r = assignHelpers([
    { id: 'c', born: 3, profile: p('ops') }, { id: 'a', born: 1, profile: p('forge') }, { id: 'b', born: 2, profile: p('builder') },
    { id: 'x', born: 1, profile: p('pixel') }, { id: 'n', born: 1 }, { id: 'z', born: 1, profile: null },
  ], { forge: 'Smith' });
  assert.deepEqual(r.get('a'), { helper: false });
  assert.deepEqual(r.get('b'), { helper: true, helperOf: 'a', label: 'Smith helper 1' });
  assert.deepEqual(r.get('c'), { helper: true, helperOf: 'a', label: 'Smith helper 2' });
  assert.deepEqual(r.get('x'), { helper: false });
  assert.equal(r.has('n'), false);
  assert.equal([...r.values()].filter(v => !v.helper && true).length, 2, 'exactly one non-helper per key');
  const two = assignHelpers([{ id: 'a', born: 1, profile: p('probe') }, { id: 'b', born: 2, profile: p('reviewer') }]);
  assert.equal(two.get('b').label, 'Probe helper');
});
test('prompts: one person per specialist, ask for an approved hire instead of spawning', () => {
  assert.match(MANAGER_PROMPT, /ONE person/);
  assert.match(MANAGER_PROMPT, /request_hire/);
  for (const k of Object.keys(SPECIALISTS)) assert.match(SPECIALISTS[k].prompt, /do not spawn/);
  const old = 'Hire with request_hire only.';
  assert.match(migrateBrief(old), /ONE person/);
  assert.equal(migrateBrief(migrateBrief(old)), null);
});

test('names can never end up duplicated, including via reset', () => {
  assert.throws(() => setAgentName({}, 'pixel', 'Forge'), /already used/, 'another agent default is refused');
  const n = setAgentName({}, 'forge', 'Ember');
  assert.throws(() => setAgentName(n, 'pixel', 'Forge'), /already used/, 'even when that agent was renamed');
  // stale file where pixel took a default another agent now owns again
  assert.deepEqual(sanitizeNames({ forge: 'Ember', pixel: 'Forge' }), { forge: 'Ember' });
  assert.deepEqual(sanitizeNames({ pixel: 'Forge' }), {});
  // reset of forge with a stale conflicting pixel override: the conflict is dropped, never duplicated
  const r = setAgentName({ forge: 'Ember', pixel: 'Forge', tiro: 'Boss' }, 'forge', '');
  assert.deepEqual(r, { tiro: 'Boss' });
  const d = displayNames({ forge: 'Ember', pixel: 'Forge' });
  assert.equal(new Set(Object.values(d).map(v => v.toLowerCase())).size, Object.keys(d).length);
});

test('hireGate.clear drops pending cards and unused grants', async () => {
  const g = hireGate({ ttl: 5000 });
  const a = g.request({ key: 'forge' }); g.decide(a.id, true);
  const b = g.request({ key: 'pixel' });
  g.clear();
  assert.deepEqual(await b.promise, { approved: false, reason: 'Cancelled.' });
  assert.equal(g.pending().length, 0);
  assert.equal(g.consume('forge'), false, 'grant gone');
});

test('server clears hires on every manager end path', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /function stopBoss\(\) \{ hires\.clear\(\)/);
  assert.match(src, /onEnd: \(\) => \{\s*hires\.clear\(\)/);
  assert.match(src, /hires\.clear\(\); fs\.rmSync\(BOSS_FILE/);
  assert.match(src, /b\.name === 'hiring' && !b\.on\) hires\.clear\(\)/);
  assert.match(src, /b\.name === 'kiro' && !b\.on\) stopBoss\(\)/);
});
