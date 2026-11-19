// Voice-room relay setting: voice.json in the app's config dir holds an optional TURN server. The password stays in this
// file and is only handed to the app's own page (GET /api/party/voice-config); it is never part of the snapshot or logs.
import fs from 'node:fs';
import path from 'node:path';

const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const URL_RE = /^turns?:[A-Za-z0-9.-]+(:\d{1,5})?(\?transport=(udp|tcp))?$/;
const str = v => typeof v === 'string' && v.length <= 128;
const validTurn = t => !!t && typeof t === 'object' && typeof t.url === 'string' && t.url.length <= 200 && URL_RE.test(t.url) && str(t.user) && str(t.pass);
const file = dir => path.join(dir, 'voice.json');

export function readVoiceConfig(dir) {
  try { const t = JSON.parse(fs.readFileSync(file(dir), 'utf8')).turn; return { turn: validTurn(t) ? { url: t.url, user: t.user, pass: t.pass } : null }; } catch { return { turn: null }; }
}
export function writeVoiceConfig(dir, cfg) {
  const t = cfg && cfg.turn;
  if (t !== null && t !== undefined && !validTurn(t)) throw new Error('TURN needs a turn:/turns: url (host[:port][?transport=udp|tcp]) and a user and password up to 128 characters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify({ turn: t ? { url: t.url, user: t.user, pass: t.pass } : null }), { mode: 0o600 });
}
export const iceServers = cfg => [{ urls: [...STUN] }, ...(validTurn(cfg && cfg.turn) ? [{ urls: cfg.turn.url, username: cfg.turn.user, credential: cfg.turn.pass }] : [])];
