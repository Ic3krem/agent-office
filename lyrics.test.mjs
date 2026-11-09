import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLrc, lineAt, positionNow, trackKey, lookupUrl, createLyrics, LRCLIB } from './desktop/lyrics.mjs';

const LRC = `[ar:Someone]
[ti:Song]
[00:12.50]Second line
[00:01.00]First line
[01:02.5][02:00]Chorus
[00:30]No fraction
[00:40.123]<00:40.12>Word <00:41.00>stamps
[00:50.00]
garbage line
[99:99.99]  `;

test('parseLrc: sorts, handles multi-stamps, fractions, word stamps, metadata, blanks and junk', () => {
  const l = parseLrc(LRC);
  assert.deepEqual(l.map(x => x.t), [1000, 12500, 30000, 40123, 50000, 62500, 120000, 99 * 60000 + 99990]);
  assert.equal(l[0].text, 'First line');
  assert.equal(l[3].text, 'Word stamps');
  assert.equal(l[4].text, '');
  assert.equal(l[5].text, 'Chorus'); assert.equal(l[6].text, 'Chorus');
  assert.deepEqual(parseLrc(undefined), []); assert.deepEqual(parseLrc(''), []); assert.deepEqual(parseLrc('just words'), []);
});

test('parseLrc: offset tag shifts lines earlier, never below 0; text length is capped', () => {
  const l = parseLrc('[offset:+500]\n[00:00.30]a\n[00:02.00]b');
  assert.deepEqual(l.map(x => x.t), [0, 1500]);
  assert.equal(parseLrc('[00:01.00]' + 'x'.repeat(999))[0].text.length, 200);
  assert.ok(parseLrc(Array.from({ length: 3000 }, (_, i) => `[00:${String(i % 60).padStart(2, '0')}.00]l`).join('\n')).length <= 800);
});

test('lineAt: before first, exact boundary, between, after last, empty', () => {
  const l = parseLrc('[00:01.00]a\n[00:03.00]b\n[00:05.00]c');
  assert.equal(lineAt(l, 0), -1); assert.equal(lineAt(l, 999), -1);
  assert.equal(lineAt(l, 1000), 0); assert.equal(lineAt(l, 2999), 0);
  assert.equal(lineAt(l, 3000), 1); assert.equal(lineAt(l, 4999), 1);
  assert.equal(lineAt(l, 5000), 2); assert.equal(lineAt(l, 9e9), 2);
  assert.equal(lineAt([], 100), -1); assert.equal(lineAt(l, NaN), -1); assert.equal(lineAt(null, 1), -1);
});

test('positionNow: extrapolates while playing (clamped to duration), frozen when paused, null without a timeline', () => {
  const np = { playing: true, pos: 10000, ts: 1000000, dur: 200000 };
  assert.equal(positionNow(np, 1002500), 12500);
  assert.equal(positionNow(np, 1000000 - 500), 10000);          // clock skew never goes backwards
  assert.equal(positionNow(np, 1000000 + 9e6), 200000);
  assert.equal(positionNow({ ...np, playing: false }, 1002500), 10000);
  assert.equal(positionNow({ playing: true, pos: null, ts: null }), null);
  assert.equal(positionNow(null), null);
});

const TRACK = { title: 'Yesterday', artist: 'The Beatles', album: '1', dur: 125600 };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lyr-'));
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('trackKey / lookupUrl: only title, artist, album, duration (seconds) are sent', () => {
  assert.equal(trackKey({ ...TRACK, dur: null }), ''); assert.equal(trackKey({ ...TRACK, artist: '' }), ''); assert.equal(trackKey(null), '');
  assert.equal(trackKey(TRACK), trackKey({ ...TRACK, pos: 5, ts: 9, status: 'Playing', id: 'secret-app-id' })); // position/status/session id are not identity
  const u = new URL(lookupUrl({ ...TRACK, id: 'Spotify.exe', pos: 1, ts: 2 }));
  assert.equal(u.origin + u.pathname, LRCLIB);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['album_name', 'artist_name', 'duration', 'track_name']);
  assert.equal(u.searchParams.get('duration'), '126');
  assert.equal(u.searchParams.get('track_name'), 'Yesterday');
  assert.deepEqual([...new URL(lookupUrl({ ...TRACK, album: '' })).searchParams.keys()].sort(), ['artist_name', 'duration', 'track_name']);
});

test('createLyrics: fetches once, caches on disk across instances, sends a 3s timeout signal and a user agent', async () => {
  const dir = mk(); let calls = 0, seen;
  const fetchFn = async (url, opts) => { calls++; seen = { url, opts }; return resp(200, { syncedLyrics: '[00:01.00]hi\n[00:02.00]there', plainLyrics: 'x' }); };
  const a = createLyrics({ dir, fetchFn, userAgent: 'T/1' });
  const [r1, r2] = await Promise.all([a.get(TRACK), a.get(TRACK)]); // concurrent calls share one request
  assert.equal(calls, 1); assert.deepEqual(r1, r2); assert.deepEqual(r1, [{ t: 1000, text: 'hi' }, { t: 2000, text: 'there' }]);
  assert.ok(seen.opts.signal instanceof AbortSignal); assert.equal(seen.opts.headers['user-agent'], 'T/1');
  assert.equal(Object.keys(seen.opts).sort().join(), 'headers,signal'); // no body, no cookies/credentials
  const b = createLyrics({ dir, fetchFn });                         // fresh instance = disk cache
  assert.deepEqual(await b.get(TRACK), r1); assert.equal(calls, 1);
  assert.equal(fs.readdirSync(dir).length, 1);
  fs.rmSync(dir, { recursive: true });
});

