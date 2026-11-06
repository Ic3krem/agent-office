import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goalStore, paceFor, paceError, priorityError, hirePace, hireGate, promptHash, ALIASES, ROSTER, MAX_SPECIALISTS, hireKey } from './company.mjs';

const ON = { hiring: true, guard: true };
const boost = { pace: 'boost' };

test('paceFor boost ok', () => {
  assert.deepEqual(paceFor(boost, ON, { models: [{ name: 'Opus', pct: 40 }] }, false), { model: 'opus', effort: 'high' });
  assert.deepEqual(paceFor(boost, ON, null, false), { model: 'opus', effort: 'high' }, 'unknown limits do not block Boost');
});

test('paceFor boost skipped when hiring off / over limit with guard on / opus window >= 100', () => {
  assert.ok(paceFor(boost, { hiring: false, guard: true }, null, false).skip);
  assert.ok(paceFor(boost, ON, null, true).skip, 'over the plan limit with the guard on');
  assert.deepEqual(paceFor(boost, { hiring: true, guard: false }, null, true), { model: 'opus', effort: 'high' }, 'guard off: the limit does not block');
  assert.ok(paceFor(boost, ON, { models: [{ name: 'Claude Opus', pct: 100 }] }, false).skip);
  assert.deepEqual(paceFor(boost, ON, { models: [{ name: 'Sonnet', pct: 100 }] }, false), { model: 'opus', effort: 'high' }, 'only the Opus window counts');
});

test('paceFor speed and none', () => {
  assert.deepEqual(paceFor({ pace: 'speed' }, ON, null, true), { model: 'haiku', effort: 'low' });
  assert.equal(paceFor({ pace: null }, ON, null, false), null);
  assert.equal(paceFor(undefined, ON, null, false), null);
});

test('done clears pace and priority; new goals default to normal / no pace', () => {
  const s = goalStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gp-')), 'goals.json'));
  const g = s.add('ship it');
  assert.equal(g.priority, 'normal'); assert.equal(g.pace, null);
  s.update(g.id, { priority: 'high', pace: 'boost' });
  assert.equal(s.list()[0].priority, 'high'); assert.equal(s.list()[0].pace, 'boost');
  s.update(g.id, { status: 'done' });
  assert.equal(s.list()[0].priority, 'normal'); assert.equal(s.list()[0].pace, null);
});

test('pace route rejects a done goal with 409 and bad values with 400', () => {
  assert.equal(paceError({ status: 'done' }, 'boost').status, 409);
  assert.equal(paceError({ status: 'dismissed' }, null).status, 409);
  assert.equal(paceError({ status: 'doing' }, 'turbo').status, 400);
  for (const st of ['todo', 'doing', 'blocked']) assert.equal(paceError({ status: st }, 'speed'), null);
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(paceError({ status: 'doing' }, k).status, 400, 'prototype key ' + k + ' is not a pace');
    assert.equal(priorityError({ status: 'doing' }, k).status, 400, 'prototype key ' + k + ' is not a priority');
    assert.equal(paceFor({ pace: k }, ON, null, false), null);
  }
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /const DECISIONS = new Set\(\[[^\]]*'\/api\/goal\/priority', '\/api\/goal\/pace'/);
});

test('priority route rejects a done goal with 409 and bad values with 400', () => {
  assert.equal(priorityError({ status: 'done' }, 'high').status, 409);
  assert.equal(priorityError({ status: 'dismissed' }, 'normal').status, 409);
  assert.equal(priorityError({ status: 'doing' }, 'urgent').status, 400);
  for (const st of ['todo', 'doing', 'blocked']) assert.equal(priorityError({ status: st }, 'high'), null);
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(!\('pace' in b\)\) return json\(res, 400/, 'a missing pace key is a 400; explicit null clears');
});

test('a hire request for a boosted goal exposes its pace and model on the approval card', () => {
  assert.deepEqual(hirePace({ pace: 'boost' }, ON, null, false), { pace: 'boost', model: 'opus' });
  assert.deepEqual(hirePace({ pace: 'speed' }, ON, null, false), { pace: 'speed', model: 'haiku' });
  assert.equal(hirePace({ pace: 'boost' }, ON, null, true).pace, 'boost');
  assert.match(hirePace({ pace: 'boost' }, ON, null, true).paceSkip, /plan limit/);
  assert.deepEqual(hirePace(undefined, ON, null, false), { pace: null });
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /hires: hires\.pending\(\)\.map\(h => \(\{ \.\.\.h, \.\.\.hirePace\(goals\.list\(\)\.find\(g => g\.id === h\.goalId\), sw\(\), limits, overLimit\(\), h\.key\) \}\)\)/);
});

