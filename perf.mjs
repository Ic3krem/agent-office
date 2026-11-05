// Performance helpers for the office server: a gated transcript scanner, a snapshot gate, bounded-state utilities,
// probe and idle-session policies, timer jitter and time-sliced work. Everything here is pure or takes its I/O as an
// argument, so it is tested with fake file systems and fake clocks (perf.test.mjs). No platform-specific API is used.
import path from 'node:path';
import crypto from 'node:crypto';

export const PERF_DEFAULTS = {
  activeMs: 45 * 60e3,   // a transcript touched within this window is "hot" and checked every tick
  coldMs: 5000,          // how often quiet project folders are looked at for new sessions
  fullMs: 60e3,          // a full rescan, which also catches old sessions that were resumed
  metaMs: 30e3,          // how long a helper's .meta.json is cached
  pruneMs: 24 * 3600e3,  // agents and files idle for longer than this are forgotten
};

// ---------- scanner ----------
// Replaces "stat and read every transcript every second". Per tick it only stats the hot transcripts. Project folders are
// checked every coldMs (a folder's mtime changes when a session file is created), and everything is re-listed every fullMs.
// fs = { readdirSync, statSync, readFileSync } (counted in tests). onFile(file, id, extra, st) reads whatever was appended.
export function createScanner({ projects, fs, onFile, isKnown = () => false, subExtra = (meta, parent) => ({ parent, helper: true }), now = Date.now, opts = {} }) {
  const o = { ...PERF_DEFAULTS, ...opts };
  const dirs = new Map();   // project dir -> { mtime, seen:Set }
  const subs = new Map();   // subagents dir -> mtime
  const hot = new Map();    // file -> { id, extra, sub, meta, metaAt }
  let lastCold = -Infinity, lastFull = -Infinity;
  const stat = p => { try { return fs.statSync(p); } catch { return null; } };
  const list = p => { try { return fs.readdirSync(p); } catch { return null; } };
  const readMeta = f => { try { return JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; } };

  function consider(file, id, st, extra, t) {
    const recent = t - st.mtimeMs <= o.activeMs;
    if (recent) hot.set(file, { id, extra });
    if (recent || isKnown(id)) onFile(file, id, extra, st);
  }
  function enterSessionSubs(dir, id, full, t) {
    const sub = path.join(dir, id, 'subagents');
    const st = stat(sub);
    if (!st) return;
    if (!full && subs.get(sub) === st.mtimeMs) return;
    subs.set(sub, st.mtimeMs);
    for (const s of list(sub) || []) {
      if (!s.endsWith('.jsonl')) continue;
      const sf = path.join(sub, s);
      if (hot.has(sf)) continue;
      const meta = readMeta(sf), sst = stat(sf);
      if (!sst) continue;
      if (meta.finished && t - sst.mtimeMs > 60e3) continue;
      const extra = subExtra(meta, id);
      if (t - sst.mtimeMs <= o.activeMs) hot.set(sf, { id: s.slice(0, -6), extra, sub: true, meta, metaAt: t });
      if (t - sst.mtimeMs <= o.activeMs || isKnown(s.slice(0, -6))) onFile(sf, s.slice(0, -6), extra, sst);
    }
  }
  function discover(full, t) {
    const names = list(projects);
    if (!names) return;
    for (const d of names) {
      const dir = path.join(projects, d), st = stat(dir);
      if (!st || (typeof st.isDirectory === 'function' && !st.isDirectory())) continue;
      let rec = dirs.get(dir);
      const changed = !rec || rec.mtime !== st.mtimeMs;
      if (!full && !changed) { // quiet folder: only look under sessions that are hot (their helpers may be new)
        for (const [file, h] of hot) if (!h.sub && path.dirname(file) === dir) enterSessionSubs(dir, h.id, false, t);
        continue;
      }
      if (!rec) { rec = { mtime: st.mtimeMs, seen: new Set() }; dirs.set(dir, rec); }
      rec.mtime = st.mtimeMs;
      const entries = list(dir) || [];
      for (const n of entries) {
        if (!n.endsWith('.jsonl')) continue;
        const id = n.slice(0, -6), file = path.join(dir, n);
        if (!full && rec.seen.has(n)) continue;
        rec.seen.add(n);
        const fst = stat(file);
        if (fst) consider(file, id, fst, undefined, t);
      }
      for (const n of entries) {
        if (!n.endsWith('.jsonl')) continue;
        const file = path.join(dir, n);
        if (hot.has(file)) enterSessionSubs(dir, n.slice(0, -6), full, t);
      }
    }
  }
  return {
    // One pass. Cheap when nothing changed: only the hot files are stat'ed; folders are re-listed on the cold/full cadence.
    tick() {
      const t = now(), full = t - lastFull >= o.fullMs, cold = full || t - lastCold >= o.coldMs;
      if (cold) { lastCold = t; if (full) lastFull = t; discover(full, t); }
      for (const [file, h] of hot) {
        const st = stat(file);
        if (!st) { hot.delete(file); continue; }
        if (h.sub && t - (h.metaAt || 0) > o.metaMs) { h.meta = readMeta(file); h.metaAt = t; h.extra = subExtra(h.meta, h.extra?.parent); }
        if (h.sub && h.meta?.finished && t - st.mtimeMs > 60e3) { hot.delete(file); continue; }
        onFile(file, h.id, h.extra, st);
        if (t - st.mtimeMs > o.activeMs) hot.delete(file); // went quiet: the next full scan notices if it wakes up
      }
    },
    hotCount: () => hot.size,
    forget(file) { hot.delete(file); },
  };
}

