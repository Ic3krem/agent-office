// Character sprites for the office world: drawn procedurally on a 16 x 24 pixel grid (1x), cached, and scaled by an
// integer when drawn so they stay crisp. One look per agent: shirt = role colour, accent = lanyard/headgear, hair and
// skin hashed per agent, plus a role prop (headphones, cap, visor, goggles, glasses, scarf, clipboard, pen, tie).
(function (root) {
  'use strict';
  const W = 18, H = 26, OX = 1, OY = 1; // 1 px margin for the outline
  const OUT = '#1b1220';
  const HAIRS = ['#d39a52', '#3b2418', '#1f1a1a', '#141010', '#c9c3b8', '#6b3a1f', '#a8432a', '#2a2a3a'];
  const SKINS = ['#f0c69c', '#c98d62', '#e6b48c', '#8d5a3b', '#f2cfae', '#d9a57a', '#f3d0b0', '#b5774f'];
  const PANTS = ['#3a3550', '#2f3a4f', '#3b3b3b', '#47352f', '#2c4038'];
  const VISITOR = ['#8b8f98', '#a39e94', '#7e8794', '#9a9aa6', '#8f8a82'];
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  function shade(hex, f) { const n = parseInt(hex.slice(1), 16); return 'rgb(' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.min(255, Math.round(v * f))).join(',') + ')'; }

  // Look for an agent: profile gives shirt and accent; everything else comes from the id.
  function lookOf(a) {
    const h = hash(a.id || a.name || 'x');
    const isTiro = !!a.isManager;
    return { key: isTiro ? 'tiro' : (a.key || null), shirt: a.color || VISITOR[h % VISITOR.length], accent: a.accent || '#d8d2c4',
      hair: isTiro ? '#3b2418' : HAIRS[(h >> 3) % 8], skin: isTiro ? '#e6b48c' : SKINS[(h >> 6) % 8], pants: PANTS[(h >> 9) % PANTS.length], style: (h >> 12) % 3, sig: [a.key, a.color, h % 977].join('|') };
  }

  function make() { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; }
  const cache = {};

  // pose: stand | walk | type | sit-idle | hand | sit | think | sit-think | play | sit-play | report | cup | cooler | sit-front | celebrate
  // view: 'f' faces the viewer (toward +x or +y), 'b' faces away. dir: -1 looks left (SW), +1 looks right (SE). frame: 0..2
  function get(look, view, pose, frame, dir) {
    const key = [look.sig, view, pose, frame, dir].join('/');
    if (cache[key]) return cache[key];
    const cv = make(), g = cv.getContext('2d');
    const buf = Array.from({ length: H }, () => new Array(W).fill(null));
    const px = (x, y, c) => { x += OX; y += OY; if (x >= 0 && x < W && y >= 0 && y < H && c) buf[y][x] = c; };
    const rc = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); };
    const L = look, C = L.shirt, c2 = shade(C, .72), A = L.accent, a2 = shade(A, .7), S = L.skin, s2 = shade(S, .85), Hh = L.hair, h2 = shade(Hh, .72), P = L.pants, K = '#2a2733';
    const seated = pose.startsWith('sit') || pose === 'type' || pose === 'hand';
    const front = view === 'f';
    const key2 = L.key;

    // ---- legs ----
    if (!seated) {
      const lift = pose === 'walk' ? (frame === 1 ? 1 : frame === 2 ? 2 : 0) : 0;
      const ll = lift === 1 ? 1 : 0, rl = lift === 2 ? 1 : 0; // the lifted leg is a pixel shorter and the foot swings
      rc(4, 18, 3, 4 - ll, P); rc(9, 18, 3, 4 - rl, P);
      rc(4, 22 - ll, 4, 2, K); rc(8, 22 - rl, 4, 2, K);
      if (lift) { px(7, 18, c2); }
    } else if (!front) { // seated, seen from behind: hips and the back of the thighs so the body reads as sitting, not floating
      rc(4, 18, 8, 2, P); rc(3, 19, 1, 1, shade(P, .7)); rc(12, 19, 1, 1, shade(P, .7)); rc(4, 20, 8, 1, shade(P, .72));
    } else { // seated, seen from the front: thighs forward, shins down
      rc(4, 18, 8, 2, P); rc(4, 20, 3, 2, P); rc(9, 20, 3, 2, P); rc(3, 22, 4, 2, K); rc(9, 22, 4, 2, K);
    }
    // ---- torso ----
    rc(3, 12, 10, 6, C); rc(10, 12, 3, 6, c2); rc(3, 17, 10, 1, c2);
    if (front) { rc(6, 11, 4, 1, S); px(5, 11, C); px(10, 11, C); }
    else { rc(6, 11, 4, 1, s2); }
    // lanyard in the accent colour (and name tag on the front)
    if (front) { px(6, 12, A); px(9, 12, A); px(7, 13, A); px(8, 13, A); px(7, 14, A); px(8, 14, A); rc(6, 15, 4, 2, '#f3ede2'); rc(6, 15, 4, 1, A); }
    else { px(7, 12, a2); px(8, 12, a2); }

    // ---- arms ----
    const sleeve = (x, y, h) => { rc(x, y, 2, h, C); px(x + (x < 8 ? 0 : 1), y + h - 1, c2); };
    const hand = (x, y, w, h) => rc(x, y, w || 2, h || 2, S);
    const swing = pose === 'walk' ? (frame === 1 ? 1 : frame === 2 ? -1 : 0) : 0;
    if (pose === 'type' && !front) { // seen from behind, forearms forward: hands show beside the torso, alternating
      sleeve(1, 12, 4); sleeve(13, 12, 4); hand(2, 15 + (frame ? 1 : 0), 2, 1); hand(12, 15 + (frame ? 0 : 1), 2, 1);
    } else if (pose === 'hand') { // raised hand: waiting for approval
      sleeve(1, 12, 4); hand(1, 16, 2, 1); sleeve(13, 8 - frame, 5); hand(13, 6 - frame, 2, 2);
    } else if (pose === 'sit-idle' && !front) {
      sleeve(1, 12, 4); hand(1, 16, 2, 1);
      if (frame) { sleeve(12, 10, 3); hand(11, 8, 2, 2); rc(10, 6, 3, 3, '#f3ede2'); px(13, 7, '#f3ede2'); } else { sleeve(13, 12, 4); hand(13, 16, 2, 1); }
    } else if (pose === 'think' || pose === 'sit-think') { // hand on chin
      sleeve(1, 12 + swing, 5); hand(1, 17 + swing, 2, 2);
      rc(10, 12, 4, 2, C); sleeve(11, 9, 3); hand(9, 8, 3, 2); // forearm up to the chin
      px(9, 9, S);
    } else if (pose === 'play' || pose === 'sit-play') {
      sleeve(2, 12, 4); sleeve(12, 12, 4); hand(4, 15 + (frame & 1), 2, 2); hand(10, 15 + ((frame + 1) & 1), 2, 2);
      rc(5, 15, 6, 2, '#2b2b36'); px(6, 15, '#ff4d6d'); px(9, 15, '#3dd6ff'); px(10, 16, '#ffd23f');
    } else if (pose === 'report') { // holding a report in the raised right hand
      sleeve(1, 12, 5); hand(1, 17, 2, 2); sleeve(13, 11, 4); hand(13, 10, 2, 2);
      if (front) { rc(11, 3, 5, 7, '#f6f1e3'); rc(12, 4, 3, 1, '#9aa'); rc(12, 6, 3, 1, '#9aa'); rc(12, 8, 2, 1, '#9aa'); px(11, 3, '#ddd'); }
      else { rc(12, 3, 4, 7, '#e9e4d6'); }
    } else if (pose === 'cup' || pose === 'cooler') {
      sleeve(1, 12, 5); hand(1, 17, 2, 2); sleeve(13, 11, 4); hand(12, 10, 2, 2);
      rc(10, 7, 3, 4, '#f3ede2'); rc(10, 8, 3, 1, '#b3261e'); px(13, 8, '#f3ede2');
    } else if (pose === 'celebrate') {
      sleeve(0, 7, 5); hand(0, 5, 2, 2); sleeve(14, 7, 5); hand(14, 5, 2, 2);
    } else { // walk / stand / sit-front / sit
      sleeve(1, 12 - (swing > 0 ? 1 : 0), 5); hand(1, 17 - (swing > 0 ? 1 : 0), 2, 2);
      sleeve(13, 12 - (swing < 0 ? 1 : 0), 5); hand(13, 17 - (swing < 0 ? 1 : 0), 2, 2);
    }

    // ---- head ----
    const ex = dir < 0 ? -1 : dir > 0 ? 1 : 0;
    if (front) {
      rc(4, 3, 8, 8, S); rc(5, 10, 6, 1, S); rc(11, 4, 1, 6, s2);
      // hair: three styles
      rc(5, 0, 6, 1, Hh); rc(4, 1, 8, 1, Hh); rc(3, 2, 10, 2, Hh);
      if (L.style === 0) { px(3, 4, Hh); px(12, 4, Hh); px(4, 4, h2); px(11, 4, h2); }
      else if (L.style === 1) { rc(3, 4, 2, 5, Hh); rc(11, 4, 2, 5, Hh); px(4, 4, Hh); px(5, 4, h2); }
      else { px(4, 0, Hh); px(7, 0, h2); px(10, 0, Hh); px(3, 4, Hh); px(12, 4, Hh); rc(4, 4, 3, 1, h2); }
      // eyes and mouth follow the look direction
      rc(5 + ex, 6, 2, 2, OUT); rc(9 + ex, 6, 2, 2, OUT); px(6 + ex, 6, '#fff'); px(10 + ex, 6, '#fff');
      rc(7 + ex, 9, 2, 1, '#8a3a30');
      px(4, 8, shade('#e0675a', 1)); px(11, 8, '#e0675a'); // blush
    } else {
      rc(3, 0, 10, 10, Hh); rc(5, 0, 6, 1, Hh); rc(3, 7, 10, 3, h2); rc(5, 9, 6, 1, h2);
      px(3, 0, null); px(12, 0, null); rc(3, 3, 2, 1, Hh); rc(11, 3, 2, 1, Hh);
      if (L.style === 2) { px(4, -1 + 1, Hh); px(8, 0, h2); }
      rc(5, 10, 6, 1, s2);
    }

    // ---- role props ----
    const hatBack = () => { rc(3, 0, 10, 4, A); rc(3, 3, 10, 1, a2); rc(4, 0, 8, 1, shade(A, 1.15)); };
    if (key2 === 'pixel') { // headphones
      rc(4, 0, 8, 1, '#2b2b36'); rc(3, 1, 1, 4, '#2b2b36'); rc(12, 1, 1, 4, '#2b2b36'); rc(2, 4, 2, 4, A); rc(12, 4, 2, 4, A); rc(2, 4, 1, 4, a2);
      px(3, 5, '#2b2b36'); px(12, 5, '#2b2b36');
    } else if (key2 === 'forge') { // hard cap
      if (front) { rc(4, 0, 8, 1, shade(A, 1.15)); rc(3, 1, 10, 2, A); rc(2, 3, 12, 1, a2); rc(7, 1, 2, 1, '#fff7c9'); } else hatBack();
    } else if (key2 === 'warden') { // visor and badge
      if (front) { rc(3, 5, 10, 3, '#1d2b4a'); rc(4, 5, 8, 1, '#6fd0ff'); px(5, 6, '#9fe3ff'); rc(3, 4, 10, 1, A); rc(5 + ex, 6, 2, 1, '#9fe3ff'); rc(9 + ex, 6, 2, 1, '#9fe3ff'); }
      else rc(3, 4, 10, 1, A);
      if (front) { rc(10, 13, 3, 3, '#ffd23f'); px(11, 14, '#b8860b'); }
    } else if (key2 === 'probe') { // goggles on the forehead
      rc(3, 3, 10, 1, A); if (front) { rc(4, 2, 3, 2, '#9fe3ff'); rc(9, 2, 3, 2, '#9fe3ff'); px(4, 2, '#fff'); px(9, 2, '#fff'); rc(4, 2, 3, 1, '#2b2b36', 0); }
    } else if (key2 === 'atlas') { // round glasses
      if (front) { for (const x0 of [4, 9]) { rc(x0 + ex, 5, 4, 1, '#2b2b36'); rc(x0 + ex, 8, 4, 1, '#2b2b36'); px(x0 + ex, 6, '#2b2b36'); px(x0 + ex, 7, '#2b2b36'); px(x0 + 3 + ex, 6, '#2b2b36'); px(x0 + 3 + ex, 7, '#2b2b36'); } px(8 + ex, 6, '#2b2b36'); px(7 + ex, 6, '#2b2b36'); }
      else { rc(3, 4, 1, 2, '#2b2b36'); rc(12, 4, 1, 2, '#2b2b36'); }
    } else if (key2 === 'cabalan') { // scarf
      rc(4, 10, 8, 2, A); rc(4, 11, 8, 1, a2); if (front) { rc(5, 12, 2, 5, A); rc(5, 15, 2, 2, a2); } else rc(9, 12, 2, 5, A);
    } else if (key2 === 'tally') { // clipboard
      if (front) { rc(12, 13, 4, 6, '#8a5a2a'); rc(13, 14, 2, 4, '#f3ede2'); rc(13, 12, 2, 1, '#bbb'); px(13, 15, '#3a8a5a'); px(14, 16, '#9aa'); hand(12, 17, 2, 2); }
      else rc(0, 13, 2, 6, '#8a5a2a');
    } else if (key2 === 'scribe') { // pen behind the ear
      rc(12, 3, 1, 5, A); px(12, 8, '#fff'); px(12, 2, a2); px(13, 3, a2);
    } else if (key2 === 'tiro') { // tie and collar
      if (front) { rc(6, 11, 4, 1, '#fff'); px(7, 12, '#b3261e'); px(8, 12, '#b3261e'); rc(7, 13, 2, 4, '#b3261e'); px(7, 16, '#7a1810'); rc(5, 12, 2, 1, '#fff'); rc(9, 12, 2, 1, '#fff'); }
      else rc(5, 11, 6, 1, '#fff');
    }

    // ---- outline pass ----
    const out = Array.from({ length: H }, () => new Array(W).fill(null));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!buf[y][x]) {
      if ((y > 0 && buf[y - 1][x]) || (y < H - 1 && buf[y + 1][x]) || (x > 0 && buf[y][x - 1]) || (x < W - 1 && buf[y][x + 1])) out[y][x] = OUT;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = buf[y][x] || out[y][x]; if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); } }
    return (cache[key] = { cv, w: W, h: H, ox: OX, oy: OY });
  }
  root.OfficeSprites = { get, lookOf, shade, W, H, OX, OY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
