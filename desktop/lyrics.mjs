// Synced lyrics for the Tiro island: LRC parsing, current-line lookup and a disk-cached LRCLIB client. No electron import, so it is testable with node --test.
// Privacy: the only data sent is track title, artist, album and duration (as URL query), to https://lrclib.net. Nothing else, no identifiers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LRCLIB = 'https://lrclib.net/api/get';
const MAX_LINES = 800, MAX_TEXT = 200, MAX_BODY = 400000;
const NEG_TTL = 3 * 24 * 3600 * 1000;  // "no lyrics" is remembered for 3 days (lyrics get added over time)
const FAIL_COOLDOWN = 5 * 60 * 1000;   // network failure: do not retry the same track for 5 minutes (and never cache it)
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

// "[01:02.50]text", multiple stamps per line, "[mm:ss]", 1-3 digit fractions, "[offset:+250]" (ms, shifts lines earlier when positive per the LRC convention), word stamps "<00:01.00>" stripped.
// Returns [{ t: ms, text }] sorted by time; text may be '' (an instrumental gap).
export function parseLrc(src) {
  if (typeof src !== 'string') return [];
  const out = []; let offset = 0;
  for (const raw of src.split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw); if (off) { offset = +off[1]; continue; }
    const stamps = []; let rest = raw.trim(), m;
    while ((m = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/.exec(rest))) {
      const frac = m[3] ? Math.round(+('0.' + m[3]) * 1000) : 0;
      stamps.push((+m[1]) * 60000 + (+m[2]) * 1000 + frac); rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;
    const text = clip(rest.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, ''), MAX_TEXT);
    for (const t of stamps) out.push({ t: Math.max(0, t - offset), text });
    if (out.length > MAX_LINES * 2) break;
  }
  return out.map((l, i) => ({ ...l, i })).sort((a, b) => a.t - b.t || a.i - b.i).slice(0, MAX_LINES).map(({ t, text }) => ({ t, text }));
}

// Index of the line being sung at posMs (last line with t <= posMs), or -1 before the first line / without lines.
export function lineAt(lines, posMs) {
  if (!Array.isArray(lines) || !lines.length || !Number.isFinite(posMs)) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= posMs) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

// Playback position now, extrapolated from the SMTC anchor (pos at wall-clock ts) while playing; null when the player gives no usable timeline.
export function positionNow(np, now = Date.now()) {
  if (!np || !Number.isFinite(np.pos) || !Number.isFinite(np.ts)) return null;
  const p = np.pos + (np.playing ? Math.max(0, now - np.ts) : 0);
  return Number.isFinite(np.dur) && np.dur > 0 ? Math.min(p, np.dur) : p;
}

// Identity of a track for lyric lookup; position/status are deliberately not part of it.
export const trackKey = np => (np && np.title && np.artist && Number.isFinite(np.dur) && np.dur > 0 ? [np.title, np.artist, np.album || '', Math.round(np.dur / 1000)].join('␟') : '');

export function lookupUrl(np) {
  const q = new URLSearchParams({ track_name: np.title, artist_name: np.artist });
  if (np.album) q.set('album_name', np.album);
  q.set('duration', String(Math.round(np.dur / 1000)));
  return `${LRCLIB}?${q}`;
}

// get(np) -> [{t,text}] | null. Cached on disk under dir (one small JSON per track). Never throws.
export function createLyrics({ dir, fetchFn = globalThis.fetch, timeoutMs = 3000, userAgent = 'AgentOffice (local desktop app)', now = () => Date.now() } = {}) {
  const inflight = new Map(), failed = new Map();
  const file = key => path.join(dir, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  const readCache = key => {
    try {
      const j = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      if (j?.v !== 1) return undefined;
      if (j.lines === null) return now() - j.at < NEG_TTL ? null : undefined;
      return Array.isArray(j.lines) ? j.lines.map(([t, text]) => ({ t, text })) : undefined;
    } catch { return undefined; }
  };
  const writeCache = (key, lines) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(key), JSON.stringify({ v: 1, at: now(), lines: lines && lines.map(l => [l.t, l.text]) })); } catch {} };
  async function lookup(np, key) {
    try {
      const r = await fetchFn(lookupUrl(np), { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': userAgent, accept: 'application/json' } });
      if (r.status === 404) { writeCache(key, null); return null; }
      if (!r.ok) { failed.set(key, now()); return null; }
      const body = await r.text();
      if (body.length > MAX_BODY) { failed.set(key, now()); return null; }
      const j = JSON.parse(body);
      const lines = !j || j.instrumental ? [] : parseLrc(j.syncedLyrics);
      const res = lines.length ? lines : null; writeCache(key, res); return res;
    } catch { failed.set(key, now()); return null; }
  }
  return {
    async get(np) {
      const key = trackKey(np); if (!key) return null;
      const hit = readCache(key); if (hit !== undefined) return hit;
      if (failed.has(key) && now() - failed.get(key) < FAIL_COOLDOWN) return null;
      if (!inflight.has(key)) inflight.set(key, lookup(np, key).finally(() => inflight.delete(key)));
      return inflight.get(key);
    },
  };
}
