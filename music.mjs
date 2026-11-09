// Background music from the user's own folder: kiro.json "music" {bg, volume, folder}. The folder is set only by the
// desktop app's native picker; the page asks for files by index into the listing, so it never names a path.
import fs from 'node:fs';
import path from 'node:path';

const AUDIO = /\.(mp3|ogg|m4a|wav|flac)$/i, MAX = 2000, DEPTH = 2;
export const TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac' };

export function cleanMusicPrefs(o) {
  const m = o && typeof o === 'object' ? o : {};
  return { bg: ['builtin', 'folder', 'off'].includes(m.bg) ? m.bg : 'builtin', volume: Number.isFinite(m.volume) ? Math.max(0, Math.min(1, m.volume)) : 0.4, folder: typeof m.folder === 'string' && path.isAbsolute(m.folder) ? m.folder : '' };
}
// Audio files at most DEPTH folders below `folder`, as forward-slash relative paths, sorted, at most MAX.
export function listAudio(folder) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (out.length >= MAX) return;
      if (e.isFile() && AUDIO.test(e.name)) out.push(rel + e.name);
      else if (e.isDirectory() && depth < DEPTH) walk(path.join(dir, e.name), rel + e.name + '/', depth + 1);
    }
  };
  if (folder) walk(folder, '', 0);
  return out;
}
// The real file behind list[i], or null: a bad index, a file gone, or anything (a link, '..') that leaves the folder.
export function fileAt(folder, list, i) {
  if (!folder || !Number.isInteger(i) || i < 0 || i >= list.length || !AUDIO.test(list[i])) return null;
  try {
    const base = fs.realpathSync(folder), f = fs.realpathSync(path.join(base, list[i]));
    return f.startsWith(base + path.sep) && fs.statSync(f).isFile() ? f : null;
  } catch { return null; }
}
// Range header -> {start, end} (inclusive), null (no header) or 'bad' (answer 416).
export function parseRange(h, size) {
  if (h === undefined || h === null || h === '') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - +m[2]); end = size - 1; }
  else { start = +m[1]; end = m[2] === '' ? size - 1 : Math.min(size - 1, +m[2]); }
  return start >= size || start > end ? 'bad' : { start, end };
}
