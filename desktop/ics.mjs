// Pure: a private calendar (ICS) feed -> events -> the instances in a time window. No library: Intl does the time zones.
// Handles line folding, TEXT escapes, TZID (IANA or the Windows names Outlook writes), UTC, floating (local) times, all-day dates,
// DTEND or DURATION, RRULE DAILY/WEEKLY/MONTHLY with INTERVAL, COUNT, UNTIL, BYDAY (weekly), EXDATE, moved/cancelled instances
// (RECURRENCE-ID). Other repeat rules yield only their first instance; an unknown TZID is read as local time.
const DAY = 864e5;
const WIN = {
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax',
  'Canada Central Standard Time': 'America/Regina', 'SA Pacific Standard Time': 'America/Bogota', 'Central America Standard Time': 'America/Guatemala', 'Central Standard Time (Mexico)': 'America/Mexico_City',
  'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires',
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'GTB Standard Time': 'Europe/Bucharest', 'FLE Standard Time': 'Europe/Kiev', 'E. Europe Standard Time': 'Europe/Chisinau', 'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem', 'South Africa Standard Time': 'Africa/Johannesburg', 'Egypt Standard Time': 'Africa/Cairo', 'Arab Standard Time': 'Asia/Riyadh', 'Arabian Standard Time': 'Asia/Dubai',
  'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Kolkata', 'Sri Lanka Standard Time': 'Asia/Colombo', 'Nepal Standard Time': 'Asia/Kathmandu', 'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok', 'Singapore Standard Time': 'Asia/Singapore', 'China Standard Time': 'Asia/Shanghai', 'Taipei Standard Time': 'Asia/Taipei', 'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane', 'AUS Eastern Standard Time': 'Australia/Sydney', 'New Zealand Standard Time': 'Pacific/Auckland',
};
const fmts = new Map();
function fmt(zone) {
  if (!fmts.has(zone)) { let f = null; try { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch {} fmts.set(zone, f); }
  return fmts.get(zone);
}
// TZID -> 'UTC', an IANA name, or '' (local time).
function zoneOf(tzid) {
  const t = String(tzid || '').replace(/^"|"$/g, '').trim();
  for (const z of [WIN[t], t, t.split('/').slice(-2).join('/')]) if (z && fmt(z)) return z === 'Etc/UTC' || z === 'UTC' ? 'UTC' : z;
  return '';
}
// Wall-clock parts [y, month0, d, h, mi, s] of an instant in a zone, and back.
function wallOf(ms, zone) {
  if (!zone) { const d = new Date(ms); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]; }
  if (zone === 'UTC') { const d = new Date(ms); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]; }
  const p = {}; for (const x of fmt(zone).formatToParts(ms)) p[x.type] = +x.value;
  return [p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second];
}
function msOf(w, zone) {
  if (!zone) return new Date(w[0], w[1], w[2], w[3], w[4], w[5]).getTime();
  const guess = Date.UTC(...w); if (zone === 'UTC') return guess;
  const off = t => Date.UTC(...wallOf(t, zone)) - t;
  const t = guess - off(guess), o2 = off(t);
  return guess - o2; // a second look settles the offset when the first guess fell on the other side of a change
}
const dayNo = w => Math.floor(Date.UTC(w[0], w[1], w[2]) / DAY);
const wallAt = (dn, w) => { const d = new Date(dn * DAY); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), w[3], w[4], w[5]]; };
const dow = dn => (((dn + 4) % 7) + 7) % 7; // day 0 (1970-01-01) was a Thursday
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const w = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  // years 0-99 would be read as 1900-1999 by Date; out-of-range fields would roll over into another date: both are dropped
  if (w[0] < 100 || w[1] > 11 || w[2] < 1 || w[2] > 31 || w[3] > 23 || w[4] > 59 || w[5] > 60) return null;
  if (!m[4]) return { ms: msOf(w, ''), allDay: true, zone: '' };
  const zone = m[7] ? 'UTC' : params.TZID ? zoneOf(params.TZID) : '';
  const ms = msOf(w, zone);
  return Number.isFinite(ms) ? { ms, allDay: false, zone } : null;
}
function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}
const unescape = v => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
function parseLine(line) {
  let q = false, i = 0;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  if (i >= line.length) return null;
  const [name, ...ps] = line.slice(0, i).split(';'), params = {};
  for (const p of ps) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1); }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}
