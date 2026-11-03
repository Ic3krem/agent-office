// Pure helpers for the Tiro island (no electron import, so they can be unit-tested with node --test).
export const ISLE_W = 620, ISLE_H = 470;
export const MODES = ['always', 'smart', 'off'];

// Visibility mode; falls back to the older islandOff flag.
export function resolveMode(prefs = {}) {
  if (MODES.includes(prefs.islandMode)) return prefs.islandMode;
  return prefs.islandOff ? 'off' : 'always';
}

// Which display hosts the island: 'cursor' (default), 'primary', or a saved display id. Unknown ids fall back to primary.
export function pickDisplay(displays, primaryId, cursor, pref) {
  const primary = displays.find(d => d.id === primaryId) || displays[0];
  if (pref === 'primary') return primary;
  if (pref == null || pref === 'cursor') {
    const hit = cursor && displays.find(d => cursor.x >= d.bounds.x && cursor.x < d.bounds.x + d.bounds.width && cursor.y >= d.bounds.y && cursor.y < d.bounds.y + d.bounds.height);
    return hit || primary;
  }
  return displays.find(d => d.id === pref) || primary;
}

export const isleBoundsFor = b => ({ x: Math.round(b.x + (b.width - ISLE_W) / 2), y: b.y, width: ISLE_W, height: ISLE_H });

// Peek: the cursor touching the top edge near the island. Once peeking, a taller zone keeps it open while the mouse travels onto it.
export function inPeekZone(b, p, already = false) {
  if (!p) return false;
  const cx = b.x + b.width / 2, half = already ? 280 : 130, depth = already ? 60 : 3;
  return p.x >= cx - half && p.x <= cx + half && p.y >= b.y && p.y <= b.y + depth;
}

// Windows SHQueryUserNotificationState: 2 busy (fullscreen), 3 D3D fullscreen, 4 presentation mode.
export const isFullscreenState = n => n === 2 || n === 3 || n === 4;

// ---------- island settings (own design; the list of knobs was inspired by Nectar's settings reference, no code reused) ----------
export const THEMES = {
  ember:    { bg: '#0b0807', card: '#17110e', line: '#261d17', ink: '#f0e4d4', dim: '#a8998a', accent: '#ffcf6b', light: false },
  midnight: { bg: '#080b12', card: '#10151f', line: '#1c2433', ink: '#e4ebf7', dim: '#8d9ab0', accent: '#6bb2ff', light: false },
  forest:   { bg: '#08100b', card: '#101a14', line: '#1b2a21', ink: '#e1f0e6', dim: '#8aa394', accent: '#6bdb94', light: false },
  light:    { bg: '#f6f1ea', card: '#ebe3d8', line: '#d9cfc0', ink: '#2a211b', dim: '#6f6256', accent: '#b8620a', light: true },
};
export const THEME_NAMES = [...Object.keys(THEMES), 'custom'];
// Spring presets: k = stiffness, c = damping (c / (2 sqrt k) < 1 means a little overshoot).
export const PHYSICS = { soft: { k: 140, c: 22 }, default: { k: 230, c: 21 }, snappy: { k: 380, c: 34 }, bouncy: { k: 260, c: 13 } };
export const ACTIONS = {
  today:    { icon: '☰', label: 'Today',    kind: 'office' },
  reports:  { icon: '▤', label: 'Reports',  kind: 'office' },
  usage:    { icon: '◔', label: 'Usage',    kind: 'office' },
  office:   { icon: '⌂', label: 'Office',   kind: 'office' },
  chat:     { icon: '✎', label: 'Chat',     kind: 'panel' },
  calendar: { icon: '▦', label: 'Calendar', kind: 'panel' },
  mute:     { icon: '♪', label: 'Chime',    kind: 'toggle' },
  settings: { icon: '⚙', label: 'Settings', kind: 'panel' },
};
export const MAX_PINNED = 8;
export const DEFAULT_SETTINGS = {
  theme: 'ember', accent: '#ffcf6b', physics: 'default',
  pinned: ['today', 'reports', 'usage', 'chat', 'calendar', 'settings'],
  hour12: false, clockInPill: true, zone2: '', zone2Label: '', weekStart: 1,
  edgeDelay: 0, leaveDelay: 900,
  nowPlaying: true, kiroFace: true, animate: true, lyrics: true,
  notchEnabled: true,   // the notch (island overlay) exists; off removes the window and everything that serves it
  notchShortcut: '',    // optional global shortcut that toggles the notch; empty = no shortcut (default)
};

// ---------- notch on/off ----------
// A global shortcut must be 2 or 3 modifiers plus one letter, digit or F-key, and may not take the island's own Ctrl+Alt+K.
const MODS = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super', cmd: 'Super', command: 'Super', meta: 'Super' };
export const RESERVED_SHORTCUTS = ['Ctrl+Alt+K'];
function parseAccelerator(s) {
  if (typeof s !== 'string' || s.length > 40) return null;
  const parts = s.trim().split('+').map(x => x.trim());
  const key = parts.pop();
  if (!key || !/^([A-Z0-9]|F([1-9]|1\d|2[0-4]))$/i.test(key)) return null;
  const mods = [...new Set(parts.map(p => MODS[p.toLowerCase()]))];
  if (mods.length !== parts.length || mods.includes(undefined) || mods.length < 2 || mods.length > 3) return null;
  const order = ['Ctrl', 'Alt', 'Shift', 'Super'];
  return [...mods.sort((a, b) => order.indexOf(a) - order.indexOf(b)), key.length === 1 ? key.toUpperCase() : key.toUpperCase()].join('+');
}
export const canonicalAccelerator = s => parseAccelerator(s) || '';
export const validAccelerator = s => { const c = parseAccelerator(s); return !!c && !RESERVED_SHORTCUTS.includes(c); };

