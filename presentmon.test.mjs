import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseCsvHeader, parseCsvRow, frameMs, fpsStats, createFps, PM_SHA256, SESSION } from './desktop/presentmon.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
// The real PresentMon 2.6.0 header and a row (spike, 2026-11-19).
const HEAD = 'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,TimeInMs,MsBetweenSimulationStart,MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,MsRenderPresentLatency,MsUntilDisplayed,CPUStartTimeInMs,MsBetweenAppStart,MsCPUBusy,MsCPUWait,MsGPULatency,MsGPUTime,MsGPUBusy,MsGPUWait,MsAnimationError,AnimationTime,MsFlipDelay,MsAllInputToPhotonLatency,MsClickToPhotonLatency';
const ROW = 'electron.exe,29700,0x1C7FEF41660,DXGI,0,0,0,Composed: Flip,815.8871,NA,0.00000000000000,NA,0.1284,3.6208,NA,824.0163,0.1284,1,1,1,1,1,1,NA,NA,NA,NA,NA';

test('parseCsvHeader: finds CPUStartTimeInMs and ProcessID, else null', () => {
  assert.deepEqual(parseCsvHeader(HEAD), { cpuStart: 15, processId: 1 });
  assert.deepEqual(parseCsvHeader(HEAD + '\r'), { cpuStart: 15, processId: 1 }, 'CRLF');
  assert.equal(parseCsvHeader('Application,ProcessID,TimeInSeconds,msBetweenPresents'), null, 'v1 header has no CPUStartTimeInMs');
  assert.equal(parseCsvHeader('electron.exe,29700'), null);
  assert.equal(parseCsvHeader(''), null);
});

test('parseCsvRow: pid and CPU start time, null for a bad row', () => {
  const h = parseCsvHeader(HEAD);
  assert.deepEqual(parseCsvRow(ROW.split(','), h), { pid: 29700, t: 824.0163 });
  assert.equal(parseCsvRow('a,1'.split(','), h), null, 'short row');
  assert.equal(parseCsvRow(ROW.replace('824.0163', 'NA').split(','), h), null, 'NA time');
  assert.equal(parseCsvRow(ROW.replace(',29700,', ',x,').split(','), h), null, 'bad pid');
  assert.equal(parseCsvRow(null, h), null);
});

test('frameMs: deltas of sorted times, non-positive and over 1000 ms dropped', () => {
  assert.deepEqual(frameMs([0, 10, 20, 20, 1500, 1510]), [10, 10, 10]);
  assert.deepEqual(frameMs([5]), []);
  assert.deepEqual(frameMs([]), []);
});

test('fpsStats: now from the last 30, average, 1% low from the slowest 1%, capped at 3000, empty is null', () => {
  assert.deepEqual(fpsStats([]), { now: null, avg: null, low1: null });
  assert.deepEqual(fpsStats(Array(50).fill(10)), { now: 100, avg: 100, low1: 100 });
  const ms = [...Array(99).fill(10), 50]; // 100 frames, the slowest 1% is one frame of 50 ms
  const s = fpsStats(ms);
  assert.ok(Math.abs(s.avg - 1000 / 10.4) < 1e-9);
  assert.equal(s.low1, 20);
  assert.ok(Math.abs(s.now - 1000 / ((29 * 10 + 50) / 30)) < 1e-9, 'now: mean of the last 30');
  const capped = fpsStats([...Array(1000).fill(100), ...Array(3000).fill(10)]);
  assert.equal(capped.avg, 100, 'only the last 3000 frames count');
});

