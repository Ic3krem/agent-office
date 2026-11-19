import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { isGame, parsePerfLine, IGNORE, KNOWN_GAMES } from './desktop/game-detect.mjs';
import { createPerfMonitor } from './desktop/perf-monitor.mjs';
import { normalizeSettings, applyPatch, DEFAULT_SETTINGS, gameName } from './desktop/island-logic.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const mon = { x: 0, y: 0, w: 1920, h: 1080 };
const full = { x: 0, y: 0, w: 1920, h: 1080 };
const win = { x: 100, y: 100, w: 1280, h: 720 };

test('isGame: known list, user list, a window covering its monitor, and the ignore list', () => {
  const rows = [
    [{ proc: 'cs2', fg: win, monitor: mon }, {}, true, 'a known game in a window'],
    [{ proc: 'mygame', fg: full, monitor: mon }, {}, true, 'an unknown process covering the monitor'],
    [{ proc: 'mygame', fg: { x: -8, y: -8, w: 1936, h: 1096 }, monitor: mon }, {}, true, 'covering with an overhang'],
    [{ proc: 'chrome', fg: full, monitor: mon }, {}, false, 'a browser covering the monitor (fullscreen video)'],
    [{ proc: 'explorer', fg: full, monitor: mon }, {}, false, 'the desktop'],
    [{ proc: 'mygame', fg: win, monitor: mon }, {}, false, 'an unknown process in a window'],
    [{ proc: 'mygame', fg: win, monitor: mon }, { games: ['mygame'] }, true, 'a user-added name'],
    [{ proc: 'mygame', fg: full, monitor: { x: 1920, y: 0, w: 2560, h: 1440 } }, {}, false, 'covers another rectangle, not its own monitor'],
    [{ proc: 'mygame', fg: full, monitor: mon, max: true }, {}, false, 'a maximized window (auto-hide taskbar) is not a fullscreen game'],
    [{ proc: null, fg: full, monitor: mon }, {}, false, 'no process name'],
    [{ proc: 'mygame', fg: null, monitor: mon }, {}, false, 'no rectangle'],
    [{ proc: 'steam', fg: full, monitor: mon }, {}, false, 'a launcher is not a game'],
    ...['ms-teams', 'teams', 'zoom', 'mstsc', 'msrdc', 'photos', 'microsoft.photos', 'code', 'powerpnt', 'soffice.bin', 'acrobat', 'acrord32', 'obs64', 'anydesk', 'teamviewer', 'vmconnect', 'vmware', 'virtualboxvm', 'windowsterminal']
      .map(proc => [{ proc, fg: full, monitor: mon }, {}, false, proc + ' covering the monitor is not a game (meeting, remote desktop, media, presentation or editor)']),
  ];
  for (const [s, o, want, why] of rows) assert.equal(isGame(s, o), want, why);
  assert.equal(isGame(null), false); assert.equal(isGame({}), false);
});

test('game lists: lower-case base names, sorted, launchers only on the ignore list', () => {
  for (const l of [KNOWN_GAMES, IGNORE]) {
    for (const n of l) assert.match(n, /^[a-z0-9._-]{1,40}$/, n);
    assert.deepEqual([...l], [...l].sort(), 'sorted');
  }
  assert.ok(KNOWN_GAMES.length >= 24 && KNOWN_GAMES.length <= 60, 'a few dozen');
  for (const n of ['steam', 'steamwebhelper', 'epicgameslauncher', 'chrome', 'msedge', 'firefox', 'vlc', 'explorer', 'applicationframehost', 'tiroagents', 'electron']) assert.ok(IGNORE.includes(n), n);
  for (const n of KNOWN_GAMES) assert.ok(!IGNORE.includes(n), n + ' is on both lists');
});

test('parsePerfLine: a full line, a line with null GPU values, garbage and hostile values', () => {
  const line = { proc: 'cs2', pid: 4242, fg: { x: 0, y: 0, w: 1920, h: 1080 }, monitor: { x: 0, y: 0, w: 1920, h: 1080 }, max: false, cpu: 31.46, mem: 12.25, gpu: 87.5, gpuTemp: 66 };
  assert.deepEqual(parsePerfLine(JSON.stringify(line)), line);
  const noGpu = parsePerfLine(JSON.stringify({ ...line, gpu: null, gpuTemp: null }));
  assert.equal(noGpu.gpu, null); assert.equal(noGpu.gpuTemp, null); assert.equal(noGpu.cpu, 31.46);
  const missing = parsePerfLine('{"cpu":5}');
  assert.deepEqual(missing, { proc: null, pid: null, fg: null, monitor: null, max: false, cpu: 5, mem: null, gpu: null, gpuTemp: null }, 'missing values are null, never 0');
  for (const bad of ['', 'junk', 'null', '[]', '42', '"x"', '{', JSON.stringify({ ...line, proc: 'x'.repeat(3000) })]) assert.equal(parsePerfLine(bad), null, bad.slice(0, 30));
  const hostile = parsePerfLine(JSON.stringify({ proc: 'Evil Name<script>', pid: -1, fg: { x: 0.5, y: 0, w: 10, h: 10 }, monitor: { x: 0, y: 0, w: 'a', h: 1 }, max: 'yes', cpu: 101, mem: 5000, gpu: -1, gpuTemp: 151 }));
  assert.deepEqual(hostile, { proc: null, pid: null, fg: null, monitor: null, max: false, cpu: null, mem: null, gpu: null, gpuTemp: null });
  assert.equal(parsePerfLine(JSON.stringify({ proc: 'a'.repeat(61) })).proc, null, 'process name at most 60');
  assert.equal(parsePerfLine(JSON.stringify({ proc: 'r5apex_dx12.x64' })).proc, 'r5apex_dx12.x64');
  assert.equal(parsePerfLine(JSON.stringify({ cpu: '5' })).cpu, null, 'a number as text is not a number');
  assert.equal(parsePerfLine(JSON.stringify({ cpu: 0, gpu: 100, gpuTemp: 0, mem: 0 })).gpu, 100, 'edges of the ranges are kept');
});

