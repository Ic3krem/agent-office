// Scheduler job: classify the inbox feed into task/need/info items, write scheduler.json for the garage Scheduler station,
// and leave Tiro a short subject-only note in its memory folder.
// Run: node scheduler-job.mjs [--dry-run] [--force] [--feed FILE] [--home DIR] [--now ISO]
// Safety: this job reads ONE local JSON feed file. It opens no network connection, calls no Graph/IMAP/ssh, holds no credentials,
// and sends, replies to, moves, flags or deletes nothing. The feed must be produced by an already approved read-only reader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { redact } from './agent-home.mjs';

// The one mailbox this job may report on: AGENT_OFFICE_MAILBOX, else "schedulerMailbox" in ~/.claude/agent-office/kiro.json. Never hardcoded.
export const mailboxOf = home => { let k = {}; try { k = JSON.parse(fs.readFileSync(path.join(home, 'kiro.json'), 'utf8')); } catch {} return String(process.env.AGENT_OFFICE_MAILBOX || k.schedulerMailbox || '').trim().toLowerCase(); };
export const INTERVAL_MIN = 30, HOURS = [7, 19], MAX_ITEMS = 20, FEED_STALE_MS = 2 * 3600e3;

const NOISE = /\b(daily|weekly|monthly) (report|summary|digest|sales)|\bnewsletter|\bunsubscribe|\bno-?reply\b|\breceipt\b|\bdelivery status|\bout of office|\bautomatic reply|\bwebinar\b|\bpromo/i;
const NEED = /\b(need|needs|needed|please (provide|send|help|check|review|fix|add|set)|can you|could you|would you|request(ed)?|access|help|urgent|asap|approve|approval|not working|broken|cannot|can't|unable)\b/i;
const TASK = /\b(action required|todo|to-do|reminder|due|deadline|follow[- ]?up|assigned|ticket|incident|alert|expir(es|ing|ed)|renew|password reset|install|upgrade|scheduled?)\b/i;

const clean = v => redact(String(v ?? '')).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

// Subject (+ optional Outlook categories from a mail categorizer) -> 'task' | 'need' | 'info' | null (noise: dropped).
export function classify(subject, categories = []) {
  const s = String(subject || ''), cats = (Array.isArray(categories) ? categories : []).join(' ').toLowerCase();
  if (!s.trim()) return null;
  if (NOISE.test(s) && !/\b(urgent|action required|failed|failure)\b/i.test(s)) return null;
  if (/\b(task|action)\b/.test(cats) || TASK.test(s)) return /\b(need|request|please|can you|could you)\b/i.test(s) && !/\b(action required|due|deadline)\b/i.test(s) ? 'need' : 'task';
  if (/\b(need|request|support|help)\b/.test(cats) || NEED.test(s)) return 'need';
  return 'info';
}

export function inHours(d, [from, to] = HOURS) { const day = d.getDay(); return day >= 1 && day <= 5 && d.getHours() >= from && d.getHours() < to; }
export function nextCheckAfter(d) {
  const n = new Date(d.getTime() + INTERVAL_MIN * 60e3);
  if (inHours(n)) return n;
  const m = new Date(n); m.setHours(HOURS[0], 0, 0, 0);
  if (m <= n) m.setDate(m.getDate() + 1);
  while (!inHours(m)) m.setDate(m.getDate() + 1);
  return m;
}
const hash = (s, at) => crypto.createHash('sha1').update(s + '|' + at).digest('hex').slice(0, 12);

// Pure: feed object -> { items, itemsFound, note } (task/need before info, newest first, capped).
export function digest(feed, now = Date.now(), mailbox = '') {
  const bad = note => ({ items: [], itemsFound: 0, note, ok: false });
  if (!feed || typeof feed !== 'object' || !Array.isArray(feed.messages)) return bad('Mail feed unreadable or empty: no inbox data.');
  if (!mailbox) return bad('No mailbox configured: set AGENT_OFFICE_MAILBOX (or schedulerMailbox in kiro.json) to the one mailbox to report on.');
  if (String(feed.mailbox || '').toLowerCase() !== mailbox) return bad('Feed is not for the configured mailbox; ignored.');
  const gen = Date.parse(feed.generatedAt || '');
  if (!Number.isFinite(gen)) return bad('Mail feed has no valid generatedAt; ignored.');
  if (now - gen > FEED_STALE_MS) return bad('Mail feed is stale (generated ' + new Date(gen).toISOString() + '): no fresh inbox data.');
  const rank = { task: 0, need: 1, info: 2 }, all = [];
  for (const m of feed.messages) {
    if (!m || m.isRead === true) continue; // unread mail only
    const title = clean(m.subject), kind = classify(title, m.categories);
    if (!title || !kind) continue;
    const at = Date.parse(m.received || '') || gen;
    all.push({ title, kind, at: new Date(at).toISOString(), key: hash(title, at) });
  }
  all.sort((a, b) => rank[a.kind] - rank[b.kind] || Date.parse(b.at) - Date.parse(a.at));
  const actionable = all.filter(x => x.kind !== 'info').length;
  return { items: all.slice(0, MAX_ITEMS), itemsFound: actionable, total: all.length, ok: true,
    note: `${actionable} task/need and ${all.length - actionable} info item(s) among unread inbox subjects; feed generated ${new Date(gen).toISOString()}.` };
}

const atomic = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + '.tmp' + process.pid; fs.writeFileSync(t, text); fs.renameSync(t, file); };

export function run({ home = path.join(os.homedir(), '.claude', 'agent-office'), feed, dry = false, force = false, now = new Date() } = {}) {
  const stateFile = path.join(home, 'scheduler.json'), seenFile = path.join(home, 'scheduler-seen.json');
  const iso = now.toISOString();
  if (!force && !inHours(now)) return { skipped: 'outside business hours (Mon-Fri 07:00-19:00 local)', nextCheck: nextCheckAfter(now).toISOString() };
  let raw = null; try { raw = JSON.parse(fs.readFileSync(feed || path.join(home, 'inbox-feed.json'), 'utf8')); } catch {}
  const d = raw ? digest(raw, now.getTime(), mailboxOf(home)) : { items: [], itemsFound: 0, ok: false, note: 'No mail feed file yet: waiting for the approved read-only mailbox reader to produce inbox-feed.json.' };
  let seen = []; try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')).seen || []; } catch {}
  const fresh = d.items.filter(i => !seen.includes(i.key));
  const state = { lastCheck: iso, itemsFound: d.itemsFound, lastUpdateToTiro: iso, untrusted: true, nextCheck: nextCheckAfter(now).toISOString(), note: d.note,
    items: d.items.map(({ title, kind, at }) => ({ title, kind, at })) };
  const result = { state, fresh: fresh.map(({ title, kind, at }) => ({ title, kind, at })), dry };
  if (dry) return result;
  atomic(seenFile, JSON.stringify({ seen: [...new Set([...fresh.map(i => i.key), ...seen])].slice(0, 200) }));
  atomic(stateFile, JSON.stringify(state, null, 2));
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const r = run({ home: opt('--home'), feed: opt('--feed'), dry: a.includes('--dry-run'), force: a.includes('--force'), now: opt('--now') ? new Date(opt('--now')) : new Date() });
  console.log(JSON.stringify(r, null, 2));
}
