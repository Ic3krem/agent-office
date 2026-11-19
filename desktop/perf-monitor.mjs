// Load and temperature for the notch. Windows: supervises the resident perf.ps1 helper the way nowplaying.mjs supervises nowplaying.ps1
// (restart with backoff, stop on demand). Elsewhere: CPU load from os.cpus() deltas and memory in use, no helper. No electron import.
import { spawn } from 'node:child_process';
import nodeOs from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePerfLine } from './game-detect.mjs';

// PowerShell cannot read inside app.asar, so the packaged build unpacks this script (asarUnpack) and we point at the real file.
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'perf.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const EMPTY = { proc: null, pid: null, fg: null, monitor: null, max: false, cpu: null, mem: null, gpu: null, gpuTemp: null };

// onSample(sample | null) fires for every sample; null when the helper died or the monitor stopped.
export function createPerfMonitor(onSample, { script = SCRIPT, spawnFn = spawn, platform = process.platform, os = nodeOs, interval = 1500, backoff = 2000 } = {}) {
  let proc = null, cur = null, retry = 0, timer = null, stopped = true, prev = null;
  const emit = s => { cur = s; onSample(s); };
  function launch() {
    if (proc || stopped) return;
    const p = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    proc = p; let buf = '';
    p.stdout.on('data', d => {
      retry = 0; buf += d; const lines = buf.split('\n'); buf = lines.pop();
      if (buf.length > 2048) buf = ''; // an over-long line is dropped (the rest of it fails to parse and is skipped too)
      for (const l of lines) { const s = parsePerfLine(l); if (s) emit(s); }
    });
    p.stdin?.on('error', () => {});
    p.on('error', () => {});
    p.on('exit', () => { if (proc !== p) return; proc = null; emit(null); // a late exit of a stopped helper must not clear its replacement
      if (!stopped) { timer = setTimeout(launch, Math.min(60000, backoff * 2 ** retry++)); timer.unref?.(); } });
  }
  // macOS/Linux: busy share of all cores since the previous tick.
  function sampleOs() {
    const t = os.cpus().reduce((a, c) => { const v = c.times; a.idle += v.idle; a.all += v.user + v.nice + v.sys + v.idle + v.irq; return a; }, { idle: 0, all: 0 });
    const d = prev && t.all - prev.all, cpu = d > 0 ? Math.round(1000 * (1 - (t.idle - prev.idle) / d)) / 10 : null; prev = t;
    emit({ ...EMPTY, cpu: cpu == null ? null : Math.min(100, Math.max(0, cpu)), mem: Math.round((os.totalmem() - os.freemem()) / 2 ** 30 * 10) / 10 });
  }
  return {
    start() {
      if (!stopped) return; stopped = false;
      if (platform === 'win32') launch();
      else { prev = null; sampleOs(); timer = setInterval(sampleOs, interval); timer.unref?.(); }
    },
    stop() {
      if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(timer);
      if (proc) { const p = proc; proc = null; try { p.kill(); } catch {} }
      emit(null);
    },
    get running() { return !stopped; },
    get current() { return cur; },
  };
}
