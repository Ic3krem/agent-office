// kiro.json is shared by the server and the desktop app. Read it before a write with readForWrite: a missing file is {}; a
// read or parse error is retried once after a short wait (the other process may be mid-write); a file that is still not a
// JSON object is moved aside to <name>.bad-<timestamp> (kept for the user, logged) and the write starts from {}, so one bad
// hand edit never blocks every later save.
import fs from 'node:fs';
import path from 'node:path';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); // sync: the stores and savePrefs are sync
// -> {v} parsed object, {io} read error (not ENOENT), or {} not a JSON object
function parse(file) {
  let s; try { s = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { v: {} } : { io: e }; }
  try { const j = JSON.parse(s); if (j && typeof j === 'object' && !Array.isArray(j)) return { v: j }; } catch {}
  return {};
}

export function readForWrite(file, { log = () => {}, delay = 75, wait = pause, now = Date.now } = {}) {
  let r = parse(file);
  if (r.v) return r.v;
  wait(delay); r = parse(file);
  if (r.v) return r.v;
  if (r.io) throw Object.assign(new Error('Cannot read ' + path.basename(file) + ': ' + r.io.code), { status: 500 });
  const bad = file + '.bad-' + new Date(now()).toISOString().replace(/[:.]/g, '-');
  fs.renameSync(file, bad);
  log(path.basename(file) + ' was not valid JSON; moved it to ' + path.basename(bad) + ' and saved fresh settings');
  return {};
}
// For reads that only display: anything unreadable is {}.
export const readSoft = file => parse(file).v || {};
