import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScanner, createSnapshotGate, trimLogs, capSet, capMap, pruneIdle, shouldProbe, shouldEndIdleSession, shouldCheckDocker, jittered, every, runSliced } from './perf.mjs';
import { usageLedger } from './usage.mjs';
import { createLyrics, MAX_FILES } from './desktop/lyrics.mjs';
import { apply, newAgent } from './transcript.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const P = '/proj';

// ---------- a fake file system with call counters ----------
function fakeFs() {
  const dirs = new Map(), files = new Map(); // path -> { mtimeMs } ; dir -> { mtimeMs, names:Set }
  const calls = { readdir: 0, stat: 0, read: 0 };
  const N = p => String(p).split(String.fromCharCode(92)).join('/'); // the scanner uses the platform path module
  const api = {
    calls,
    addDir(p, mtimeMs = 0) { dirs.set(p, { mtimeMs, names: new Set() }); },
    addFile(p, mtimeMs, size = 10, content = '') {
      const d = path.posix.dirname(p); if (!dirs.has(d)) api.addDir(d, mtimeMs);
      dirs.get(d).names.add(path.posix.basename(p)); files.set(p, { mtimeMs, size, content });
    },
    touchDir(p, t) { dirs.get(p).mtimeMs = t; },
    touchFile(p, t, size) { const f = files.get(p); f.mtimeMs = t; if (size) f.size = size; },
    readdirSync(p) { p = N(p); calls.readdir++; const d = dirs.get(p); if (!d) throw new Error('ENOENT'); return [...d.names]; },
    statSync(p) {
      p = N(p); calls.stat++;
      if (files.has(p)) { const f = files.get(p); return { mtimeMs: f.mtimeMs, size: f.size, isDirectory: () => false }; }
      if (dirs.has(p)) return { mtimeMs: dirs.get(p).mtimeMs, size: 0, isDirectory: () => true };
      throw new Error('ENOENT');
    },
    readFileSync(p) { p = N(p); calls.read++; const f = files.get(p); if (!f) throw new Error('ENOENT'); return f.content; },
    reset() { calls.readdir = calls.stat = calls.read = 0; },
    total: () => calls.readdir + calls.stat + calls.read,
  };
  // project folders list names of sub-folders too (readdir of the root returns the project dirs)
  const baseRead = api.readdirSync;
  api.readdirSync = p => (N(p) === P ? [...dirs.keys()].filter(k => path.posix.dirname(k) === P).map(k => path.posix.basename(k)) : baseRead(p));
  return api;
}
function bigTree(fx, t0, { projects = 30, sessions = 40, subs = 5 } = {}) {
  for (let i = 0; i < projects; i++) {
    const dir = `${P}/proj${i}`; fx.addDir(dir, t0);
    for (let j = 0; j < sessions; j++) {
      fx.addFile(`${dir}/s${j}.jsonl`, t0); // all old
      if (j < subs) { fx.addDir(`${dir}/s${j}/subagents`, t0); fx.addFile(`${dir}/s${j}/subagents/h${j}.jsonl`, t0); fx.addFile(`${dir}/s${j}/subagents/h${j}.meta.json`, t0, 10, '{"agentType":"x","finished":true}'); }
    }
  }
}

test('scanner: a big untouched tree costs no fs calls between cold ticks and about one stat per project folder on them', () => {
  const fx = fakeFs(), T0 = 1_000_000; let t = T0 + 10 * 3600e3;
  bigTree(fx, T0);
  const seen = []; const sc = createScanner({ projects: P, fs: fx, now: () => t, onFile: (...a) => seen.push(a) });
  sc.tick(); // first pass is a full scan
  const first = fx.total(); assert.ok(first > 1000, 'the full scan lists everything once: ' + first);
  assert.equal(sc.hotCount(), 0, 'nothing is recent, nothing is hot');
  for (const dt of [1000, 2000, 3000, 4000]) { t = T0 + 10 * 3600e3 + dt; fx.reset(); sc.tick(); assert.equal(fx.total(), 0, 'quiet tick at +' + dt + ' ms'); }
  t += 1100; fx.reset(); sc.tick(); // cold tick: look at folders only
  assert.ok(fx.total() <= 30 + 2, 'cold tick stats each project folder once: ' + fx.total());
  t += 60e3; fx.reset(); sc.tick(); assert.ok(fx.total() > 1000, 'a full rescan runs once a minute');
  // old behaviour: every tick touched every file. 60 ticks now cost about 1 full scan + a few cold ticks.
});

