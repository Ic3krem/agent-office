import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelegator } from './external-delegate.mjs';
import { hireGate } from './company.mjs';
import { redact } from './redact.mjs';

const KEY = 'ext-codex-1', PROMPT = 'Review the parser in src/parse.js and list bugs.';
function setup({ run, settings = () => ({}), launch = () => ({ cmd: 'codex', pre: [] }), max = 8, approve = true } = {}) {
  const hires = hireGate(), calls = { run: 0, inc: 0, dec: 0, tell: [], start: [], end: [], lines: [] };
  let running = 0, told;
  const toldP = new Promise(r => { told = r; });
  if (approve) { const { id } = hires.request({ key: KEY, goalId: 'g1', promptHash: undefined, prompt: PROMPT }); hires.decide(id, true); }
  const d = createDelegator({
    hires, settings, launch, redact, timeoutMs: 1200000,
    run: async o => { calls.run++; calls.opts = o; return run ? run(o) : { ok: true, code: 0, stdoutTail: '{"type":"item.completed","item":{"type":"agent_message","text":"all good"}}\n' }; },
    tell: t => { calls.tell.push(t); told(t); },
    onStart: (key, goalId, prompt) => { calls.start.push([key, goalId, prompt]); return 'ext-agent-1'; },
    onLine: (id, l) => calls.lines.push([id, l]), onEnd: (id, r) => calls.end.push([id, r]),
    max: () => max, running: () => running, inc: () => { calls.inc++; running++; }, dec: () => { calls.dec++; running--; },
    cwd: () => '/work', nameOf: k => ({ 'ext-codex-1': 'Codex' })[k] || k,
  });
  return { d, hires, calls, toldP, setRunning: n => { running = n; } };
}
// hireGate's request uses promptHash from the spec; build the grant the way request_hire does.
import { promptHash } from './company.mjs';
function approved(hires, key, prompt) { const { id } = hires.request({ key, goalId: 'g1', promptHash: promptHash(prompt) }); hires.decide(id, true); }

test('needs an approved grant', () => {
  const { d, calls } = setup({ approve: false });
  const r = d.delegate(KEY, PROMPT);
  assert.equal(r.ok, false); assert.match(r.error, /^Hiring needs user approval first: call mcp__office__request_hire/);
  assert.equal(calls.run, 0); assert.equal(calls.inc, 0);
});

test('unknown or non-external key', () => {
  const { d } = setup();
  assert.match(d.delegate('forge', PROMPT).error, /not an external specialist/);
  assert.match(d.delegate('ext-codex-9', PROMPT).error, /not an external specialist/);
});

test('prompt must match', () => {
  const { d, hires } = setup({ approve: false });
  approved(hires, KEY, 'prompt A, long enough to be real');
  assert.match(d.delegate(KEY, 'prompt B').error, /^The prompt must be exactly the prompt approved in request_hire/);
});

test('one approval, one run', async () => {
  const { d, hires, calls, toldP } = setup({ approve: false });
  approved(hires, KEY, PROMPT);
  assert.deepEqual(d.delegate(KEY, PROMPT), { ok: true, text: 'started' });
  assert.deepEqual(calls.start, [[KEY, 'g1', PROMPT]]);
  assert.equal(calls.opts.stdin, PROMPT); assert.equal(calls.opts.cwd, '/work');
  assert.deepEqual(d.active(), [KEY]);
  assert.match(await toldP, /^Codex \(Codex CLI\) finished: all good$/);
  assert.match(d.delegate(KEY, PROMPT).error, /^Hiring needs user approval first/);
  assert.deepEqual([calls.inc, calls.dec, calls.run], [1, 1, 1]);
  assert.deepEqual(d.active(), []);
  assert.deepEqual(calls.end, [['ext-agent-1', { ok: true, summary: 'all good' }]]);
});

test('team full does not use the grant; a busy desk is refused', async () => {
  const { d, hires, setRunning } = setup({ approve: false, run: () => new Promise(() => {}) });
  approved(hires, KEY, PROMPT);
  setRunning(8);
  assert.equal(d.delegate(KEY, PROMPT).error, '8 specialists are already working. Wait for a report first.');
  assert.equal(hires.check(KEY, PROMPT).ok, true, 'grant kept');
  setRunning(0);
  assert.equal(d.delegate(KEY, PROMPT).ok, true);
  approved(hires, KEY, PROMPT);
  assert.equal(d.delegate(KEY, PROMPT).error, 'Codex is already working on a task.');
});

test('failure releases the count', async () => {
  const { d, hires, calls, toldP } = setup({ approve: false, run: () => ({ ok: false, code: 1, stdoutTail: '', stderrTail: 'warming up\nError: not logged in\n' }) });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  assert.equal(await toldP, 'Codex (Codex CLI) could not finish: Error: not logged in');
  assert.equal(calls.dec, 1); assert.equal(calls.end[0][1].ok, false);
});

test('a JSON error on stderr (Gemini not signed in) is reported, not its last line', async () => {
  const err = '{\n  "session_id": "x",\n  "error": {\n    "type": "Error",\n    "message": "Please set an Auth method",\n    "code": 41\n  }\n}\n';
  const { d, hires, toldP } = setup({ approve: false, run: () => ({ ok: false, code: 41, stdoutTail: '', stderrTail: err }) });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  assert.match(await toldP, /could not finish: Please set an Auth method$/);
});

