// Game frame rate through PresentMon 2.6.0 (Intel, MIT, vendored in vendor/presentmon). Windows only. The exe is pinned by SHA-256 and
// checked before every start; a mismatch means FPS is unavailable. Nothing is ever downloaded. Supervised like perf-monitor.mjs.
// PresentMon writes CSV to stdout; frame times are deltas of CPUStartTimeInMs per process (MsBetweenPresents is mostly 0 on 2.x and
// rows arrive out of order, so they are buffered and sorted). No electron import.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PM_SHA256 = 'B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF';
export const SESSION = 'TiroAgentsFPS'; // our own ETW session; other PresentMon sessions (NVIDIA runs one) are never touched
// Windows cannot run an exe inside app.asar, so the packaged build unpacks vendor/presentmon (asarUnpack) and we point at the real file.
const EXE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'presentmon', 'PresentMon-2.6.0-x64.exe').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const CAP = 3000, NOW_N = 30, STALE = 2000;

export function parseCsvHeader(line) {
  const cols = String(line || '').trim().split(',');
  const cpuStart = cols.indexOf('CPUStartTimeInMs'), processId = cols.indexOf('ProcessID');
  return cpuStart >= 0 && processId >= 0 ? { cpuStart, processId } : null;
}
export function parseCsvRow(cols, header) {
  if (!Array.isArray(cols) || !header || cols.length <= Math.max(header.cpuStart, header.processId)) return null;
  const pid = Number(cols[header.processId]), t = Number(cols[header.cpuStart]);
  return Number.isInteger(pid) && pid > 0 && cols[header.cpuStart] !== '' && Number.isFinite(t) ? { pid, t } : null;
}
// Sorted CPU start times -> frame times in ms; a non-positive or over-1000 ms gap (a pause, a duplicate) is not a frame.
export function frameMs(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0 && d <= 1000) out.push(d); }
  return out;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
// FPS = 1000 / mean frame time. now: the last 30 frames; avg: the whole list (last 3000); low1: the slowest 1% of frames.
export function fpsStats(msList) {
  const l = (msList || []).slice(-CAP);
  if (!l.length) return { now: null, avg: null, low1: null };
  const slow = [...l].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(l.length / 100)));
  return { now: 1000 / mean(l.slice(-NOW_N)), avg: 1000 / mean(l), low1: 1000 / mean(slow) };
}

const sha256 = async f => createHash('sha256').update(await readFile(f)).digest('hex');

// onStats({ state: 'on'|'waiting'|'unavailable', now, avg, low1, frames (last 120 ms) } | null): every `interval` while running; null when stopped.
export function createFps(onStats, { exe = EXE, spawnFn = spawn, platform = process.platform, hashOf = sha256, interval = 500, backoff = 2000 } = {}) {
  let proc = null, pid = null, gen = 0, retry = 0, timer = null, tickT = null, times = [], pending = [], lastRow = 0, bad = false;
  const NONE = { now: null, avg: null, low1: null, frames: [] };
  const endSession = () => { try { const t = spawnFn(exe, ['--terminate_existing_session', '--session_name', SESSION], { stdio: 'ignore', windowsHide: true }); t.on?.('error', () => {}); } catch {} };
  function tick() {
    if (pending.length) { times = times.concat(pending).sort((a, b) => a - b).slice(-(CAP + 1)); pending = []; }
    if (bad) return onStats({ state: 'unavailable', ...NONE });
    if (!lastRow || Date.now() - lastRow > STALE) return onStats({ state: 'waiting', ...NONE });
    const ms = frameMs(times);
    onStats({ state: 'on', ...fpsStats(ms), frames: ms.slice(-120) });
  }
  function launch(g) {
    if (g !== gen || proc) return;
    times = []; pending = []; lastRow = 0; // CPUStartTimeInMs restarts at 0 with every PresentMon session: never mix two runs
    const p = spawnFn(exe, ['--process_id', String(pid), '--output_stdout', '--no_console_stats', '--session_name', SESSION, '--stop_existing_session'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    proc = p; let buf = '', header = null;
    p.stdout.on('data', d => {
      buf += d; const lines = buf.split('\n'); buf = lines.pop();
      if (buf.length > 4096) buf = '';
      for (const l of lines) {
        if (!header) { header = parseCsvHeader(l); continue; }
        const r = parseCsvRow(l.trim().split(','), header);
        if (r && r.pid === pid) { pending.push(r.t); lastRow = Date.now(); retry = 0; }
      }
      if (pending.length > CAP) pending = pending.slice(-CAP);
    });
    p.on('error', () => {});
    p.on('exit', () => { if (proc !== p) return; proc = null; if (g === gen) { timer = setTimeout(() => launch(g), Math.min(60000, backoff * 2 ** retry++)); timer.unref?.(); } });
  }
  // end: also end our ETW session (stop() only). On a pid change the next launch's --stop_existing_session clears it, and a separate
  // terminate here could run after that launch and kill the new session.
  function halt(end) {
    gen++; clearTimeout(timer); clearInterval(tickT); tickT = null;
    if (proc) { const p = proc; proc = null; try { p.kill(); } catch {} if (end) endSession(); } // a killed PresentMon leaves its ETW session running
    pid = null; times = []; pending = []; lastRow = 0; bad = false; retry = 0;
  }
  return {
    start(target) {
      if (platform !== 'win32' || !Number.isInteger(target) || target <= 0) return;
      if (target === pid) return;
      halt(false); pid = target; const g = gen;
      tickT = setInterval(tick, interval); tickT.unref?.();
      hashOf(exe).then(h => String(h).toUpperCase() === PM_SHA256, () => false).then(ok => { if (g !== gen) return; if (ok) launch(g); else { bad = true; tick(); } });
    },
    stop() { if (pid == null) return; halt(true); onStats(null); },
    get running() { return pid != null; },
    get pid() { return pid; },
  };
}
