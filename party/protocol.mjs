// Party wire format (phase 7), shared by the party server and the app. Both sides run every message through these
// cleaners: the app before anything leaves the machine, the server before anything is stored or relayed. Only what is
// listed here can ever cross: office layout, looks, avatar position, presence, and per agent a display name, a role key,
// a state and one generic bubble from a fixed list; also connection setup data (SDP and ICE candidates, which contain IP
// addresses), to the addressed member only, and one reaction from a fixed list. Never task text, prompts, tool input, file paths or reports.
export const BUBBLES = ['Coding…', 'Researching…', 'Running a command', 'Writing a report', 'Reviewing', 'Thinking…', 'Waiting for approval', 'On break', 'Idle'];
export const STATES = ['working', 'idle', 'blocked', 'limited', 'error'];
export const PRESENCE = ['available', 'busy', 'working', 'away'];
export const LIMITS = { name: 20, chat: 200, agents: 16, members: 16, layoutBytes: 300_000, body: 400_000, chatKeep: 50, sdp: 8192, ice: 512, voice: 8 };
export const EMOTES = ['wave', 'clap', 'laugh', 'heart', 'thumbs', 'party'];

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY = /^[a-z][a-z0-9-]{1,15}$/;
// Display names: no control characters or markup, single spaces, at most 20 characters.
export const cleanName = v => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f<>&"`\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name).trim();
export const cleanChat = v => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.chat);
const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;

export function cleanAgent(a) {
  if (!plain(a)) return null;
  const id = typeof a.id === 'string' && /^[a-z0-9]{1,16}$/.test(a.id) ? a.id : null, name = cleanName(a.name);
  if (!id || !name) return null;
  return { id, name, key: typeof a.key === 'string' && KEY.test(a.key) ? a.key : null, state: STATES.includes(a.state) ? a.state : 'idle', bubble: BUBBLES.includes(a.bubble) ? a.bubble : 'Idle' };
}
// Costumes: small preset indices only (the receiving app re-checks them against its own catalog).
export function cleanLooks(o) {
  const out = {};
  if (!plain(o)) return out;
  for (const k of Object.keys(o).slice(0, 32)) {
    if (!KEY.test(k) || !plain(o[k])) continue;
    const c = o[k], v = { hair: int(c.hair, 15), skin: int(c.skin, 15), style: int(c.style, 15), outfit: int(c.outfit, 15), prop: typeof c.prop === 'string' && KEY.test(c.prop) ? c.prop : undefined };
    for (const f of Object.keys(v)) if (v[f] === undefined) delete v[f];
    if (Object.keys(v).length) out[k] = v;
  }
  return out;
}
// Layout: an object under the size cap, re-serialised (no prototypes, no functions). Receivers validate it with
// WorldModel.validate before drawing it.
export function cleanLayout(l) {
  if (!plain(l)) return null;
  let s; try { s = JSON.stringify(l); } catch { return null; }
  return s.length <= LIMITS.layoutBytes ? JSON.parse(s) : null;
}
export function cleanOffice(o) {
  if (!plain(o)) return null;
  const st = plain(o.stats) ? o.stats : {};
  return { stats: { done: int(st.done, 1e6) || 0, reports: int(st.reports, 1e6) || 0 }, layout: cleanLayout(o.layout), looks: cleanLooks(o.looks), manor: cleanManor(o.manor), agents: (Array.isArray(o.agents) ? o.agents : []).slice(0, LIMITS.agents).map(cleanAgent).filter(Boolean) };
}
// Manor theme (beta.6): a preset name and up to four #rrggbb overrides, nothing else (friends' lots and visits draw it).
export const MANOR_THEMES = ['modern', 'country', 'japanese', 'beach', 'cyber', 'cottage'];
const HEX = /^#[0-9a-f]{6}$/i;
export function cleanManor(m) {
  if (!plain(m) || !MANOR_THEMES.includes(m.theme)) return null;
  const colors = {}, c = plain(m.colors) ? m.colors : {};
  for (const k of ['wall', 'floor', 'roof', 'accent']) if (typeof c[k] === 'string' && HEX.test(c[k])) colors[k] = c[k].toLowerCase();
  return { theme: m.theme, colors };
}
// Party music (beta.6): a pasted link -> {src, ref}. YouTube video ids, Spotify track/album/playlist/episode ids, or an
// https audio stream without credentials. Nothing is downloaded or re-streamed; each app plays it from the source.
const YT_ID = /^[\w-]{11}$/, SP_ID = /^[A-Za-z0-9]{22}$/, SP_KINDS = ['track', 'album', 'playlist', 'episode'];
export function parseMusicLink(text) {
  const t = String(text ?? '').trim();
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(t);
  if (uri) return SP_KINDS.includes(uri[1]) && SP_ID.test(uri[2]) ? { src: 'spotify', ref: uri[1] + ':' + uri[2] } : null;
  let u; try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (/^(www\.|m\.|music\.)?youtube\.com$/.test(host)) { const v = u.searchParams.get('v'); return v && YT_ID.test(v) ? { src: 'youtube', ref: v } : null; }
  if (host === 'youtu.be') { const v = u.pathname.slice(1); return YT_ID.test(v) ? { src: 'youtube', ref: v } : null; }
  if (host === 'open.spotify.com') { const p = u.pathname.split('/').filter(x => x && !/^intl-/.test(x)); return p.length === 2 && SP_KINDS.includes(p[0]) && SP_ID.test(p[1]) ? { src: 'spotify', ref: p[0] + ':' + p[1] } : null; }
  return t.length <= 300 ? { src: 'stream', ref: u.href } : null;
}
const refOk = (src, ref) => typeof ref === 'string' && (src === 'youtube' ? YT_ID.test(ref) : src === 'spotify' ? (([k, id]) => SP_KINDS.includes(k) && SP_ID.test(id || ''))(ref.split(':')) : src === 'stream' && (p => !!p && p.src === 'stream' && p.ref === ref)(parseMusicLink(ref)));
const num = (v, max) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
export function cleanMusic(m) {
  if (!plain(m) || !['youtube', 'spotify', 'stream'].includes(m.src) || !refOk(m.src, m.ref)) return null;
  return { src: m.src, ref: m.ref, title: cleanChat(String(m.title ?? '').replace(/<[^>]*>/g, ' ')).slice(0, 80), startedAt: num(m.startedAt, 9e15), paused: m.paused === true, pos: num(m.pos, 1e6) };
}
const coord = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4000, Math.round(v))) : 0;
export function cleanAvatar(a) {
  if (!plain(a)) return null;
  const room = ['lounge', 'town', 'kain', 'games', 'meet'].includes(a.room) || (typeof a.room === 'string' && /^office:[a-z0-9]{1,16}$/.test(a.room)) ? a.room : 'home';
  const out = { x: coord(a.x), y: coord(a.y), room, presence: PRESENCE.includes(a.presence) ? a.presence : 'available' };
  // in the meet room: mic only once joined to voice (absent = still on the card, not in the call); hand only if raised
  if (room === 'meet') { if (['on', 'muted', 'listen'].includes(a.mic)) out.mic = a.mic; if (a.hand === true) out.hand = true; }
  return out;
}
// Meeting-room voice setup (WebRTC): an offer/answer SDP or one ICE candidate for one member, printable ASCII only, capped. Relayed, never stored.
const PRINTABLE = /^[\x20-\x7e\r\n]*$/;
export function cleanRtc(v) {
  if (!plain(v) || typeof v.to !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(v.to) || typeof v.data !== 'string') return null;
  const { kind, data } = v, ice = kind === 'ice';
  if (!ice && kind !== 'offer' && kind !== 'answer') return null;
  if (data.length > (ice ? LIMITS.ice : LIMITS.sdp) || !PRINTABLE.test(data) || (ice ? data !== '' && (!data.startsWith('candidate:') || /[\r\n]/.test(data)) : !data.startsWith('v=0') || data.split(/\r?\n/).some(l => l && !/^[a-z]=/.test(l)))) return null;
  return { to: v.to, kind, data };
}
export const cleanEmote = v => Number.isInteger(v) && v >= 0 && v < EMOTES.length ? v : null;