test('settings: gameMode (auto/always/never) and the user game list are validated', () => {
  assert.equal(DEFAULT_SETTINGS.gameMode, 'auto'); assert.deepEqual(DEFAULT_SETTINGS.games, []);
  assert.equal(normalizeSettings({}).gameMode, 'auto');
  for (const m of ['auto', 'always', 'never']) assert.equal(normalizeSettings({ gameMode: m }).gameMode, m);
  assert.equal(normalizeSettings({ gameMode: 'on' }).gameMode, 'auto');
  assert.deepEqual(normalizeSettings({ games: ['MyGame.exe', 'mygame', 'bad name!', 42, '', 'x'.repeat(41), 'League of Legends.exe'] }).games, ['mygame', 'league_of_legends']);
  assert.deepEqual(normalizeSettings({ games: 'mygame' }).games, []);
  assert.equal(normalizeSettings({ games: Array.from({ length: 80 }, (_, i) => 'g' + i) }).games.length, 50);
  assert.deepEqual(applyPatch({ games: ['a'] }, { gameMode: 'never' }).games, ['a'], 'a patch keeps the list');
  assert.equal(gameName(' Cyberpunk2077.EXE '), 'cyberpunk2077'); assert.equal(gameName('a/b'), ''); assert.equal(gameName(null), '');
});

test('settings rows: the page keeps a display copy and draws the game mode row and the list editor', () => {
  const page = ['notch-core.js', 'notch-views.js', 'notch-page.js'].map(f => read('./public/' + f)).join('\n');
  assert.match(page, /gameMode: 'auto', games: \[\]/, 'page defaults');
  assert.match(page, /chips\('gameMode', \[\['auto', 'Auto'\], \['always', 'Always'\], \['never', 'Never'\]\]\)/);
  assert.match(page, /data-gameform/); assert.match(page, /data-gamedel/);
  assert.match(page, /\[a-z0-9\._-\]\{1,40\}/, 'the page validates a name the same way');
});

// ---------- the supervisor, driven with a fake process ----------
function fakeSpawn() {
  const made = [];
  const fn = (cmd, args) => { const p = new EventEmitter(); p.cmd = cmd; p.args = args; p.stdout = new PassThrough(); p.stdin = new PassThrough(); p.killed = false; p.kill = () => { p.killed = true; p.emit('exit'); }; made.push(p); return p; };
  return { fn, made };
}
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));

test('perf monitor (Windows): parses lines, skips garbage, emits null and restarts with backoff when the helper dies, stops on demand', async () => {
  const sp = fakeSpawn(), got = [];
  const m = createPerfMonitor(s => got.push(s), { spawnFn: sp.fn, platform: 'win32', script: 'C:\\x\\perf.ps1', backoff: 20 });
  m.start(); m.start();
  assert.equal(sp.made.length, 1, 'one helper');
  assert.equal(sp.made[0].cmd, 'powershell.exe'); assert.ok(sp.made[0].args.includes('C:\\x\\perf.ps1'));
  sp.made[0].stdout.write('{"proc":"cs2","pid":7,"cpu":10}\njunk\n{"cpu":2');
  await tick();
  assert.equal(got.length, 1, 'garbage is skipped'); assert.equal(got[0].proc, 'cs2'); assert.equal(m.current.cpu, 10);
  sp.made[0].stdout.write('0}\n'); await tick();
  assert.equal(got.at(-1).cpu, 20, 'a line split across chunks');
  sp.made[0].stdout.write('x'.repeat(3000)); sp.made[0].stdout.write('\n{"cpu":3}\n'); await tick();
  assert.equal(got.at(-1).cpu, 3, 'an over-long line is dropped, the next one is read');
  sp.made[0].emit('exit'); await tick(5);
  assert.equal(got.at(-1), null, 'a dead helper clears the values');
  await tick(40);
  assert.equal(sp.made.length, 2, 'restarted after the backoff');
  assert.equal(m.running, true);
  m.stop();
  assert.equal(sp.made[1].killed, true); assert.equal(m.running, false);
  await tick(60);
  assert.equal(sp.made.length, 2, 'no restart after stop');
});

