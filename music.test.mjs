import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanMusicPrefs, listAudio, fileAt, parseRange } from './music.mjs';

const tree = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-music-'));
  const w = f => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), 'x'); };
  ['a.mp3', 'b.OGG', 'notes.txt', 'one/c.flac', 'one/two/d.wav', 'one/two/three/too-deep.mp3'].forEach(w);
  return d;
};

test('cleanMusicPrefs: defaults and bounds', () => {
  assert.deepEqual(cleanMusicPrefs(null), { bg: 'builtin', volume: 0.4, folder: '' });
  assert.deepEqual(cleanMusicPrefs({ bg: 'folder', volume: 3, folder: 'rel/path' }), { bg: 'folder', volume: 1, folder: '' }, 'a relative folder is ignored');
  assert.equal(cleanMusicPrefs({ bg: 'loud' }).bg, 'builtin');
  assert.equal(cleanMusicPrefs({ bg: 'off', volume: -1 }).volume, 0);
});

test('listAudio: audio files only, two folder levels below the folder, sorted', () => {
  const d = tree();
  assert.deepEqual(listAudio(d), ['a.mp3', 'b.OGG', 'one/c.flac', 'one/two/d.wav']);
  assert.deepEqual(listAudio(path.join(d, 'missing')), []);
  assert.deepEqual(listAudio(''), []);
});

test('listAudio stops at 2000 files', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-music-many-'));
  for (let i = 0; i < 2010; i++) fs.writeFileSync(path.join(d, 't' + i + '.mp3'), '');
  assert.equal(listAudio(d).length, 2000);
});

test('fileAt: only an index of the list, only inside the folder', () => {
  const d = tree(), list = listAudio(d);
  assert.equal(fileAt(d, list, 2), fs.realpathSync(path.join(d, 'one', 'c.flac')));
  for (const i of [-1, 4, 1.5, NaN, '0']) assert.equal(fileAt(d, list, i), null, String(i));
  assert.equal(fileAt(d, ['../outside.mp3'], 0), null);
  fs.rmSync(path.join(d, 'a.mp3')); assert.equal(fileAt(d, list, 0), null, 'gone since the listing');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-music-out-')); fs.writeFileSync(path.join(out, 'x.mp3'), 'x');
  try { fs.symlinkSync(path.join(out, 'x.mp3'), path.join(d, 'link.mp3')); assert.equal(fileAt(d, ['link.mp3'], 0), null, 'a link out of the folder'); } catch (e) { if (e.code !== 'EPERM') throw e; } // Windows without symlink rights
});

test('parseRange', () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-50', 1000), { start: 950, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'bad');
  assert.equal(parseRange('bytes=5-2', 1000), 'bad');
  assert.equal(parseRange('items=0-1', 1000), 'bad');
});
