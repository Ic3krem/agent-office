// Token usage and API-equivalent cost per day from transcripts, plus the claude.ai plan limits.
import fs from 'node:fs';
import path from 'node:path';

// $ per million tokens (Anthropic first-party list prices, 2026-10). Cache writes: 1.25x input (5 min), 2x (1 h).
const PRICES = [
  [/opus-5-5/, { in: 4, out: 20, read: 0.2 }],
  [/opus/, { in: 5, out: 25, read: 0.5 }],
  [/fable|mythos/, { in: 10, out: 50, read: 0.25 }],
  [/sonnet-5/, { in: 2, out: 10, read: 0.2 }],
  [/sonnet/, { in: 3, out: 15, read: 0.3 }],
  [/haiku-5/, { in: 0.1, out: 0.5, read: 0.01 }], // ponytail: Haiku 5.5 cache-read price not in the skill's table; assumed 0.1x input
  [/haiku/, { in: 1, out: 5, read: 0.1 }],
];
export function costOf(model = '', u = {}) {
  const p = (PRICES.find(([re]) => re.test(model)) || [, PRICES[0][1]])[1];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens || 0, w5m = (u.cache_creation_input_tokens || 0) - w1h;
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.read
    + w5m * p.in * 1.25 + w1h * p.in * 2) / 1e6;
}

const DAYS = 7;
const dayOf = ts => new Date(ts).toLocaleDateString('en-CA');
const lastDays = () => Array.from({ length: DAYS }, (_, i) => dayOf(Date.now() - (DAYS - 1 - i) * 864e5));

// Reads every transcript (sessions and helpers) touched in the last week, then only what is appended.
export function usageLedger(projectsDir) {
  const offsets = new Map(), days = new Map(); // day -> { cost, tokens, models: {model: cost}, seen: Set }
  const bucket = d => days.get(d) ?? days.set(d, { cost: 0, out: 0, tokens: 0, models: {}, seen: new Set() }).get(d);
  function eat(line) {
    if (!line.includes('"assistant"') || !line.includes('"usage"')) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    const m = j.message, u = m?.usage;
    if (j.type !== 'assistant' || !u || !j.timestamp || m.model === '<synthetic>') return;
    const b = bucket(dayOf(j.timestamp)), id = m.id || j.uuid;
    if (b.seen.has(id)) return; // one API response is written as several lines
    b.seen.add(id);
    const c = costOf(m.model, u);
    b.cost += c; b.out += u.output_tokens || 0;
    b.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    b.models[m.model] = (b.models[m.model] || 0) + c;
  }
  function readFile(file, st) {
    let off = offsets.get(file) || 0;
    if (st.size < off) off = 0;
    if (st.size === off) return;
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(st.size - off);
    fs.readSync(fd, buf, 0, buf.length, off); fs.closeSync(fd);
    const text = buf.toString('utf8'), nl = text.lastIndexOf('\n');
    if (nl < 0) return;
    offsets.set(file, off + Buffer.byteLength(text.slice(0, nl + 1), 'utf8'));
    for (const l of text.slice(0, nl).split('\n')) eat(l);
  }
  function walk(dir, since) {
    let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) walk(p, since);
      else if (n.name.endsWith('.jsonl')) { try { const st = fs.statSync(p); if (st.mtimeMs >= since) readFile(p, st); } catch {} }
    }
  }
  return {
    refresh() {
      walk(projectsDir, Date.now() - DAYS * 864e5);
      const keep = new Set(lastDays()); for (const d of days.keys()) if (!keep.has(d)) days.delete(d);
    },
    summary: () => lastDays().map(d => { const b = days.get(d); return { day: d, cost: b?.cost || 0, tokens: b?.tokens || 0, out: b?.out || 0, models: b?.models || {} }; }),
  };
}

// Plan limits (5-hour session, weekly, extra usage) from the same endpoint as /usage. Experimental SDK call: failures just mean "unknown".
export async function planLimits(query, base = {}) {
  const idle = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  const q = query({ prompt: idle, options: { ...base, settingSources: [], strictMcpConfig: true } });
  try {
    const u = await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 30e3))]);
    const r = u.rate_limits || {};
    const win = w => w && { pct: w.utilization, resets: w.resets_at };
    return {
      plan: u.subscription_type, available: u.rate_limits_available,
      session: win(r.five_hour), weekly: win(r.seven_day),
      models: (r.model_scoped || []).map(m => ({ name: m.display_name, pct: m.utilization, resets: m.resets_at })),
      extra: r.extra_usage?.is_enabled ? { used: (r.extra_usage.used_credits || 0) / 10 ** (r.extra_usage.decimal_places ?? 2), limit: r.extra_usage.monthly_limit, currency: r.extra_usage.currency || 'USD' } : null,
      at: Date.now(),
    };
  } finally { q.close(); }
}

// Real money on a subscription: extra-usage credits. The endpoint only gives a month-to-date total,
// so each check adds the increase since the previous one to today's bucket.
export function creditLog(file) {
  let s = { last: null, days: {} };
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return {
    // Credits are only charged past a plan limit, and the counter posts late. So an increase seen while under
    // every limit belongs to the last day a limit was hit, not to today.
    observe(used, overLimit = false) {
      if (typeof used !== 'number') return;
      if (overLimit) s.lastOver = dayOf(Date.now());
      if (s.last !== null && used !== s.last) {
        const delta = used < s.last ? used : used - s.last; // drop = new month, count from zero
        const day = overLimit ? dayOf(Date.now()) : s.lastOver;
        if (day) s.days[day] = (s.days[day] || 0) + delta; else s.unplaced = (s.unplaced || 0) + delta;
      }
      s.last = used; s.first ||= dayOf(Date.now());
      const keep = new Set(lastDays()); for (const d of Object.keys(s.days)) if (!keep.has(d)) delete s.days[d];
      fs.writeFileSync(file, JSON.stringify(s));
    },
    days: () => Object.fromEntries(lastDays().map(d => [d, s.days[d] || 0])),
    since: () => s.first || null,
  };
}
