// The private calendar link: validation, the guarded fetch, encrypted storage and the refresh loop. No real network: fetchImpl is faked.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLink, fetchCalendar, privateHost, createCalendarSync, saveLink, loadLink } from './desktop/calendar-link.mjs';
import { occurrences } from './desktop/ics.mjs';
import { removeKey } from './claude-key.mjs';

const ICS = fs.readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
const SECRET = 'private-0123456789abcdef';
const LINK = `https://calendar.example.com/ical/${SECRET}/basic.ics`;
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } });
const ok = body => new Response(body, { status: 200 });
const fakeFetch = (...answers) => { const calls = []; const f = async (u, opts) => { calls.push({ u, opts }); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; return typeof a === 'function' ? a(u, opts) : a; }; f.calls = calls; return f; };
const noLink = r => assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('calendar.example.com/ical'), 'the link is not in ' + JSON.stringify(r));

test('normalizeLink', () => {
  assert.equal(normalizeLink('  webcal://x.test/a.ics '), 'https://x.test/a.ics');
  assert.equal(normalizeLink('WEBCAL://x.test/a.ics'), 'https://x.test/a.ics');
  assert.equal(normalizeLink('https://x.test/a.ics'), 'https://x.test/a.ics');
  for (const bad of ['http://x.test/a.ics', 'file:///c:/a.ics', '  ', '', null, 42, 'https://', 'not a url', 'https://x.test/' + 'a'.repeat(2000)]) assert.equal(normalizeLink(bad), null, String(bad));
});

