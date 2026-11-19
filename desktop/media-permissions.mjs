// Deny-by-default permission policy for the desktop app's session. Names verified against electron.d.ts (Electron 43):
// 'media' = camera/mic, 'clipboard-sanitized-write' = navigator.clipboard.writeText, 'mediaKeySystem' = protected (DRM) playback.
const SPOTIFY = 'https://open.spotify.com';
// Check handlers pass 'http://localhost:4790/' (trailing slash), request URLs are full URLs: compare bare origins; unparsable -> ''.
export const originOf = u => { try { const o = new URL(u).origin; return o === 'null' ? '' : o; } catch { return ''; } };
export function decidePermission({ permission, origin, isMainWindow, mediaTypes, appOrigin }) {
  if (!origin || !appOrigin) return false;
  switch (permission) {
    case 'media': return origin === appOrigin && isMainWindow === true && Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === 'audio';
    case 'clipboard-sanitized-write': return origin === appOrigin;
    // stock Electron may ship without Widevine, so this rule may never fire
    case 'mediaKeySystem': return origin === SPOTIFY;
    default: return false;
  }
}
