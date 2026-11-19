import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLink, cleanMusic, cleanManor, MANOR_THEMES, cleanOffice, feedOf } from './party/protocol.mjs';

const YT = 'dQw4w9WgXcQ', SP = '4uLU6hMCjMI75M1A2tKUQC';

test('parseMusicLink: YouTube links of every usual shape', () => {
  for (const u of ['https://www.youtube.com/watch?v=' + YT, 'https://youtu.be/' + YT + '?t=3', 'https://music.youtube.com/watch?v=' + YT + '&list=x', 'https://m.youtube.com/watch?v=' + YT])
    assert.deepEqual(parseMusicLink(u), { src: 'youtube', ref: YT }, u);
  assert.equal(parseMusicLink('https://www.youtube.com/watch?v=' + YT + 'x'), null, '12 characters');
  assert.equal(parseMusicLink('https://evil.example.com/watch?v=' + YT).src, 'stream', 'another host is only a stream URL');
});

test('parseMusicLink: Spotify links and URIs, track/album/playlist/episode only', () => {
  assert.deepEqual(parseMusicLink('https://open.spotify.com/track/' + SP + '?si=abc'), { src: 'spotify', ref: 'track:' + SP });
  assert.deepEqual(parseMusicLink('https://open.spotify.com/intl-de/album/' + SP), { src: 'spotify', ref: 'album:' + SP });
  assert.deepEqual(parseMusicLink('spotify:playlist:' + SP), { src: 'spotify', ref: 'playlist:' + SP });
  assert.deepEqual(parseMusicLink('https://open.spotify.com/episode/' + SP), { src: 'spotify', ref: 'episode:' + SP });
  assert.equal(parseMusicLink('https://open.spotify.com/artist/' + SP), null);
  assert.equal(parseMusicLink('spotify:track:short'), null);
});

test('parseMusicLink: https audio streams, nothing else', () => {
  assert.deepEqual(parseMusicLink('https://radio.example.com/stream.mp3'), { src: 'stream', ref: 'https://radio.example.com/stream.mp3' });
  assert.equal(parseMusicLink('http://radio.example.com/stream.mp3'), null);
  assert.equal(parseMusicLink('https://user:pw@radio.example.com/s'), null);
  assert.equal(parseMusicLink('https://radio.example.com/' + 'a'.repeat(300)), null);
  assert.equal(parseMusicLink('javascript:alert(1)'), null);
  assert.equal(parseMusicLink(''), null);
});

test('cleanMusic keeps only the known fields, re-checks the ref', () => {
  const m = cleanMusic({ src: 'youtube', ref: YT, title: '<b>Song</b>\u202e', startedAt: 1000, paused: false, pos: 12.5, extra: 'x' });
  assert.deepEqual(m, { src: 'youtube', ref: YT, title: 'Song', startedAt: 1000, paused: false, pos: 12.5 });
  assert.equal(cleanMusic({ src: 'youtube', ref: 'bad id!' }), null);
  assert.equal(cleanMusic({ src: 'spotify', ref: 'artist:' + SP }), null);
  assert.equal(cleanMusic({ src: 'stream', ref: 'http://x.example.com/a' }), null);
  assert.equal(cleanMusic({ src: 'file', ref: 'C:/music/a.mp3' }), null);
  assert.equal(cleanMusic({ src: 'youtube', ref: YT, pos: -5 }).pos, 0);
  assert.equal(cleanMusic(null), null);
});

test('cleanManor: a known theme and #rrggbb colours only', () => {
  assert.deepEqual(MANOR_THEMES, ['modern', 'country', 'japanese', 'beach', 'cyber', 'cottage']);
  assert.deepEqual(cleanManor({ theme: 'beach', colors: { wall: '#AABBCC', floor: 'red', roof: '#fff', accent: 'url(x)', extra: '#000000' } }), { theme: 'beach', colors: { wall: '#aabbcc' } });
  assert.equal(cleanManor({ theme: 'castle' }), null);
  assert.deepEqual(cleanManor({ theme: 'cyber' }), { theme: 'cyber', colors: {} });
});

test('cleanOffice carries the manor; feedOf copies it from the snapshot', () => {
  assert.deepEqual(cleanOffice({ agents: [], manor: { theme: 'cottage', colors: { roof: '#112233' } } }).manor, { theme: 'cottage', colors: { roof: '#112233' } });
  assert.equal(cleanOffice({ agents: [], manor: { theme: 'x' } }).manor, null);
  assert.deepEqual(feedOf({ agents: [], manor: { theme: 'japanese', colors: {} } }, null, {}, x => x).manor, { theme: 'japanese', colors: {} });
});

// ---------- the party's shared player (party/server.mjs createParty) ----------
import { createParty } from './party/server.mjs';
const partyOf = () => {
  let t = 5000; const p = createParty({ code: 'ABC', adminKey: 'k'.repeat(32), now: () => t });
  const join = (name, host) => { const r = p.join({ code: 'ABC', name, ...(host ? { hostKey: 'k'.repeat(32) } : {}) }, name); const m = p.member(r.body.token); m.got = []; p.attach(m, ev => ev && m.got.push(ev)); return m; };
  return { p, join, tick: d => { t += d; } };
};