test('private, loopback and link-local hosts are refused', () => {
  for (const h of ['localhost', 'a.localhost', '127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '[::1]', '[::]', '[fe80::1]', '[fd00::1]', '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', 'localhost.', 'localhost..', '127.0.0.1.', '198.18.0.1', '198.19.255.254', '[64:ff9b::7f00:1]', '[fec0::1]', '[ff02::1]', '[ff00::]'])
    assert.equal(privateHost(new URL(`https://${h}/x`).hostname), true, h);
  for (const h of ['calendar.example.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1]', 'localhost.example.com', '198.20.0.1', '198.17.0.1', '[64:ff9a::1]']) assert.equal(privateHost(new URL(`https://${h}/x`).hostname), false, h);
  // a literal private address written another way still parses to the same host
  assert.equal(privateHost(new URL('https://0x7f.1/x').hostname), true);
});

test('fetchCalendar: success, headers, manual redirects', async () => {
  const f = fakeFetch(redirect('https://cdn.example.com/c.ics'), ok('\n  BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  const r = await fetchCalendar(LINK, { fetchImpl: f });
  assert.equal(r.ok, true); assert.match(r.text, /^\s*BEGIN:VCALENDAR/);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].u, 'https://cdn.example.com/c.ics');
  for (const c of f.calls) {
    assert.equal(c.opts.redirect, 'manual'); assert.equal(c.opts.credentials, 'omit'); assert.ok(c.opts.signal);
    assert.deepEqual(Object.keys(c.opts.headers).sort(), ['Accept', 'User-Agent']);
    assert.equal(c.opts.headers.Accept, 'text/calendar'); assert.doesNotMatch(c.opts.headers['User-Agent'], /tiro|agent|office|\d+\.\d+\.\d+/i);
  }
  // a relative redirect resolves against the current hop
  const g = fakeFetch(redirect('/other.ics', 301), ok('BEGIN:VCALENDAR'));
  assert.equal((await fetchCalendar(LINK, { fetchImpl: g })).ok, true);
  assert.equal(g.calls[1].u, 'https://calendar.example.com/other.ics');
});

test('fetchCalendar: every error, and never the link in the result', async () => {
  const cases = [
    ['bad-link', 'http://x', fakeFetch(ok('BEGIN:VCALENDAR'))],
    ['bad-link', LINK, fakeFetch(redirect('http://calendar.example.com/a.ics'))],
    ['bad-link', LINK, fakeFetch(redirect('https://127.0.0.1/a.ics'))],
    ['bad-link', LINK, fakeFetch(redirect('https://169.254.169.254/latest'))],
    ['bad-link', LINK, fakeFetch(redirect('https://localhost:8080/a'))],
    ['bad-link', 'https://192.168.0.10/a.ics', fakeFetch(ok('BEGIN:VCALENDAR'))],
    ['network', LINK, fakeFetch(redirect('https://a.example.com/1'), redirect('https://a.example.com/2'), redirect('https://a.example.com/3'), redirect('https://a.example.com/4'), ok('BEGIN:VCALENDAR'))],
    ['network', LINK, fakeFetch(() => { throw new TypeError('fetch failed for ' + LINK); })],
    ['http', LINK, fakeFetch(new Response(null, { status: 302 }))],
    ['http', LINK, fakeFetch(new Response('nope ' + LINK, { status: 404 }))],
    ['not-calendar', LINK, fakeFetch(ok('<!doctype html><title>Sign in</title>'))],
    ['too-big', LINK, fakeFetch(() => { let n = 0; return new Response(new ReadableStream({ pull(c) { if (n++ >= 48) c.close(); else c.enqueue(new Uint8Array(65536).fill(65)); } }), { status: 200 }); })],
    ['too-big', LINK, fakeFetch(new Response('BEGIN:VCALENDAR', { status: 200, headers: { 'content-length': String(3 * 1024 * 1024) } }))],
  ];
  for (const [want, link, f] of cases) {
    const r = await fetchCalendar(link, { fetchImpl: f });
    assert.deepEqual(r, { ok: false, error: want }, `${want} from ${f.calls.map(c => c.u).join(' > ')}`);
    noLink(r);
  }
  // 3 redirects are fine, the 4th is not
  const three = fakeFetch(redirect('https://a.example.com/1'), redirect('https://a.example.com/2'), redirect('https://a.example.com/3'), ok('BEGIN:VCALENDAR'));
  assert.equal((await fetchCalendar(LINK, { fetchImpl: three })).ok, true);
});

test('fetchCalendar: a host that never answers times out', async () => {
  const t0 = Date.now();
  let aborted = false;
  const r = await fetchCalendar(LINK, { fetchImpl: (u, o) => { o.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }, timeoutMs: 50 });
  assert.deepEqual(r, { ok: false, error: 'timeout' }); assert.ok(aborted, 'the request is aborted'); assert.ok(Date.now() - t0 < 2000);
  const slowBody = await fetchCalendar(LINK, { fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR')); } }), { status: 200 }), timeoutMs: 50 });
  assert.deepEqual(slowBody, { ok: false, error: 'timeout' });
});

test('storage: encrypted in its own file, only valid links load, remove deletes it', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cal-')), 'calendar-link.bin');
  const enc = s => Buffer.from('ENC:' + Buffer.from(s).toString('base64')), dec = b => { const t = String(b); if (!t.startsWith('ENC:')) throw new Error('bad'); return Buffer.from(t.slice(4), 'base64').toString(); };
  saveLink(f, LINK, enc);
  assert.ok(!fs.readFileSync(f, 'utf8').includes(SECRET));
  assert.equal(loadLink(f, dec), LINK);
  assert.throws(() => saveLink(f, 'http://x.test/a', enc), e => !String(e.message).includes('x.test'));
  fs.writeFileSync(f, enc('http://x.test/a')); assert.equal(loadLink(f, dec), '');
  removeKey(f); assert.equal(fs.existsSync(f), false); assert.equal(loadLink(f, dec), '');
});

// The refresh loop with a fake clock: tick() is what the 60 s timer calls.
function harness({ link = LINK, fetchImpl = fakeFetch(ok(ICS)), now = new Date(2026, 10, 24, 8, 0).getTime(), push, occurrencesImpl } = {}) {
  const h = { now, pushes: [], saved: [], removed: 0, stored: link, timers: 0 };
  h.sync = createCalendarSync({
    load: () => h.stored, save: l => { h.saved.push(l); h.stored = l; }, remove: () => { h.removed++; h.stored = ''; }, available: () => true,
    fetchImpl, push: push ? v => { h.pushes.push(v); push(v); } : v => h.pushes.push(v), now: () => h.now, occurrencesImpl,
    every: (fn, ms) => { h.timers++; h.every = { fn, ms }; return 1; }, clear: () => { h.timers--; h.every = null; },
  });
  h.fetches = () => fetchImpl.calls.length;
  return h;
}

test('loop: refreshes on start, every 15 min, pushes today and tomorrow only, and never the link', async () => {
  const h = harness();
  await h.sync.start();
  assert.equal(h.timers, 1); assert.equal(h.every.ms, 60e3);
  const v = h.pushes.at(-1);
  assert.equal(v.linked, true); assert.equal(v.host, 'calendar.example.com'); assert.equal(v.error, null); assert.equal(v.fetchedAt, h.now);
  assert.deepEqual(v.events.map(e => e.title), ['Team offsite', 'Stand-up', 'Review, part 2', 'Planning'], 'Tue 24 and Wed 25 only');
  assert.equal(typeof v.events[0].start, 'number'); assert.equal(v.events[2].join, true); assert.equal(v.events[1].join, false);
  noLink(v); noLink(h.pushes);
  assert.equal(h.sync.joinUrl(v.events[2].id), 'https://teams.microsoft.com/l/meetup-join/abcdef');
  assert.equal(h.sync.joinUrl(v.events[1].id), null); assert.equal(h.sync.joinUrl('nonsense'), null); assert.equal(h.sync.joinUrl('999:2'), null, 'an id from an older push opens nothing');
  h.now += 14 * 60e3; await h.every.fn(); assert.equal(h.fetches(), 1);
  h.now += 60e3; await h.every.fn(); assert.equal(h.fetches(), 2);
  h.sync.stop(); assert.equal(h.timers, 0);
});

test('loop: after sleep, one refresh, not one per missed interval', async () => {
  const h = harness();
  await h.sync.start();
  h.now += 9 * 3600e3; // the PC slept for 9 hours: the timer fires once on wake
  await h.every.fn(); await h.every.fn();
  assert.equal(h.fetches(), 2);
});

test('loop: failures back off 15, 30, 60, 60 min and keep the last good events', async () => {
  let fail = false;
  const f = fakeFetch(() => fail ? new Response('x', { status: 500 }) : ok(ICS));
  const h = harness({ fetchImpl: f });
  await h.sync.start();
  const good = h.pushes.at(-1).events; fail = true;
  const step = async min => { const n = h.fetches(); h.now += (min - 1) * 60e3; await h.every.fn(); assert.equal(h.fetches(), n, `not before ${min} min`); h.now += 60e3; await h.every.fn(); assert.equal(h.fetches(), n + 1, `at ${min} min`); };
  await step(15);
  assert.equal(h.pushes.at(-1).error, 'http'); assert.deepEqual(h.pushes.at(-1).events, good); assert.equal(h.pushes.at(-1).fetchedAt, new Date(2026, 10, 24, 8, 0).getTime());
  await step(15); await step(30); await step(60); await step(60);
  fail = false; await step(60);
  assert.equal(h.pushes.at(-1).error, null); await step(15);
});

test('loop: the day rolls over at local midnight without a refetch', async () => {
  const f = fakeFetch(ok(ICS));
  const h = harness({ fetchImpl: f, now: new Date(2026, 10, 24, 23, 50).getTime() });
  await h.sync.start();
  assert.ok(h.pushes.at(-1).events.some(e => e.title === 'Stand-up'));
  h.now = new Date(2026, 10, 25, 0, 0, 30).getTime(); // 10.5 min after the fetch: no refetch is due
  const n = h.fetches(), p = h.pushes.length;
  await h.every.fn();
  assert.equal(h.fetches(), n, 'no refetch');
  assert.equal(h.pushes.length, p + 1, 'one push for the new day');
  assert.deepEqual(h.pushes.at(-1).events.map(e => e.title), ['Planning'], 'Wed 25 (Planning) and Thu 26 (nothing)');
  await h.every.fn(); assert.equal(h.pushes.length, p + 1, 'nothing changed, nothing pushed');
});

test('set: validates, saves the normalized link, refreshes; remove deletes the file and the events', async () => {
  const h = harness({ link: '' });
  await h.sync.start();
  assert.deepEqual(h.pushes.at(-1), { available: true, linked: false, host: '', error: null, fetchedAt: null, partial: false, events: [] });
  assert.equal(h.fetches(), 0, 'no link, no fetch');
  assert.deepEqual(await h.sync.set('http://calendar.example.com/a.ics'), { ok: false, error: 'bad-link' });
  assert.deepEqual(await h.sync.set('https://10.0.0.5/a.ics'), { ok: false, error: 'bad-link' });
  assert.equal(h.saved.length, 0);
  const r = await h.sync.set('webcal://calendar.example.com/ical/' + SECRET + '/basic.ics');
  assert.equal(r.ok, true); assert.equal(r.linked, true); noLink(r);
  assert.deepEqual(h.saved, [LINK]); assert.equal(h.fetches(), 1); assert.equal(r.events.length, 4);
  const gone = await h.sync.set('');
  assert.equal(h.removed, 1); assert.equal(gone.linked, false); assert.deepEqual(gone.events, []); assert.equal(gone.fetchedAt, null);
  assert.equal(await h.sync.refresh().then(v => v.linked), false); assert.equal(h.fetches(), 1);
});

test('set: refused when the OS cannot encrypt it', async () => {
  const h = harness({ link: '' });
  const sync = createCalendarSync({ load: () => '', save: () => { throw new Error('must not save'); }, remove() {}, available: () => false, fetchImpl: fakeFetch(ok(ICS)), push() {}, now: () => h.now, every: () => 1, clear() {} });
  assert.deepEqual(await sync.set(LINK), { ok: false, error: 'no-storage' });
  assert.equal(sync.view().available, false);
});

test('a link change during a fetch drops the old result', async () => {
  let release; const slow = fakeFetch(() => new Promise(r => { release = () => r(ok(ICS)); }), ok('BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  const h = harness({ fetchImpl: slow });
  const started = h.sync.start();
  await new Promise(r => setImmediate(r));
  await h.sync.set('');
  release(); await started;
  assert.equal(h.pushes.at(-1).linked, false); assert.deepEqual(h.pushes.at(-1).events, []);
});

test('no log call in the calendar modules or in main near the link', () => {
  for (const f of ['desktop/calendar-link.mjs', 'desktop/ics.mjs']) {
    const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /console\.|logLine|logText|logEvent|process\.std(out|err)/, f);
  }
  const main = fs.readFileSync(new URL('./desktop/main.mjs', import.meta.url), 'utf8').split('\n');
  const lines = main.filter(l => /calendar|calSync|CAL_FILE|joinUrl/i.test(l));
  assert.ok(lines.length >= 4, 'main wires the calendar');
  for (const l of lines) assert.doesNotMatch(l, /console\.|logLine|logText|logEvent|\.message/, l.trim());
  const pre = fs.readFileSync(new URL('./desktop/island-preload.cjs', import.meta.url), 'utf8');
  assert.match(pre, /calendar:set/); assert.match(pre, /island:calendar/);
  assert.doesNotMatch(fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8'), /calendar-link/, 'the server never sees the link');
});

test('the page: the link field is emptied before the link is sent, the closed line gets the next event, only main opens Join links', () => {
  const page = fs.readFileSync(new URL('./public/notch-page.js', import.meta.url), 'utf8'), views = fs.readFileSync(new URL('./public/notch-views.js', import.meta.url), 'utf8');
  const sub = page.slice(page.indexOf("f.matches('[data-calform]')"));
  assert.ok(sub.indexOf("i.value = ''") > 0 && sub.indexOf("i.value = ''") < sub.indexOf('desk.calendar.set(link)'), 'the field is emptied first');
  assert.ok(page.includes('nextEvent: nextEvent(Date.now())'));
  assert.ok(page.includes('desk.calendar.join(cj.dataset.caljoin)'));
  assert.doesNotMatch(page + views, /openExternal|window\.open\(/);
  for (const k of ['e.title', 'e.where', 'cal.host', 'calMsg', 't', 'when']) assert.ok(!views.includes('${' + k + '}'), k + ' is always escaped');
});

test('a manual Refresh within 30 s of the last fetch is ignored', async () => {
  const h = harness();
  await h.sync.start();
  h.now += 29e3; const v = await h.sync.refresh();
  assert.equal(h.fetches(), 1); assert.equal(v.linked, true);
  h.now += 2e3; await h.sync.refresh(); assert.equal(h.fetches(), 2);
});

test('a feed cut at 5000 events says so', async () => {
  const many = ['BEGIN:VCALENDAR', ...Array.from({ length: 5001 }, (_, i) => ['BEGIN:VEVENT', `UID:m${i}`, 'SUMMARY:E', 'DTSTART:20261124T150000Z', 'END:VEVENT'].join('\r\n')), 'END:VCALENDAR'].join('\r\n');
  const h = harness({ fetchImpl: fakeFetch(ok(many)) });
  await h.sync.start();
  assert.equal(h.pushes.at(-1).partial, true);
  const g = harness(); await g.sync.start(); assert.equal(g.pushes.at(-1).partial, false);
});

test('occurrences run only when the events or the local day change; a throw keeps the last good list', async () => {
  let calls = 0, boom = false;
  const occurrencesImpl = (...a) => { calls++; if (boom) throw new RangeError('Invalid time value'); return occurrences(...a); };
  const h = harness({ occurrencesImpl });
  await h.sync.start();
  const n = calls, good = h.pushes.at(-1).events;
  for (let i = 0; i < 5; i++) { h.now += 60e3; await h.every.fn(); }
  assert.equal(calls, n, 'no recompute on a quiet tick');
  boom = true; h.now = new Date(2026, 10, 25, 0, 1).getTime();
  await h.every.fn(); assert.equal(calls, n + 1, 'recomputed for the new day');
  assert.deepEqual(h.sync.view().events.map(e => e.title), good.map(e => e.title), 'the last good list');
});

test('set, refresh, resend and the timer never throw or reject, even when push throws', async () => {
  const h = harness({ link: '', push: () => { throw new Error('window gone'); } });
  await h.sync.start();
  assert.doesNotThrow(() => h.sync.resend());
  const r = await h.sync.set(LINK); assert.equal(r.ok, true);
  h.now += 60e3; await h.sync.refresh();
  await h.every.fn();
  assert.equal((await h.sync.set('')).ok, true);
  const bad = createCalendarSync({ load: () => { throw new Error('x'); }, save() {}, remove() {}, available: () => { throw new Error('y'); }, fetchImpl: fakeFetch(ok(ICS)), push() {}, now: () => h.now, every: () => 1, clear() {} });
  assert.doesNotThrow(() => bad.resend());
  await bad.start(); await bad.refresh(); await bad.set(LINK); await bad.set('');
});

test('the Calendar tab says when the feed was cut to 5000 events', () => {
  const views = fs.readFileSync(new URL('./public/notch-views.js', import.meta.url), 'utf8');
  assert.match(views, /partial: 'The calendar is too large, so only part of it is shown\.'/);
  assert.ok(views.includes("${cal.partial ? `<div class=\"note\" role=\"status\">${esc(calErr('partial'))}</div>` : ''}"));
});