// Whether the notch is on. Before the setting existed, islandMode 'off' (or the older islandOff flag) meant "no island"; an explicit
// islandSettings.notchEnabled always wins.
export function notchEnabledOf(prefs = {}) {
  const raw = prefs.islandSettings;
  if (raw && typeof raw === 'object' && typeof raw.notchEnabled === 'boolean') return raw.notchEnabled;
  return resolveMode(prefs) !== 'off';
}
// Run once at start: make the legacy "off" explicit, so later settings patches (which write every field) cannot turn the notch back on.
export function migrateNotchPrefs(prefs = {}) {
  const raw = prefs.islandSettings && typeof prefs.islandSettings === 'object' ? prefs.islandSettings : {};
  if (typeof raw.notchEnabled === 'boolean') return prefs;
  return { ...prefs, islandSettings: { ...raw, notchEnabled: notchEnabledOf(prefs) } };
}
// The toggle as a pure state machine. state = { enabled, alive } (alive = the island window exists); action = enable | disable | toggle | closed.
// Returns the new state plus the one effect main must perform: 'create', 'destroy' or 'none'.
export function notchStep(state, action) {
  const s = { enabled: !!state?.enabled, alive: !!state?.alive };
  switch (action) {
    case 'enable': return { enabled: true, alive: true, effect: s.alive ? 'none' : 'create' };
    case 'disable': return { enabled: false, alive: false, effect: s.alive ? 'destroy' : 'none' };
    case 'toggle': return notchStep(s, s.enabled ? 'disable' : 'enable');
    case 'closed': return { enabled: s.enabled, alive: false, effect: 'none' }; // the window went away (crash, OS): enabled stays, the next apply re-creates it
    default: return { ...s, effect: 'none' };
  }
}

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const isHex = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
export function validZone(z) {
  if (typeof z !== 'string' || !z || z.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; }
}

// Merge a (possibly hostile or stale) settings object over the defaults; every field is validated, unknown keys dropped.
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_SETTINGS;
  const pinned = Array.isArray(r.pinned) ? [...new Set(r.pinned.filter(k => typeof k === 'string' && ACTIONS[k]))].slice(0, MAX_PINNED) : [...d.pinned];
  const zone2 = validZone(r.zone2) ? r.zone2 : '';
  return {
    theme: THEME_NAMES.includes(r.theme) ? r.theme : d.theme,
    accent: isHex(r.accent) ? r.accent.toLowerCase() : d.accent,
    physics: PHYSICS[r.physics] ? r.physics : d.physics,
    pinned,
    hour12: typeof r.hour12 === 'boolean' ? r.hour12 : d.hour12,
    clockInPill: typeof r.clockInPill === 'boolean' ? r.clockInPill : d.clockInPill,
    zone2, zone2Label: zone2 && typeof r.zone2Label === 'string' ? r.zone2Label.replace(/[^\w .\-]/g, '').slice(0, 12) : '',
    weekStart: r.weekStart === 0 ? 0 : 1,
    edgeDelay: clampInt(r.edgeDelay, 0, 1000, d.edgeDelay),
    leaveDelay: clampInt(r.leaveDelay, 300, 3000, d.leaveDelay),
    nowPlaying: typeof r.nowPlaying === 'boolean' ? r.nowPlaying : d.nowPlaying,
    kiroFace: typeof r.kiroFace === 'boolean' ? r.kiroFace : d.kiroFace,
    animate: typeof r.animate === 'boolean' ? r.animate : d.animate,
    lyrics: typeof r.lyrics === 'boolean' ? r.lyrics : d.lyrics,
    notchEnabled: typeof r.notchEnabled === 'boolean' ? r.notchEnabled : d.notchEnabled,
    notchShortcut: validAccelerator(r.notchShortcut) ? canonicalAccelerator(r.notchShortcut) : d.notchShortcut,
  };
}
// A patch changes only the keys it names (so the page can send one knob at a time).
export const applyPatch = (cur, patch) => normalizeSettings({ ...normalizeSettings(cur), ...(patch && typeof patch === 'object' ? patch : {}) });

// CSS variables for a theme; custom keeps the dark ember surfaces with the user's accent.
export function themeVars(s) {
  const t = s.theme === 'custom' ? { ...THEMES.ember, accent: s.accent } : THEMES[s.theme] || THEMES.ember;
  return { '--bg': t.bg, '--card': t.card, '--line': t.line, '--ink': t.ink, '--dim': t.dim, '--accent': t.accent, '--tile': t.light ? '#e0d6c8' : '#2a211b' };
}

// Pinned buttons in order; a chime toggle reflects mute state.
export const pinnedActions = (s, ctx = {}) => s.pinned.map(id => ({ id, ...ACTIONS[id], label: id === 'mute' && ctx.mute ? 'Muted' : ACTIONS[id].label }));

// Time of day for a given zone ('' = local).
export function formatClock(date, { hour12 = false, zone = '' } = {}) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12, ...(zone ? { timeZone: zone } : {}) }).format(date).replace(/\s?([ap])m$/i, (_m, x) => ' ' + x.toUpperCase() + 'M');
}

// Month grid: weeks of 7 cells (null padding), for the calendar widget. month is 0-11.
export function monthGrid(year, month, weekStart = 1) {
  const first = new Date(Date.UTC(year, month, 1)), days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() - weekStart + 7) % 7, cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
export const weekdayNames = (weekStart = 1) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((_, i, a) => a[(i + weekStart) % 7]);

// Smart/peek: the cursor must rest on the edge this long before the island peeks (0 = immediately).
export const peekReady = (since, now, delay) => since != null && now - since >= delay;
