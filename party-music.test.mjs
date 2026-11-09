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
