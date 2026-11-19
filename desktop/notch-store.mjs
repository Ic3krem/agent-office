// Notch notes, timers and counters on disk (notch-store.json next to kiro.json). Pure Node, no electron import.
// normalizeStore is the one gate for reads and writes: the page and a hand-edited file are both untrusted for shape and size.
import fs from 'node:fs';
import path from 'node:path';

export const FILE = 'notch-store.json';
export const MAX_BYTES = 256 * 1024;
const ID = /^[a-z0-9]{6,12}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const T_MIN = Date.UTC(2020, 0, 1), T_MAX = Date.UTC(2100, 0, 1), DAY_MS = 24 * 3600 * 1000;
const KINDS = ['countdown', 'stopwatch', 'pomodoro'], PHASES = ['focus', 'break'];
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
// Keeps the first `max` valid items with a unique id.
function pick(list, max, make) {
  const out = [], seen = new Set();
  if (Array.isArray(list)) for (const raw of list.slice(0, max * 4)) {
    if (out.length >= max) break;
    if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || seen.has(raw.id)) continue;
    const item = make(raw);
    if (item) { seen.add(raw.id); out.push(item); }
  }
  return out;
}

export function normalizeStore(raw) {
  const r = isObj(raw) ? raw : {}, p = isObj(r.pomodoro) ? r.pomodoro : {};
  return {
    notes: pick(r.notes, 100, n => { const text = str(n.text, 500); return text === null ? null : { id: n.id, text }; }),
    timers: pick(r.timers, 10, t => {
      const name = str(t.name, 40);
      if (name === null || !KINDS.includes(t.kind) || !PHASES.includes(t.phase)) return null;
      return { id: t.id, name, kind: t.kind, endsAt: num(t.endsAt, T_MIN, T_MAX), startedAt: num(t.startedAt, T_MIN, T_MAX), pausedLeft: num(t.pausedLeft, 0, DAY_MS), round: int(t.round, 0, 99) ? t.round : 0, phase: t.phase };
    }),
    counters: pick(r.counters, 12, c => {
      const name = str(c.name, 40);
      if (name === null || !int(c.goal, 1, 999) || !DAY.test(c.day)) return null;
      return { id: c.id, name, goal: c.goal, count: int(c.count, 0, 99999) ? c.count : 0, day: c.day };
    }),
    pomodoro: { focus: int(p.focus, 1, 180) ? p.focus : 25, rest: int(p.rest, 1, 60) ? p.rest : 5, rounds: int(p.rounds, 1, 12) ? p.rounds : 4 },
  };
}

// Untrusted payload (from the page): refuse anything over MAX_BYTES before normalizing; null = rejected.
export function acceptStore(raw) {
  let json;
  try { json = JSON.stringify(raw); } catch { return null; }
  if (typeof json !== 'string' || json.length > MAX_BYTES) return null;
  return normalizeStore(raw);
}

export function readStore(dir) {
  const f = path.join(dir, FILE);
  let text;
  try {
    if (fs.statSync(f).size > MAX_BYTES) return normalizeStore({});
    text = fs.readFileSync(f, 'utf8');
    return normalizeStore(JSON.parse(text));
  } catch {
    if (text !== undefined) try { fs.renameSync(f, f + '.bad'); } catch {} // unreadable JSON: set aside so the next commit does not overwrite it
    return normalizeStore({});
  }
}

export function writeStore(dir, store) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, FILE), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(normalizeStore(store)));
  fs.renameSync(tmp, f);
}
