// Read-only status of the office scheduler (the job that will check mail for tasks and needs, send check-ins and update Tiro).
// The scheduler job writes ~/.claude/agent-office/scheduler.json; this module only reads and sanitises it for the office UI.
// It does no mail reading, no Graph calls and sends nothing. Absent or unreadable file -> { present: false } ("no data yet").
import fs from 'node:fs';

const MAX_ITEMS = 20, STALE_MS = 6 * 3600e3;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
const when = v => { const t = typeof v === 'number' ? v : Date.parse(String(v || '')); return Number.isFinite(t) && t > 0 && t < 4e12 ? new Date(t).toISOString() : null; };

// Expected file: { "lastCheck": ISO|ms, "itemsFound": n, "lastUpdateToTiro": ISO|ms, "nextCheck": ISO|ms, "note": "...",
//                  "items": [{ "title": "...", "kind": "task|need|info", "at": ISO|ms }] }
export function readScheduler(file, now = Date.now()) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { present: false }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { present: false };
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).filter(x => x && typeof x === 'object')
    .map(x => ({ title: str(x.title, 140), kind: ['task', 'need', 'info'].includes(x.kind) ? x.kind : 'info', at: when(x.at) })).filter(x => x.title);
  const lastCheck = when(raw.lastCheck), lastUpdateToTiro = when(raw.lastUpdateToTiro), nextCheck = when(raw.nextCheck);
  const n = Number.isFinite(Number(raw.itemsFound)) && Number(raw.itemsFound) >= 0 ? Math.min(9999, Math.floor(Number(raw.itemsFound))) : items.length;
  if (!lastCheck && !lastUpdateToTiro && !items.length && raw.itemsFound == null) return { present: false };
  return { present: true, untrusted: true, lastCheck, itemsFound: n, lastUpdateToTiro, nextCheck, note: str(raw.note, 300), items,
    stale: !lastCheck || now - Date.parse(lastCheck) > STALE_MS };
}
