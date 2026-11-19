// Hover open/close for the notch, decided in the main process from the cursor (pure, no Electron).
// Opens once the cursor has rested in the closed rect for edgeDelay; stays open while it is in the open rect; closes leaveDelay after it leaves.
// Deciding against the rects (not page mouse events) means a resize under a still cursor cannot flicker.
// dismiss (Esc) closes at once; hover is then ignored until the cursor has left the open rect. pinned / forced always open.

export const inRect = (p, r) => !!p && !!r && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
// How long a shrinking notch waits before the window shrinks (the page animates meanwhile): none under reduced motion, Animations off or Power saver.
export const shrinkDelay = ({ animate = true, powerSaver = false, reducedMotion = false } = {}) => (animate && !powerSaver && !reducedMotion ? 220 : 0);
// Smart mode: hidden unless open, peeking, pinned or forced (approval/hire), in game mode, or (no fullscreen app and something to show:
// a line/game view, or the page is busy: a toast, an ask or hire, a working agent, offline). busy never widens the closed notch.
export const smartAway = ({ mode, fs, peek, open, closedKind, busy, pinned, forced }) =>
  mode === 'smart' && !open && !peek && !pinned && !forced && closedKind !== 'game' && (!!fs || (closedKind === 'closed' && !busy));
const CLOSED = { open: false, enterAt: null, leaveAt: null, dismissed: false };

export function hoverStep(state, { now, cursor, closedRect, openRect, edgeDelay = 0, leaveDelay = 0, pinned = false, forced = false, dismiss = false }) {
  const s = { ...CLOSED, ...state };
  if (pinned || forced) return { ...CLOSED, open: true };
  if (dismiss) return { ...CLOSED, dismissed: true };
  if (s.dismissed) { if (inRect(cursor, openRect)) return { ...CLOSED, dismissed: true }; s.open = false; s.enterAt = null; }
  if (!s.open) {
    if (!inRect(cursor, closedRect)) return { ...CLOSED };
    const enterAt = s.enterAt ?? now;
    return now - enterAt >= edgeDelay ? { ...CLOSED, open: true } : { ...CLOSED, enterAt };
  }
  if (inRect(cursor, openRect)) return { ...CLOSED, open: true };
  const leaveAt = s.leaveAt ?? now;
  return now - leaveAt >= leaveDelay ? { ...CLOSED } : { ...CLOSED, open: true, leaveAt };
}