// ---------- snapshot gate ----------
// Decides whether a snapshot string is pushed. Unchanged content is never pushed; while no window is visible pushes are
// coalesced to hiddenMs. A window becoming visible flushes at once (visible() === true again).
export function createSnapshotGate({ hiddenMs = 3000, now = Date.now } = {}) {
  let lastHash = '', lastAt = -Infinity;
  const hash = s => crypto.createHash('sha1').update(s).digest('base64');
  const gate = {
    // true when a push is allowed at all right now (cheap check before building the snapshot string)
    due: (visible = true) => visible || now() - lastAt >= hiddenMs,
    // 'send' | 'same' (identical to the last push: skip and mark as done) | 'wait' (coalescing while hidden: try again later)
    decide(data, visible = true) {
      if (!gate.due(visible)) return 'wait';
      const h = hash(data);
      if (h === lastHash) return 'same';
      lastHash = h; lastAt = now(); return 'send';
    },
    shouldSend: (data, visible = true) => gate.decide(data, visible) === 'send',
    reset() { lastHash = ''; lastAt = -Infinity; }, // a new client needs the current state
  };
  return gate;
}

// Logs per agent in a push: the selected agent and the manager keep their full tail, everyone else a short one (the office view
// only reads the last few lines of each desk). sel === undefined means "no client told us": keep the old, full behaviour.
export function trimLogs(agents, sel, { full = 60, short = 8 } = {}) {
  if (sel === undefined) return agents;
  return agents.map(a => (a.isManager || a.id === sel ? a : { ...a, logs: (a.logs || []).slice(-short) }));
}

// ---------- bounded state ----------
// Keeps a Set at most max entries, dropping the oldest (insertion order).
export function capSet(set, max) { while (set.size > max) set.delete(set.values().next().value); return set; }
// Same for a Map (oldest first).
export function capMap(map, max) { while (map.size > max) map.delete(map.keys().next().value); return map; }

// Forget agents and transcript files nobody touched for pruneMs. keep(a) protects live ones (manager, pending asks, running sessions).
export function pruneIdle({ agents, files, now = Date.now(), maxIdleMs = PERF_DEFAULTS.pruneMs, keep = () => false }) {
  let n = 0;
  for (const [id, a] of agents) {
    if (keep(a, id) || a.perms?.length) continue;
    if (now - (a.mtime || a.born || 0) > maxIdleMs) { agents.delete(id); n++; }
  }
  for (const [file, f] of files) if (!agents.has(f.id) && now - (f.mtime || 0) > maxIdleMs) files.delete(file);
  return n;
}

// ---------- policies ----------
// Plan-limits probe (spawns a full claude process): only when someone looks or Tiro works, never more often than the interval.
export function shouldProbe({ now, last, visible, bossActive, minMs = 15 * 60e3, activeMs = 5 * 60e3 }) {
  if (!visible && !bossActive) return false;
  return now - last >= (bossActive ? Math.min(minMs, activeMs) : minMs);
}

// End Tiro's session after it sat idle, but never while anything depends on it. Resume is by the saved session id on the next goal.
export function shouldEndIdleSession({ now, lastActive, idleMin, hasSession, pendingAsks = 0, running = 0, doingGoals = 0, working = false }) {
  if (!hasSession || !(idleMin > 0)) return false;
  if (pendingAsks > 0 || running > 0 || doingGoals > 0 || working) return false;
  return now - lastActive >= idleMin * 60e3;
}

// Docker status check: only when the rack panel was looked at recently, otherwise at most every minMs.
export function shouldCheckDocker({ now, last, panelOpenAt = 0, minMs = 5 * 60e3, panelMs = 30e3 }) {
  return now - last >= (now - panelOpenAt < 60e3 ? panelMs : minMs);
}

// ---------- timers ----------
export const jittered = (ms, spread = 0.15, rnd = Math.random) => Math.round(ms * (1 + (rnd() * 2 - 1) * spread));
// setInterval whose period carries a little jitter and that never overlaps itself; returns a stop function.
export function every(ms, fn, { spread = 0.15, rnd = Math.random, timers = { setTimeout, clearTimeout } } = {}) {
  let h, stopped = false;
  const loop = () => { h = timers.setTimeout(async () => { try { await fn(); } catch {} if (!stopped) loop(); }, jittered(ms, spread, rnd)); h?.unref?.(); };
  loop();
  return () => { stopped = true; timers.clearTimeout(h); };
}

// Runs an iterator of small work steps in slices of about budgetMs, yielding to the event loop between slices so requests
// (SSE, approvals) stay responsive. step() work should itself be small (one chunk, one file).
export function runSliced(iterator, { budgetMs = 10, now = Date.now, yieldFn = setImmediate } = {}) {
  return new Promise((resolve, reject) => {
    const slice = () => {
      const end = now() + budgetMs;
      try {
        for (;;) {
          const r = iterator.next();
          if (r.done) return resolve(r.value);
          if (now() >= end) break;
        }
      } catch (e) { return reject(e); }
      yieldFn(slice);
    };
    slice();
  });
}
