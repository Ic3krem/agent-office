import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, appName, createNowPlaying } from './desktop/nowplaying.mjs';
import { normalizeSettings, DEFAULT_SETTINGS, applyPatch, migrateLyricsPrefs } from './desktop/island-logic.mjs';

test('appName maps known players and falls back to the exe name', () => {
  assert.equal(appName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify');
  assert.equal(appName('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'), 'Apple Music');
  assert.equal(appName('Chrome'), 'Chrome');
  assert.equal(appName('Foo.exe'), 'Foo');
  assert.equal(appName(''), 'Player');
});

test('parseLine: valid, paused, empty and hostile lines', () => {
  const ok = parseLine('{"id":"Spotify.exe","status":"Playing","title":"A","artist":"B","album":"C","canPlayPause":true,"canNext":true,"canPrev":false}');
  assert.deepEqual([ok.app, ok.playing, ok.title, ok.artist, ok.canNext, ok.canPrev], ['Spotify', true, 'A', 'B', true, false]);
  assert.equal(parseLine('{"id":"x","status":"Paused","title":"T"}').playing, false);
  for (const bad of ['null', '', 'junk', '[]', '{"id":"x","status":"Playing","title":"","artist":""}', '{"id":"x","status":"Closed","title":"T"}', '{"status":"Playing","title":"T"}']) assert.equal(parseLine(bad), null, bad);
  assert.equal(parseLine(JSON.stringify({ id: 'x', status: 'Playing', title: 'a'.repeat(999) })).title.length, 140);
});

test('createNowPlaying emits on change only, restarts nothing when stopped, controls only known verbs', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const made = []; const got = [];
  const spawnFn = () => { const p = new EventEmitter(); p.stdout = new PassThrough(); p.stdin = new PassThrough(); p.kill = () => p.emit('exit'); p.written = ''; p.stdin.on('data', d => { p.written += d; }); made.push(p); return p; };
  const np = createNowPlaying(n => got.push(n), { spawnFn });
  if (process.platform !== 'win32') return; // poller is Windows only
  np.start();
  const line = '{"id":"Spotify.exe","status":"Playing","title":"A","artist":"B"}\n';
  made[0].stdout.write(line); made[0].stdout.write(line); await new Promise(r => setTimeout(r, 20));
  assert.equal(got.length, 1);
  assert.equal(np.control('rm -rf'), false);
  assert.equal(np.control('next'), true); await new Promise(r => setTimeout(r, 20));
  assert.equal(made[0].written, 'next Spotify.exe\n');
  np.stop(); assert.equal(got.at(-1), null);
});

test('island settings: new boolean prefs default on and reject non-booleans', () => {
  assert.equal(DEFAULT_SETTINGS.nowPlaying && DEFAULT_SETTINGS.kiroFace && DEFAULT_SETTINGS.animate, true);
  const s = normalizeSettings({ nowPlaying: false, kiroFace: 'no', animate: false });
  assert.deepEqual([s.nowPlaying, s.kiroFace, s.animate], [false, true, false]);
});

test('parseLine: SMTC timeline (pos/dur/ts) is validated, absent or hostile values become null', () => {
  const ok = parseLine('{"id":"x","status":"Playing","title":"T","pos":212456,"dur":256000,"ts":1793640137670}');
  assert.deepEqual([ok.pos, ok.dur, ok.ts], [212456, 256000, 1793640137670]);
  const none = parseLine('{"id":"x","status":"Playing","title":"T","pos":null,"dur":null,"ts":null}');
  assert.deepEqual([none.pos, none.dur, none.ts], [null, null, null]);
  const bad = parseLine('{"id":"x","status":"Playing","title":"T","pos":"5","dur":-1,"ts":1e99}');
  assert.deepEqual([bad.pos, bad.dur, bad.ts], [null, null, null]);
});

test('lyrics pref: opt-in (off by default), rejects non-booleans, and an old stored default is switched off once', () => {
  assert.equal(DEFAULT_SETTINGS.lyrics, false, 'nothing is sent to lrclib.net until the user turns lyrics on');
  assert.equal(normalizeSettings({ lyrics: true }).lyrics, true);
  assert.equal(normalizeSettings({ lyrics: 'yes' }).lyrics, false);
  assert.equal(normalizeSettings({}).lyrics, false);
  assert.equal(normalizeSettings(undefined).lyrics, false);
  // migration: the old default (true) was stored by every settings patch, so it is not a choice; it is reset once
  const old = { islandMute: true, islandSettings: { theme: 'forest', lyrics: true } };
  const m = migrateLyricsPrefs(old);
  assert.equal(m.islandSettings.lyrics, false); assert.equal(m.islandSettings.theme, 'forest'); assert.equal(m.islandMute, true); assert.equal(m.lyricsOptInV2, true);
  assert.deepEqual(migrateLyricsPrefs(m), m, 'idempotent');
  const later = { ...m, islandSettings: applyPatch(m.islandSettings, { lyrics: true }) };
  assert.equal(migrateLyricsPrefs(later).islandSettings.lyrics, true, 'a later explicit opt-in is kept');
  assert.equal(migrateLyricsPrefs({ islandSettings: { lyrics: false } }).islandSettings.lyrics, false, 'a stored off stays off');
  assert.equal(migrateLyricsPrefs({}).islandSettings.lyrics, false, 'a fresh install starts with lyrics off');
  assert.equal(normalizeSettings(migrateLyricsPrefs({ islandSettings: 'junk' }).islandSettings).lyrics, false);
});