function parseRule(v) {
  const r = {}; for (const part of v.split(';')) { const [k, x] = part.split('='); if (k && x != null) r[k.toUpperCase()] = x; }
  const known = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY'];
  const byday = r.BYDAY ? r.BYDAY.toUpperCase().split(',') : null, until = r.UNTIL ? parseDate(r.UNTIL, {}) : null;
  return {
    freq: String(r.FREQ || '').toUpperCase(), interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1), count: parseInt(r.COUNT, 10) > 0 ? parseInt(r.COUNT, 10) : null,
    until: until ? new Date(until.allDay ? until.ms + DAY - 1 : until.ms) : null, byday, wkst: DOW[String(r.WKST || 'MO').toUpperCase()] ?? 1,
    other: Object.keys(r).some(k => !known.includes(k)) || !!(byday && byday.some(d => !(d in DOW))),
  };
}

export const MAX_EVENTS = 5000;
// The events of a feed (at most MAX_EVENTS; the array's truncated flag says whether more were dropped). Never throws.
export function parseIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null, depth = 0;
  out.truncated = false;
  for (const raw of lines) {
    const l = parseLine(raw); if (!l) continue;
    if (l.name === 'BEGIN') { if (ev) depth++; else if (l.value.toUpperCase() === 'VEVENT') { ev = { exdates: [], p: {} }; depth = 0; } continue; }
    if (l.name === 'END') { if (ev && depth) depth--; else if (ev && l.value.toUpperCase() === 'VEVENT') { let e = null; try { e = finish(ev); } catch {} if (e) { if (out.length >= MAX_EVENTS) { out.truncated = true; return out; } out.push(e); } ev = null; } continue; }
    if (!ev || depth) continue; // VALARM and other nested parts are skipped
    if (l.name === 'EXDATE') { for (const v of l.value.split(',')) { const d = parseDate(v, l.params); if (d) ev.exdates.push(new Date(d.ms)); } continue; }
    if (!(l.name in ev.p)) ev.p[l.name] = l;
  }
  return out;
}
function finish({ p, exdates }) {
  const s = p.DTSTART && parseDate(p.DTSTART.value, p.DTSTART.params);
  if (!s) return null;
  const allDay = s.allDay || (p.DTSTART.params.VALUE || '').toUpperCase() === 'DATE';
  const e = p.DTEND && parseDate(p.DTEND.value, p.DTEND.params), dur = p.DURATION ? parseDuration(p.DURATION.value) : null;
  const endMs = e && e.ms >= s.ms ? e.ms : dur != null && dur >= 0 ? s.ms + dur : allDay ? s.ms + DAY : s.ms;
  if (!Number.isFinite(new Date(s.ms).getTime()) || !Number.isFinite(new Date(endMs).getTime())) return null; // beyond what Date can hold
  const txt = k => (p[k] ? unescape(p[k].value) : '');
  const rid = p['RECURRENCE-ID'] && parseDate(p['RECURRENCE-ID'].value, p['RECURRENCE-ID'].params);
  return {
    uid: txt('UID'), title: txt('SUMMARY'), start: new Date(s.ms), end: new Date(endMs), allDay, where: txt('LOCATION'), text: txt('DESCRIPTION'),
    rrule: p.RRULE ? parseRule(p.RRULE.value) : null, exdates,
    zone: allDay ? '' : s.zone, recurrenceId: rid ? new Date(rid.ms) : null, cancelled: txt('STATUS').toUpperCase() === 'CANCELLED',
    links: [txt('URL'), txt('X-GOOGLE-CONFERENCE')].filter(Boolean).join('\n'),
  };
}

