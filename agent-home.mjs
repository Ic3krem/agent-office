// Per-agent homes: every roster key gets its own memory folder and task history, with Tiro as the parent folder.
//   <root>/tiro/                 parent: Tiro's own memory/ and history/ (history also lists every hire)
//   <root>/tiro/<key>/memory/    that specialist's own notes (MEMORY.md index + note files); the ONLY thing carried between tasks
//   <root>/tiro/<key>/history/   index.jsonl (one event per line) + <task>.md summaries; transcripts stay where Claude wrote them
// Folders are keyed by roster type (never by display name), so renaming an agent never moves its history.
import fs from 'node:fs';
import path from 'node:path';
import { ROSTER } from './company.mjs';

export const KEYS = ['tiro', ...Object.keys(ROSTER)];
const SECRET = /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"',;]{4,}|\bbearer\s+[A-Za-z0-9._~+\/=-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}/gi;
export const redact = t => String(t ?? '').replace(SECRET, '[redacted]');
const safeId = v => String(v ?? '').replace(/[^\w.-]+/g, '-').slice(0, 64) || 'task';
const clip = (v, n) => redact(v).replace(/\s+/g, ' ').trim().slice(0, n);

export function agentHome(root) {
  const need = key => { if (!KEYS.includes(key)) throw new Error('Unknown agent type ' + key); return key; };
  const dir = key => path.join(root, 'tiro', ...(need(key) === 'tiro' ? [] : [key]));
  const memoryDir = key => path.join(dir(key), 'memory');
  const histDir = key => path.join(dir(key), 'history');
  const indexFile = key => path.join(histDir(key), 'index.jsonl');
  const ensure = key => {
    fs.mkdirSync(memoryDir(key), { recursive: true }); fs.mkdirSync(histDir(key), { recursive: true });
    const mem = path.join(memoryDir(key), 'MEMORY.md');
    if (!fs.existsSync(mem)) fs.writeFileSync(mem, `# ${key} memory\n\nOne line per note: - [title](file.md) - why it matters. Durable facts only (paths, decisions, gotchas). Never secrets.\n`);
    return dir(key);
  };
  const append = (key, ev) => { ensure(key); fs.appendFileSync(indexFile(key), JSON.stringify(ev) + '\n'); };
  const events = key => { try { return fs.readFileSync(indexFile(need(key)), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const tasksOf = key => {
    const by = new Map();
    for (const e of events(key)) {
      const t = by.get(e.id) || { id: e.id, key };
      if (e.ev === 'start') Object.assign(t, { goalId: e.goalId || '', title: e.title || '', startedAt: e.at, brief: e.brief || '', parent: e.parent || '' });
      else if (e.ev === 'end') Object.assign(t, { endedAt: e.at, summary: e.summary || '', transcript: e.transcript || '', agentId: e.agentId || '', summaryFile: e.summaryFile || '' });
      else if (e.ev === 'hire') Object.assign(t, { goalId: e.goalId || '', title: e.title || '', startedAt: e.at, hired: e.hired });
      by.set(e.id, t);
    }
    return [...by.values()].sort((a, b) => (b.startedAt || b.endedAt || 0) - (a.startedAt || a.endedAt || 0));
  };
  const open = new Map(); // key -> [taskId] in start order; one person per key, so FIFO pairs a stop with its start
  return {
    root, dir, memoryDir, histDir, ensure, tasks: tasksOf,
    ensureAll() { for (const k of KEYS) ensure(k); },
    // Called when a hire is allowed to start. Returns the task id.
    start(key, { goalId = '', title = '', brief = '', at = Date.now(), id } = {}) {
      const tid = safeId(id || 't' + at.toString(36) + Math.random().toString(36).slice(2, 5));
      append(key, { ev: 'start', id: tid, at, goalId: /^g[0-9a-f]{6}$/.test(goalId) ? goalId : '', title: clip(title, 160), brief: clip(brief, 600), parent: 'tiro' });
      if (key !== 'tiro') append('tiro', { ev: 'hire', id: key + '-' + tid, at, goalId: /^g[0-9a-f]{6}$/.test(goalId) ? goalId : '', title: clip(title, 160), hired: key });
      (open.get(key) || open.set(key, []).get(key)).push(tid);
      return tid;
    },
    // Called when that specialist stops. Writes the summary note and closes the oldest open task (or a standalone one).
    end(key, { agentId = '', transcript = '', summary = '', at = Date.now() } = {}) {
      const q = open.get(key) || [], tid = q.shift() || safeId('t' + at.toString(36));
      const body = redact(summary).slice(0, 8000), file = tid + '.md';
      ensure(key);
      fs.writeFileSync(path.join(histDir(key), file), `# ${key} task ${tid}\n\n- Finished: ${new Date(at).toISOString()}\n- Transcript: ${transcript || '(not recorded)'}\n\n## Final report\n\n${body || '(no final message)'}\n`);
      append(key, { ev: 'end', id: tid, at, agentId: safeId(agentId), transcript: String(transcript || ''), summary: clip(summary, 500), summaryFile: file });
      return tid;
    },
    openCount: key => (open.get(key) || []).length,
    // Plain-text search over a key's task titles, briefs and summaries.
    search(key, q) {
      const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return tasksOf(key).filter(t => { const h = [t.title, t.brief, t.summary, t.goalId, t.id].join(' ').toLowerCase(); return words.every(w => h.includes(w)); });
    },
    // Full summary markdown of one task (id is validated, never joined raw).
    read(key, id) {
      const t = tasksOf(key).find(x => x.id === id); if (!t?.summaryFile) return '';
      try { return fs.readFileSync(path.join(histDir(key), path.basename(t.summaryFile)), 'utf8'); } catch { return ''; }
    },
    overview() { return KEYS.map(key => { const t = tasksOf(key), m = (() => { try { return fs.readdirSync(memoryDir(key)).filter(f => f.endsWith('.md')).length; } catch { return 0; } })(); return { key, dir: dir(key), tasks: t.length, last: t[0]?.startedAt || t[0]?.endedAt || 0, notes: m }; }); },
    // Sentence appended to an agent's instructions. Memory is the only thing that carries from one task to the next.
    note(key) {
      ensure(key);
      const ro = key !== 'tiro' && !(ROSTER[key].tools || []).some(t => ['Write', 'Edit'].includes(t));
      return `\nYour own memory folder: ${memoryDir(key)}. Every task starts with a fresh context, so this folder is all you remember: read MEMORY.md there first, ` +
        (ro ? 'and use the notes as background. You are read-only, so Agent Office files your final report in your history for you. ' : 'and before you finish add or update a short note for durable facts (paths, decisions, gotchas) and keep the MEMORY.md index current. ') +
        'Never store secrets, passwords or tokens.';
    },
  };
}
