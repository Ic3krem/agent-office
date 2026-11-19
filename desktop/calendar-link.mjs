// The private calendar link (a secret: anyone with it can read the calendar). Validation, a guarded https fetch, storage through the
// OS-encrypted key helpers, and the refresh loop the desktop process runs while the notch is on. The link never leaves this module
// except to its own host: results, errors and the pushed view carry fixed error words and the hostname only. Nothing here logs.
import { saveKey, loadKey } from '../claude-key.mjs';
import { parseIcs, occurrences } from './ics.mjs';

const MAX_LEN = 2000, MAX_REDIRECTS = 3;
const UA = 'Mozilla/5.0 (compatible; calendar-reader)'; // generic on purpose: no app name, version or user details
const fail = error => ({ ok: false, error });

// webcal:// -> https://; only https URLs of at most 2000 characters with a hostname.
export function normalizeLink(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim(); if (/^webcal:\/\//i.test(t)) t = 'https://' + t.slice(9);
  if (!t || t.length > MAX_LEN) return null;
  let u; try { u = new URL(t); } catch { return null; }
  return u.protocol === 'https:' && u.hostname && u.href.length <= MAX_LEN ? u.href : null;
}

// This PC or its network, written as a name or a literal address (URL has already turned 0x7f.1 into 127.0.0.1 and IPv6 into hex).
// ponytail: a public name that resolves to a private address is not caught; that needs a DNS lookup per hop.
export function privateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  const bad4 = ([a, b]) => a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) return bad4(v4.slice(1).map(Number));
  if (!h.includes(':')) return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) { const [x, y] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]; return bad4([x >> 8, x & 255, y >> 8, y & 255]); }
  if (h.startsWith('::') || h.startsWith('64:ff9b:')) return true; // ::, ::1 and the other reserved ::/96 forms; NAT64 64:ff9b::/96 reaches IPv4 behind it
  const first = parseInt(h.split(':')[0], 16);
  return (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xfe00) === 0xfc00 || first >= 0xff00; // link-local, site-local, unique-local, multicast
}