// Start times (ms) of a series that may fall in [F, T); the caller filters exactly. Steps in wall-clock days, so a 09:00 stays 09:00 across a DST change.
function expand(e, F, T, budget) {
  const r = e.rrule, zone = e.zone, w0 = wallOf(+e.start, zone), d0 = dayNo(w0);
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(r.freq) || r.other || (r.byday && r.freq !== 'WEEKLY')) return [+e.start];
  const span = Math.max(0, +e.end - +e.start), dnLo = dayNo(wallOf(F - span, zone)) - 1, dnHi = dayNo(wallOf(T, zone)) + 1;
  const dnUntil = r.until ? dayNo(wallOf(+r.until, zone)) : Infinity;
  const offs = r.freq === 'WEEKLY' ? [...new Set((r.byday || [Object.keys(DOW)[dow(d0)]]).map(d => (DOW[d] - r.wkst + 7) % 7))].sort((a, b) => a - b) : [0];
  const wk0 = d0 - ((dow(d0) - r.wkst + 7) % 7);
  const step = r.freq === 'DAILY' ? r.interval : 7 * r.interval;
  // Skip ahead to the window. With COUNT the skipped instances are counted arithmetically: one per step (daily; monthly when every
  // month has the day), or every BYDAY day per week after the first week, whose days before DTSTART do not count.
  const first = offs.filter(o => wk0 + o >= d0).length;
  let i = 0, n = 0;
  if (!r.count || r.freq !== 'MONTHLY' || w0[2] <= 28) {
    const lo = new Date(dnLo * DAY), months = lo.getUTCFullYear() * 12 + lo.getUTCMonth() - (w0[0] * 12 + w0[1]);
    i = Math.max(0, Math.floor((r.freq === 'MONTHLY' ? months : dnLo - d0) / (r.freq === 'MONTHLY' ? r.interval : step)) - 1);
    n = r.freq === 'WEEKLY' ? (i ? first + (i - 1) * offs.length : 0) : i;
    if (r.count && n >= r.count) return [];
  }
  const out = [];
  for (; budget.left-- > 0; i++) { // one budget per occurrences() call: a hostile feed cannot hold the main process
    let days;
    if (r.freq === 'DAILY') days = [d0 + i * r.interval];
    else if (r.freq === 'WEEKLY') days = offs.map(o => wk0 + i * step + o).filter(dn => dn >= d0);
    else { const d = new Date(Date.UTC(w0[0], w0[1] + i * r.interval, w0[2])); days = d.getUTCDate() === w0[2] ? [Math.floor(+d / DAY)] : []; }
    for (const dn of days) {
      if (dn > dnHi || dn > dnUntil) return out;
      if (r.count && ++n > r.count) return out;
      if (dn < dnLo) continue;
      const ms = msOf(wallAt(dn, w0), zone);
      if (r.until && ms > +r.until) return out;
      out.push(ms);
    }
  }
  return out;
}

// Instances in [from, to), sorted by start (all-day first on a tie). join: the meeting link, if any.
// Never throws: an event that cannot be expanded is left out.
export function occurrences(events, from, to) {
  const F = +from, T = +to, out = [], budget = { left: 1e6 };
  if (!Array.isArray(events) || !Number.isFinite(F) || !Number.isFinite(T)) return out;
  const moved = new Set(events.filter(e => e && e.recurrenceId).map(e => e.uid + '|' + +e.recurrenceId));
  for (const e of events) {
    try {
      if (!e || e.cancelled || !Number.isFinite(+e.start) || !Number.isFinite(+e.end)) continue;
      const series = e.rrule && !e.recurrenceId;
      const span = e.allDay ? Math.round((+e.end - +e.start) / DAY) : +e.end - +e.start;
      let join;
      for (const s of series ? expand(e, F, T, budget) : [+e.start]) {
        if ((series && moved.has(e.uid + '|' + s)) || e.exdates.some(x => +x === s)) continue;
        const end = e.allDay ? msOf(wallAt(dayNo(wallOf(s, '')) + span, [0, 0, 0, 0, 0, 0]), '') : s + span;
        if (!Number.isFinite(s) || !Number.isFinite(end) || !(s < T && (end > F || s >= F))) continue;
        if (join === undefined) join = joinLink([e.where, e.text, e.links].join('\n')); // only for events that are shown
        out.push({ title: e.title, start: new Date(s), end: new Date(end), allDay: e.allDay, where: e.where, join });
      }
    } catch { /* this event is left out */ }
  }
  return out.sort((a, b) => +a.start - +b.start || +b.allDay - +a.allDay);
}

const MEET = ['teams.microsoft.com', 'teams.live.com', 'zoom.us', 'meet.google.com', 'webex.com'];
// The first https link to a known meeting service (the host is the service or a subdomain of it), or null.
export function joinLink(text) {
  for (const m of String(text || '').matchAll(/https:\/\/[^\s<>"'`\\]+/gi)) {
    let u; try { u = new URL(m[0].replace(/[.,;:!?)\]}]+$/, '')); } catch { continue; }
    const h = u.hostname.toLowerCase();
    if (u.protocol === 'https:' && !u.username && !u.password && MEET.some(d => h === d || h.endsWith('.' + d))) return u.href;
  }
  return null;
}
