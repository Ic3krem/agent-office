// Runs one external CLI headless: no shell, stdin written then closed, last 200 KB of output kept, a timeout and a stop
// that kill the whole process tree. killAll() stops every live run (the app calls it on quit).
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const CAP = 200 * 1024, LINE_MAX = 64 * 1024;
const live = new Map(); // child -> stop(reason)
export const liveCount = () => live.size;

const taskkill = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { spawnSync(taskkill(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch {}
    try { child.kill('SIGKILL'); } catch {}
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }
}
export function killAll() { for (const stop of [...live.values()]) stop('stopped'); }

// Keeps the last `cap` bytes of a stream without growing.
function tail(cap) {
  let buf = Buffer.alloc(0);
  return { push(c) { buf = buf.length + c.length <= cap ? Buffer.concat([buf, c]) : Buffer.concat([buf, c]).subarray(-cap); }, text: () => buf.toString('utf8') };
}

export function runExternal({ cmd, args = [], stdin = '', cwd, env, timeoutMs = 1_200_000, signal, onLine } = {}) {
  if (signal?.aborted) return Promise.resolve({ ok: false, code: null, stdoutTail: '', stderrTail: '', timedOut: false, stopped: true });
  return new Promise((resolve, reject) => {
    let child;
    try {
      // Never shell:true. POSIX: its own process group so the whole tree can be killed.
      child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) { reject(e); return; }
    const out = tail(CAP), err = tail(CAP);
    let partial = '', timedOut = false, stopped = false, done = false, exitTimer = null;
    const finish = (code, e) => {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(exitTimer); live.delete(child); signal?.removeEventListener('abort', onAbort);
      if (e) { reject(e); return; }
      if (onLine && partial) { try { onLine(partial); } catch {} }
      resolve({ ok: code === 0 && !timedOut && !stopped, code, stdoutTail: out.text(), stderrTail: err.text(), timedOut, stopped });
    };
    const stop = reason => { if (done) return; if (reason === 'timeout') timedOut = true; else stopped = true; killTree(child); };
    const onAbort = () => stop('stopped');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    live.set(child, stop);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', e => finish(null, e));
    child.stdout.on('data', c => {
      out.push(c);
      if (!onLine) return;
      const parts = (partial + c.toString('utf8')).split('\n');
      partial = parts.pop().slice(-LINE_MAX);
      for (const l of parts) { try { onLine(l.replace(/\r$/, '')); } catch {} }
    });
    child.stderr.on('data', c => err.push(c));
    child.stdin.on('error', () => {}); // EPIPE when the CLI exits without reading
    child.stdin.end(stdin);
    child.on('close', code => finish(code));
    // A grandchild that escaped the tree kill could hold the pipes open; do not wait on it forever.
    child.on('exit', code => { exitTimer = setTimeout(() => finish(code), 2000); });
  });
}

process.once('exit', killAll);