test('party music: the host plays a link; everyone gets it with a server start time', () => {
  const { p, join } = partyOf(), h = join('Hal', true), g = join('Gus');
  assert.deepEqual(p.music(h, { music: { src: 'youtube', ref: YT, title: 'Song', startedAt: 1, pos: 3 } }), { ok: true });
  const ev = g.got.find(e => e.t === 'music');
  assert.equal(ev.music.startedAt, 5000, 'stamped by the server'); assert.equal(ev.music.pos, 3); assert.equal(ev.djAll, true);
  assert.equal(p.hello(g).music.ref, YT, 'late joiners get it in the hello');
});

test('party music: anyone can DJ by default; with it off only the host can', () => {
  const { p, join } = partyOf(), h = join('Hal', true), g = join('Gus');
  assert.equal(p.music(g, { music: { src: 'stream', ref: 'https://radio.example.com/a.mp3' } }).ok, true);
  assert.equal(p.music(g, { djAll: false }).ok, false, 'only the host switches it');
  assert.equal(p.music(h, { djAll: false }).ok, true);
  const before = h.got.length;
  assert.equal(p.music(g, { music: { src: 'youtube', ref: YT } }).ok, false);
  assert.equal(h.got.length, before, 'nothing relayed');
  assert.equal(p.music(g, { music: { src: 'youtube', ref: 'nope' } }).ok, false);
  assert.equal(p.music(h, { music: null }).ok, true); assert.equal(p.hello(g).music, null, 'the host can stop it');
  assert.equal(p.music(h, { music: { src: 'file', ref: '/etc/passwd' } }).ok, false);
});

// ---------- the player in each app (public/party-music.js) ----------
import { loadWorld } from './world-vm.mjs';
const PM = loadWorld({ extra: ['party-music.js'] }).PartyMusic;

test('posOf: paused stays put, playing moves with the clock', () => {
  assert.equal(PM.posOf({ startedAt: 1000, pos: 10, paused: true }, 9000), 10);
  assert.equal(PM.posOf({ startedAt: 1000, pos: 10, paused: false }, 6000), 15);
  assert.equal(PM.posOf(null, 5), 0);
});

test('embed: privacy-enhanced YouTube with the start time, the Spotify embed, a stream as audio', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PM.embed({ src: 'youtube', ref: YT, startedAt: 0, pos: 0, paused: false }, 42500))),
    { kind: 'iframe', url: 'https://www.youtube-nocookie.com/embed/' + YT + '?enablejsapi=1&autoplay=1&playsinline=1&start=42' });
  assert.equal(PM.embed({ src: 'spotify', ref: 'playlist:' + SP }).url, 'https://open.spotify.com/embed/playlist/' + SP);
  assert.deepEqual(JSON.parse(JSON.stringify(PM.embed({ src: 'stream', ref: 'https://radio.example.com/a.mp3' }))), { kind: 'audio', url: 'https://radio.example.com/a.mp3' });
});

test('drift: resync only past 2 seconds', () => {
  const m = { startedAt: 0, pos: 0, paused: false };
  assert.equal(PM.drift(10.5, m, 9000), false);
  assert.equal(PM.drift(6.9, m, 9000), true);
  assert.equal(PM.drift(11.5, m, 9000), true);
});

// ---- the meeting room ducks the party music ----
function playerRig(m) {
  const sent = [];
  const el = { style: {}, addEventListener() {}, load() {}, contentWindow: { postMessage: (msg, origin) => sent.push([typeof msg === 'string' ? JSON.parse(msg) : msg, origin]) } };
  const mk = () => ({ style: {}, appendChild() {}, addEventListener() {}, set innerHTML(v) {} });
  const P = loadWorld({ extra: ['party-music.js'], globals: { addEventListener() {}, document: { body: { appendChild() {} }, createElement: t => (t === 'iframe' ? el : mk()) } } }).PartyMusic;
  P.sync(m); sent.length = 0;
  return { P, sent, el };
}
test('duck: Spotify is paused, then re-synced to the party position and resumed', () => {
  const now = Date.now(), { P, sent } = playerRig({ src: 'spotify', ref: 'track:' + SP, startedAt: now - 30000, pos: 10, paused: false });
  P.duck(true); assert.deepEqual(sent.map(x => x[0]), [{ command: 'pause' }]); P.duck(true); assert.equal(sent.length, 1, 'idempotent');
  P.duck(false);
  assert.deepEqual(sent.slice(1).map(x => x[0].command), ['seek', 'resume']);
  const ms = sent[1][0].timestamp; assert.ok(ms >= 40000 && ms < 42000, 'about 10 s + 30 s into the track: ' + ms);
  assert.ok(sent.every(x => x[1] === 'https://open.spotify.com'));
});
test('duck: YouTube drops to volume 25 and comes back to 100', () => {
  const { P, sent } = playerRig({ src: 'youtube', ref: YT, startedAt: Date.now(), pos: 0, paused: false });
  P.duck(true); P.duck(false);
  assert.deepEqual(sent.map(x => [x[0].func, x[0].args]), [['setVolume', [25]], ['setVolume', [100]]]);
});
