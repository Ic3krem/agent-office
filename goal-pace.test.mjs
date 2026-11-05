import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goalStore, paceFor, paceError, hireGate, promptHash, ALIASES, ROSTER, MAX_SPECIALISTS, hireKey } from './company.mjs';

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
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /const DECISIONS = new Set\(\[[^\]]*'\/api\/goal\/priority', '\/api\/goal\/pace'/);
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
  env.limits = null;
  const { hireHook: h2 } = new Function(...Object.keys(env), code + '\nreturn { hireHook };')(...Object.values({ ...env, limits: { models: [{ name: 'Opus', pct: 100 }] } }));
  const P = 'Boosted work, second hire.';
  { const { id, promise } = env.hires.request({ key: 'general-purpose', goalId: a.id, promptHash: promptHash(P) }); env.hires.decide(id, true); await promise; }
  const r4 = await h2({ tool_use_id: 'x', tool_input: { subagent_type: 'general-purpose', prompt: P } });
  assert.equal(r4.hookSpecificOutput.updatedInput, undefined);
  assert.match(r4.hookSpecificOutput.additionalContext, /^Boost skipped: /);
  assert.match(notes.at(-1), /^Boost skipped: /);
});