test('scanner: new session files and appends to hot files are noticed; helper meta is cached', () => {
  const fx = fakeFs(), T0 = 5_000_000; let t = T0;
  bigTree(fx, T0 - 10 * 3600e3, { projects: 3, sessions: 3, subs: 1 });
  const got = []; const sc = createScanner({ projects: P, fs: fx, now: () => t, onFile: (file) => got.push(path.basename(file)) });
  sc.tick(); got.length = 0;
  // a new session appears in a folder (folder mtime changes)
  fx.addFile(`${P}/proj1/new.jsonl`, T0 + 500); fx.touchDir(`${P}/proj1`, T0 + 500);
  t = T0 + 5500; sc.tick();
  assert.ok(got.includes('new.jsonl'), 'new session found on the next cold tick'); assert.equal(sc.hotCount() >= 1, true);
  // while it is hot only that file is stat'ed per tick
  got.length = 0; fx.reset(); fx.touchFile(`${P}/proj1/new.jsonl`, T0 + 5900, 99); t = T0 + 6000; sc.tick();
  assert.deepEqual(got, ['new.jsonl']); assert.equal(fx.total(), 1, 'one stat for the hot file, nothing else');
  // a helper under a hot session: found once, its meta is read once and cached for 30 s
  fx.addDir(`${P}/proj1/new/subagents`, T0 + 6100); fx.addFile(`${P}/proj1/new/subagents/h9.jsonl`, T0 + 6100); fx.addFile(`${P}/proj1/new/subagents/h9.meta.json`, T0 + 6100, 10, '{"agentType":"a"}');
  t = T0 + 11_000; fx.reset(); sc.tick();
  assert.ok(got.includes('h9.jsonl')); const metaReads = fx.calls.read;
  for (let i = 1; i <= 10; i++) { t += 1000; fx.touchFile(`${P}/proj1/new/subagents/h9.jsonl`, t - 10, 200 + i); sc.tick(); }
  assert.ok(fx.calls.read - metaReads <= 1, 'meta cached across ticks: ' + (fx.calls.read - metaReads));
});

test('snapshot gate: identical snapshots are skipped, hidden windows are coalesced, a visible window flushes', () => {
  let t = 0; const g = createSnapshotGate({ hiddenMs: 3000, now: () => t });
  assert.equal(g.decide('a', true), 'send'); assert.equal(g.decide('a', true), 'same');
  assert.equal(g.decide('b', true), 'send');
  t = 1000; assert.equal(g.decide('c', false), 'wait'); assert.equal(g.due(false), false);
  t = 3500; assert.equal(g.decide('c', false), 'send');
  t = 3600; assert.equal(g.decide('d', true), 'send', 'visible again: no waiting');
  g.reset(); assert.equal(g.decide('d', true), 'send', 'a new client gets the current state');
});

test('snapshot size budget at 8 agents: logs only in full for the selected agent and Tiro', () => {
  const mk = (id, isManager = false) => ({ id, isManager, name: id, status: 'working', logs: Array.from({ length: 60 }, (_, i) => ({ t: '12:00:00', k: 'tool', text: 'Bash: some command number ' + i + ' '.repeat(80) })) });
  const agents = [mk('boss', true), ...Array.from({ length: 8 }, (_, i) => mk('a' + i))];
  const full = JSON.stringify({ agents }).length;
  const out = trimLogs(agents, 'a3');
  const slim = JSON.stringify({ agents: out }).length;
  assert.ok(slim < full * 0.4, `slim ${slim} vs full ${full}`);
  assert.equal(out.find(a => a.id === 'a3').logs.length, 60); assert.equal(out.find(a => a.id === 'boss').logs.length, 60);
  assert.equal(out.find(a => a.id === 'a1').logs.length, 8);
  assert.equal(trimLogs(agents, undefined), agents, 'no selection reported: unchanged behaviour');
  assert.ok(slim < 30 * 1024, 'nine desks with long log lines stay under 30 KB: ' + slim);
});