test('perf monitor: a late exit from a stopped helper does not touch its replacement', async () => {
  const made = [], got = [];
  const fn = () => { const p = new EventEmitter(); p.stdout = new PassThrough(); p.stdin = new PassThrough(); p.kill = () => { setTimeout(() => p.emit('exit'), 5); }; made.push(p); return p; };
  const m = createPerfMonitor(s => got.push(s), { spawnFn: fn, platform: 'win32', script: 'x.ps1', backoff: 20 });
  m.start(); m.stop(); m.start();
  assert.equal(made.length, 2);
  made[1].stdout.write('{"proc":"cs2","cpu":10}\n'); await tick(5);
  await tick(30); // the old helper's exit arrives now
  assert.equal(m.current && m.current.cpu, 10, "the new helper's sample is not cleared");
  assert.notEqual(got.at(-1), null);
  await tick(60);
  assert.equal(made.length, 2, 'no extra restart');
  made[1].stdout.write('{"cpu":11}\n'); await tick(5);
  assert.equal(m.current.cpu, 11, 'the new helper is still the current one');
  m.stop();
});

test('perf monitor (macOS/Linux): CPU from os.cpus() deltas and memory in use, no helper', async () => {
  const sp = fakeSpawn(), got = [];
  let n = 0; const cpus = () => { n++; return [{ times: { user: 100 * n, nice: 0, sys: 0, idle: 300 * n, irq: 0 } }]; };
  const m = createPerfMonitor(s => got.push(s), { spawnFn: sp.fn, platform: 'linux', interval: 10, os: { cpus, totalmem: () => 16 * 2 ** 30, freemem: () => 4 * 2 ** 30 } });
  m.start(); await tick(45); m.stop();
  assert.equal(sp.made.length, 0, 'nothing spawned');
  const s = got.find(x => x && x.cpu != null);
  assert.equal(s.cpu, 25); assert.equal(s.mem, 12); assert.equal(s.gpu, null); assert.equal(s.proc, null);
  const after = got.length; await tick(30); assert.equal(got.length, after, 'stopped');
});

// ---------- the page's pure pieces ----------
vm.runInThisContext(read('./public/notch-core.js'), { filename: 'notch-core.js' });
const C = globalThis.NotchCore;
test('closed game line: FPS first when present, missing values left out, approvals count kept', () => {
  assert.equal(C.gameLine({ gpu: 87.4, gpuTemp: 66, cpu: 31.6 }), '87% GPU · 66°C · 32% CPU');
  assert.equal(C.gameLine({ fps: 143.6, gpu: 87, gpuTemp: 66, cpu: 31 }), '144 FPS · 87% GPU · 66°C · 31% CPU');
  assert.equal(C.gameLine({ gpu: null, gpuTemp: null, cpu: 5 }), '5% CPU', 'never 0 for unknown');
  assert.equal(C.gameLine({}), '');
  const g = C.closedView({ game: { gpu: 50, cpu: 10 }, asks: 2 });
  assert.deepEqual(g, { kind: 'game', left: '50% GPU · 10% CPU', right: '2 approvals' });
  assert.equal(C.forcedOpen({ asks: 1, game: { gpu: 1 } }), false, 'an approval does not force the notch open over a game');
});

// ---------- wiring (source checks) ----------
test('wiring: shipped helper, monitor lifetime, privacy of the process name, preload bridge', () => {
  const main = read('./desktop/main.mjs'), pre = read('./desktop/island-preload.cjs'), ps = read('./desktop/perf.ps1'), mon = read('./desktop/perf-monitor.mjs');
  const pkg = JSON.parse(read('./package.json'));
  assert.ok(pkg.build.asarUnpack.includes('desktop/perf.ps1'), 'perf.ps1 is unpacked like nowplaying.ps1');
  assert.match(mon, /app\.asar\.unpacked/);
  assert.match(pkg.scripts.test, /game-detect\.test\.mjs/);
  assert.doesNotMatch(ps, /GetWindowText|MainWindowTitle|WindowTitle/i, 'the helper never reads window titles');
  assert.doesNotMatch(ps + mon, /https?:\/\/|Invoke-WebRequest|Invoke-RestMethod|WebClient|\bfetch\(/i, 'no network');
  assert.match(main, /'island:perf', \{ game: isle\.game, proc: isle\.game \? [^,]+ : null,[^}]*fps: f\.now \?\? null,/, 'payload; proc only in game mode; fps from PresentMon');
  assert.match(main, /function destroyIsland\(\) \{[^\n]*perfMon\.stop\(\)/, 'destroyIsland stops the helper');
  assert.match(main, /gameMode !== 'never' \|\| perfOpen/);
  assert.doesNotMatch(main, /console\.[a-z]+\([^)]*\.proc/, 'the process name is never logged');
  assert.match(main, /ipcMain\.on\('island:perfOpen', \(e, on\) => \{ if \(fromIsland\(e\)\)/);
  assert.match(pre, /perfOpen: on => ipcRenderer\.send\('island:perfOpen', !!on\)/);
  assert.match(pre, /onPerf: fn => ipcRenderer\.on\('island:perf'/);
});
