// "Now playing" for the Tiro island: parses the resident SMTC poller (nowplaying.ps1) output. No electron import, so it is testable with node --test.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PowerShell cannot read inside app.asar, so the packaged build unpacks this one script (asarUnpack) and we point at the real file.
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nowplaying.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const STATUSES = ['Playing', 'Paused', 'Stopped', 'Opened', 'Changing', 'Closed'];
const ms = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e13 ? Math.round(v) : null);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

// Friendly app name from an AppUserModelId ("Spotify.exe", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Chrome", "AppleInc.AppleMusicWin_...!App").
export function appName(id) {
  const s = String(id || '').toLowerCase();
  const map = [['spotify', 'Spotify'], ['applemusic', 'Apple Music'], ['itunes', 'Apple Music'], ['msedge', 'Edge'], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['opera', 'Opera'], ['vlc', 'VLC'], ['zunemusic', 'Media Player'], ['mediaplayer', 'Media Player'], ['amazonmusic', 'Amazon Music'], ['tidal', 'TIDAL'], ['deezer', 'Deezer']];
  const hit = map.find(([k]) => s.includes(k)); if (hit) return hit[1];
  const base = String(id || '').split('!')[0].split('_')[0].replace(/\.exe$/i, '').split('.').pop();
  return clip(base, 24) || 'Player';
}

// One poller line -> a clean, length-capped object, or null (no session / garbage / nothing with a title).
export function parseLine(line) {
  let j; try { j = JSON.parse(String(line).trim()); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const status = STATUSES.includes(j.status) ? j.status : 'Closed';
  const title = clip(j.title, 140), artist = clip(j.artist, 100), id = clip(j.id, 200);
  if (!id || status === 'Closed' || status === 'Stopped' || !(title || artist)) return null;
  return { id, app: appName(id), status, playing: status === 'Playing', title, artist, album: clip(j.album, 100), canPlayPause: j.canPlayPause !== false, canNext: !!j.canNext, canPrev: !!j.canPrev,
    // SMTC timeline: pos = playback position (ms) as of wall-clock ts (epoch ms); dur = track length (ms). null when the player gives none.
    pos: ms(j.pos), dur: ms(j.dur) || null, ts: ms(j.ts) };
}

export const sameTrack = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Resident poller + control. onChange(np|null) fires only when something changed. Windows only; elsewhere start() is a no-op.
export function createNowPlaying(onChange, { script = SCRIPT, spawnFn = spawn } = {}) {
  let proc = null, cur = null, retry = 0, timer = null, stopped = true;
  const emit = n => { if (!sameTrack(n, cur)) { cur = n; onChange(cur); } };
  function launch() {
    if (proc || stopped || process.platform !== 'win32') return;
    const p = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    proc = p; let buf = '';
    p.stdout.on('data', d => { retry = 0; buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) if (l.trim()) emit(parseLine(l)); });
    p.stdin.on('error', () => {});
    p.on('error', () => {});
    p.on('exit', () => { if (proc === p) proc = null; emit(null); if (!stopped) { timer = setTimeout(launch, Math.min(60000, 2000 * 2 ** retry++)); timer.unref?.(); } });
  }
  return {
    start() { stopped = false; launch(); },
    stop() { stopped = true; clearTimeout(timer); if (proc) { try { proc.kill(); } catch {} proc = null; } emit(null); },
    // Only acts on the session currently shown, and only for known verbs.
    control(verb) {
      if (!proc || !cur || !['playpause', 'next', 'prev'].includes(verb)) return false;
      try { proc.stdin.write(`${verb} ${cur.id}\n`); return true; } catch { return false; }
    },
    get current() { return cur; },
  };
}