test('ledger: byte offsets and day totals persist, a restart resumes without re-reading, big files stream in chunks', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-led-')), proj = path.join(d, 'p'), state = path.join(d, 'state.json');
  fs.mkdirSync(proj);
  const ts = new Date().toISOString();
  const line = (id, out) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: out } } }) + '\n';
  const f = path.join(proj, 's.jsonl');
  // 3000 lines of ~230 bytes with a multi-byte char: spans many 64 KB chunks
  let body = ''; for (let i = 0; i < 3000; i++) body += line('m' + i, 5).replace('claude-sonnet-4', 'claude-sonnet-4') + (i % 100 === 0 ? JSON.stringify({ type: 'user', message: { content: 'héllo ☃' } }) + '\n' : '');
  fs.writeFileSync(f, body);
  let bytes = 0; const orig = fs.readSync; fs.readSync = (...a) => { const n = orig(...a); bytes += n; return n; };
  try {
    const L = usageLedger(proj, { stateFile: state, chunk: 64 * 1024 }); L.refresh();
    assert.ok(Math.abs(bytes - fs.statSync(f).size) < 1, 'read the file once, in chunks: ' + bytes);
    const today = L.summary().at(-1); assert.equal(today.out, 3000 * 5); assert.equal(today.tokens, 3000 * 15);
    assert.ok(fs.existsSync(state));
    // restart: nothing new on disk, so nothing is read, and the totals are still there
    bytes = 0; const L2 = usageLedger(proj, { stateFile: state, chunk: 64 * 1024 }); L2.refresh();
    assert.equal(bytes, 0, 'resumed from the saved offset'); assert.equal(L2.summary().at(-1).out, 3000 * 5);
    // append: only the new bytes are read, with no double counting
    fs.appendFileSync(f, line('mNEW', 7)); bytes = 0; L2.refresh();
    assert.ok(bytes < 400, 'only the appended line: ' + bytes); assert.equal(L2.summary().at(-1).out, 3000 * 5 + 7);
    L2.refresh(); assert.equal(L2.summary().at(-1).out, 3000 * 5 + 7, 'idempotent');
  } finally { fs.readSync = orig; fs.rmSync(d, { recursive: true, force: true }); }
});