// One calendar download: https on every hop, redirects followed by hand (at most 3), a 10 s limit for the whole thing, 2 MB cap.
export async function fetchCalendar(link, { fetchImpl = fetch, timeoutMs = 10e3, maxBytes = 2 * 1024 * 1024 } = {}) {
  let u = normalizeLink(link);
  if (!u) return fail('bad-link');
  const ctl = new AbortController(), TIMEOUT = {}; let timer;
  const expired = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(TIMEOUT); }, timeoutMs); });
  expired.catch(() => {});
  const race = p => Promise.race([p, expired]);
  const drop = r => { try { r.body?.cancel().catch(() => {}); } catch {} };
  try {
    for (let hop = 0; ; hop++) {
      if (privateHost(new URL(u).hostname)) return fail('bad-link');
      const r = await race(fetchImpl(u, { redirect: 'manual', credentials: 'omit', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/calendar' } }));
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location'); drop(r);
        if (!loc) return fail('http');
        if (hop >= MAX_REDIRECTS) return fail('network');
        let next; try { next = normalizeLink(new URL(loc, u).href); } catch { next = null; }
        if (!next) return fail('bad-link');
        u = next; continue;
      }
      if (!r.ok) { drop(r); return fail('http'); }
      if (+r.headers.get('content-length') > maxBytes) { drop(r); return fail('too-big'); }
      const parts = []; let size = 0;
      if (r.body) {
        const rd = r.body.getReader();
        for (;;) {
          const { done, value } = await race(rd.read());
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { rd.cancel().catch(() => {}); return fail('too-big'); }
          parts.push(value);
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(parts));
      return /^\s*BEGIN:VCALENDAR/i.test(text) ? { ok: true, text } : fail('not-calendar');
    }
  } catch (e) {
    return fail(e === TIMEOUT ? 'timeout' : 'network'); // never e.message: it can carry the URL
  } finally { clearTimeout(timer); }
}

// Storage: the generic encrypted-key helpers with a link validator (calendar-link.bin in the config folder).
const linkShape = s => typeof s === 'string' && normalizeLink(s) === s;
export const saveLink = (file, link, enc) => saveKey(file, link, enc, linkShape);
export const loadLink = (file, dec) => loadKey(file, dec, linkShape);

const REFRESH = 15 * 60e3, BACKOFF_MIN = [15, 30, 60];
// The loop. tick() runs every minute while started: it refetches when due (15 min, or the back-off after failures) and otherwise
// re-sends the view only when it changed (a new local day). A due time in wall-clock ms means a wake from sleep fetches once.
// The events are kept in memory only; push(view) gets { available, linked, host, error, fetchedAt, partial, events } and never the link
// (partial: the feed had more than 5000 events and only those were read). No method throws or rejects: a broken feed or a closed
// window must not reach the main process's error handler.
const MANUAL_GAP = 30e3; // a Refresh click this soon after the last download only re-sends the view
export function createCalendarSync({ load, save, remove, available, fetchImpl = fetch, push, now = Date.now, occurrencesImpl = occurrences,
  every = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; }, clear = clearInterval }) {
  let link = null, loaded = false, events = [], ver = 0, fetchedAt = null, error = null, failures = 0, nextAt = 0, doneAt = -Infinity;
  let timer = null, gen = 0, inflight = null, seq = 0, occKey = '', occ = [], occFor = '', sent = '';
  const canStore = () => { try { return !!available(); } catch { return false; } };
  const ensure = () => { if (!loaded) { loaded = true; try { link = canStore() ? load() || null : null; } catch { link = null; } } };
  function view() {
    ensure();
    const d = new Date(now()), key = `${ver}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== occFor) { // expand only when the events or the local day changed; a failure keeps the last good list
      try {
        const list = link ? occurrencesImpl(events, new Date(d.getFullYear(), d.getMonth(), d.getDate()), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2)) : [];
        occFor = key; const j = JSON.stringify(list); if (j !== occKey) { occKey = j; occ = list; seq++; } // ids stay the same while the list does
      } catch {}
    }
    return { available: canStore(), linked: !!link, host: link ? new URL(link).hostname : '', error: link ? error : null, fetchedAt: link ? fetchedAt : null, partial: !!(link && events.truncated),
      events: occ.map((o, i) => ({ id: seq + ':' + i, title: o.title, start: +o.start, end: +o.end, allDay: o.allDay, where: o.where, join: !!o.join })) };
  }
  function publish(force) { const v = view(), j = JSON.stringify(v); if (force || j !== sent) { sent = j; try { push(v); } catch {} } return v; }
  const safeView = force => { try { return publish(force); } catch { return null; } };
  const setEvents = list => { events = list; ver++; };
  function fetchNow() {
    ensure();
    if (!link) return Promise.resolve(safeView());
    if (inflight) return inflight;
    const my = gen;
    const p = inflight = fetchCalendar(link, { fetchImpl }).then(r => {
      if (my !== gen) return publish(); // the link changed or was removed meanwhile: this answer is for the old one
      const t = now(); doneAt = t;
      let list = null; if (r.ok) try { list = parseIcs(r.text); } catch {}
      if (list) { setEvents(list); fetchedAt = t; error = null; failures = 0; nextAt = t + REFRESH; }
      else { error = r.ok ? 'not-calendar' : r.error; failures++; nextAt = t + BACKOFF_MIN[Math.min(failures, BACKOFF_MIN.length) - 1] * 60e3; } // the last good events stay
      return publish(true);
    }).catch(() => safeView()).finally(() => { if (inflight === p) inflight = null; });
    return p;
  }
  const tick = () => { try { return link && now() >= nextAt ? fetchNow() : Promise.resolve(safeView()); } catch { return Promise.resolve(null); } };
  const reset = l => { gen++; inflight = null; link = l; setEvents([]); fetchedAt = null; error = null; failures = 0; nextAt = 0; doneAt = -Infinity; };
  return {
    view,
    refresh: () => { try { return link && now() - doneAt < MANUAL_GAP ? Promise.resolve(safeView()) : fetchNow(); } catch { return Promise.resolve(null); } }, // the Refresh button
    resend: () => safeView(true),
    start() { ensure(); if (timer == null) timer = every(() => tick(), 60e3); return tick(); },
    stop() { if (timer != null) { clear(timer); timer = null; } },
    // '' removes the link (its file and the events); anything else must be an https link to a public host.
    async set(raw) {
      try {
        ensure();
        if (raw === '') { reset(null); try { remove(); } catch {} return { ok: true, ...publish(true) }; }
        if (!canStore()) return fail('no-storage');
        const l = normalizeLink(raw);
        if (!l || privateHost(new URL(l).hostname)) return fail('bad-link');
        try { save(l); } catch { return fail('no-storage'); }
        reset(l); publish(true); // the page shows the linked state (not loaded yet) while the first download runs
        return { ok: true, ...(await fetchNow()) };
      } catch { return fail('network'); }
    },
    // The meeting link of an event in the latest view, by its id; null for anything else.
    joinUrl(id) { const m = /^(\d+):(\d+)$/.exec(String(id || '')); return m && +m[1] === seq ? occ[+m[2]]?.join || null : null; },
  };
}
