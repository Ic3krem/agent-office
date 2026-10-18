// Backends for the office furniture: the breaker box (persistent switches) and the server rack (host telemetry).
// Plain code, no model calls.
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import path from 'node:path';

// Breaker box. kiro: Kiro may run at all. autopilot: Kiro keeps itself going between turns. hiring: specialists allowed.
// bridge: terminals send approvals to the office. guard: stop at plan limits (subscription only, no extra-usage credits).
// espresso: the next hire runs on the fast, cheap model.
export const SWITCHES = { kiro: true, autopilot: true, hiring: true, bridge: true, guard: true, espresso: false };
export function switchBox(file) {
  let s = { ...SWITCHES };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  return {
    get: () => s,
    set(name, on) {
      if (!(name in SWITCHES)) throw new Error('No switch called ' + name);
      s[name] = !!on; fs.writeFileSync(file, JSON.stringify(s)); return s;
    },
  };
}

// Server rack: CPU and memory of this machine, Docker containers, and the server's own recent log lines.
export function rack() {
  let prev = os.cpus(), cpu = 0, docker = null;
  const log = [];
  const tick = () => {
    const now = os.cpus();
    let idle = 0, total = 0;
    now.forEach((c, i) => { const p = prev[i]?.times || c.times; for (const k in c.times) total += c.times[k] - p[k]; idle += c.times.idle - p.idle; });
    cpu = total ? Math.round(100 * (1 - idle / total)) : 0; prev = now;
  };
  const dockerCheck = () => execFile('docker', ['ps', '-a', '--format', '{{json .}}'], { timeout: 8000, windowsHide: true }, (err, out) => {
    docker = err ? null : out.trim().split('\n').filter(Boolean).map(l => { try { const j = JSON.parse(l); return { name: j.Names, state: j.State, status: j.Status, image: j.Image }; } catch { return null; } }).filter(Boolean);
  });
  setInterval(tick, 5000).unref(); setInterval(dockerCheck, 30e3).unref(); dockerCheck();
  for (const k of ['log', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { log.push({ t: new Date().toTimeString().slice(0, 8), k, text: a.map(String).join(' ').slice(0, 500) }); if (log.length > 300) log.shift(); orig(...a); };
  }
  return {
    status() {
      const mem = Math.round(100 * (1 - os.freemem() / os.totalmem()));
      const down = (docker || []).filter(c => c.state !== 'running' && !/^Exited \(0\)/.test(c.status));
      return { cpu, mem, docker: docker && docker.map(({ name, state }) => ({ name, state })), led: down.length ? 'red' : cpu > 85 || mem > 90 ? 'amber' : 'green' };
    },
    detail: () => ({ cpu, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())), memTotalGb: +(os.totalmem() / 2 ** 30).toFixed(1), host: os.hostname(), uptimeH: Math.round(os.uptime() / 3600), docker, log: log.slice(-200) }),
    note: text => { log.push({ t: new Date().toTimeString().slice(0, 8), k: 'log', text }); if (log.length > 300) log.shift(); },
  };
}

// The user's own Claude Code install runs the agents (the app ships no copy of it). CLAUDE_CODE_PATH overrides.
export function findClaude(home = os.homedir(), env = process.env) {
  if (env.CLAUDE_CODE_PATH && fs.existsSync(env.CLAUDE_CODE_PATH)) return env.CLAUDE_CODE_PATH;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const dirs = [path.join(home, '.local', 'bin'), ...(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map(d => path.join(d, name)).find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}
