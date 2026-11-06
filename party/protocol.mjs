// Party wire format (phase 7), shared by the party server and the app. Both sides run every message through these
// cleaners: the app before anything leaves the machine, the server before anything is stored or relayed. Only what is
// listed here can ever cross: office layout, looks, avatar position, presence, and per agent a display name, a role key,
// a state and one generic bubble from a fixed list. Never task text, prompts, tool input, file paths or reports.
export const BUBBLES = ['Coding…', 'Researching…', 'Running a command', 'Writing a report', 'Reviewing', 'Thinking…', 'Waiting for approval', 'On break', 'Idle'];
export const STATES = ['working', 'idle', 'blocked', 'limited', 'error'];
export const PRESENCE = ['available', 'busy', 'working', 'away'];
export const LIMITS = { name: 20, chat: 200, agents: 16, members: 16, layoutBytes: 300_000, body: 400_000, chatKeep: 50 };

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
  return { stats: { done: int(st.done, 1e6) || 0, reports: int(st.reports, 1e6) || 0 }, layout: cleanLayout(o.layout), looks: cleanLooks(o.looks), agents: (Array.isArray(o.agents) ? o.agents : []).slice(0, LIMITS.agents).map(cleanAgent).filter(Boolean) };
}
const coord = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4000, Math.round(v))) : 0;
export function cleanAvatar(a) {
  if (!plain(a)) return null;
  const room = a.room === 'lounge' || (typeof a.room === 'string' && /^office:[a-z0-9]{1,16}$/.test(a.room)) ? a.room : 'home';
  return { x: coord(a.x), y: coord(a.y), room, presence: PRESENCE.includes(a.presence) ? a.presence : 'available' };
}

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
  return cleanOffice({ stats: { done: snapshot && snapshot.tasksDone, reports: snapshot && snapshot.doneReports }, layout, looks, agents });
}