test('ledger: seen ids are capped per day and a corrupt state file is ignored', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-led2-')), proj = path.join(d, 'p'), state = path.join(d, 'state.json');
  fs.mkdirSync(proj); fs.writeFileSync(state, '{not json');
  const ts = new Date().toISOString();
  let body = ''; for (let i = 0; i < 500; i++) body += JSON.stringify({ type: 'assistant', timestamp: ts, message: { id: 'x' + i, model: 'claude-sonnet-4', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n';
  fs.writeFileSync(path.join(proj, 's.jsonl'), body);
  const L = usageLedger(proj, { stateFile: state, seenCap: 100 }); L.refresh();
  assert.equal(L.summary().at(-1).out, 500, 'all counted');
  // the cap only bounds memory: peek at it through a second ledger that re-reads from zero is not possible, so check the module bound directly
  const s = new Set(); for (let i = 0; i < 1000; i++) capSet(s.add('k' + i) && s, 100); assert.equal(s.size, 100);
  fs.rmSync(d, { recursive: true, force: true });
});

test('limits probe gating: never when idle and unseen, spaced when visible, faster only while Tiro works', () => {
  const base = { now: 100 * 60e3, last: 0 };
  assert.equal(shouldProbe({ ...base, visible: false, bossActive: false }), false, 'never spawned when idle');
  assert.equal(shouldProbe({ ...base, now: 10 * 60e3, visible: true, bossActive: false }), false, 'under 15 min');
  assert.equal(shouldProbe({ ...base, now: 15 * 60e3, visible: true, bossActive: false }), true);
  assert.equal(shouldProbe({ ...base, now: 6 * 60e3, visible: false, bossActive: true }), true, 'Tiro works: 5 min, even with no window');
  assert.equal(shouldProbe({ ...base, now: 4 * 60e3, visible: true, bossActive: true }), false);
  assert.equal(shouldProbe({ ...base, now: 20 * 60e3, visible: true, bossActive: false, minMs: 30 * 60e3 }), false, 'the setting is honoured');
});

test('idle Tiro session state machine: ends only when nothing depends on it', () => {
  const idle = { now: 1_000_000_000, lastActive: 1_000_000_000 - 16 * 60e3, idleMin: 15, hasSession: true };
  assert.equal(shouldEndIdleSession(idle), true);
  assert.equal(shouldEndIdleSession({ ...idle, lastActive: idle.now - 5 * 60e3 }), false, 'not idle long enough');
  assert.equal(shouldEndIdleSession({ ...idle, pendingAsks: 1 }), false, 'approval pending');
  assert.equal(shouldEndIdleSession({ ...idle, running: 1 }), false, 'a specialist is out');
  assert.equal(shouldEndIdleSession({ ...idle, doingGoals: 1 }), false, 'a goal is being worked on');
  assert.equal(shouldEndIdleSession({ ...idle, working: true }), false);
  assert.equal(shouldEndIdleSession({ ...idle, hasSession: false }), false);
  assert.equal(shouldEndIdleSession({ ...idle, idleMin: 0 }), false, '0 = never');
  const s = read('./server.mjs');
  assert.match(s, /shouldEndIdleSession\(/); assert.match(s, /stopBoss\(\)/); assert.match(s, /resume: saved\.date === today\(\) \? saved\.id/, 'resume by the saved session id is untouched');
  assert.match(s, /BOSS_FILE/); assert.doesNotMatch(s.slice(s.indexOf('shouldEndIdleSession('), s.indexOf('shouldEndIdleSession(') + 900), /rmSync\(BOSS_FILE/, 'the saved session id is kept');
});

test('bounded state: seen ids, maps, idle agents', () => {
  const a = newAgent('x');
  for (let i = 0; i < 2000; i++) apply(a, { type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm' + i, usage: { output_tokens: 1 }, content: [] } });
  assert.ok(a.seenMsg.size <= 500, 'seenMsg capped: ' + a.seenMsg.size);
  assert.ok(a.seenMsg.has('m1999') && !a.seenMsg.has('m0'));
  const m = new Map(); for (let i = 0; i < 50; i++) m.set(i, i); capMap(m, 10); assert.equal(m.size, 10); assert.ok(m.has(49) && !m.has(0));
  const now = 100 * 3600e3, agents = new Map([['old', { id: 'old', mtime: 0 }], ['fresh', { id: 'fresh', mtime: now - 1000 }], ['asks', { id: 'asks', mtime: 0, perms: [{}] }], ['boss', { id: 'boss', mtime: 0 }]]);
  const files = new Map([['f1', { id: 'old', mtime: 0 }], ['f2', { id: 'fresh', mtime: now }]]);
  assert.equal(pruneIdle({ agents, files, now, keep: x => x.id === 'boss' }), 1);
  assert.deepEqual([...agents.keys()].sort(), ['asks', 'boss', 'fresh']); assert.deepEqual([...files.keys()], ['f2']);
});

test('lyrics cache is bounded on disk', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-lyr-'));
  for (let i = 0; i < MAX_FILES + 60; i++) { const p = path.join(d, 'f' + i + '.json'); fs.writeFileSync(p, '{"v":1,"at":0,"lines":null}'); fs.utimesSync(p, new Date(1e9 + i * 1000), new Date(1e9 + i * 1000)); }
  createLyrics({ dir: d });
  const left = fs.readdirSync(d).length;
  assert.ok(left <= MAX_FILES, 'pruned to the newest files: ' + left); assert.ok(fs.existsSync(path.join(d, 'f' + (MAX_FILES + 59) + '.json')) && !fs.existsSync(path.join(d, 'f0.json')));
  fs.rmSync(d, { recursive: true, force: true });
});

test('docker check: only for an open rack panel or every 5 minutes', () => {
  assert.equal(shouldCheckDocker({ now: 100e3, last: 90e3, panelOpenAt: 0 }), false);
  assert.equal(shouldCheckDocker({ now: 100e3 + 5 * 60e3, last: 100e3, panelOpenAt: 0 }), true);
  assert.equal(shouldCheckDocker({ now: 130e3, last: 100e3, panelOpenAt: 125e3 }), true, 'panel open: every 30 s');
  assert.equal(shouldCheckDocker({ now: 110e3, last: 100e3, panelOpenAt: 105e3 }), false);
  assert.match(read('./office.mjs'), /shouldCheckDocker/); assert.match(read('./office.mjs'), /panelOpenAt = Date\.now\(\)/);
});

test('timers: jitter stays in range and never overlaps; sliced work yields between slices', async () => {
  for (let i = 0; i < 200; i++) { const j = jittered(1000, 0.15); assert.ok(j >= 850 && j <= 1150); }
  assert.equal(jittered(1000, 0.15, () => 0), 850); assert.equal(jittered(1000, 0.15, () => 1), 1150);
  // every(): the next run is scheduled only after the previous one finished
  const queue = []; let running = 0, maxRunning = 0, runs = 0;
  const timers = { setTimeout: fn => { queue.push(fn); return { unref() {} }; }, clearTimeout() {} };
  const stop = every(1000, async () => { running++; maxRunning = Math.max(maxRunning, running); await Promise.resolve(); runs++; running--; }, { timers });
  for (let i = 0; i < 3; i++) { const fn = queue.shift(); await fn(); }
  assert.equal(runs, 3); assert.equal(maxRunning, 1); stop();
  // runSliced: with a fake clock that advances 4 ms per step and a 10 ms budget the work yields about every 3 steps
  let clock = 0, yields = 0, steps = 0;
  function* work() { for (let i = 0; i < 30; i++) { steps++; yield; } return 'done'; }
  const r = await runSliced(work(), { budgetMs: 10, now: () => (clock += 4), yieldFn: fn => { yields++; setImmediate(fn); } });
  assert.equal(r, 'done'); assert.equal(steps, 30); assert.ok(yields >= 8, 'yielded to the event loop: ' + yields);
});

test('wiring: server, desktop shell and dashboard use the new pieces', () => {
  const s = read('./server.mjs'), m = read('./desktop/main.mjs'), h = read('./public/Agent Office.html');
  assert.match(s, /createScanner\(/); assert.doesNotMatch(s, /fs\.readdirSync\(PROJECTS\)/);
  assert.match(s, /createSnapshotGate\(/); assert.match(s, /trimLogs\(/); assert.match(s, /case '\/api\/visibility'/); assert.match(s, /case '\/api\/select'/);
  assert.match(s, /refreshAsync\(\)/); assert.doesNotMatch(s, /setInterval\(\(\) => \{ ledger\.refresh\(\)/);
  assert.match(s, /shouldProbe\(/); assert.doesNotMatch(s, /refreshLimits\(\); \}\s*\}, 30e3\)/);
  assert.match(s, /pruneIdle\(/);
  assert.ok(!/\/api\/(visibility|select)/.test((s.match(/const DECISIONS = new Set\(\[[^\]]*\]\)/) || [''])[0]), 'harmless endpoints need no nonce but do need the UI cookie');
  assert.match(m, /reportVisibility/); assert.match(m, /\/api\/visibility/); assert.match(m, /ao_ui=/);
  assert.match(m, /isleMode\(\) === 'smart' \? 200 : 1000/); assert.doesNotMatch(m, /setInterval\(\(\) => applyMgrName\(\), 3000\)/); assert.match(m, /fs\.watch\(CFG_DIR/);
  assert.match(m, /np\.start\(\)[^\n]*island\.isVisible\(\)|island\.isVisible\(\) && !isle\.fs\) np\.start\(\)/);
  assert.match(m, /watchFullscreen\(on && m === 'smart'\)/);
  assert.match(h, /api\('\/api\/select'/);
});

// Heap stays flat while a long session streams in. Opt in with AO_LEAK=1 and node --expose-gc (slow, so not part of the default run).
test('leak loop: heap is stable after 50k transcript lines', { skip: !(process.env.AO_LEAK === '1' && global.gc) }, () => {
  const a = newAgent('leak'); const ts = new Date().toISOString();
  const feed = n => { for (let i = 0; i < n; i++) { apply(a, { type: 'assistant', timestamp: ts, message: { id: 'u' + (a._n = (a._n || 0) + 1), usage: { output_tokens: 1 }, content: [{ type: 'text', text: 'line ' + i }, { type: 'tool_use', name: 'Bash', input: { command: 'echo ' + i } }] } }); apply(a, { type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', content: 'ok ' + i }] } }); } };
  feed(10000); global.gc(); const h1 = process.memoryUsage().heapUsed;
  feed(40000); global.gc(); const h2 = process.memoryUsage().heapUsed;
  assert.ok(h2 - h1 < 8 * 1024 * 1024, 'heap grew by ' + Math.round((h2 - h1) / 1024) + ' KB');
  assert.ok(a.logs.length <= 200 && a.seenMsg.size <= 500);
});