test('createLyrics: 404, instrumental and plain-only are cached as "no lyrics" (null); expires after 3 days', async () => {
  for (const r of [resp(404, {}), resp(200, { instrumental: true, syncedLyrics: '[00:01.00]x' }), resp(200, { plainLyrics: 'only plain', syncedLyrics: null })]) {
    const dir = mk(); let calls = 0, t = 1e12;
    const c = () => createLyrics({ dir, fetchFn: async () => { calls++; return r; }, now: () => t });
    const per = r.status === 404 ? 2 : 1; // a 404 on the exact match is followed by one search
    assert.equal(await c().get(TRACK), null); assert.equal(await c().get(TRACK), null); assert.equal(calls, per);
    t += 4 * 24 * 3600 * 1000; assert.equal(await c().get(TRACK), null); assert.equal(calls, 2 * per);
    fs.rmSync(dir, { recursive: true });
  }
});

test('createLyrics: no exact match -> search by title and artist; picks synced lyrics within 3 s, ignoring album and title extras', async () => {
  const dir = mk(), urls = [];
  const results = [
    { trackName: 'Yesterday', artistName: 'The Beatles', duration: 140, syncedLyrics: '[00:01.00]too long' },        // 14 s off
    { trackName: 'Yesterday', artistName: 'Someone Else', duration: 125, syncedLyrics: '[00:01.00]other artist' },
    { trackName: 'Yesterday', artistName: 'The Beatles', duration: 126, syncedLyrics: null, plainLyrics: 'plain' },
    { trackName: 'Yesterday (Remastered 2009)', artistName: 'The Beatles', duration: 127, syncedLyrics: '[00:01.00]right one' },
  ];
  const fetchFn = async url => { urls.push(url); return /\/api\/get\?/.test(url) ? resp(404, {}) : resp(200, results); };
  const c = createLyrics({ dir, fetchFn });
  assert.deepEqual(await c.get({ ...TRACK, title: 'Yesterday - Remastered 2009' }), [{ t: 1000, text: 'right one' }]);
  assert.match(urls[1], /^https:\/\/lrclib\.net\/api\/search\?track_name=Yesterday&artist_name=The\+Beatles$/);
  assert.equal(await createLyrics({ dir, fetchFn: async () => { throw new Error('no network'); } }).get({ ...TRACK, title: 'Yesterday - Remastered 2009' }).then(l => l.length), 1, 'cached');
  fs.rmSync(dir, { recursive: true });
});

test('createLyrics: a "no lyrics" answer cached by an older version is retried', async () => {
  const dir = mk(); let calls = 0;
  fs.mkdirSync(dir, { recursive: true });
  const old = createLyrics({ dir, fetchFn: async () => resp(404, {}) }); await old.get(TRACK);
  for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), JSON.stringify({ v: 1, at: Date.now(), lines: null }));
  const c = createLyrics({ dir, fetchFn: async () => { calls++; return resp(200, { syncedLyrics: '[00:01.00]back' }); } });
  assert.equal((await c.get(TRACK))[0].text, 'back'); assert.equal(calls, 1);
  fs.rmSync(dir, { recursive: true });
});

test('createLyrics: network errors, timeouts, 5xx and junk fail silently, are not cached, and back off 5 minutes', async () => {
  const dir = mk(); let calls = 0, t = 1e12; const kinds = [() => { throw new Error('offline'); }, () => resp(503, ''), () => resp(200, 'not json'), () => resp(200, 'x'.repeat(500000))];
  for (const k of kinds) {
    calls = 0; fs.rmSync(dir, { recursive: true, force: true });
    const c = createLyrics({ dir, fetchFn: async () => { calls++; return k(); }, now: () => t });
    assert.equal(await c.get(TRACK), null); assert.equal(await c.get(TRACK), null); assert.equal(calls, 1);  // cooldown
    assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0);                                     // nothing cached
    t += 6 * 60 * 1000; assert.equal(await c.get(TRACK), null); assert.equal(calls, 2);                       // retried later
    t += 1;
  }
  // a real timeout: abort signal fires and the call still resolves to null
  const slow = createLyrics({ dir, timeoutMs: 30, fetchFn: (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  assert.equal(await slow.get(TRACK), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createLyrics: no duration or artist -> no request; corrupt cache file is ignored', async () => {
  const dir = mk(); let calls = 0;
  const c = createLyrics({ dir, fetchFn: async () => { calls++; return resp(200, { syncedLyrics: '[00:01.00]a' }); } });
  assert.equal(await c.get({ ...TRACK, dur: null }), null); assert.equal(await c.get({ title: 'x', artist: '', dur: 1000 }), null); assert.equal(calls, 0);
  await c.get(TRACK); const f = path.join(dir, fs.readdirSync(dir)[0]); fs.writeFileSync(f, '{broken');
  assert.deepEqual(await createLyrics({ dir, fetchFn: async () => { calls++; return resp(200, { syncedLyrics: '[00:02.00]b' }); } }).get(TRACK), [{ t: 2000, text: 'b' }]);
  fs.rmSync(dir, { recursive: true });
});