test('run throws (spawn ENOENT): one clear line, no unhandled rejection', async () => {
  const { d, hires, calls, toldP } = setup({ approve: false, run: () => { throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }); } });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  assert.match(await toldP, /could not finish: Codex CLI is not installed on this PC \(see the Agents panel\)\.$/);
  assert.equal(calls.dec, 1);
});

test('not installed, custom without a command, bad model: refused before the grant is used', () => {
  const a = setup({ approve: false, launch: () => null }); approved(a.hires, KEY, PROMPT);
  assert.equal(a.d.delegate(KEY, PROMPT).error, 'Codex CLI is not installed on this PC (see the Agents panel).');
  assert.equal(a.hires.check(KEY, PROMPT).ok, true);
  const b = setup({ approve: false }); approved(b.hires, 'ext-custom-1', PROMPT);
  assert.equal(b.d.delegate('ext-custom-1', PROMPT).error, 'This desk has no confirmed command; set it in the Agents panel.');
  const c = setup({ approve: false, settings: () => ({ model: 'a b' }) }); approved(c.hires, KEY, PROMPT);
  assert.match(c.d.delegate(KEY, PROMPT).error, /Invalid model name/);
  const e = setup({ approve: false, launch: () => ({ error: 'Cannot run this CLI safely from TiroAgents (unrecognised launcher)' }) }); approved(e.hires, KEY, PROMPT);
  assert.match(e.d.delegate(KEY, PROMPT).error, /unrecognised launcher/);
});

test('answer is redacted and capped', async () => {
  const secret = 'sk-ant-api03-' + 'A'.repeat(40);
  const text = 'key ' + secret + ' ' + 'x'.repeat(50000);
  const { d, hires, toldP } = setup({ approve: false, run: () => ({ ok: true, code: 0, stdoutTail: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) }) });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  const t = await toldP;
  assert.ok(!t.includes(secret));
  assert.ok(t.length <= 20000 + 'Codex (Codex CLI) finished: '.length + ' (truncated)'.length);
  assert.ok(t.endsWith(' (truncated)'));
});

test('empty answer is a failure', async () => {
  const { d, hires, toldP } = setup({ approve: false, run: () => ({ ok: true, code: 0, stdoutTail: '' }) });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  assert.equal(await toldP, 'Codex (Codex CLI) could not finish: it printed no answer');
});

test('stop and timeout', async () => {
  const { d, hires, toldP } = setup({ approve: false, run: o => new Promise(r => o.signal.addEventListener('abort', () => r({ ok: false, code: null, stdoutTail: '', stderrTail: '', stopped: true }))) });
  approved(hires, KEY, PROMPT); d.delegate(KEY, PROMPT);
  assert.equal(d.stop(KEY), true); assert.equal(d.stop('ext-gemini-1'), false);
  assert.equal(await toldP, 'Codex (Codex CLI) could not finish: stopped by the user');
  const t = setup({ approve: false, run: () => ({ ok: false, code: null, timedOut: true, stdoutTail: '', stderrTail: '' }) });
  approved(t.hires, KEY, PROMPT); t.d.delegate(KEY, PROMPT);
  assert.equal(await t.toldP, 'Codex (Codex CLI) could not finish: timed out after 20 minutes');
});

test('server wiring: delegate is an office tool, runs outlive Tiro\'s session, quitting stops them', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /allowedTools: \['request_hire', 'delegate',/);
  assert.match(src, /tool\('delegate', /);
  assert.match(src, /running: delegator\.active\(\)\.length, reload: false/, 'a session end keeps the external runs counted');
  assert.doesNotMatch(src.match(/function stopBoss\(\) \{[^\n]*/)[0], /killExternal|delegator/, 'stopping Tiro does not stop external runs');
  assert.match(src, /if \(\/\^ext-\/\.test\(String\(input\.tool_input\?\.subagent_type\)\)\) return no\(/, 'the Agent tool never runs an external desk');
  assert.match(src, /'approved\. Call mcp__office__delegate once with specialist ' \+ key \+ ' and exactly the prompt you submitted\.'/);
  assert.match(src, /case '\/api\/external\/stop'/);
  assert.match(src, /process\.once\('SIGTERM', \(\) => \{ killExternal\(\); process\.exit\(0\); \}\)/);
  const main = fs.readFileSync(new URL('./desktop/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /'\/T', '\/F'\]/, 'the app kills the server\'s whole tree on quit (Windows)');
  const run = fs.readFileSync(new URL('./external-run.mjs', import.meta.url), 'utf8');
  assert.match(run, /process\.once\('exit', killAll\)/);
  for (const f of ['./external-run.mjs', './external-agents.mjs', './external-delegate.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /shell:\s*true\s*[,}]/, f);
});

test('party: external desks travel as ordinary agents with generic bubbles only', async () => {
  const { cleanAgent } = await import('./party/protocol.mjs');
  for (const key of ['ext-codex-1', 'ext-gemini-3', 'ext-opencode-3', 'ext-custom-2'])
    assert.deepEqual(cleanAgent({ id: 'a1', name: 'Ollie', key, state: 'working', bubble: 'Coding…', command: 'x', prompt: 'p' }), { id: 'a1', name: 'Ollie', key, state: 'working', bubble: 'Coding…' });
});
