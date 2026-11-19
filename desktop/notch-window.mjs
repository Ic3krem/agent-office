// The notch window: which form it is created in, its options, and its rectangle per state. Pure, no Electron.
// 'material' = system blur (Windows 11 22H2+ acrylic, macOS vibrancy) in a non-transparent frameless window;
// 'transparent' = CSS glass or Solid. Transparency is fixed at creation, so changing form means a new window.

export const SIZES = { closed: { w: 180, h: 32 }, line: { w: 400, h: 36 }, game: { w: 360, h: 36 }, open: { w: 1100, h: 370 } };

// Windows build 22621 (11 22H2) is the first with the backdrop API Electron's backgroundMaterial uses.
const winBuild = release => Number(String(release || '').split('.')[2]) || 0;

export function windowForm({ platform, release, look, materialOk } = {}) {
  if (look !== 'glass' || materialOk === false) return 'transparent';
  return platform === 'darwin' || (platform === 'win32' && winBuild(release) >= 22621) ? 'material' : 'transparent';
}

export function windowOptions(form, platform) {
  const o = { frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false };
  if (form !== 'material') return { ...o, transparent: true };
  return platform === 'darwin'
    ? { ...o, transparent: false, vibrancy: 'hud', visualEffectState: 'active' }
    : { ...o, transparent: false, backgroundMaterial: 'acrylic' };
}

// What a view change does to the window now, given the view it is sized for: 'grow' (resize, then tell the page),
// 'later' (tell the page, resize after the delay so it can animate), 'now' (shrink at once), 'none' (already that size).
const area = k => (SIZES[k] || SIZES.closed).w * (SIZES[k] || SIZES.closed).h;
export const resizePlan = (shown, want, delay) => (shown === want ? 'none' : area(want) > area(shown) ? 'grow' : delay > 0 ? 'later' : 'now');

// The material form's overhang (12 px above the display), or 0 when another display sits right above that strip: there it would show and take clicks.
export function topOverhang(d, all, px = 12) {
  return (all || []).some(r => r.x < d.x + d.width && r.x + r.width > d.x && r.y < d.y && r.y + r.height > d.y - px) ? 0 : px;
}

// Centred on the display's top edge. overhang lifts the window above the top so the OS-rounded top corners sit off-screen.
export function rectFor(displayBounds, state, { overhang = 0 } = {}) {
  const s = SIZES[state] || SIZES.closed;
  const width = state === 'open' ? Math.min(s.w, displayBounds.width - 80) : s.w;
  return { x: displayBounds.x + Math.round((displayBounds.width - width) / 2), y: displayBounds.y - overhang, width, height: s.h + overhang };
}