// ---------- the supervisor, driven with a fake process ----------
function fakeSpawn() {
  const made = [];
  const fn = (cmd, args) => { const p = new EventEmitter(); p.cmd = cmd; p.args = args; p.stdout = new PassThrough(); p.killed = false; p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit')); }; made.push(p); return p; };
  return { fn, made };
}
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const isRun = p => p.args.includes('--output_stdout');

test('fps supervisor: refuses an exe whose SHA-256 differs, spawns nothing', async () => {
  const sp = fakeSpawn(), got = [];
  const f = createFps(s => got.push(s), { spawnFn: sp.fn, platform: 'win32', exe: 'C:\\x\\pm.exe', hashOf: async () => 'bad' });
  f.start(7); await tick();
  assert.equal(sp.made.length, 0);
  assert.equal(got.at(-1).state, 'unavailable');
  f.stop();
});

test('fps supervisor: one session for the pid, rows out of order, stats every interval, restart on pid change, stop ends our session only', async () => {
  const sp = fakeSpawn(), got = [];
  const f = createFps(s => got.push(s), { spawnFn: sp.fn, platform: 'win32', exe: 'C:\\x\\pm.exe', hashOf: async () => PM_SHA256, interval: 20, backoff: 20 });
  f.start(7); f.start(7); await tick();
  const runs = () => sp.made.filter(isRun);
  assert.equal(runs().length, 1, 'one PresentMon');
  const a = runs()[0].args;
  assert.equal(runs()[0].cmd, 'C:\\x\\pm.exe');
  assert.deepEqual(a.slice(a.indexOf('--process_id'), a.indexOf('--process_id') + 2), ['--process_id', '7']);
  assert.deepEqual(a.slice(a.indexOf('--session_name'), a.indexOf('--session_name') + 2), ['--session_name', SESSION]);
  assert.ok(a.includes('--stop_existing_session') && a.includes('--no_console_stats'));
  assert.notEqual(SESSION.toLowerCase(), 'presentmon', 'never the default session name');
  const row = (pid, t) => ROW.replace(',29700,', `,${pid},`).replace('824.0163', String(t));
  runs()[0].stdout.write(HEAD + '\n' + [30, 10, 20, 0, 40].map(t => row(7, t)).join('\n') + '\n' + row(9, 5) + '\n' + row(7, 50).slice(0, 20));
  runs()[0].stdout.write(row(7, 50).slice(20) + '\n'); // a row split across chunks
  await tick(50);
  const s = got.filter(Boolean).at(-1);
  assert.equal(s.state, 'on');
  assert.equal(s.now, 100); assert.equal(s.avg, 100); assert.equal(s.low1, 100);
  assert.deepEqual(s.frames, [10, 10, 10, 10, 10], 'sorted, only our pid');
  f.start(8); await tick(30);
  assert.equal(sp.made.filter(isRun)[0].killed, true, 'old pid stopped');
  assert.equal(runs().length, 2); assert.ok(runs()[1].args.includes('8'));
  f.stop(); await tick(30);
  assert.equal(runs()[1].killed, true);
  const term = sp.made.filter(p => p.args.includes('--terminate_existing_session'));
  assert.ok(term.length >= 1, 'our ETW session is ended after a kill');
  for (const t of term) assert.deepEqual(t.args.slice(t.args.indexOf('--session_name'), t.args.indexOf('--session_name') + 2), ['--session_name', SESSION]);
  assert.equal(got.at(-1), null);
  const n = sp.made.length; await tick(60); assert.equal(sp.made.filter(isRun).length, 2, 'no restart after stop'); assert.ok(sp.made.length >= n);
});

test('fps supervisor: a pid change starts no terminate child that could race the new session', async () => {
  const sp = fakeSpawn();
  const f = createFps(() => {}, { spawnFn: sp.fn, platform: 'win32', exe: 'C:\\x\\pm.exe', hashOf: async () => PM_SHA256, interval: 20 });
  f.start(7); await tick(); f.start(8); await tick(); f.start(9); await tick(30);
  assert.equal(sp.made.filter(p => p.args.includes('--terminate_existing_session')).length, 0, 'no terminate on pid change');
  assert.equal(sp.made.filter(isRun).length, 3);
  assert.ok(sp.made.filter(isRun).every(p => p.args.includes('--stop_existing_session')), 'each launch clears a stale same-name session itself');
  f.stop(); await tick();
  assert.equal(sp.made.filter(p => p.args.includes('--terminate_existing_session')).length, 1, 'stop ends our session once');
});

test('fps supervisor: a relaunch for the same pid never mixes the old run\'s timestamps (both start near 0)', async () => {
  const sp = fakeSpawn(), got = [];
  const f = createFps(s => got.push(s), { spawnFn: sp.fn, platform: 'win32', exe: 'C:\\x\\pm.exe', hashOf: async () => PM_SHA256, interval: 20, backoff: 20 });
  const row = t => ROW.replace(',29700,', ',7,').replace('824.0163', String(t));
  const runs = () => sp.made.filter(isRun);
  f.start(7); await tick();
  runs()[0].stdout.write(HEAD + '\n' + [0, 10, 20, 30, 40, 50].map(row).join('\n') + '\n'); await tick(40);
  assert.equal(got.filter(Boolean).at(-1).now, 100, 'first run: 100 FPS');
  runs()[0].emit('exit'); await tick(50); // PresentMon died by itself; relaunched after the backoff
  assert.equal(runs().length, 2);
  runs()[1].stdout.write(HEAD + '\n' + [2, 22, 42, 62, 82].map(row).join('\n') + '\n'); await tick(40);
  const s = got.filter(Boolean).at(-1);
  assert.equal(s.now, 50, 'only the new run counts'); assert.equal(s.avg, 50); assert.deepEqual(s.frames, [20, 20, 20, 20]);
  f.stop();
});

test('fps supervisor: off Windows nothing runs', async () => {
  const sp = fakeSpawn(), got = [];
  const f = createFps(s => got.push(s), { spawnFn: sp.fn, platform: 'linux', hashOf: async () => PM_SHA256 });
  f.start(7); await tick(); f.stop();
  assert.equal(sp.made.length, 0);
});

// ---------- wiring (source checks) ----------
test('wiring: vendored, pinned, unpacked, never downloaded; payload, lifetime, setup button never pressed by a test', () => {
  const pkg = JSON.parse(read('./package.json')), main = read('./desktop/main.mjs'), pre = read('./desktop/island-preload.cjs'), pm = read('./desktop/presentmon.mjs');
  const sha = read('./vendor/presentmon/SHA256.txt');
  assert.match(sha, new RegExp(PM_SHA256, 'i'));
  assert.ok(fs.existsSync(new URL('./vendor/presentmon/LICENSE.txt', import.meta.url)));
  assert.ok(pkg.build.files.includes('vendor/presentmon/**'));
  assert.ok(pkg.build.asarUnpack.includes('vendor/presentmon/**'));
  assert.match(pm, /app\.asar\.unpacked/);
  assert.doesNotMatch(pm, /https?:\/\/|fetch\(|Invoke-WebRequest/i, 'never downloads');
  assert.match(pkg.scripts.test, /presentmon\.test\.mjs/);
  assert.match(read('./THIRD_PARTY_NOTICES.md'), /PresentMon 2\.6\.0/);
  assert.match(main, /function destroyIsland\(\) \{[^\n]*fpsMon\.stop\(\)/, 'destroyIsland stops PresentMon');
  assert.match(main, /app\.on\('before-quit', \(\) => \{[^\n]*fpsMon\.stop\(\)/, 'quit stops PresentMon');
  assert.match(main, /ipcMain\.handle\('island:fpsSetup', async \(e\) => \{ if \(!fromIsland\(e\)/);
  assert.match(main, /Add-LocalGroupMember -SID 'S-1-5-32-559' -Member '\$\{sid\}'/, 'the group by SID: its name is localized; the member by SID too');
  assert.match(main, /WindowsIdentity\]::GetCurrent\(\)\.User\.Value/, 'the member is the current user, read unelevated (works on Entra-joined PCs)');
  assert.match(main, /\/\^S-1-\[0-9-\]\+\$\/\.test\(sid\)/, 'the SID is validated before it is embedded');
  assert.doesNotMatch(main, /USERDOMAIN/, 'no DOMAIN\\user name');
  assert.match(main, /if \(fpsSetupBusy\) return \{ ok: false, busy: true \}/, 'a double click cannot open two UAC prompts');
  assert.match(pre, /fpsSetup: \(\) => ipcRenderer\.invoke\('island:fpsSetup'\)/);
});