test('hireHook applies pace to updatedInput for that goal only', async () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const code = src.slice(src.indexOf('const starting = new Map()'), src.indexOf('const bossOptions = () =>'));
  const store = goalStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gp-')), 'goals.json'));
  const a = store.add('boosted'), b = store.add('plain');
  store.update(a.id, { pace: 'boost' });
  let espresso = true; const notes = [];
  const env = {
    sw: () => ({ hiring: true, guard: true, espresso }), boss: { running: 0, progress: false, keys: [] }, MAX_SPECIALISTS, ALIASES, ROSTER, hireKey,
    currentKeys: () => [], dnames: () => ({}), hires: hireGate(), hireGoal: {}, AH: { start() {} }, bump: () => {}, switches: { set(k, v) { if (k === 'espresso') espresso = v; } },
    goals: store, paceFor, limits: null, overLimit: () => false, host: { note: t => notes.push(t) },
  };
  const { hireHook } = new Function(...Object.keys(env), code + '\nreturn { hireHook };')(...Object.values(env));
  const hire = async (goalId, prompt) => {
    const { id, promise } = env.hires.request({ key: 'general-purpose', goalId, promptHash: promptHash(prompt) }); env.hires.decide(id, true); await promise;
    return hireHook({ tool_use_id: prompt, tool_input: { subagent_type: 'general-purpose', prompt } });
  };
  const r1 = await hire(a.id, 'Boosted work, please do it.');
  assert.equal(r1.hookSpecificOutput.updatedInput.model, 'opus', 'pace wins over espresso');
  assert.equal(r1.hookSpecificOutput.updatedInput.effort, 'high');
  assert.equal(r1.hookSpecificOutput.updatedInput.prompt, 'Boosted work, please do it.');
  const r2 = await hire(b.id, 'Plain work, please do it.');
  assert.equal(r2.hookSpecificOutput.updatedInput.model, 'haiku', 'no pace: espresso still applies');
  const r3 = await hire(b.id, 'Plain work again, please.');
  assert.deepEqual(r3, {}, 'no pace and no espresso: unchanged');
  // Boost while over the Opus window: the hire proceeds on its own model and Tiro and the user are told.
  const { hireHook: h2 } = new Function(...Object.keys(env), code + '\nreturn { hireHook };')(...Object.values({ ...env, limits: { models: [{ name: 'Opus', pct: 100 }] } }));
  const P = 'Boosted work, second hire.';
  { const { id, promise } = env.hires.request({ key: 'general-purpose', goalId: a.id, promptHash: promptHash(P) }); env.hires.decide(id, true); await promise; }
  const r4 = await h2({ tool_use_id: 'x', tool_input: { subagent_type: 'general-purpose', prompt: P } });
  assert.equal(r4.hookSpecificOutput.updatedInput, undefined);
  assert.match(r4.hookSpecificOutput.additionalContext, /^Boost skipped: /);
  assert.match(notes.at(-1), /^Boost skipped: /);
  // A skipped Boost with espresso on: espresso still applies, in the same hook output as the note.
  espresso = true;
  const P2 = 'Boosted work, third hire.';
  { const { id, promise } = env.hires.request({ key: 'general-purpose', goalId: a.id, promptHash: promptHash(P2) }); env.hires.decide(id, true); await promise; }
  const r5 = await h2({ tool_use_id: 'y', tool_input: { subagent_type: 'general-purpose', prompt: P2 } });
  assert.equal(r5.hookSpecificOutput.updatedInput.model, 'haiku');
  assert.match(r5.hookSpecificOutput.additionalContext, /^Boost skipped: /);
  assert.equal(espresso, false, 'the cup is used up');
});

test('array/object/number pace and priority are rejected; a coerced pace never reaches Boost', () => {
  for (const bad of [['boost'], { x: 1 }, 1, true]) {
    assert.equal(paceError({ status: 'doing' }, bad).status, 400);
    assert.equal(priorityError({ status: 'doing' }, bad).status, 400);
  }
  assert.equal(paceError({ status: 'doing' }, null), null);
  const full = { models: [{ name: 'Opus', pct: 100 }] };
  assert.equal(paceFor({ pace: ['boost'] }, ON, full, false), null);
  assert.equal(hirePace({ pace: ['boost'] }, ON, full, false).pace, null);
});

test('fork hires show no pace line', () => {
  assert.deepEqual(hirePace({ pace: 'boost' }, ON, null, false, 'fork'), { pace: null });
  assert.equal(hirePace({ pace: 'boost' }, ON, null, false, 'general-purpose').model, 'opus');
});

test('priority and pace clicks never start a Tiro session; list_goals sorts high first', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const pace = src.slice(src.indexOf("case '/api/goal/pace'"), src.indexOf("case '/api/scheduler'"));
  assert.doesNotMatch(pace, /tellBoss/);
  const pri = src.slice(src.indexOf("case '/api/goal/priority'"), src.indexOf("case '/api/goal/pace'"));
  assert.doesNotMatch(pri, /tellBoss/);
  assert.match(pri, /if \(boss\.id && boss\.push && /, 'note only pushed into a running session');
  assert.match(src, /\.sort\(\(a, b\) => \(b\.priority === 'high'\) - \(a\.priority === 'high'\)\)/);
  const t = [{ id: 1 }, { id: 2, priority: 'high' }, { id: 3, priority: 'normal' }, { id: 4, priority: 'high' }]
    .map(g => ({ priority: 'normal', ...g })).sort((a, b) => (b.priority === 'high') - (a.priority === 'high')).map(g => g.id);
  assert.deepEqual(t, [2, 4, 1, 3], 'stable');
});
