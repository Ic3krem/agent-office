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

// The exact match (/api/get) misses when the player's album name or length differs from LRCLIB's copy; then search by a
// cleaned title and the artist and take the first synced result whose title and artist match and length is within 3 s.
const clean = s => String(s || '').replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
const norm = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const searchUrl = np => `${LRCLIB.replace(/\/get$/, '/search')}?${new URLSearchParams({ track_name: clean(np.title), artist_name: np.artist })}`;
export function pickResult(list, np) {
  const t = norm(np.title), a = norm(np.artist), d = np.dur / 1000;
  return (Array.isArray(list) ? list : []).find(r => r && typeof r.syncedLyrics === 'string' && !r.instrumental && norm(r.trackName) === t
    && (norm(r.artistName).includes(a) || a.includes(norm(r.artistName))) && Math.abs(Number(r.duration) - d) <= 3) || null;
}

// get(np) -> [{t,text}] | null. Cached on disk under dir (one small JSON per track). Never throws.
export const MAX_FAILED = 200, MAX_FILES = 500, MAX_BYTES = 10 * 1024 * 1024;
export function createLyrics({ dir, fetchFn = globalThis.fetch, timeoutMs = 3000, userAgent = 'AgentOffice (local desktop app)', now = () => Date.now() } = {}) {
  const inflight = new Map(), failed = new Map();
  // Bounded memory and disk: at most MAX_FAILED remembered failures, and the on-disk cache keeps the newest MAX_FILES files / MAX_BYTES bytes.
  const markFailed = key => { failed.delete(key); failed.set(key, now()); while (failed.size > MAX_FAILED) failed.delete(failed.keys().next().value); };
  let writes = 0;
  const pruneCache = () => {
    try {
      const items = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { const p = path.join(dir, f), st = fs.statSync(p); return { p, m: st.mtimeMs, n: st.size }; }).sort((a, b) => b.m - a.m);
      let bytes = 0;
      items.forEach((it, i) => { bytes += it.n; if (i >= MAX_FILES || bytes > MAX_BYTES) { try { fs.rmSync(it.p, { force: true }); } catch {} } });
    } catch {}
  };
  pruneCache();
  const file = key => path.join(dir, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  const readCache = key => {
    try {
      const j = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      if (j?.v !== 2) return undefined; // v2: misses before the search fallback are retried
      if (j.lines === null) return now() - j.at < NEG_TTL ? null : undefined;
      return Array.isArray(j.lines) ? j.lines.map(([t, text]) => ({ t, text })) : undefined;
    } catch { return undefined; }
  };
  const writeCache = (key, lines) => { if (++writes % 25 === 0) pruneCache(); try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(key), JSON.stringify({ v: 2, at: now(), lines: lines && lines.map(l => [l.t, l.text]) })); } catch {} };
  const getJson = async url => {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': userAgent, accept: 'application/json' } });
    if (r.status === 404) return { miss: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body = await r.text();
    if (body.length > MAX_BODY) throw new Error('too big');
    return { j: JSON.parse(body) };
  };
  async function lookup(np, key) {
    try {
      let { j, miss } = await getJson(lookupUrl(np));
      if (miss) j = pickResult((await getJson(searchUrl(np))).j, np);
      const lines = !j || j.instrumental ? [] : parseLrc(j.syncedLyrics);
      const res = lines.length ? lines : null; writeCache(key, res); return res;
    } catch { markFailed(key); return null; }
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