// What the app shares about its own office, built from its snapshot: the generic bubble comes from the agent's status and
// the kind of its latest activity, never from its text. ids are hashed so session ids never leave the machine.
export function bubbleOf(a) {
  if (a.status === 'blocked') return 'Waiting for approval';
  if (a.status === 'limited') return 'On break';
  if (a.status !== 'working') return 'Idle';
  const last = (a.logs || []).slice(-1)[0] || {}, k = String(last.k || ''), tool = String(last.text || '').split(':')[0];
  if (k === 'tool') {
    if (/^(Bash|PowerShell)$/.test(tool)) return 'Running a command';
    if (/^(WebFetch|WebSearch|Read|Grep|Glob)$/.test(tool)) return 'Researching…';
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'Coding…';
    if (/report/i.test(tool)) return 'Writing a report';
    return 'Coding…';
  }
  return 'Thinking…';
}
export function feedOf(snapshot, layout, looks, hashId) {
  let helper = 0;
  const agents = (snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : []).map(a => ({
    id: hashId(a.id), name: a.isManager || (a.profile && a.profile.key && !a.profile.helper) ? a.name : 'Helper ' + (++helper), key: a.isManager ? 'tiro' : (a.profile && a.profile.key) || null,
    state: STATES.includes(a.status) ? a.status : 'idle', bubble: bubbleOf(a),
  }));
  return cleanOffice({ stats: { done: snapshot && snapshot.tasksDone, reports: snapshot && snapshot.doneReports }, layout, looks, manor: snapshot && snapshot.manor, agents });
}
