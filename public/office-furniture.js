// Office world drawing: isometric helpers, the baked floor and walls, and every piece of furniture, as painters that
// the world loop depth-sorts with the characters. Pure drawing: it reads the live bits (time, desk status, extras) from
// OfficeFurniture.state and the geometry from OfficeMotion.LAYOUT-style exports. No DOM except the offscreen canvas.
(function (root) {
  'use strict';
  const M = root.OfficeMotion;
  const K = 0.70710678, K2 = 0.35355339, OXS = 575, OYS = 175, STW = 1480, STH = 920, WH = 150; // projection, stage size, wall height
  const P = (x, y, z) => [OXS + K * (x - y), OYS + K2 * (x + y) - (z || 0)];

  // ---------- colour helpers ----------
  const parse = c => {
    if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
    const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] == null ? 1 : m[3]];
  };
  const shc = {};
  function sh(c, f) { const k = c + f; if (shc[k]) return shc[k]; const p = parse(c); return (shc[k] = 'rgb(' + p.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v * f)))).join(',') + ')'); }
  function mix(a, b, t) { const p = parse(a), q = parse(b); return 'rgb(' + [0, 1, 2].map(i => Math.round(p[i] + (q[i] - p[i]) * t)).join(',') + ')'; }
  const alpha = (c, a) => { const p = parse(c); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; };
  const rnd = seed => { let s = seed | 0 || 1; return () => ((s = (s * 1664525 + 1013904223) | 0) >>> 8) / 16777216 % 1; };

  // ---------- drawing primitives ----------
  function poly(g, pts, fill, stroke, lw) {
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
  }
  const EDGE = 'rgba(14,8,26,.38)';
  // Box with its three visible faces: top, +y face (front-left, lit) and +x face (front-right, shaded).
  let REC = null; // while measuring: collects ground-level footprints (x0,y0,x1,y1) of what a painter draws
  function box(g, x, y, z, w, d, h, col, o) {
    if (REC && z <= .5 && h > 1) REC.push([Math.min(x, x + w), Math.min(y, y + d), Math.max(x, x + w), Math.max(y, y + d)]);
    o = o || {}; const st = o.st === undefined ? EDGE : o.st;
    if (!o.noL) poly(g, [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)], o.l || sh(col, .9), st, .6);
    if (!o.noR) poly(g, [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)], o.r || sh(col, .68), st, .6);
    if (!o.noT) poly(g, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], o.t || sh(col, 1.14), st, .6);
  }
  function flat(g, x, y, w, d, col, z, stroke) { poly(g, [P(x, y, z || 0), P(x + w, y, z || 0), P(x + w, y + d, z || 0), P(x, y + d, z || 0)], col, stroke, 1); }
  function gell(g, x, y, z, r, col, ry) { const c = P(x, y, z); g.fillStyle = col; g.beginPath(); g.ellipse(c[0], c[1], r, ry == null ? r / 2 : ry, 0, 0, 6.2832); g.fill(); }
  function cyl(g, x, y, z, r, h, col, o) {
    if (REC && z <= .5 && h > 1) REC.push([x - r, y - r, x + r, y + r]);
    o = o || {}; const c = P(x, y, z);
    g.fillStyle = sh(col, .86); g.beginPath(); g.ellipse(c[0], c[1], r, r / 2, 0, 0, 6.2832); g.fill();
    g.fillStyle = sh(col, .96); g.fillRect(c[0] - r, c[1] - h, 2 * r, h);
    g.fillStyle = sh(col, .72); g.fillRect(c[0] + r * .3, c[1] - h, r * .7, h);
    g.fillStyle = sh(col, 1.04); g.fillRect(c[0] - r * .7, c[1] - h, r * .22, h);
    g.fillStyle = o.top || sh(col, 1.16); g.beginPath(); g.ellipse(c[0], c[1] - h, r, r / 2, 0, 0, 6.2832); g.fill();
    if (o.stroke !== false) { g.strokeStyle = EDGE; g.lineWidth = .6; g.beginPath(); g.ellipse(c[0], c[1] - h, r, r / 2, 0, 0, 6.2832); g.stroke(); }
  }
  function ball(g, x, y, z, r, col) {
    const c = P(x, y, z + r), gr = g.createRadialGradient(c[0] - r * .35, c[1] - r * .4, r * .1, c[0], c[1], r);
    gr.addColorStop(0, sh(col, 1.35)); gr.addColorStop(.6, col); gr.addColorStop(1, sh(col, .6));
    g.fillStyle = gr; g.beginPath(); g.arc(c[0], c[1], r, 0, 6.2832); g.fill();
  }
  // Flat-plane transforms: draw ordinary 2D shapes and text onto a wall, a desk front or the floor.
  function Fy(g, y, zt, fn) { g.save(); g.transform(K, K2, 0, 1, OXS - K * y, OYS + K2 * y - zt); fn(); g.restore(); }              // plane y=const: u = x, v down from zt
  function Fx(g, x, yM, zt, fn) { g.save(); g.transform(K, -K2, 0, 1, OXS + K * (x - yM), OYS + K2 * (x + yM) - zt); fn(); g.restore(); } // plane x=const: u = yM - y (reads left to right)
  function Fg(g, z, fn) { g.save(); g.transform(K, K2, -K, K2, OXS, OYS - (z || 0)); fn(); g.restore(); }                             // floor: local (x, y)
  const FONT = "'Pixelify Sans','IBM Plex Mono',monospace";
  const txt = (g, s, x, y, size, col, al) => { g.font = size + 'px ' + FONT; g.fillStyle = col; g.textAlign = al || 'left'; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); };

  // live values the painters read (set by the world loop and by the page)
  const state = { T: 0, night: 0, dim: 0, desk: {}, ex: {}, board: { todo: 0, doing: 0, done: 0, total: 0 }, hover: null, selected: null, reportIcon: false, printer: 0, labels: 1, tiroBusy: false, tiroLook: false };
  const ST = state;
  const objects = []; // interactive things: { key, label, box:[x,y,z,w,d,h] }
  const items = [];   // depth-sorted painters
  const walls = [];   // wall decor painted each frame after the baked background
  // add(d, fn, o): d = fallback depth (x+y); o.fp = explicit footprint [x0,y0,x1,y1]; o.nofp = never use a measured footprint
  // (seated-in pieces whose sitter must stay in front); o.floor = flat floor piece drawn under everyone.
  // While place() builds a piece away from its home, CUR holds the offset: the painter draws through a canvas translate
  // and its depth, footprints and click box shift with it. IT/OB are where add/reg collect (footprints() uses scratch arrays).
  let CUR = null, IT = items, OB = objects, INST = null; // INST: id of the instance being built (click objects carry it)
  const off = (q, dx, dy) => [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy];
  const add = (d, fn, o) => {
    if (CUR && (CUR.dx || CUR.dy)) {
      const { dx, dy } = CUR, f0 = fn, tx = K * (dx - dy), ty = K2 * (dx + dy);
      d += dx + dy; if (o && o.fp) o = Object.assign({}, o, { fp: off(o.fp, dx, dy) });
      fn = g => { const n = REC ? REC.length : 0; g.translate(tx, ty); try { f0(g); } finally { g.translate(-tx, -ty); if (REC) for (let i = n; i < REC.length; i++) REC[i] = off(REC[i], dx, dy); } };
    }
    const it = { d: o && o.floor ? -1e9 : d, fn, o: o || {}, fp: (o && o.fp) || null }; IT.push(it); return it;
  };
  const reg = (key, label, b, src, o) => {
    if (CUR && (CUR.dx || CUR.dy)) b = [b[0] + CUR.dx, b[1] + CUR.dy, ...b.slice(2)];
    const ob = { key, label, box: b, src: src || null, inst: INST }; if (o) Object.assign(ob, o); OB.push(ob); return ob;
  };
  // Furniture catalog: def() declares a type whose build(p, x, y) calls add/reg exactly as the hardcoded scene did, drawing at
  // its home (x, y): the type anchor, or p.home for a second copy of a type, or T.home(p) (desks read M.DESKS). put() lists
  // today's pieces, in today's add() order, as the default instances. Spot dx/dy are relative to the instance's x, y.
  const CATALOG = {}, DEFAULTS = [];
  const def = (type, anchor, build, meta) => (CATALOG[type] = Object.assign({ type, anchor, build }, meta));
  const put = (id, type, x, y, extra) => {
    const T = CATALOG[type], p = Object.assign({ id, type, x, y }, extra);
    if (!T.home && (x !== T.anchor[0] || y !== T.anchor[1])) p.home = [x, y];
    DEFAULTS.push(p);
  };
  const homeOf = (T, p) => T.home ? T.home(p) : p.home || T.anchor;
  // Sprite painters. useAtlas({image, frames: {name: {x, y, w, h, ax, ay}}, glow?}) registers the office atlas once its image
  // has loaded. Frame names: '<type>' for a type whose build calls add() once, '<type>.<part>' otherwise, where part is the
  // 0-based add() index within the build (dept-desk.0 the desk, dept-desk.1 the chair). sprite() puts the frame's (ax, ay)
  // on P(x, y, 0). spriteOr(name, fn), called inside a build, returns a painter that draws the frame at the build's home
  // (a moved copy shifts through add()'s CUR translate) when the atlas has it, else the procedural fn exactly as before.
  // Footprints never come from the art: while measure()/footprints() record (REC), the sprite painter also runs fn on the
  // no-op context, so a piece blocks, sorts and nofp/floor/gaps exactly as fixtures/office-footprints.json froze it.
  let ATLAS = null, HOME = null; // HOME: [x, y] of the piece being built
  function useAtlas(a) { ATLAS = a; measured = false; } // re-measure: click silhouettes follow the sprites
  function sprite(g, name, x, y, a) {
    const f = ATLAS && ATLAS.frames[name]; if (!f) return false;
    const p = P(x, y, 0);
    if (a != null) { g.save(); g.globalAlpha *= a; }
    g.drawImage(ATLAS.image, f.x, f.y, f.w, f.h, Math.round(p[0] - f.ax), Math.round(p[1] - f.ay), f.w, f.h);
    if (a != null) g.restore();
    return true;
  }
  const spriteOr = (name, fn) => { const [x, y] = HOME; return g => { if (!(ATLAS && ATLAS.frames[name])) return fn(g); if (REC) fn(NUL); sprite(g, name, x, y); }; };
  const fixture = (name, build) => { def('fixture-' + name, [0, 0], build); put(name, 'fixture-' + name, 0, 0); };

  const COL = { wood: '#b98a57', dwood: '#7a5230', ink: '#1b1220', metal: '#8a909c', dmetal: '#4a4f5c', paper: '#f3ede2', glass: 'rgba(170,215,240,.22)', wallL: '#2e3058', wallR: '#25274a' };
  // A desk's role card: the live team's entry, else the catalog's (a layout being checked before it is applied).
  const teamOf = key => M.TEAM.find(t => t.key === key) || (root.RoleCatalog && root.RoleCatalog.get(key));
  const dstate = id => ST.desk[id] || { present: false, working: false, led: '#666' };

  // ---------- baked background: floors, walls, slab ----------
  // The hand-painted 1.2.9 floor (the default layout's zones).
  function bakeDefaultFloor(g) {
    const zone = (x0, y0, x1, y1, c) => flat(g, x0, y0, x1 - x0, y1 - y0, c);
    zone(0, 0, 470, 230, '#7a5236');                    // manager's office: dark wood
    zone(470, 0, 1240, 230, '#4f8a47');                  // garden, running on into the east park
    zone(1000, 230, 1240, 550, '#4f8a47');               // east park
    zone(1000, 550, 1240, 780, '#8e949e');               // garage forecourt
    zone(0, 230, 1000, 550, '#59607a');                  // focus carpet
    zone(0, 550, 470, 780, '#d9d2c3');                   // utility vinyl
    zone(470, 550, 1000, 780, '#5b3f7a');                // playroom carpet
    Fg(g, 0, () => {
      // office planks
      g.strokeStyle = 'rgba(30,14,4,.22)'; g.lineWidth = 1; g.beginPath();
      for (let y = 10; y < 230; y += 14) { g.moveTo(0, y); g.lineTo(470, y); }
      const r = rnd(7); for (let y = 0; y < 230; y += 14) for (let x = (y / 14 % 2) * 40; x < 470; x += 80) { g.moveTo(x + r() * 20, y); g.lineTo(x + r() * 20, y + 14); }
      g.stroke();
      // garden: mowing stripes and a gravel strip
      for (let i = 0; i < 11; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,30,0,.06)'; g.fillRect(470 + i * 48, 0, 48, 230); }
      const q = rnd(3); for (let i = 0; i < 170; i++) { g.fillStyle = q() > .5 ? 'rgba(20,70,20,.45)' : 'rgba(150,200,110,.35)'; g.fillRect(470 + q() * 530, q() * 225, 1.6, 3); }
      // focus: carpet tiles
      for (let y = 230; y < 550; y += 40) for (let x = 0; x < 1000; x += 40) { g.fillStyle = ((x + y) / 40) % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,20,.05)'; g.fillRect(x, y, 40, 40); }
      // north corridor walkway
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 238, 1000, 26); g.strokeStyle = 'rgba(255,255,255,.12)'; g.strokeRect(0, 238, 1000, 26);
      // aisle runner rug (room for eight accent pairs)
      g.fillStyle = '#34406a'; g.fillRect(36, 366, 928, 60); g.strokeStyle = '#c9a24a'; g.lineWidth = 3; g.strokeRect(40, 370, 920, 52);
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.22)'; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(52, 396); g.lineTo(948, 396); g.stroke(); g.setLineDash([]);
      M.TEAM.slice(0, 8).forEach((t, i) => { g.fillStyle = t.accent; g.fillRect(70 + i * 112, 374, 30, 3); g.fillRect(70 + i * 112, 415, 30, 3); });
      // utility checker
      for (let y = 550; y < 780; y += 38) for (let x = 0; x < 470; x += 38) { g.fillStyle = ((x + y) / 38) % 2 ? 'rgba(80,60,30,.1)' : 'rgba(255,255,255,.18)'; g.fillRect(x, y, 38, 38); }
      // playroom: confetti and a big rug
      const c = rnd(11); const cols = ['#ff6b8a', '#ffd23f', '#3dd6ff', '#7cf29a', '#c9b0f0'];
      for (let i = 0; i < 120; i++) { g.fillStyle = cols[i % 5]; g.globalAlpha = .55; g.fillRect(480 + c() * 515, 556 + c() * 220, 3, 2); } g.globalAlpha = 1;
      g.fillStyle = '#3d2a5c'; g.fillRect(556, 636, 350, 132); g.fillStyle = '#e0679a'; g.fillRect(564, 644, 334, 116); g.fillStyle = '#3d2a5c'; g.fillRect(572, 652, 318, 100);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.strokeRect(580, 660, 302, 84);
      g.fillStyle = '#5ac8e8'; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(600 + i * 32, 702); g.lineTo(616 + i * 32, 678); g.lineTo(632 + i * 32, 702); g.lineTo(616 + i * 32, 726); g.fill(); }
      // office rug
      g.fillStyle = '#5a2f3a'; g.fillRect(116, 98, 220, 120); g.strokeStyle = '#d6b13a'; g.lineWidth = 2; g.strokeRect(122, 104, 208, 108); g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(130, 112, 192, 92);
      // zone trims
      g.fillStyle = '#2a2030'; g.fillRect(0, 228, 470, 3); g.fillStyle = '#c9a24a'; g.fillRect(0, 548, 1000, 2); g.fillStyle = '#2a2030'; g.fillRect(0, 550, 1000, 3);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(468, 0, 5, 230);
      // threshold strips: playroom/utility
      g.fillStyle = '#c9a24a'; g.fillRect(467, 556, 6, 224); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(472, 556, 3, 224);
      // garden: stepping stones round the pond and to the gate
      const st = rnd(5);
      for (let i = 0; i < 24; i++) { const t = i / 24 * 6.2832; g.fillStyle = i % 2 ? '#b9b2a6' : '#a7a094'; g.beginPath(); g.ellipse(790 + 80 * Math.cos(t), 105 + 80 * Math.sin(t), 9, 6.5, t, 0, 6.2832); g.fill(); }
      for (let i = 0; i < 9; i++) { g.fillStyle = '#b4ad9f'; g.beginPath(); g.ellipse(500 + i * 9, 214 - (i < 4 ? 0 : 0) + (i > 4 ? -(i - 4) * 2 : 0), 8, 6, st(), 0, 6.2832); g.fill(); }
      // flower beds
      const bed = (x, y, w, d, seed) => { g.fillStyle = '#3d2a1a'; g.fillRect(x, y, w, d); const f = rnd(seed); for (let i = 0; i < 26; i++) { g.fillStyle = ['#ff7aa8', '#ffd23f', '#fff', '#c9b0f0', '#ff9a4a'][i % 5]; g.beginPath(); g.arc(x + 4 + f() * (w - 8), y + 4 + f() * (d - 8), 2.4, 0, 6.2832); g.fill(); } g.strokeStyle = '#7a5230'; g.lineWidth = 2; g.strokeRect(x, y, w, d); };
      bed(530, 120, 46, 70, 21); bed(940, 70, 40, 60, 22); bed(600, 12, 50, 34, 23);
      // ---- east wing: park lawn, path to the fence gate, flower beds; garage forecourt with bay markings ----
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,30,0,.06)'; g.fillRect(1000 + i * 48, 0, 48, 550); }
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,30,0,.06)'; g.fillRect(998 + i * 48, 0, 48, 230); }
      const pq = rnd(31); for (let i = 0; i < 230; i++) { g.fillStyle = pq() > .5 ? 'rgba(20,70,20,.45)' : 'rgba(150,200,110,.35)'; g.fillRect(1000 + pq() * 238, pq() * 548, 1.6, 3); }
      const sp = (x, y, r) => { g.fillStyle = r % 2 ? '#b9b2a6' : '#a7a094'; g.beginPath(); g.ellipse(x, y, 9, 6.5, r * .4, 0, 6.2832); g.fill(); };
      for (let i = 0; i < 11; i++) sp(1004 + i * 10, 396, i);
      for (let i = 0; i < 18; i++) { const t = i / 18 * 6.2832; sp(1120 + 78 * Math.cos(t), 290 + 78 * Math.sin(t) * .92, i); }
      for (let i = 0; i < 6; i++) sp(1100, 380 + i * 11, i);
      bed(1010, 60, 50, 60, 41); bed(1180, 360, 44, 70, 42); bed(1020, 500, 60, 36, 43);
      // forecourt: asphalt apron in front of the bay, parking lines
      g.fillStyle = '#5c616d'; g.fillRect(1006, 700, 228, 76); g.strokeStyle = '#e8d36a'; g.lineWidth = 2; g.setLineDash([12, 9]); g.beginPath(); g.moveTo(1010, 700); g.lineTo(1232, 700); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(1030 + i * 62, 706); g.lineTo(1030 + i * 62, 770); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 40; i++) g.fillRect(1010 + (i * 53 % 220), 556 + (i * 37 % 140), 3, 2);
      g.fillStyle = '#c9a24a'; g.fillRect(996, 556, 5, 224);
    });

  }

  // Floor painted from layout zones (custom layouts): base fill, a texture for the type clipped to the rect, a 2-unit trim.
  // ponytail: rugs, beds and stepping stones of the 1.2.9 floor are not drawn here; they return as pieces in a later phase.
  const ZONE_TEX = {
    office: { c: '#7a5236', t(g, x0, y0, x1, y1) { g.strokeStyle = 'rgba(30,14,4,.22)'; g.lineWidth = 1; g.beginPath(); for (let y = y0 + 10; y < y1; y += 14) { g.moveTo(x0, y); g.lineTo(x1, y); } const r = rnd(7); for (let y = y0; y < y1; y += 14) for (let x = x0 + ((y - y0) / 14 % 2) * 40; x < x1; x += 80) { g.moveTo(x + r() * 20, y); g.lineTo(x + r() * 20, y + 14); } g.stroke(); } },
    garden: { c: '#4f8a47', t(g, x0, y0, x1, y1) { for (let i = 0, x = x0; x < x1; i++, x += 48) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,30,0,.06)'; g.fillRect(x, y0, 48, y1 - y0); } const q = rnd(3), n = Math.round((x1 - x0) * (y1 - y0) / 700); for (let i = 0; i < n; i++) { g.fillStyle = q() > .5 ? 'rgba(20,70,20,.45)' : 'rgba(150,200,110,.35)'; g.fillRect(x0 + q() * (x1 - x0), y0 + q() * (y1 - y0), 1.6, 3); } } },
    focus: { c: '#59607a', t(g, x0, y0, x1, y1) { for (let y = y0; y < y1; y += 40) for (let x = x0; x < x1; x += 40) { g.fillStyle = ((x - x0 + y - y0) / 40) % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,20,.05)'; g.fillRect(x, y, 40, 40); } } },
    utility: { c: '#d9d2c3', t(g, x0, y0, x1, y1) { for (let y = y0; y < y1; y += 38) for (let x = x0; x < x1; x += 38) { g.fillStyle = ((x - x0 + y - y0) / 38) % 2 ? 'rgba(80,60,30,.1)' : 'rgba(255,255,255,.18)'; g.fillRect(x, y, 38, 38); } } },
    play: { c: '#5b3f7a', t(g, x0, y0, x1, y1) { const c = rnd(11), cols = ['#ff6b8a', '#ffd23f', '#3dd6ff', '#7cf29a', '#c9b0f0'], n = Math.round((x1 - x0) * (y1 - y0) / 950); g.globalAlpha = .55; for (let i = 0; i < n; i++) { g.fillStyle = cols[i % 5]; g.fillRect(x0 + c() * (x1 - x0), y0 + c() * (y1 - y0), 3, 2); } g.globalAlpha = 1; } },
    garage: { c: '#8e949e', t() { } },
    path: { c: '#6c7390', t(g, x0, y0, x1, y1) { g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); } },
    lounge: { c: '#a8805a', t(g, x0, y0, x1, y1) { for (let y = y0; y < y1; y += 30) for (let x = x0; x < x1; x += 30) { g.fillStyle = ((x - x0 + y - y0) / 30) % 2 ? 'rgba(255,235,200,.1)' : 'rgba(60,30,10,.08)'; g.fillRect(x, y, 30, 30); } } },
  };
  function bakeZoneFloor(g, zones) {
    flat(g, 0, 0, WXm(), WYm(), '#4a4a55'); // neutral base: a removed or shrunk zone leaves plain floor, not a hole
    for (const q of zones) {
      const T = ZONE_TEX[q.type]; if (!T) continue; // water: the pond pieces draw it
      const [x0, y0, x1, y1] = q.rect;
      flat(g, x0, y0, x1 - x0, y1 - y0, T.c);
      Fg(g, 0, () => {
        g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); T.t(g, x0, y0, x1, y1); g.restore();
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x0, y0, x1 - x0, 2); g.fillRect(x0, y1 - 2, x1 - x0, 2); g.fillRect(x0, y0, 2, y1 - y0); g.fillRect(x1 - 2, y0, 2, y1 - y0);
      });
    }
  }
  const zoneColor = type => (ZONE_TEX[type] || { c: '#3d8fd6' }).c; // water has no floor texture: pond blue
  let ZONES = null;
  function setZones(zones) { ZONES = zones || null; }

  function bake(g) {
    const nt = ST.night, SK0 = mix('#5d9be0', '#0b1230', nt), SK1 = mix('#cfe6ff', '#233466', nt), CLOUD = 'rgba(255,255,255,' + (.7 - .55 * nt) + ')';
    const stars = (w, h) => { if (nt < .35) return; const q = rnd(5); g.fillStyle = 'rgba(255,255,255,' + Math.min(1, nt) + ')'; for (let i = 0; i < 14; i++) g.fillRect(q() * w, q() * h * .6, 1.4, 1.4); };
    // floor slab (front edges)
    poly(g, [P(0, WYm(), 0), P(WXm(), WYm(), 0), P(WXm(), WYm(), -16), P(0, WYm(), -16)], '#4a3020', null);
    poly(g, [P(WXm(), 0, 0), P(WXm(), WYm(), 0), P(WXm(), WYm(), -16), P(WXm(), 0, -16)], '#33200f', null);
    if (!ZONES || !root.WorldModel || root.WorldModel.isDefaultZones(ZONES)) bakeDefaultFloor(g); else bakeZoneFloor(g, ZONES);

    // ---- left wall (plane x=0) and right wall (plane y=0) ----
    const WYv = WYm(), WXv = WXm();
    const gl = g.createLinearGradient(P(0, 0, 0)[0], 0, P(0, WYv, 0)[0], 0); gl.addColorStop(0, '#34376a'); gl.addColorStop(1, '#262850');
    poly(g, [P(0, 0, 0), P(0, WYv, 0), P(0, WYv, WH), P(0, 0, WH)], gl, null);
    const gr = g.createLinearGradient(P(0, 0, 0)[0], 0, P(WXv, 0, 0)[0], 0); gr.addColorStop(0, '#2a2c58'); gr.addColorStop(1, '#202244');
    poly(g, [P(0, 0, 0), P(WXv, 0, 0), P(WXv, 0, WH), P(0, 0, WH)], gr, null);
    // wall panel lines and rails
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; g.beginPath();
    for (let y = 0; y <= WYv; y += 60) { const a = P(0, y, 0), b = P(0, y, WH); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    for (let x = 0; x <= WXv; x += 60) { const a = P(x, 0, 0), b = P(x, 0, WH); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
    poly(g, [P(0, 0, WH), P(0, WYv, WH), P(0, WYv, WH + 7), P(0, 0, WH + 7)], '#4a4d86', null);
    poly(g, [P(0, 0, WH), P(WXv, 0, WH), P(WXv, 0, WH + 7), P(0, 0, WH + 7)], '#3f4276', null);
    poly(g, [P(0, 0, WH + 7), P(WXv, 0, WH + 7), P(WXv, -6, WH + 7), P(0, -6, WH + 7)], '#5a5e9a', null);
    poly(g, [P(0, 0, WH + 7), P(0, WYv, WH + 7), P(-6, WYv, WH + 7), P(-6, 0, WH + 7)], '#5a5e9a', null);
    // baseboards and a wainscot band
    poly(g, [P(0, 0, 0), P(0, WYv, 0), P(0, WYv, 10), P(0, 0, 10)], '#6b4a2e', null);
    poly(g, [P(0, 0, 0), P(WXv, 0, 0), P(WXv, 0, 10), P(0, 0, 10)], '#5a3d25', null);
    poly(g, [P(0, 0, 34), P(0, WYv, 34), P(0, WYv, 37), P(0, 0, 37)], 'rgba(255,255,255,.07)', null);
    poly(g, [P(0, 0, 34), P(WXv, 0, 34), P(WXv, 0, 37), P(0, 0, 37)], 'rgba(255,255,255,.06)', null);

    // windows: left wall (office + two in the focus band), right wall (garden panorama)
    const winL = (y0, y1) => { Fx(g, 0, y1, 128, () => { const w = y1 - y0, h = 78; g.fillStyle = '#16183a'; g.fillRect(-4, -4, w + 8, h + 8); g.fillStyle = '#7a4a22'; g.fillRect(-2, -2, w + 4, h + 4); const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, SK0); sg.addColorStop(1, SK1); g.fillStyle = sg; g.fillRect(0, 0, w, h); stars(w, h); g.fillStyle = CLOUD; g.beginPath(); g.ellipse(w * .3, h * .35, 20, 7, 0, 0, 6.2832); g.ellipse(w * .5, h * .4, 16, 6, 0, 0, 6.2832); g.fill(); g.fillStyle = '#4a8a4a'; g.fillRect(0, h * .78, w, h * .22); g.fillStyle = '#7a4a22'; g.fillRect(w / 2 - 1.5, 0, 3, h); g.fillRect(0, h / 2 - 1.5, w, 3); g.fillStyle = '#9a6a3a'; g.fillRect(-4, h + 2, w + 8, 4); }); };
    winL(60, 125); winL(135, 200); winL(280, 360); winL(400, 480);
    const winR = (x0, x1) => { Fy(g, 0, 128, () => { g.translate(x0, 0); const w = x1 - x0, h = 80; g.fillStyle = '#16183a'; g.fillRect(-4, -4, w + 8, h + 8); const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, SK0); sg.addColorStop(1, SK1); g.fillStyle = sg; g.fillRect(0, 0, w, h); stars(w, h); g.fillStyle = CLOUD; g.beginPath(); g.ellipse(w * .25, h * .3, 24, 8, 0, 0, 6.2832); g.ellipse(w * .62, h * .45, 18, 6, 0, 0, 6.2832); g.fill(); g.fillStyle = '#54925a'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * .72); g.quadraticCurveTo(w * .3, h * .55, w * .5, h * .72); g.quadraticCurveTo(w * .8, h * .6, w, h * .74); g.lineTo(w, h); g.fill(); g.fillStyle = '#7a4a22'; for (let i = 0; i <= 3; i++) g.fillRect(i * w / 3 - 1.5, 0, 3, h); g.fillRect(0, h / 2 - 1.5, w, 3); g.fillRect(-4, h + 2, w + 8, 4); }); };
    winR(500, 640); winR(660, 800); winR(820, 960); winR(40, 120); winR(980, 1100); winR(1120, 1220);
    // left wall: ivy trellis and framed prints in the utility strip
    Fx(g, 0, 780, 130, () => { for (const [y0, w, c] of [[8, 50, '#c95a3a'], [66, 38, '#3d8aa8']]) { g.fillStyle = '#3a2a18'; g.fillRect(y0, 0, w, 40); g.fillStyle = c; g.fillRect(y0 + 3, 3, w - 6, 34); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(y0 + 8, 12, w - 16, 3); g.fillRect(y0 + 8, 20, (w - 16) * .6, 3); } });
  }
  const WXm = () => M.WX, WYm = () => M.WY;

  // ---------- dynamic wall pieces (drawn every frame, after the background, before the sorted items) ----------
  function todayBoard(g) {
    const b = ST.board, tot = Math.max(1, b.total);
    Fy(g, 0, 128, () => {
      g.translate(132, 0);
      g.fillStyle = '#d9d2c3'; g.fillRect(-3, -3, 186, 78); g.fillStyle = '#7a5230'; g.fillRect(-3, -3, 186, 3); g.fillStyle = '#26402f'; g.fillRect(0, 0, 180, 72);
      txt(g, 'TODAY  ' + b.done + '/' + b.total + ' done', 8, 14, 11, '#ffdca0');
      const cols = [['TO DO', b.todo, '#f0e4d4'], ['DOING', b.doing, '#5ef0a0'], ['DONE', b.done, '#7fd49b']];
      cols.forEach(([n, v, c], i) => {
        const x = 8 + i * 56; txt(g, n, x, 27, 8, '#cfe0d0');
        for (let k = 0; k < Math.min(4, v); k++) { g.fillStyle = ['#fff7a8', '#a8f0c8', '#ffd0e0', '#c9e4ff'][(k + i) % 4]; g.fillRect(x + (k % 2) * 22, 31 + Math.floor(k / 2) * 17, 18, 14); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + (k % 2) * 22 + 3, 35 + Math.floor(k / 2) * 17, 11, 1.4); }
        if (v > 4) txt(g, '+' + (v - 4), x + 36, 66, 9, c);
        if (!v) txt(g, '–', x + 8, 46, 12, '#6b8a74');
      });
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 68, 180, 4); g.fillStyle = '#5ef0a0'; g.fillRect(0, 68, 180 * b.done / tot, 4);
    });
  }
  function usageBoard(g) {
    const u = ST.ex.usage || {};
    Fy(g, 0, 120, () => {
      g.translate(355, 0);
      g.fillStyle = '#9a9fa8'; g.fillRect(-3, -3, 106, 66); g.fillStyle = '#f3eee2'; g.fillRect(0, 0, 100, 60);
      txt(g, 'USAGE · TODAY', 6, 11, 8, '#a2463a');
      txt(g, 'Credits ' + (u.credits || '$0.00'), 6, 24, 8.5, '#2b2b36'); txt(g, 'Week ' + (u.week || '–'), 58, 24, 8.5, u.weekColor || '#2b2b36');
      txt(g, (u.tok || '0') + ' tok', 6, 35, 8.5, '#2b2b36'); txt(g, '5h ' + (u.sess || '–'), 58, 35, 8.5, u.sessColor || '#2b2b36');
      const bars = u.bars || []; bars.forEach((b, i) => { const bw = 100 / Math.max(7, bars.length) - 2; g.fillStyle = b.c; const hh = 16 * b.h / 100; g.fillRect(6 + i * (bw + 2), 56 - hh, bw, hh); });
      g.fillStyle = '#b9b3a6'; g.fillRect(4, 56, 92, 1);
    });
  }
  function clockAndBoard(g) {
    // wall clock (left wall) driven by the real time
    const d = new Date(), hh = d.getHours() % 12 + d.getMinutes() / 60, mm = d.getMinutes();
    Fx(g, 0, 560, 140, () => {
      g.translate(0, 0); const cx = 560 - 520 + 0; void cx;
      g.save(); g.translate(40, 20); g.fillStyle = '#3b2a1a'; g.beginPath(); g.arc(0, 0, 20, 0, 6.2832); g.fill(); g.fillStyle = '#f3eee2'; g.beginPath(); g.arc(0, 0, 17, 0, 6.2832); g.fill();
      g.strokeStyle = '#2b2b36'; g.lineWidth = 1; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.sin(a) * 14, -Math.cos(a) * 14); g.lineTo(Math.sin(a) * 16, -Math.cos(a) * 16); g.stroke(); }
      g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(hh * Math.PI / 6) * 9, -Math.cos(hh * Math.PI / 6) * 9); g.stroke();
      g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(mm * Math.PI / 30) * 13, -Math.cos(mm * Math.PI / 30) * 13); g.stroke(); g.restore();
    });
    // whiteboard with the date (left wall, focus band)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    Fx(g, 0, 470, 126, () => {
      g.fillStyle = '#c9ccd4'; g.fillRect(-3, -3, 126, 62); g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, 120, 56);
      txt(g, days[d.getDay()].toUpperCase(), 8, 14, 9, '#3a6ac0'); txt(g, d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), 8, 30, 14, '#1f2a44');
      g.strokeStyle = '#d35a4a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(8, 36); g.lineTo(60, 36); g.stroke(); txt(g, 'Focus first.', 8, 50, 8.5, '#4a5a7a');
    });
  }
  walls.push(todayBoard, usageBoard, clockAndBoard);

  // ---------- helper furniture ----------
  function plant(g, x, y, s, lv) {
    s = s || 1; cyl(g, x, y, 0, 9 * s, 13 * s, '#a65f2c');
    const c = P(x, y, 13 * s);
    [['#2f5e2c', -9, -14, 11], ['#3d6b34', 8, -16, 12], ['#4c7f3e', 0, -26, 12], ['#5a8f47', -3, -36, 9]].forEach(([col, dx, dy, r]) => { g.fillStyle = col; g.beginPath(); g.arc(c[0] + dx * s, c[1] + dy * s, r * s, 0, 6.2832); g.fill(); });
  }
  function tree(g, x, y, s) {
    s = s || 1; gell(g, x, y, 0, 26 * s, 'rgba(10,30,10,.35)'); cyl(g, x, y, 0, 6 * s, 50 * s, '#6b4220');
    const c = P(x, y, 50 * s);
    [['#2f5e2c', -22, -2, 22], ['#2f5e2c', 24, 0, 20], ['#3d6b34', 0, -14, 28], ['#4c7f3e', -12, -34, 20], ['#5a8f47', 14, -32, 17], ['#6aa456', 0, -52, 14]].forEach(([col, dx, dy, r]) => { g.fillStyle = col; g.beginPath(); g.arc(c[0] + dx * s, c[1] + dy * s, r * s, 0, 6.2832); g.fill(); });
  }
  function bench(g, x, y, w, face) { // face 's': seat toward +y
    box(g, x - w / 2, y - 7, 0, 5, 14, 12, COL.dwood); box(g, x + w / 2 - 5, y - 7, 0, 5, 14, 12, COL.dwood);
    box(g, x - w / 2, y - 8, 12, w, 16, 3, '#b98a57'); box(g, x - w / 2, y - 9, 15, w, 3, 16, '#a5764a');
  }
  function chair(g, x, y, col, o) { // office chair seen from the front, backrest low so the sitter stays visible
    o = o || {}; gell(g, x, y, 0, 15, 'rgba(10,5,20,.25)');
    cyl(g, x, y, 0, 2.2, 10, '#2b2b36'); for (let k = 0; k < 5; k++) { const a = k * 1.2566 + .3, c = P(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 1.5); g.fillStyle = '#1f1f27'; g.beginPath(); g.arc(c[0], c[1], 1.6, 0, 6.2832); g.fill(); }
    cyl(g, x, y, 10, 14, 5, col || '#3d4560');
    if (!o.noBack) box(g, x - 12, y + 12, 15, 24, 3, o.h || 22, sh(col || '#3d4560', .85));
  }
  function mug(g, x, y, z, col, steam) { cyl(g, x, y, z, 3.2, 5, col || '#f3ede2'); const c = P(x + 3.2, y, z + 3); g.strokeStyle = col || '#f3ede2'; g.lineWidth = 1.2; g.beginPath(); g.arc(c[0] + 1, c[1], 2, -1.4, 1.4); g.stroke(); if (steam) { const t = ST.T, c2 = P(x, y, z + 6); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(c2[0], c2[1]); g.quadraticCurveTo(c2[0] + 2 * Math.sin(t * 2), c2[1] - 4, c2[0], c2[1] - 8 - (t * 6 % 3)); g.stroke(); } }
  function lamp(g, x, y, z, on, col) {
    cyl(g, x, y, z, 4, 2, '#2b2b36'); const a = P(x, y, z + 2), b = P(x - 4, y + 2, z + 26);
    g.strokeStyle = '#3a3a44'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    cyl(g, x - 5, y + 2, z + 24, 5.5, 4, on ? (col || '#ffd36b') : '#6b6b74', { stroke: false });
    if (on) { const c = P(x - 5, y + 2, z + 20); const gr = g.createRadialGradient(c[0], c[1], 1, c[0], c[1] + 6, 30); gr.addColorStop(0, 'rgba(255,225,150,.35)'); gr.addColorStop(1, 'rgba(255,225,150,0)'); g.fillStyle = gr; g.fillRect(c[0] - 32, c[1] - 6, 64, 40); }
  }
  function led(g, x, y, z, col, blink) { const c = P(x, y, z); g.fillStyle = col; g.globalAlpha = blink ? .55 + .45 * Math.sin(ST.T * 7 + x) : 1; g.fillRect(c[0] - 1.5, c[1] - 1.5, 3, 3); g.globalAlpha = 1; }

  // monitor with a drawn screen. x,y = left/back corner of the panel on the desk top.
  function monitor(g, x, y, z, w, h, kind, on, col) {
    box(g, x + w / 2 - 6, y + 2, z, 12, 5, 2, '#2b2b36'); box(g, x + w / 2 - 2, y + 3, z + 2, 4, 3, 6, '#3a3a44');
    box(g, x, y, z + 7, w, 3, h, '#1f2128', { st: 'rgba(0,0,0,.5)' });
    Fy(g, y + 3, z + 7 + h - 2, () => {
      g.translate(x + 2, 0); const sw = w - 4, sh2 = h - 4;
      g.fillStyle = on ? (col ? sh(col, .22) : '#0d2a1c') : '#0c1024'; g.fillRect(0, 0, sw, sh2);
      g.save(); g.beginPath(); g.rect(0, 0, sw, sh2); g.clip();
      const lc = on ? (col || '#5ef0a0') : '#3a4470', t = on ? ST.T : 0;
      if (kind === 'wire') { g.strokeStyle = lc; g.lineWidth = 1; g.strokeRect(3, 3, sw - 6, 6); g.strokeRect(3, 12, sw * .4, sh2 - 16); g.strokeRect(sw * .5, 12, sw * .4, 6); g.strokeRect(sw * .5, 21, sw * .4, sh2 - 25); g.beginPath(); g.moveTo(4, 14); g.lineTo(sw * .4, sh2 - 6); g.moveTo(sw * .4 + 2, 14); g.lineTo(5, sh2 - 6); g.stroke(); }
      else if (kind === 'shield') { g.fillStyle = lc; g.beginPath(); g.moveTo(sw / 2, 3); g.lineTo(sw / 2 + 10, 6); g.lineTo(sw / 2 + 9, sh2 * .55); g.lineTo(sw / 2, sh2 - 3); g.lineTo(sw / 2 - 9, sh2 * .55); g.lineTo(sw / 2 - 10, 6); g.fill(); g.fillStyle = '#0d2a1c'; g.fillRect(sw / 2 - 1, 8, 2, 8); g.fillRect(sw / 2 - 4, 11, 8, 2); }
      else if (kind === 'chart') { g.strokeStyle = lc; g.lineWidth = 1; g.beginPath(); for (let i = 0; i < 12; i++) { const yy = sh2 - 5 - (Math.sin(i * .9 + t * 2) * .5 + .5) * (sh2 - 10); i ? g.lineTo(3 + i * (sw - 6) / 11, yy) : g.moveTo(3, yy); } g.stroke(); }
      else { for (let i = -1; i < 7; i++) { const yy = 2 + i * 4 + (on ? (t * 8 % 4) : 0); g.fillStyle = lc; g.fillRect(3 + (i * 7 % 5), yy, 4 + ((i * 13) % 5) * 4, 1.5); } }
      g.restore();
      if (on) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 0, sw, 3); }
    });
    if (on) { const c = P(x + w / 2, y + 12, z + 7 + h / 2); const gr = g.createRadialGradient(c[0], c[1], 2, c[0], c[1], 34); gr.addColorStop(0, alpha(col || '#5ef0a0', .13)); gr.addColorStop(1, alpha(col || '#5ef0a0', 0)); g.fillStyle = gr; g.fillRect(c[0] - 36, c[1] - 30, 72, 60); }
  }
  function keyboard(g, x, y, z, w, col) { box(g, x, y, z, w || 26, 9, 2, col || '#cfc8b6'); Fg(g, z + 2, () => { g.fillStyle = 'rgba(0,0,0,.3)'; for (let i = 0; i < 6; i++) g.fillRect(x + 2 + i * 4, y + 2, 3, 2), g.fillRect(x + 3 + i * 4, y + 5.5, 3, 2); }); }

  // ---------- desks ----------
  function nameplate(g, d, t, st) {
    const x = d.cx - 20, y = d.rect.y0 + 40;
    box(g, x, y, 34, 40, 4, 9, '#20202a');
    Fy(g, y + 4, 34 + 9, () => { g.translate(x, 0); g.fillStyle = st.present ? t.accent : '#7a7a86'; g.fillRect(2, 1.5, 36, 5.5); g.font = '5.5px ' + FONT; g.fillStyle = '#1b1220'; g.textAlign = 'center'; g.fillText(st.present ? t.name.toUpperCase() : (t.name.toUpperCase() + ' · EMPTY'), 20, 6.2); });
  }
  function ledFront(g, d, st) { led(g, d.cx + 42, d.rect.y0 + 52, 20, st.led, st.working); }
  function deskBase(g, d, t, st) {
    const { cx, rect: r, block: b } = d, y0 = r.y0, acc = t.accent, wall = '#3a3d66', top = '#d8c19a';
    // partition panels in the accent colour: back panel + left side panel
    const bz = d.key === 'tally' ? 96 : d.key === 'atlas' ? 0 : 62;
    if (bz) { box(g, cx - 95, y0 - 14, 0, 190, 5, bz, wall); box(g, cx - 95, y0 - 14, bz - 5, 190, 5, 5, acc, { t: sh(acc, 1.1) }); box(g, cx - 95, y0 - 14, 0, 190, 5, 8, '#262846', { t: '#262846' }); }
    box(g, cx - 97, y0 - 14, 0, 6, d.top ? 106 : 112, 48, wall); box(g, cx - 97, y0 - 14, 43, 6, d.top ? 106 : 112, 5, acc, { t: sh(acc, 1.1) });
    // desk: top, drawers on the right, open knee space on the left
    box(g, cx - 50, y0, 0, 4, 52, 31, '#8d6840'); box(g, cx + 46, y0, 0, 4, 52, 31, '#8d6840');
    box(g, cx + 6, y0 + 2, 0, 40, 46, 31, '#a37a4a'); box(g, cx - 46, y0 + 2, 6, 52, 3, 24, '#7a5230');
    Fy(g, y0 + 48, 31, () => { g.translate(cx + 6, 0); for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#b08556' : '#b88c5b'; g.fillRect(2, 2 + i * 9.5, 36, 8.5); g.fillStyle = '#e8d8b8'; g.fillRect(16, 5 + i * 9.5, 8, 1.6); } });
    box(g, cx - 54, y0 - 2, 31, 108, 56, 4, '#c9a878', { t: top, l: '#a98960', r: '#8d6f4d' });
    Fg(g, 35, () => { g.strokeStyle = 'rgba(80,50,20,.18)'; g.lineWidth = .8; g.beginPath(); for (let i = 1; i < 6; i++) { g.moveTo(cx - 50, y0 - 2 + i * 9.5); g.lineTo(cx + 54, y0 - 2 + i * 9.5); } g.stroke(); g.fillStyle = alpha(acc, .55); g.fillRect(cx - 54, y0 - 2, 108, 1.6); });
    nameplate(g, d, t, st); ledFront(g, d, st);
    mug(g, cx + 30, y0 + 36, 35, st.present ? '#f3ede2' : '#8a8a92', st.present && !st.working);
    lamp(g, cx + 44, y0 + 6, 35, st.present && st.working);
  }
  // distinguishing blocks
  const PROPS = {
    pixel(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 46, y0 + 8, 35, 36, 30, 'wire', on, '#7ad0ff'); monitor(g, cx - 6, y0 + 8, 35, 36, 30, 'code', on, '#ffb3d1');
      keyboard(g, cx - 24, y0 + 30, 35, 28);
      // pen tablet and pen
      box(g, cx + 8, y0 + 28, 35, 18, 13, 1.4, '#2b2b36'); Fg(g, 36.5, () => { g.strokeStyle = t.accent; g.lineWidth = 1; g.strokeRect(cx + 10, y0 + 30, 14, 9); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(cx + 38, y0 + 40); g.lineTo(cx + 30, y0 + 28); g.stroke(); });
      // six colour swatch chips
      ['#e0679a', '#ffb3d1', '#7ad0ff', '#ffd23f', '#7cf29a', '#c9b0f0'].forEach((c, i) => box(g, cx - 49 + i * 5.6, y0 + 42, 35, 4.6, 6, 1.6, c));
      // sticker laptop on a side table
      box(g, cx + 58, y0 + 6, 0, 32, 30, 24, '#8d6840'); box(g, cx + 56, y0 + 4, 24, 36, 34, 3, '#c9a878');
      box(g, cx + 62, y0 + 12, 27, 24, 17, 1.5, '#cfd3dc'); box(g, cx + 62, y0 + 10, 27, 24, 2, 17, '#cfd3dc', { noT: true });
      Fy(g, y0 + 12, 27 + 17, () => { g.translate(cx + 62, 0); g.fillStyle = on ? '#112a3a' : '#10163a'; g.fillRect(1, 1, 22, 15); [['#ff6b8a', 4, 4], ['#ffd23f', 12, 7], ['#3dd6ff', 7, 11], ['#7cf29a', 17, 4]].forEach(([c, x, y]) => { g.fillStyle = c; g.fillRect(x, y, 3.5, 3.5); }); });
    },
    forge(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'code', on, '#ffc78a'); keyboard(g, cx - 28, y0 + 31, 35, 28);
      box(g, cx + 14, y0 + 28, 35, 22, 12, 4, '#2f3442'); for (let i = 0; i < 6; i++) led(g, cx + 17 + i * 3, y0 + 40.2, 38, on ? ['#5ef0a0', '#7cc4ff', '#ffb547'][i % 3] : '#3a3f4c', on && i % 2);
      // short server rack beside the desk
      const rx = cx + 56, ry = y0 + 4;
      box(g, rx, ry, 0, 34, 26, 96, '#2b2f3a'); box(g, rx + 2, ry + 26, 4, 30, 1, 88, '#14161c', { st: null });
      Fy(g, ry + 26.5, 94, () => { g.translate(rx + 3, 0); for (let i = 0; i < 8; i++) { g.fillStyle = i === 3 ? '#0d2a1c' : '#1c1f28'; g.fillRect(0, 2 + i * 10.5, 28, 9); g.fillStyle = '#3a4050'; g.fillRect(1, 3 + i * 10.5, 14, 1); if (i === 3) { g.fillStyle = '#5ef0a0'; g.fillRect(2, 5 + i * 10.5, 10, 1); g.fillRect(2, 7.5 + i * 10.5, 7, 1); } for (let k = 0; k < 3; k++) { const f = on ? (Math.sin(ST.T * (4 + k * 2.3) + i * 1.7 + k) > -.2) : false; g.fillStyle = f ? ['#5ef0a0', '#ffb547', '#7cc4ff'][k] : '#2a2f3a'; g.fillRect(19 + k * 3, 5 + i * 10.5, 1.8, 1.8); } } });
      Fg(g, 0.6, () => { g.fillStyle = '#1f2128'; g.fillRect(cx + 34, y0 + 30, 28, 4); g.fillRect(cx + 34, y0 + 30, 4, 30); }); // cable tray
    },
    warden(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 30, y0 + 8, 35, 40, 30, 'shield', on, '#a9c1f5'); keyboard(g, cx - 24, y0 + 31, 35, 28);
      // padlock emblem on the back partition
      Fy(g, y0 - 9, 60, () => { g.translate(cx - 14, 0); g.fillStyle = t.accent; g.beginPath(); g.arc(14, 8, 6.5, Math.PI, 0); g.lineWidth = 2.6; g.strokeStyle = t.accent; g.stroke(); g.fillStyle = t.accent; g.fillRect(5, 8, 18, 13); g.fillStyle = '#1b2440'; g.fillRect(12.5, 12, 3, 5); g.beginPath(); g.arc(14, 12, 2.2, 0, 6.2832); g.fill(); });
      // two wall cameras that pan slowly
      [cx - 80, cx + 76].forEach((x, i) => { const pan = on || ST.T ? Math.sin(ST.T * .6 + i * 2) * 4 : 0; box(g, x, y0 - 14, 56, 12, 5, 6, '#2b2f3a'); const a = P(x + 6, y0 - 9, 59), b = P(x + 6 + pan, y0 + 2, 55 - 1); g.strokeStyle = '#1b1f28'; g.lineWidth = 4; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.fillStyle = '#7cc4ff'; g.beginPath(); g.arc(b[0], b[1], 1.8, 0, 6.2832); g.fill(); led(g, x + 10, y0 - 8, 62, '#ff4d4d', true); });
      // keycard reader on the side panel, shredder on the floor
      box(g, cx - 92, y0 + 14, 26, 3, 9, 14, '#2b2f3a'); Fx(g, cx - 89, y0 + 23, 40, () => { g.fillStyle = '#0d2a1c'; g.fillRect(1, 1.5, 7, 4); g.fillStyle = on ? '#5ef0a0' : '#2a4a3a'; g.fillRect(2, 8, 5, 2); });
      box(g, cx + 58, y0 + 8, 0, 26, 18, 34, '#3a3f4c'); box(g, cx + 62, y0 + 12, 34, 18, 3, 1, '#14161c'); Fg(g, 36, () => { g.fillStyle = '#f3ede2'; g.fillRect(cx + 66, y0 + 14, 6, 1.6); });
      box(g, cx + 60, y0 + 18, 4, 22, 1, 12, '#4a5060');
    },
    probe(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working, tk = on ? Math.floor(ST.T / 2.4) % 6 : 3;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'term', on, '#a5e6c6'); keyboard(g, cx - 28, y0 + 31, 35, 28);
      // clipboard checklist on the partition; ticks fill as tests pass
      Fy(g, y0 - 9, 56, () => { g.translate(cx + 30, 0); g.fillStyle = '#8a5a2a'; g.fillRect(0, 0, 32, 40); g.fillStyle = '#f3ede2'; g.fillRect(2, 5, 28, 33); g.fillStyle = '#bbb'; g.fillRect(10, 0, 12, 4); for (let i = 0; i < 5; i++) { g.fillStyle = '#9aa'; g.fillRect(12, 10 + i * 6, 16, 1.6); g.strokeStyle = '#9aa'; g.strokeRect(4, 8 + i * 6, 4, 4); if (i < tk) { g.strokeStyle = '#2f9f68'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(4.5, 10 + i * 6); g.lineTo(6, 12 + i * 6); g.lineTo(9, 7 + i * 6); g.stroke(); } } });
      // test bench: second table with three devices under test
      box(g, cx + 54, y0 - 2, 0, 40, 60, 28, '#8d6840', { t: '#d8d2c6' }); box(g, cx + 52, y0 - 4, 28, 44, 64, 3, '#d8d2c6');
      [[0, '#5ef0a0'], [1, '#ffb547'], [2, '#7cc4ff']].forEach(([i, c]) => { const yy = y0 + 4 + i * 18; box(g, cx + 62, yy, 31, 20, 12, 3, '#2b2f3a'); Fg(g, 34.2, () => { g.fillStyle = on ? c : '#2a4a3a'; g.fillRect(cx + 65, yy + 2, 14, 7); g.fillStyle = '#e0ffe8'; if (on) g.fillRect(cx + 66 + (ST.T * 6 % 10), yy + 4, 2, 2); }); });
      // bug jar and a magnifier
      cyl(g, cx + 36, y0 + 36, 35, 5, 9, 'rgba(170,215,240,.6)'); const jc = P(cx + 36, y0 + 36, 38); g.fillStyle = '#1b1220'; g.beginPath(); g.ellipse(jc[0], jc[1] - 1, 2, 1.2, 0, 0, 6.2832); g.fill(); g.strokeStyle = '#1b1220'; g.lineWidth = .8; g.beginPath(); g.moveTo(jc[0] - 3, jc[1] - 3); g.lineTo(jc[0] + 3, jc[1] + 1); g.moveTo(jc[0] - 3, jc[1] + 1); g.lineTo(jc[0] + 3, jc[1] - 3); g.stroke();
      const mc = P(cx + 22, y0 + 40, 36); g.strokeStyle = '#d6b13a'; g.lineWidth = 1.6; g.beginPath(); g.arc(mc[0], mc[1] - 4, 4, 0, 6.2832); g.stroke(); g.beginPath(); g.moveTo(mc[0] + 3, mc[1] - 1); g.lineTo(mc[0] + 8, mc[1] + 3); g.stroke();
    },
    atlas(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      // floor-to-ceiling bookshelf behind the desk
      const sx = cx - 78, sy = y0 - 22;
      box(g, sx, sy, 0, 130, 10, 140, '#6b4220'); Fy(g, sy + 10, 140, () => { g.translate(sx, 0); const q = rnd(31); for (let row = 0; row < 5; row++) { g.fillStyle = '#4a2c14'; g.fillRect(2, 4 + row * 27, 126, 2); let x = 4; while (x < 124) { const w = 3 + q() * 4, h = 15 + q() * 8; g.fillStyle = ['#8f3b2e', '#3f6b4a', '#c99a3c', '#2f4a72', '#6b3a5a', '#d8cdb5', '#8a63c9'][(q() * 7) | 0]; g.fillRect(x, 4 + row * 27 + 22 - h, w, h); x += w + .6; } } });
      monitor(g, cx - 30, y0 + 8, 35, 36, 28, 'chart', on, '#c9b0f0'); keyboard(g, cx - 24, y0 + 31, 35, 26);
      // stack of open books and a globe
      box(g, cx + 12, y0 + 26, 35, 20, 14, 2, '#8f3b2e'); box(g, cx + 14, y0 + 27, 37, 18, 12, 2, '#f3ede2'); box(g, cx + 16, y0 + 30, 39, 12, 8, 2, '#2f4a72'); Fg(g, 41, () => { g.strokeStyle = '#9aa'; g.lineWidth = .6; g.beginPath(); g.moveTo(cx + 18, y0 + 34); g.lineTo(cx + 40, y0 + 34); g.stroke(); });
      cyl(g, cx + 40, y0 + 12, 35, 4, 2, '#3a2a18'); ball(g, cx + 40, y0 + 12, 38, 8, '#3d8aa8'); const gc = P(cx + 40, y0 + 12, 46); g.fillStyle = '#4c9a5a'; g.beginPath(); g.arc(gc[0] - 2, gc[1] - 1, 3, 0, 6.2832); g.arc(gc[0] + 3, gc[1] + 2, 2, 0, 6.2832); g.fill();
      // rolling whiteboard with a string-and-pin diagram
      const wx = cx + 60, wy = y0 + 22;
      box(g, wx, wy, 6, 3, 3, 34, '#3a3a44'); box(g, wx + 30, wy, 6, 3, 3, 34, '#3a3a44'); box(g, wx, wy, 0, 33, 3, 6, '#2b2b36');
      box(g, wx - 2, wy - 1, 40, 38, 3, 40, '#c9ccd4'); Fy(g, wy + 2, 80, () => { g.translate(wx - 2, 0); g.fillStyle = '#f5f6f8'; g.fillRect(2, 2, 34, 36); const pts = [[8, 9], [28, 7], [14, 22], [30, 26], [9, 32]]; g.strokeStyle = '#c0392b'; g.lineWidth = .9; g.beginPath(); [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4]].forEach(([a, b]) => { g.moveTo(...pts[a]); g.lineTo(...pts[b]); }); g.stroke(); pts.forEach(([x, y], i) => { g.fillStyle = ['#3a6ac0', '#e0b030', '#2f9f68', '#8a63c9', '#d35a4a'][i]; g.beginPath(); g.arc(x, y, 2.2, 0, 6.2832); g.fill(); g.fillStyle = '#fff'; g.fillRect(x - 5, y + 2.5, 10, 3); }); });
    },
    cabalan(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working, ac = t.accent;
      // rug in the accent colour, armchair, floor lamp, side table with a book and tea, small bookcase
      Fg(g, .4, () => { g.fillStyle = sh(ac, .62); g.fillRect(cx + 38, y0 - 2, 58, 88); g.strokeStyle = ac; g.lineWidth = 2; g.strokeRect(cx + 42, y0 + 2, 50, 80); g.fillStyle = alpha(ac, .35); g.fillRect(cx + 50, y0 + 10, 34, 64); });
      monitor(g, cx - 36, y0 + 8, 34, 40, 28, 'code', on, '#9de4e8'); keyboard(g, cx - 28, y0 + 31, 35, 26);
      box(g, cx - 92, y0 - 12, 0, 32, 12, 74, '#6b4220'); Fy(g, y0, 74, () => { g.translate(cx - 92, 0); const q = rnd(41); for (let row = 0; row < 3; row++) { g.fillStyle = '#4a2c14'; g.fillRect(1, 3 + row * 23, 30, 2); let x = 3; while (x < 29) { const w = 3 + q() * 3; g.fillStyle = ['#3f6b4a', '#c99a3c', '#2f4a72', '#d8cdb5', '#3fb0b8'][(q() * 5) | 0]; g.fillRect(x, 5 + row * 23 + 4 + q() * 4, w, 14); x += w + .6; } } });
      // armchair
      const ax = cx + 52, ay = y0 + 20;
      box(g, ax, ay - 4, 0, 40, 8, 40, sh(ac, .75)); box(g, ax, ay, 0, 8, 38, 20, sh(ac, .8)); box(g, ax + 32, ay, 0, 8, 38, 20, sh(ac, .8)); box(g, ax + 8, ay, 0, 24, 36, 14, sh(ac, .95));
      box(g, ax + 10, ay + 4, 14, 20, 28, 4, ac);
      cyl(g, cx + 92, y0 - 2, 0, 3, 74, '#3a3a44'); cyl(g, cx + 92, y0 - 2, 74, 9, 12, '#ffd9a0', { top: '#fff3d0' });
      cyl(g, cx + 70, y0 + 70, 0, 9, 22, '#7a5230'); box(g, cx + 63, y0 + 66, 22, 11, 8, 2.4, '#8f3b2e'); mug(g, cx + 75, y0 + 74, 22, '#f3ede2', true);
    },
    tally(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working, b = ST.board;
      // kanban wall on the tall back panel: To do / Doing / Done, mirrored from the real goal board
      Fy(g, y0 - 9, 94, () => { g.translate(cx - 90, 0); g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, 180, 62); g.fillStyle = '#3a3d66'; g.fillRect(0, 0, 180, 9);
        const cols = [['TO DO', b.todo, '#fff7a8'], ['DOING', b.doing, '#a8f0c8'], ['DONE', b.done, '#c9e4ff']];
        cols.forEach(([n, v, c], i) => { const x = 4 + i * 59; g.fillStyle = t.accent; g.fillRect(x, 12, 55, 8); txt(g, n + ' ' + v, x + 27.5, 18.5, 6.5, '#1b1220', 'center'); g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, 21, 55, 38);
          for (let k = 0; k < Math.min(6, v); k++) { g.fillStyle = k % 2 ? c : sh(c, .93); g.fillRect(x + 3 + (k % 3) * 17, 24 + Math.floor(k / 3) * 17, 15, 14); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 5 + (k % 3) * 17, 29 + Math.floor(k / 3) * 17, 10, 1.2); g.fillRect(x + 5 + (k % 3) * 17, 32 + Math.floor(k / 3) * 17, 7, 1.2); } }); });
      monitor(g, cx - 36, y0 + 8, 35, 40, 28, 'term', on, '#f5e08f'); keyboard(g, cx - 28, y0 + 31, 35, 26);
      // label maker and a filing tray
      box(g, cx + 12, y0 + 30, 35, 14, 9, 5, '#d35a4a'); box(g, cx + 14, y0 + 32, 40, 10, 4, 2, '#f3ede2'); Fg(g, 40.1, () => { g.fillStyle = '#1b1220'; g.fillRect(cx + 15, y0 + 33, 8, 1); });
      [0, 1, 2].forEach(i => { box(g, cx + 30, y0 + 28, 35 + i * 4.5, 20, 15, 3.2, '#8a909c'); box(g, cx + 32, y0 + 30, 38 + i * 4.5, 16, 11, 1.2, i === 2 ? '#fff' : '#f3ede2'); });
    },
    scribe(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working, n = Math.max(3, Math.min(12, ST.ex.sopN || ST.ex.memoryN || 6));
      // binder rack: one binder per SOP note
      const bx = cx - 90, by = y0 - 22;
      box(g, bx, by, 0, 96, 10, 90, '#6b4220'); Fy(g, by + 10, 90, () => { g.translate(bx, 0); const cols = [t.color, '#3f6b4a', '#2f4a72', '#c99a3c', '#8a63c9', '#8f3b2e', '#3fb0b8', '#d8cdb5']; for (let row = 0; row < 3; row++) { g.fillStyle = '#4a2c14'; g.fillRect(2, 4 + row * 28, 92, 2); for (let k = 0; k < 4; k++) { const idx = row * 4 + k; if (idx >= n) continue; g.fillStyle = cols[idx % 8]; g.fillRect(6 + k * 22, 8 + row * 28, 18, 22); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(9 + k * 22, 12 + row * 28, 12, 5); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(6 + k * 22 + 16, 8 + row * 28, 2, 22); } } });
      monitor(g, cx - 18, y0 + 8, 36, 28, 'term', on, '#e8b99f');
      // typewriter-style keyboard, page stack, quill cup
      box(g, cx - 28, y0 + 30, 35, 28, 12, 4, '#2f3442'); Fg(g, 39.2, () => { g.fillStyle = '#d8cdb5'; for (let i = 0; i < 7; i++) for (let k = 0; k < 2; k++) { g.beginPath(); g.arc(cx - 24 + i * 3.6, y0 + 34 + k * 4.5, 1.2, 0, 6.2832); g.fill(); } });
      [0, 1, 2, 3].forEach(i => box(g, cx + 18 + (i % 2), y0 + 28, 35 + i * 1.4, 18, 14, 1.4, '#f3ede2'));
      cyl(g, cx + 44, y0 + 14, 35, 4.2, 8, '#8a5a2a'); [[-2, '#e8b99f'], [0, '#fff'], [2, '#c9b0f0']].forEach(([dx, c]) => { const q = P(cx + 44 + dx, y0 + 14, 43); g.strokeStyle = c; g.lineWidth = 1.2; g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(q[0] + dx * 2, q[1] - 10, q[0] + dx * 3.5, q[1] - 16); g.stroke(); });
    },
    it(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 46, y0 + 8, 35, 36, 30, 'term', on, '#9fd0f7'); monitor(g, cx - 6, y0 + 8, 35, 36, 30, 'chart', on, t.accent);
      keyboard(g, cx - 24, y0 + 30, 35, 28);
      // cable tidy: a spine down the side panel with coloured leads looping into it
      box(g, cx + 46, y0 + 8, 0, 4, 4, 31, '#2b2f3a');
      Fg(g, 35.4, () => { ['#5ef0a0', '#7cc4ff', '#ffb547'].forEach((c, i) => { g.strokeStyle = c; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 10 + i * 12, y0 + 4); g.quadraticCurveTo(cx + 30, y0 + 2 + i * 3, cx + 47, y0 + 10); g.stroke(); }); });
    },
    accounting(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'chart', on, t.accent); keyboard(g, cx - 28, y0 + 31, 35, 28);
      // adding machine with a paper roll, and an open ledger
      box(g, cx + 14, y0 + 26, 35, 20, 16, 5, '#cfd3dc'); box(g, cx + 18, y0 + 24, 40, 12, 4, 4, '#f3ede2');
      Fg(g, 40.1, () => { for (let i = 0; i < 9; i++) { g.fillStyle = i === 8 ? '#d35a4a' : '#4a4f5c'; g.fillRect(cx + 16 + (i % 3) * 5.5, y0 + 30 + Math.floor(i / 3) * 4, 4, 3); } });
      box(g, cx - 50, y0 + 40, 35, 26, 12, 1.6, '#2f5a2a'); box(g, cx - 49, y0 + 41, 36.6, 24, 10, 1, '#f3ede2');
      Fg(g, 37.7, () => { g.fillStyle = '#9aa'; for (let i = 0; i < 4; i++) { g.fillRect(cx - 47, y0 + 43 + i * 2, 9, .6); g.fillRect(cx - 35, y0 + 43 + i * 2, 9, .6); } });
    },
    marketing(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'wire', on, t.accent); keyboard(g, cx - 28, y0 + 31, 35, 28);
      // mood board on the back partition: pinned swatches and photos
      Fy(g, y0 - 9, 58, () => { g.translate(cx + 22, 0); g.fillStyle = '#c99a6a'; g.fillRect(0, 0, 40, 30); [['#e0503f', 3, 3, 12, 10], ['#ffd23f', 18, 4, 9, 9], ['#3dd6ff', 29, 3, 8, 12], ['#7cf29a', 4, 16, 10, 11], ['#ffa99c', 17, 16, 18, 10]].forEach(([c, x, y, w, h]) => { g.fillStyle = c; g.fillRect(x, y, w, h); g.fillStyle = '#d35a4a'; g.fillRect(x + w / 2 - 1, y, 2, 2); }); });
      // megaphone lying on the desk
      const m = P(cx + 22, y0 + 34, 37); g.fillStyle = t.color; g.beginPath(); g.moveTo(m[0], m[1] - 2); g.lineTo(m[0] + 14, m[1] - 7); g.lineTo(m[0] + 14, m[1] + 5); g.lineTo(m[0], m[1] + 1); g.closePath(); g.fill();
      g.fillStyle = '#f3ede2'; g.beginPath(); g.ellipse(m[0] + 14, m[1] - 1, 2, 6, 0, 0, 6.2832); g.fill(); g.fillStyle = '#2b2f3a'; g.fillRect(m[0] - 4, m[1] - 2, 5, 3);
    },
    auditor(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'shield', on, t.accent); keyboard(g, cx - 28, y0 + 31, 35, 28);
      // row of binders on the desk end
      ['#4a4f8c', '#8f3b2e', '#3f6b4a', '#c99a3c', t.accent].forEach((c, i) => { box(g, cx + 30, y0 + 4 + i * 5, 35, 16, 4.4, 20, c); Fx(g, cx + 46, y0 + 8.4 + i * 5, 55, () => { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(1, 4, 2.4, 6); }); });
      // magnifier over a report page
      box(g, cx + 6, y0 + 32, 35, 16, 13, 1, '#f3ede2');
      const mc = P(cx + 14, y0 + 38, 37); g.strokeStyle = '#d6b13a'; g.lineWidth = 1.6; g.beginPath(); g.arc(mc[0], mc[1] - 4, 4.5, 0, 6.2832); g.stroke(); g.beginPath(); g.moveTo(mc[0] + 3.5, mc[1] - 1); g.lineTo(mc[0] + 9, mc[1] + 3); g.stroke();
    },
    notetaker(g, d, t, st) {
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      monitor(g, cx - 36, y0 + 8, 35, 40, 30, 'term', on, t.accent); keyboard(g, cx - 28, y0 + 31, 35, 28);
      // spiral notepad with lines
      box(g, cx + 10, y0 + 28, 35, 18, 15, 1.4, '#f3ede2');
      Fg(g, 36.5, () => { g.fillStyle = '#4a4f5c'; for (let i = 0; i < 5; i++) g.fillRect(cx + 12 + i * 3.4, y0 + 28.5, 1.4, 1.4); g.fillStyle = '#9aa'; for (let i = 0; i < 4; i++) g.fillRect(cx + 12, y0 + 32 + i * 2.8, 13, .6); });
      // desk mic on a stand; the tip glows while recording
      cyl(g, cx + 38, y0 + 18, 35, 4, 1.4, '#2b2f3a'); cyl(g, cx + 38, y0 + 18, 36.4, .9, 10, '#4a4f5c'); ball(g, cx + 38, y0 + 18, 45.4, 3, on ? '#ff5a4a' : '#6a6f7c');
    },
    laptop(g, d, t, st) { // any role without its own props
      const { cx, rect: r } = d, y0 = r.y0, on = st.working;
      box(g, cx - 20, y0 + 22, 35, 32, 22, 1.5, '#cfd3dc'); box(g, cx - 20, y0 + 20, 35, 32, 2, 22, '#cfd3dc', { noT: true });
      Fy(g, y0 + 22, 35 + 22, () => { g.translate(cx - 20, 0); g.fillStyle = on ? '#112a3a' : '#10163a'; g.fillRect(1.5, 1.5, 29, 19); g.fillStyle = t.accent; g.fillRect(4, 5, 16, 1.6); g.fillRect(4, 9, 22, 1.6); });
    },
  };
  function drawDesk(g, d) {
    const t = teamOf(d.key), st = dstate(d.id);
    g.save(); if (!st.present) g.globalAlpha = .55;
    deskBase(g, d, t, st); (PROPS[d.key] || PROPS.laptop)(g, d, t, st);
    g.restore();
    if (!st.present) { const c = P(d.cx, d.rect.y0 + 20, 36); g.save(); g.fillStyle = 'rgba(20,16,40,.28)'; poly(g, [P(d.block.x0, d.block.y0, 0), P(d.block.x1, d.block.y0, 0), P(d.block.x1, d.block.y1, 0), P(d.block.x0, d.block.y1, 0)], 'rgba(20,16,40,.22)'); g.restore(); void c; }
  }
  // The desk a dept-desk piece draws: the live one when it holds the same role, else built from the piece itself.
  const deskOf = p => {
    const d = M.DESKS.find(q => q.id === p.desk), RC = root.RoleCatalog, key = p.role || (RC ? RC.BUILTIN_DESKS[p.desk] : d && d.key);
    return d && d.key === key ? d : M.deskAt(p.desk, key, p.x, p.y);
  };
  def('dept-desk', [155, 352], p => { // a department desk with its chair; anchored at the seat
    const d = deskOf(p);
    const deskItem = add(d.cx + d.rect.y0 + 30 + (d.top ? 0 : 0), g => drawDesk(g, d));
    add(d.cx + d.seat.y - 8, g => { const st = dstate(d.id); g.save(); if (!st.present) g.globalAlpha = .5; chair(g, d.seat.x, d.seat.y, sh(teamOf(d.key).color, .6)); g.restore(); });
    reg('desk', teamOf(d.key).name + "'s desk", [d.block.x0, d.block.y0, 0, d.block.x1 - d.block.x0, d.block.y1 - d.block.y0, 70], deskItem, { desk: d.id });
  }, { home: p => { const d = deskOf(p); return [d.seat.x, d.seat.y]; }, spots: [{ id: p => p.desk, dx: 0, dy: 0, face: 'n', zone: 'focus', seat: true, desk: true }] });
  M.DESKS.forEach(d => put(d.id, 'dept-desk', d.seat.x, d.seat.y, { desk: d.id }));

  // ---------- manager's office ----------
  def('tiro-desk', [150, 46], () => { const tiroObj = reg('desk', "Tiro's desk", [150, 14, 0, 150, 84, 64], null, { desk: 'office' });
  tiroObj.src = add(340, g => { // Tiro's desk, trophy shelf, rug items, plant, glass walls are separate items
    const D = M.TIRO_DESK; const dx = D.x0, dy = D.y0, w = D.x1 - D.x0, dd = D.y1 - D.y0;
    box(g, dx + 4, dy + 2, 0, w - 8, dd - 4, 28, '#5e3a1e'); box(g, dx, dy, 28, w, dd, 6, '#7d5230', { t: '#9a6a3c' });
    Fy(g, dy + dd, 28, () => { g.translate(dx + 4, 0); g.fillStyle = '#4a2c14'; g.fillRect(2, 2, w - 12, 20); g.fillStyle = '#6e4624'; for (let i = 0; i < 6; i++) g.fillRect(4 + i * 23, 4, 21, 16); g.fillStyle = '#d6b13a'; for (let i = 0; i < 6; i++) g.fillRect(12 + i * 23, 11, 5, 1.6); });
    // two monitors (we see their backs), nameplate faces the guests
    box(g, dx + 8, dy + 12, 34, 38, 3, 24, '#20222a'); box(g, dx + 104, dy + 12, 34, 38, 3, 24, '#20222a'); box(g, dx + 24, dy + 14, 34, 6, 2, 3, '#3a3a44'); box(g, dx + 120, dy + 14, 34, 6, 2, 3, '#3a3a44'); // monitors flank the chair so Tiro stays visible between them
    const on = ST.tiroBusy; if (on) { const c = P(dx + 27, dy + 26, 50), c2 = P(dx + 123, dy + 26, 50); [c, c2].forEach(q => { const gr = g.createRadialGradient(q[0], q[1], 2, q[0], q[1], 26); gr.addColorStop(0, 'rgba(120,240,170,.16)'); gr.addColorStop(1, 'rgba(120,240,170,0)'); g.fillStyle = gr; g.fillRect(q[0] - 28, q[1] - 24, 56, 48); }); }
    box(g, dx + 60, dy + dd - 10, 34, 34, 4, 9, '#20202a'); Fy(g, dy + dd - 6, 43, () => { g.translate(dx + 60, 0); g.fillStyle = '#ffcf6b'; g.fillRect(2, 1.5, 30, 5.5); txt(g, 'TIRO · MANAGER', 17, 6.2, 5.2, '#1b1220', 'center'); });
    mug(g, dx + 132, dy + 34, 34, '#ffcf6b', true); lamp(g, dx + 140, dy + 8, 34, true);
    box(g, dx + 10, dy + 30, 34, 14, 11, 1, '#f3ede2'); box(g, dx + 12, dy + 32, 35, 14, 11, 1, '#e9e4d6');
  }); }); // Tiro sits behind his desk: the desk has a footprint now, so its top and front panel draw over his lower body
  put('tiro-desk', 'tiro-desk', 150, 46);
  fixture('wall-boards', () => {
    reg('usage', 'Usage and plan limits', [355, 0, 58, 100, 4, 62], usageBoard, { clip: true });
    reg('today', 'Today board', [132, 0, 54, 180, 4, 74], todayBoard, { clip: true });
  });
  // Inbox tray (approvals) on the desk, and the report icon
  def('inbox', [158, 70], () => { const inboxItem = add(95, g => {
    const D = M.TIRO_DESK, tx = D.x0 + 8, ty = D.y1 - 24, pend = ST.ex.pending || 0;
    const hov = ST.hover === 'inbox'; g.save(); if (pend) g.shadowColor = '#ffcf6b', g.shadowBlur = 6 + 6 * Math.sin(ST.T * 5);
    box(g, tx, ty, 34, 26, 16, 5, '#7a5a3a'); box(g, tx + 2, ty + 2, 35, 22, 12, 1, '#5e4228'); g.restore();
    if (pend) { box(g, tx + 4, ty + 3, 36, 18, 10, 1.6, '#fff7e0'); box(g, tx + 5, ty + 4, 37.6, 17, 9, 1.4, '#f3ede2'); }
    if (ST.reportIcon) { const c = P(D.x1 - 12, D.y1 - 24, 44 + Math.sin(ST.T * 4) * 2); g.fillStyle = '#fff'; g.strokeStyle = '#1b1220'; g.lineWidth = 1; g.fillRect(c[0] - 6, c[1] - 8, 12, 15); g.strokeRect(c[0] - 6, c[1] - 8, 12, 15); g.fillStyle = '#3f9f68'; g.fillRect(c[0] - 4, c[1] - 5, 8, 1.4); g.fillRect(c[0] - 4, c[1] - 2, 8, 1.4); g.fillRect(c[0] - 4, c[1] + 1, 5, 1.4); }
    void hov;
  });
  reg('inbox', 'Inbox tray: approvals', [158, 70, 34, 26, 16, 6], inboxItem); });
  put('inbox', 'inbox', 158, 70);
  def('tiro-chair', [225, 26], () => add(26, g => { // Tiro's leather chair behind the desk
    gell(g, 225, 26, 0, 17, 'rgba(10,5,20,.25)'); cyl(g, 225, 26, 0, 2.4, 11, '#2b2b36'); cyl(g, 225, 26, 11, 15, 6, '#6e2f2a'); box(g, 213, 12, 14, 24, 4, 34, '#5a2420'); box(g, 211, 12, 40, 28, 4, 6, '#6e2f2a');
  }, { nofp: true }), { spots: [{ id: 'tiro:seat', dx: 0, dy: 4, face: 's', zone: 'office', seat: true, desk: true }] });
  put('tiro-chair', 'tiro-chair', 225, 26);
  def('guest-chair', [170, 152], (p, x, y) => add(x + y, g => chair(g, x, y, '#4a5a7a', { noBack: false, h: 18 })));
  [[170, 152], [284, 152]].forEach(([x, y], i) => put('guest-chair-' + (i + 1), 'guest-chair', x, y));
  def('trophy-shelf', [20, 0], () => add(120, g => { // trophy shelf on the back wall, fills as goals finish
    const n = Math.min(6, ST.board.done);
    box(g, 20, 0, 0, 96, 12, 20, '#5e3a1e'); box(g, 20, 0, 70, 96, 12, 3, '#7d5230'); box(g, 20, 0, 40, 96, 12, 3, '#7d5230');
    Fy(g, 12, 73, () => { g.translate(20, 0); for (let i = 0; i < 6; i++) { const x = 8 + i * 15, y = 24; if (i < n) { g.fillStyle = '#ffd23f'; g.fillRect(x, y - 14, 8, 9); g.fillRect(x + 2.5, y - 5, 3, 4); g.fillRect(x - 1, y - 1, 10, 2); g.fillStyle = '#fff3a0'; g.fillRect(x + 1, y - 13, 2, 5); } else { g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(x, y - 9, 8, 8); } } g.fillStyle = '#d9d2c3'; g.fillRect(0, 36, 96, 1); g.fillStyle = '#2b2b36'; g.fillRect(24, 48, 48, 20); txt(g, 'GOALS DONE', 48, 56, 6, '#ffd23f', 'center'); txt(g, String(ST.board.done), 48, 66, 9, '#5ef0a0', 'center'); });
  }));
  put('trophy-shelf', 'trophy-shelf', 20, 0);
  // potted plant; p.s = scale, p.dd = depth tweak against x + y (each copy was hand-tuned)
  def('plant', [445, 38], (p, x, y) => add(x + y + (p.dd || 0), g => plant(g, x, y, p.s)));
  put('plant-1', 'plant', 445, 38, { s: 1.15, dd: -13 });
  def('side-table', [22, 190], () => add(150, g => { // window seat cushion area: a small side table with a cup near the window
    cyl(g, 22, 190, 0, 9, 22, '#7a5230'); mug(g, 22, 190, 22, '#ffcf6b', true);
  }));
  put('side-table', 'side-table', 22, 190);

  // glass walls round the manager's office: east wall (x=470) and south wall (y=230) with a door gap
  function glassX(g, x, y0, y1) { // plane x=const, between y0..y1
    const h = 100; poly(g, [P(x, y0, h), P(x, y1, h), P(x, y1, 0), P(x, y0, 0)], 'rgba(170,215,240,.16)', 'rgba(210,235,250,.55)', 1);
    poly(g, [P(x, y0, 56), P(x, y1, 56), P(x, y1, 46), P(x, y0, 46)], 'rgba(255,255,255,.14)', null);
    poly(g, [P(x, y0, h), P(x, y1, h), P(x, y1, h - 5), P(x, y0, h - 5)], '#b9c0cc', null); poly(g, [P(x, y0, 5), P(x, y1, 5), P(x, y1, 0), P(x, y0, 0)], '#8a909c', null);
    for (let y = y0; y <= y1 + .1; y += 60) poly(g, [P(x, y - 1.5, h), P(x, y + 1.5, h), P(x, y + 1.5, 0), P(x, y - 1.5, 0)], '#a9b0bc', null);
  }
  function glassY(g, y, x0, x1) {
    const h = 100; poly(g, [P(x0, y, h), P(x1, y, h), P(x1, y, 0), P(x0, y, 0)], 'rgba(170,215,240,.16)', 'rgba(210,235,250,.55)', 1);
    poly(g, [P(x0, y, 56), P(x1, y, 56), P(x1, y, 46), P(x0, y, 46)], 'rgba(255,255,255,.14)', null);
    poly(g, [P(x0, y, h), P(x1, y, h), P(x1, y, h - 5), P(x0, y, h - 5)], '#b9c0cc', null); poly(g, [P(x0, y, 5), P(x1, y, 5), P(x1, y, 0), P(x0, y, 0)], '#8a909c', null);
    for (let x = x0; x <= x1 + .1; x += 60) poly(g, [P(x - 1.5, y, h), P(x + 1.5, y, h), P(x + 1.5, y, 0), P(x - 1.5, y, 0)], '#a9b0bc', null);
  }
  def('glass-x', [470, 0], (p, x, y) => add(x + y + 23, g => glassX(g, x, y, Math.min(230, y + 46)), { fp: [x - 2, y, x + 2, Math.min(230, y + 46)] }));
  for (let y = 0; y < 230; y += 46) put('glass-x-' + (y / 46 + 1), 'glass-x', 470, y);
  def('glass-y', [0, 230], (p, a, y) => { const b = a + p.w; add((a + b) / 2 + y + 2, g => glassY(g, y, a, b), { fp: [a, y - 2, b, y + 2] }); }); // p.w = pane length
  [[0, 130], [130, 260], [260, 395]].forEach(([a, b], i) => put('glass-y-' + (i + 1), 'glass-y', a, 230, { w: b - a }));
  def('office-door', [420, 230], () => { // the short pane east of the door, then the door itself
  add(445 + 230 + 2, g => glassY(g, 230, 445, 470), { fp: [445, 228, 470, 232] });
  add(420 + 230 + 4, g => { // door frame + open door leaf + sign
    const h = 100; [395, 445].forEach(x => { poly(g, [P(x - 3, 230, h), P(x + 3, 230, h), P(x + 3, 230, 0), P(x - 3, 230, 0)], '#8a909c', null); });
    poly(g, [P(395, 230, h + 8), P(445, 230, h + 8), P(445, 230, h), P(395, 230, h)], '#b9c0cc', null);
    Fy(g, 230, h + 24, () => { g.translate(395, 0); g.fillStyle = '#2a2030'; g.fillRect(0, 0, 50, 15); g.strokeStyle = '#ffcf6b'; g.strokeRect(.5, .5, 49, 14); txt(g, "TIRO'S OFFICE", 25, 10.5, 6.4, '#ffcf6b', 'center'); });
    poly(g, [P(445, 230, h), P(445, 230, 0), P(445, 262, 0), P(445, 262, h - 12)], 'rgba(200,225,240,.22)', 'rgba(210,235,250,.6)', 1);
    Fg(g, .5, () => { g.fillStyle = '#8f3b2e'; g.fillRect(398, 228, 44, 8); g.fillStyle = '#d6b13a'; g.fillRect(398, 232, 44, 1.6); });
  }); });
  put('office-door', 'office-door', 420, 230);

  // ---------- focus area furniture: pendant lights ----------
  const pendants = [[270, 330], [500, 330], [730, 330], [385, 470], [615, 470], [845, 470], [155, 330], [970, 330]];
  walls.push(g => { }); // reserved

  // ---------- garden ----------
  def('pond', [790, 105], () => add(790 + 105 + 2, g => { // pond with koi and lily pads
    const c = P(790, 105, 0); g.fillStyle = '#9a8f7a'; g.beginPath(); g.ellipse(c[0], c[1], 58, 29, 0, 0, 6.2832); g.fill();
    g.fillStyle = '#7a705f'; g.beginPath(); g.ellipse(c[0], c[1] + 1, 54, 27, 0, 0, 6.2832); g.fill();
    const gr = g.createRadialGradient(c[0] - 12, c[1] - 6, 3, c[0], c[1], 52); gr.addColorStop(0, '#6ec2e6'); gr.addColorStop(1, '#2f7aa8'); g.fillStyle = gr; g.beginPath(); g.ellipse(c[0], c[1], 49, 24.5, 0, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { const r = 8 + ((ST.T * 6 + i * 11) % 30); g.globalAlpha = Math.max(0, 1 - r / 38) * .8; g.beginPath(); g.ellipse(c[0] + 14, c[1] + 4, r, r / 2, 0, 0, 6.2832); g.stroke(); } g.globalAlpha = 1;
    [['#ff9a4a', 0, 1], ['#fff', 2.4, -1.2], ['#ff6a5a', 4.4, .8]].forEach(([col, ph, sp], i) => { const a = ST.T * .5 * sp + ph, kx = c[0] + Math.cos(a) * (28 - i * 4), ky = c[1] + Math.sin(a) * (14 - i * 2); g.save(); g.translate(kx, ky); g.rotate(a + (sp > 0 ? Math.PI / 2 : -Math.PI / 2)); g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, 6, 2.4, 0, 0, 6.2832); g.fill(); g.beginPath(); g.moveTo(-5, 0); g.lineTo(-9, -2.4); g.lineTo(-9, 2.4); g.fill(); g.restore(); });
    [[-22, 6], [18, -10], [26, 8]].forEach(([dx, dy]) => { g.fillStyle = '#3d8a4a'; g.beginPath(); g.ellipse(c[0] + dx, c[1] + dy, 7, 3.4, 0, 0, 6.2832); g.fill(); g.fillStyle = '#ffb3d1'; g.beginPath(); g.arc(c[0] + dx + 1, c[1] + dy - 1, 1.8, 0, 6.2832); g.fill(); });
  }, { floor: true }), { walkable: true }); // flat water: always under the walkers
  put('pond', 'pond', 790, 105);
  def('bench', [700, 24], (p, x, y) => add(x + y, g => bench(g, x, y, 56)), { spots: [{ id: p => p.spot, dx: 0, dy: 0, face: 's', zone: 'garden', seat: true }] }); // p.spot = its seat id
  put('bench-1', 'bench', 700, 24, { spot: 'garden:b1' });
  put('bench-2', 'bench', 860, 24, { spot: 'garden:b2' });
  def('bench-side', [585, 118], () => add(585 + 118, g => { // bench facing the pond, seen from its side
    box(g, 578, 90, 0, 14, 5, 12, COL.dwood); box(g, 578, 142, 0, 14, 5, 12, COL.dwood); box(g, 578, 90, 12, 14, 57, 3, '#b98a57'); box(g, 575, 90, 15, 3, 57, 16, '#a5764a');
  }), { spots: [{ id: 'garden:b3', dx: 0, dy: 0, face: 'e', zone: 'garden', seat: true }] });
  put('bench-side', 'bench-side', 585, 118);
  // tree; p.s = scale, p.dd = depth tweak against x + y + 4
  def('tree', [560, 36], (p, x, y) => add(x + y + 4 + (p.dd || 0), g => tree(g, x, y, p.s)));
  put('tree-1', 'tree', 560, 36, { s: 1.05 }); put('tree-2', 'tree', 950, 44, { s: 1.2, dd: -4 });
  def('server-plant', [945, 196], () => { const plantItem = add(940 + 190, g => plant(g, 945, 196, 1.1 + Math.min(6, ST.ex.plantLevel || 0) * .07));
    reg('plant', 'Server plant', [938, 190, 0, 14, 14, 70], plantItem); });
  put('server-plant', 'server-plant', 945, 196);
  def('bird-feeder', [930, 100], () => add(930 + 100, g => { // bird feeder on a pole
    cyl(g, 930, 100, 0, 1.8, 52, '#5a3d25'); box(g, 922, 92, 52, 16, 16, 10, '#a65f2c'); poly(g, [P(920, 90, 62), P(940, 90, 62), P(930, 99, 74)], '#7a3b1c', null); poly(g, [P(920, 90, 62), P(920, 110, 62), P(930, 99, 74)], '#6a321a', null);
    const c = P(930, 99, 80); g.fillStyle = '#e0573f'; g.beginPath(); g.ellipse(c[0] + 8 + Math.sin(ST.T) * 1, c[1] - 6, 3, 2, 0, 0, 6.2832); g.fill();
  }));
  put('bird-feeder', 'bird-feeder', 930, 100);
  // lantern string lights along the right wall
  fixture('string-lights', () => add(10, g => { const n = 11; g.strokeStyle = '#2b2b36'; g.lineWidth = 1; g.beginPath(); for (let i = 0; i <= 60; i++) { const x = 490 + i * 8.5, z = 118 - Math.sin(i / 60 * Math.PI * 4) ** 2 * 0 - 8 * Math.sin((i / 15) * Math.PI) ** 2 * 1 - 4; const p = P(x, 3, z); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke();
    for (let i = 0; i < n * 3; i++) { const x = 500 + i * (480 / (n * 3 - 1)), z = 118 - 8 * Math.sin((((x - 490) / 8.5) / 15) * Math.PI) ** 2 - 8, p = P(x, 3, z - 4); const on = ST.night > .1 || ST.dim > .3 || true; g.fillStyle = ['#ffd36b', '#ffb3d1', '#9de4e8', '#c9f0a0'][i % 4]; g.beginPath(); g.arc(p[0], p[1] + 2, 2.6, 0, 6.2832); g.fill(); if (on) { const gr = g.createRadialGradient(p[0], p[1] + 2, 1, p[0], p[1] + 2, 12); gr.addColorStop(0, 'rgba(255,225,150,' + (.25 + .35 * ST.night) + ')'); gr.addColorStop(1, 'rgba(255,225,150,0)'); g.fillStyle = gr; g.fillRect(p[0] - 12, p[1] - 10, 24, 24); } } }));
  // hedge along the garden's south edge (gate at x=500)
  def('hedge', [545, 222], (p, x) => add(x + 18 + 224, g => { box(g, x, 222, 0, 34, 7, 16, '#2f6a34', { t: '#3f8a44' }); [0, 1, 2].forEach(i => { const c = P(x + 6 + i * 11, 225, 18); g.fillStyle = '#3f8a44'; g.beginPath(); g.arc(c[0], c[1], 6, 0, 6.2832); g.fill(); }); }));
  for (let x = 545; x < 1000; x += 36) put('hedge-' + ((x - 545) / 36 + 1), 'hedge', x, 222);

  // ---------- playroom ----------
  def('arcade', [880, 600], () => { const arcadeItem = add(897 + 612 + 2, g => arcade(g, 880, 600, true, 'BUGS', '#ff6a6a'));
    reg('arcade', 'Arcade: Bug Squasher', [880, 600, 0, 34, 28, 82], arcadeItem); }, { spots: [{ id: 'play:arcade1', dx: 54, dy: 18, face: 'w', zone: 'play', game: true }] });
  put('arcade', 'arcade', 880, 600);
  def('arcade-race', [820, 600], () => add(837 + 612 + 2, g => arcade(g, 820, 600, false, 'RACE', '#3dd6ff')), { spots: [{ id: 'play:arcade2', dx: 30, dy: 54, face: 'n', zone: 'play', game: true }] });
  put('arcade-race', 'arcade-race', 820, 600);
  function arcade(g, x, y, live, name, col) {
    box(g, x, y, 0, 34, 28, 82, '#2a1f4a', { t: '#3a2c66', l: '#2a1f4a', r: '#1c1533' }); box(g, x + 3, y + 22, 40, 28, 7, 4, '#3a2a6a');
    Fy(g, y + 28, 82, () => { g.translate(x, 0); g.fillStyle = col; g.fillRect(3, 2, 28, 9); txt(g, name, 17, 9.2, 7, '#1b1220', 'center'); g.fillStyle = '#0d1a10'; g.fillRect(4, 14, 26, 22); g.strokeStyle = '#3dff8f'; g.strokeRect(4.5, 14.5, 25, 21);
      if (live) { const t = ST.T; g.fillStyle = '#ff6a6a'; g.fillRect(8 + (t * 20 % 18), 20 + Math.sin(t * 3) * 3, 4, 4); g.fillStyle = '#3dff8f'; g.fillRect(24 - (t * 14 % 16), 28, 3, 3); g.fillStyle = '#ffd23f'; g.fillRect(16, 30, 2, 2); } else { g.fillStyle = '#7cc4ff'; g.fillRect(6, 30, 22, 2); g.fillRect(10, 24, 4, 4); }
      g.fillStyle = '#3a2a6a'; g.fillRect(3, 40, 28, 13); g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(10, 47, 2.4, 0, 6.2832); g.fill(); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(18, 47, 2.4, 0, 6.2832); g.fill(); g.fillStyle = '#3dd6ff'; g.beginPath(); g.arc(25, 47, 2.4, 0, 6.2832); g.fill(); });
    const c = P(x + 17, y + 34, 50); const gr = g.createRadialGradient(c[0], c[1], 3, c[0], c[1], 38); gr.addColorStop(0, alpha(col, .22)); gr.addColorStop(1, alpha(col, 0)); g.fillStyle = gr; g.fillRect(c[0] - 40, c[1] - 30, 80, 70);
  }
  def('jukebox', [520, 598], () => { const jukeItem = add(538 + 608, g => { // jukebox
    const x = 520, y = 598, play = !!ST.ex.music;
    box(g, x, y, 0, 38, 22, 52, '#7a3a1c', { t: '#9a4a24' }); cyl(g, x + 19, y + 11, 52, 19, 14, '#7a3a1c');
    Fy(g, y + 22, 54, () => { g.translate(x, 0); g.fillStyle = '#3b1a0a'; g.fillRect(4, 8, 30, 38); g.fillStyle = play ? '#ffb547' : '#a8742a'; g.fillRect(6, 10, 26, 24); for (let i = 0; i < 5; i++) { g.fillStyle = '#ffd36b'; const hh = play ? 4 + Math.abs(Math.sin(ST.T * 6 + i * 1.3)) * 12 : 4; g.fillRect(8 + i * 5, 34 - hh, 3.4, hh); } g.fillStyle = '#ffd36b'; g.fillRect(8, 38, 22, 3); });
    if (play) [0, 1].forEach(i => { const q = (ST.T * .6 + i * .5) % 1, c = P(x + 28 + i * 6, y, 60 + q * 34); g.globalAlpha = 1 - q; g.fillStyle = '#ffd36b'; g.font = '13px sans-serif'; g.fillText(i ? '♫' : '♪', c[0], c[1]); g.globalAlpha = 1; });
  });
  reg('jukebox', 'Jukebox', [520, 598, 0, 38, 22, 62], jukeItem); }, { spots: [{ id: 'play:juke', dx: 25, dy: 42, face: 'n', zone: 'play' }] });
  put('jukebox', 'jukebox', 520, 598);
  def('sofa3', [598, 598], () => add(686 + 610, g => { // three-seat sofa facing +y
    const x = 598, y = 598, w = 176, col = '#c0627a';
    box(g, x, y, 0, w, 10, 44, sh(col, .85)); box(g, x - 4, y, 0, 10, 42, 26, sh(col, .75)); box(g, x + w - 6, y, 0, 10, 42, 26, sh(col, .75));
    box(g, x + 6, y + 8, 0, w - 12, 34, 16, col); [0, 1, 2].forEach(i => box(g, x + 8 + i * 55, y + 10, 16, 53, 30, 8, sh(col, 1.08), { st: 'rgba(60,10,30,.45)' }));
    [0, 1, 2].forEach(i => box(g, x + 8 + i * 55, y + 6, 24, 53, 6, 18, sh(col, .98)));
  }), { spots: [30, 88, 146].map((dx, i) => ({ id: 'play:sofa' + (i + 1), dx, dy: 18, face: 's', zone: 'play', seat: true })) });
  put('sofa3', 'sofa3', 598, 598);
  def('snack-table', [624, 672], () => add(660 + 690, g => { // low table with snacks
    box(g, 628, 676, 0, 3, 3, 14, '#3a2a18'); box(g, 680, 676, 0, 3, 3, 14, '#3a2a18'); box(g, 628, 700, 0, 3, 3, 14, '#3a2a18'); box(g, 680, 700, 0, 3, 3, 14, '#3a2a18');
    box(g, 624, 672, 14, 62, 34, 4, '#b98a57'); cyl(g, 640, 686, 18, 8, 3, '#e8e4dc'); [['#ffd23f', 0], ['#ff7aa8', 4], ['#7cf29a', 8]].forEach(([c, d]) => { cyl(g, 637 + d, 685 + d / 2, 21, 2.2, 3, c, { stroke: false }); });
    box(g, 662, 684, 18, 18, 14, 3, '#d35a4a'); box(g, 663, 685, 21, 16, 12, 1.4, '#f3d9a0'); cyl(g, 712 - 20, 700, 18, 3, 6, '#3dd6ff');
  }), { spots: [{ id: 'play:table', dx: 81, dy: 18, face: 'w', zone: 'play' }] });
  put('snack-table', 'snack-table', 624, 672);
  function bean(g, x, y, col) { gell(g, x, y, 0, 26, 'rgba(10,5,20,.25)'); const c = P(x, y, 0); g.fillStyle = sh(col, .72); g.beginPath(); g.ellipse(c[0], c[1] - 4, 25, 15, 0, 0, 6.2832); g.fill(); g.fillStyle = col; g.beginPath(); g.ellipse(c[0] - 1, c[1] - 11, 22, 13, 0, 0, 6.2832); g.fill(); g.fillStyle = sh(col, 1.25); g.beginPath(); g.ellipse(c[0] - 5, c[1] - 14, 9, 4, -.2, 0, 6.2832); g.fill(); }
  def('beanbag', [775, 715], (p, x, y) => add(x + y, g => bean(g, x, y, p.col)), { spots: [{ id: p => p.spot, dx: 0, dy: 0, face: 's', zone: 'play', seat: true }] }); // p.col colour, p.spot seat id
  put('beanbag-1', 'beanbag', 775, 715, { col: '#3dd6e8', spot: 'play:bean1' }); put('beanbag-2', 'beanbag', 850, 748, { col: '#ffb547', spot: 'play:bean2' });
  def('ball-pit', [935, 725], () => add(935 + 725 - 12, g => { // ball pit
    const c = P(935, 725, 0); g.fillStyle = '#2a5a8a'; g.beginPath(); g.ellipse(c[0], c[1], 48, 24, 0, 0, 6.2832); g.fill();
    const q = rnd(9); for (let i = 0; i < 60; i++) { const a = q() * 6.2832, r = Math.sqrt(q()) * 38; g.fillStyle = ['#ff6b8a', '#ffd23f', '#3dd6ff', '#7cf29a', '#c9b0f0', '#ff9a4a'][i % 6]; g.beginPath(); g.arc(c[0] + Math.cos(a) * r, c[1] - 3 + Math.sin(a) * r / 2, 4.4, 0, 6.2832); g.fill(); }
    cyl(g, 935, 725, 0, 49, 0.1, '#2a5a8a', { stroke: false }); g.strokeStyle = '#1f4a78'; g.lineWidth = 6; g.beginPath(); g.ellipse(c[0], c[1] - 6, 48, 24, 0, 0, 6.2832); g.stroke(); g.strokeStyle = '#3a7ab8'; g.lineWidth = 2; g.beginPath(); g.ellipse(c[0], c[1] - 9, 48, 24, 0, 0, 6.2832); g.stroke();
  }), { walkable: true, spots: [{ id: 'play:pit', dx: 0, dy: 0, face: 's', zone: 'play', seat: true }] });
  put('ball-pit', 'ball-pit', 935, 725);
  def('hoop', [520, 748], () => add(528 + 735, g => { // basketball hoop
    cyl(g, 520, 748, 0, 8, 3, '#3a3a44'); cyl(g, 520, 748, 3, 2, 76, '#8a909c'); box(g, 516, 734, 76, 3, 28, 30, '#f3ede2'); Fx(g, 519, 762, 106, () => { g.strokeStyle = '#d35a4a'; g.lineWidth = 1.4; g.strokeRect(8, 8, 12, 10); });
    const r = P(530, 748, 82); g.strokeStyle = '#ff7a2a'; g.lineWidth = 2; g.beginPath(); g.ellipse(r[0], r[1], 8, 4, 0, 0, 6.2832); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = .8; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(r[0] + i * 3.5, r[1]); g.lineTo(r[0] + i * 1.8, r[1] + 11); g.stroke(); }
    ball(g, 548, 760, 0, 5, '#ff8a2a');
  }), { spots: [{ id: 'play:hoop', dx: 48, dy: -13, face: 'w', zone: 'play', game: true }] });
  put('hoop', 'hoop', 520, 748);
  def('dartboard', [512, 676], () => add(512 + 686, g => { // dartboard on a stand
    box(g, 512, 676, 0, 3, 3, 52, '#3a2a18'); box(g, 505, 672, 0, 17, 11, 3, '#3a2a18'); Fx(g, 515, 688, 68, () => { g.fillStyle = '#1b1220'; g.beginPath(); g.arc(14, 14, 14, 0, 6.2832); g.fill(); [[12, '#d35a4a'], [8, '#f3ede2'], [4, '#2f9f68'], [1.6, '#d35a4a']].forEach(([r, c]) => { g.fillStyle = c; g.beginPath(); g.arc(14, 14, r, 0, 6.2832); g.fill(); }); g.fillStyle = '#7cc4ff'; g.fillRect(20, 10, 1.6, 6); });
  }), { spots: [{ id: 'play:dart', dx: 48, dy: 14, face: 'w', zone: 'play', game: true }] });
  put('dartboard', 'dartboard', 512, 676);
  def('toy-bin', [495, 650], () => add(512 + 668, g => { // toy bin
    box(g, 495, 650, 0, 30, 24, 20, '#ff8a4a', { t: '#ffa86a' }); Fy(g, 674, 20, () => { g.translate(495, 0); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(2, 8, 26, 2); });
    ball(g, 505, 660, 20, 5, '#3dd6ff'); box(g, 512, 664, 20, 6, 6, 6, '#ffd23f'); ball(g, 517, 656, 20, 4, '#7cf29a');
  }), { spots: [{ id: 'play:toy', dx: 50, dy: 18, face: 's', zone: 'play' }] });
  put('toy-bin', 'toy-bin', 495, 650);
  put('plant-2', 'plant', 976, 604, { s: 1.2, dd: -5 }); put('plant-3', 'plant', 486, 768, { s: 1, dd: 4 });
  // pennant string over the playroom
  fixture('pennants', () => add(10, g => { const a = P(480, 560, 108), b = P(990, 560, 108); g.strokeStyle = '#2b2b36'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 26, b[0], b[1]); g.stroke(); for (let i = 1; i < 16; i++) { const t = i / 16, x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * ((a[0] + b[0]) / 2) + t * t * b[0], y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * ((a[1] + b[1]) / 2 + 26) + t * t * b[1]; g.fillStyle = ['#ff6b8a', '#ffd23f', '#3dd6ff', '#7cf29a', '#c9b0f0'][i % 5]; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.lineTo(x, y + 9); g.fill(); } }));

  // ---------- utility strip ----------
  def('filing-cabinet', [4, 596], () => { const sopItem = add(26 + 620, g => { // filing cabinet: SOPs
    box(g, 4, 596, 0, 46, 48, 72, '#8a909c', { t: '#a9afba', l: '#8a909c', r: '#6b717d' });
    Fx(g, 50, 644, 72, () => { for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#7d838f' : '#848a96'; g.fillRect(2, 2 + i * 23, 44, 21); g.fillStyle = '#d9d2c3'; g.fillRect(14, 6 + i * 23, 20, 7); g.fillStyle = '#2b2b36'; g.fillRect(18, 16 + i * 23, 12, 2.4); txt(g, 'SOP', 24, 12 + i * 23, 5, '#3a3a44', 'center'); } });
  });
  reg('sops', 'Filing cabinet: SOPs', [4, 596, 0, 46, 48, 72], sopItem); });
  put('filing-cabinet', 'filing-cabinet', 4, 596);
  def('server-rack', [4, 650], () => { const rackItem = add(26 + 668, g => { // server rack (existing)
    box(g, 4, 650, 0, 40, 38, 108, '#2b2f3a'); const ledc = (ST.ex.rack || {}).led === 'red' ? '#ff5a4a' : (ST.ex.rack || {}).led === 'amber' ? '#ffb547' : '#5ef0a0';
    Fx(g, 44, 688, 108, () => { for (let i = 0; i < 7; i++) { g.fillStyle = '#1c1f28'; g.fillRect(2, 3 + i * 14.5, 34, 12.5); g.fillStyle = '#3a4050'; g.fillRect(3, 4 + i * 14.5, 18, 1); for (let k = 0; k < 4; k++) { const f = Math.sin(ST.T * (3 + k * 1.7) + i * 2.1) > -.3; g.fillStyle = f ? (k % 3 === 0 ? ledc : k % 3 === 1 ? '#7cc4ff' : '#ffb547') : '#2a2f3a'; g.fillRect(22 + k * 3.6, 6 + i * 14.5, 2, 2); } } g.fillStyle = '#d9d2c3'; g.fillRect(4, 104, 30, 3); });
  });
  reg('rack', 'Server rack', [4, 650, 0, 40, 38, 108], rackItem); });
  put('server-rack', 'server-rack', 4, 650);
  def('bookshelf', [4, 696], () => { const shelfItem = add(26 + 740, g => { // bookshelf: reports
    box(g, 4, 696, 0, 38, 80, 128, '#6b4220'); Fx(g, 42, 776, 128, () => { g.fillStyle = '#3a2412'; g.fillRect(2, 2, 76, 124); const q = rnd(77); for (let row = 0; row < 5; row++) { g.fillStyle = '#5a3a1c'; g.fillRect(2, 24 + row * 25, 76, 2.5); let x = 4; while (x < 76) { const w = 3 + q() * 4, h = 14 + q() * 8; g.fillStyle = ['#8f3b2e', '#3f6b4a', '#c99a3c', '#2f4a72', '#6b3a5a', '#d8cdb5', '#3fb0b8'][(q() * 7) | 0]; g.fillRect(x, 24 + row * 25 - h, w, h); x += w + .5; } } txt(g, 'REPORTS ' + (ST.ex.reportsN || 0), 40, 122, 6.5, '#ffdca0', 'center'); });
  });
  reg('reports', 'Bookshelf: reports', [4, 696, 0, 38, 80, 128], shelfItem); });
  put('bookshelf', 'bookshelf', 4, 696);
  const cork = g => { // corkboard (memory) and breaker box on the left wall
    const n = ST.ex.memoryN || 0;
    Fx(g, 0, 700, 128, () => { g.translate(0, 0); const yy = 700 - 100; void yy; });
    Fx(g, 0, 690, 118, () => { g.translate(8, 0); g.fillStyle = '#5a3a1c'; g.fillRect(-3, -3, 76, 62); g.fillStyle = '#a4744a'; g.fillRect(0, 0, 70, 56); const q = rnd(13); for (let i = 0; i < 6; i++) { g.fillStyle = ['#fdf3dc', '#fff7d6', '#f2e6c8', '#ffd0e0'][i % 4]; g.fillRect(5 + (i % 3) * 22 + q() * 3, 5 + Math.floor(i / 3) * 24, 16, 18); g.fillStyle = ['#e04a3a', '#3a8ae0', '#3ae07a', '#e0c43a'][i % 4]; g.beginPath(); g.arc(13 + (i % 3) * 22, 7 + Math.floor(i / 3) * 24, 1.8, 0, 6.2832); g.fill(); } g.strokeStyle = '#b3261e'; g.lineWidth = .8; g.beginPath(); g.moveTo(13, 7); g.lineTo(35, 31); g.lineTo(57, 7); g.stroke(); txt(g, n + ' notes', 35, 54, 6, '#3a2a1a', 'center'); });
    const sw = ST.ex.switches || {}, on = ['kiro', 'autopilot', 'hiring', 'bridge', 'guard', 'espresso'].map(k => k === 'espresso' ? !!sw.espresso : sw[k] !== false);
    Fx(g, 0, 598, 112, () => { g.translate(0, 0); g.fillStyle = '#3b3f45'; g.fillRect(-2, -2, 38, 52); g.fillStyle = '#8a9099'; g.fillRect(0, 0, 34, 48); g.fillStyle = '#5e646c'; g.fillRect(3, 3, 28, 42); on.forEach((v, i) => { const x = 6 + (i % 3) * 8, y = 7 + Math.floor(i / 3) * 18; g.fillStyle = '#2b2b33'; g.fillRect(x, y, 5, 13); g.fillStyle = v ? '#5fd38d' : '#e0573f'; g.fillRect(x - 1, y + (v ? 0 : 7), 7, 6); }); });
  };
  walls.push(cork);
  fixture('corkboard', () => {
    reg('memory', 'Corkboard: memory notes', [0, 600, 78, 4, 92, 56], cork, { clip: true });
    reg('breaker', 'Breaker box: switches', [0, 560, 62, 4, 38, 52], cork, { clip: true });
  });
  // Karinderya (phase 6): a cosy wood-panelled eatery. Two back walls with planks, shelves and a sunny window, checkered
  // tiles, a brick pugon, a turo-turo counter (the cook stands behind it at npc:cook), a long table with three chairs and
  // a bangko (the six kain:* seats), fridge, plant, lamp, rug and a cat. Not in the default office (it needs about
  // 230 x 190 of clear floor, e.g. the east park); added from Build. Agents at their plan limit eat here instead of
  // standing at the water cooler. Each part is its own painter so people inside sort correctly against walls and table.
  const KX = 1010, KY = 370, KW = 220, KD = 180;
  const KWOOD = '#8b4a2b', KPLANK = '#6e3a21', KTRIM = '#b0683a', KTILE = ['#ecc49a', '#d9a273'];
  const KSEATS = [80, 120, 160].map(dx => ({ dx, dy: 78, face: 's' })).concat([84, 120, 156].map(dx => ({ dx, dy: 120, face: 'n' })));
  const plates = (g, list) => list.forEach(([c, u, v]) => { g.fillStyle = c; if (c === '#f3ede2') { g.beginPath(); g.arc(u + 2, v + 4, 3.4, 0, 6.2832); g.fill(); } else { g.fillRect(u, v, 6, 8); g.fillStyle = '#5a2e19'; g.fillRect(u, v - 1, 6, 1.5); } });
  def('karinderya', [KX, KY], () => {
    add(0, g => { // checkered tile floor, warm window light and a rug
      Fg(g, .3, () => { for (let i = 0; i < KW / 10; i++) for (let j = 0; j < KD / 10; j++) { g.fillStyle = KTILE[(i + j) & 1]; g.fillRect(KX + i * 10, KY + j * 10, 10, 10); } });
      flat(g, KX + 4, KY + 66, 54, 40, 'rgba(255,214,140,.3)', .6);
      flat(g, KX + 96, KY + 140, 46, 20, '#a8452f', .7); flat(g, KX + 99, KY + 142, 40, 16, '#c86a45', .8); flat(g, KX + 106, KY + 148, 26, 4, '#e8b07a', .9);
    }, { floor: true });
    add(KX + KY + KW / 2, g => { // back wall (along x): planks, sign, shelves with plates, jars and a plant
      box(g, KX, KY - 4, 0, KW, 4, 70, KWOOD, { t: KTRIM });
      Fy(g, KY, 70, () => { g.translate(KX, 0);
        g.fillStyle = KPLANK; for (let u = 6; u < KW; u += 9) g.fillRect(u, 0, 1, 70);
        g.fillStyle = '#5a2e19'; g.fillRect(0, 67, KW, 3);
        g.fillStyle = '#b3261e'; g.fillRect(60, 4, 112, 12); g.fillStyle = '#f1c40f'; g.fillRect(60, 16, 112, 1.5); txt(g, 'KARINDERYA', 116, 13.5, 10, '#fff3c4', 'center');
        g.fillStyle = '#5a2e19'; g.fillRect(64, 34, 104, 2); g.fillRect(184, 26, 30, 2); g.fillRect(184, 44, 30, 2);
        plates(g, [['#f3ede2', 68, 26], ['#f3ede2', 75, 26], ['#7fb8d8', 88, 26], ['#e3b23c', 98, 26], ['#c0392b', 108, 26], ['#f3ede2', 124, 26], ['#9cc06a', 136, 26], ['#f3ede2', 150, 26], ['#f3ede2', 157, 26], ['#7fb8d8', 188, 18], ['#f3ede2', 200, 18], ['#e3b23c', 190, 36], ['#c0392b', 202, 36]]);
        g.fillStyle = '#7a3b1c'; g.fillRect(14, 30, 10, 7); g.fillStyle = '#3e7d55'; g.beginPath(); g.arc(16, 29, 5, 0, 6.2832); g.arc(23, 27, 4, 0, 6.2832); g.fill(); g.fillStyle = '#5aa86e'; g.fillRect(12, 36, 2, 8); g.fillRect(24, 36, 2, 10);
      });
    });
    add(KX + KY + KD / 2, g => { // left wall (along y): planks, sunny window, calendar
      box(g, KX - 4, KY - 4, 0, 4, KD + 4, 70, KWOOD, { t: KTRIM });
      Fx(g, KX, KY + KD, 70, () => {
        g.fillStyle = KPLANK; for (let u = 6; u < KD; u += 9) g.fillRect(u, 0, 1, 70);
        g.fillStyle = '#5a2e19'; g.fillRect(0, 67, KD, 3);
        g.fillStyle = '#4a2614'; g.fillRect(74, 12, 36, 34); g.fillStyle = '#ffd58a'; g.fillRect(77, 15, 30, 28); g.fillStyle = '#fff1c9'; g.fillRect(77, 15, 14, 13);
        g.fillStyle = '#4a2614'; g.fillRect(91, 15, 2, 28); g.fillRect(77, 28, 30, 2); g.fillStyle = '#b0683a'; g.fillRect(72, 45, 40, 3);
        g.fillStyle = '#f3ede2'; g.fillRect(132, 18, 12, 15); g.fillStyle = '#c0392b'; g.fillRect(132, 18, 12, 4); g.fillStyle = '#9aa'; for (let k = 0; k < 3; k++) g.fillRect(134, 24 + k * 3, 8, 1);
      });
    });
    add(KX + 16 + KY + 19, g => { // brick pugon with a fire, chimney up the corner
      box(g, KX + 4, KY + 4, 0, 24, 30, 46, '#a2492f'); box(g, KX + 8, KY + 10, 46, 14, 16, 40, '#9a4430');
      Fy(g, KY + 34, 46, () => { g.translate(KX + 4, 0); g.fillStyle = 'rgba(70,20,10,.45)'; for (let v = 6; v < 46; v += 6) { g.fillRect(0, v, 24, .8); for (let u = (v / 6) % 2 ? 4 : 0; u < 24; u += 8) g.fillRect(u, v - 6, .8, 6); }
        g.fillStyle = '#2a1410'; g.fillRect(5, 20, 14, 20); g.beginPath(); g.arc(12, 20, 7, Math.PI, 0); g.fill();
        const f = Math.sin(ST.T * 9) * 1.5; g.fillStyle = '#ff7a2a'; g.fillRect(7, 32 - f, 10, 8 + f); g.fillStyle = '#ffd23f'; g.fillRect(9, 35 - f, 6, 5 + f); });
    });
    add(KX + 116 + KY + 40, g => { // turo-turo counter: five trays of ulam under a glass guard, electric fan at the end
      box(g, KX + 56, KY + 30, 0, 120, 18, 30, '#9c5530', { t: '#d9b98a' });
      Fy(g, KY + 48, 30, () => { g.translate(KX + 56, 0); g.fillStyle = '#7a3e20'; for (let u = 4; u < 116; u += 28) g.fillRect(u, 5, 24, 21); g.fillStyle = '#b0683a'; for (let u = 4; u < 116; u += 28) g.fillRect(u + 10, 14, 4, 2); });
      [['#7a3b1c', '#5a2a12'], ['#e3b23c', '#c48a1c'], ['#9cc06a', '#d7c79a'], ['#c98d3a', '#8a5a2a'], ['#f6f1e3', '#ddd5c2']].forEach(([food, bit], i) => { // adobo, pancit, sinigang, lumpia, kanin
        const tx = KX + 60 + i * 23; flat(g, tx, KY + 33, 20, 12, '#b8bec8', 30.5, 'rgba(40,40,60,.45)'); flat(g, tx + 2, KY + 35, 16, 8, food, 31);
        for (let k = 0; k < 3; k++) { const c = P(tx + 4 + k * 5, KY + 37 + (k % 2) * 2, 32); g.fillStyle = bit; g.fillRect(c[0], c[1], 2, 1.5); } });
      poly(g, [P(KX + 58, KY + 32, 31), P(KX + 174, KY + 32, 31), P(KX + 174, KY + 32, 46), P(KX + 58, KY + 32, 46)], 'rgba(190,225,245,.16)', 'rgba(220,240,255,.45)', .6);
      cyl(g, KX + 188, KY + 36, 0, 2.5, 36, '#4a4f5c');
      const c = P(KX + 188, KY + 36, 42); g.fillStyle = 'rgba(200,215,230,.55)'; g.beginPath(); g.ellipse(c[0], c[1], 9, 9, 0, 0, 6.2832); g.fill();
      g.strokeStyle = '#3a8ae0'; g.lineWidth = 1.4; const a0 = ST.T * 14; for (let k = 0; k < 3; k++) { const a = a0 + k * 2.094; g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[0] + Math.cos(a) * 8, c[1] + Math.sin(a) * 8); g.stroke(); }
    });
    add(KX + 14 + KY + 131, g => { // fridge by the left wall
      box(g, KX + 4, KY + 120, 0, 20, 22, 52, '#ddd6c4'); Fy(g, KY + 142, 52, () => { g.translate(KX + 4, 0); g.fillStyle = '#b9b2a0'; g.fillRect(0, 19, 20, 1); g.fillStyle = '#8a8478'; g.fillRect(16, 8, 1.5, 7); g.fillRect(16, 25, 1.5, 11); g.fillStyle = '#e74c3c'; g.fillRect(4, 4, 4, 4); g.fillStyle = '#f1c40f'; g.fillRect(9, 6, 4, 3); });
    });
    add(KX + 120 + KY + 98, g => { // long table: rice pot, plates, pancit and adobo
      box(g, KX + 60, KY + 86, 0, 120, 24, 18, '#a85a2e', { t: '#c4743d' });
      Fg(g, 18.2, () => { g.fillStyle = 'rgba(90,40,15,.35)'; for (let u = KX + 70; u < KX + 180; u += 10) g.fillRect(u, KY + 86, .7, 24); });
      cyl(g, KX + 120, KY + 98, 18, 6, 7, '#5a5f6a', { top: '#f6f1e3' });
      KSEATS.forEach(st => gell(g, KX + st.dx, KY + (st.face === 's' ? 92 : 104), 18.5, 4.5, '#f3ede2'));
      gell(g, KX + 140, KY + 98, 19, 4.5, '#e3b23c'); gell(g, KX + 100, KY + 98, 19, 4, '#7a3b1c'); gell(g, KX + 160, KY + 99, 19, 3, '#c0392b');
    });
    KSEATS.filter(st => st.face === 's').forEach(st => add(KX + st.dx + KY + st.dy - 1, g => { // chairs on the far side (backs behind the sitter)
      const x = KX + st.dx, y = KY + st.dy; // z 1: chairs are not walking obstacles, so the seats stay reachable
      box(g, x - 6, y - 7, 1, 12, 2, 29, '#7a3e20'); box(g, x - 6, y - 5, 1, 12, 10, 11, '#9c5530', { t: '#b0683a' });
      Fy(g, y - 5, 30, () => { g.fillStyle = '#5a2e19'; g.fillRect(x - 4, 4, 1.5, 12); g.fillRect(x - .7, 4, 1.5, 12); g.fillRect(x + 2.5, 4, 1.5, 12); });
    }, { nofp: true }));
    add(KX + 84 + KY + 120 - 1, g => box(g, KX + 66, KY + 115, 0, 108, 9, 12, '#9c5530', { t: '#b8703c' }), { nofp: true }); // bangko (bench)
    add(KX + 204 + KY + 164, g => { // floor lamp with a warm glow
      cyl(g, KX + 204, KY + 164, 0, 4, 2, '#5a2e19'); box(g, KX + 203, KY + 163, 2, 2, 2, 42, '#5a2e19');
      gell(g, KX + 204, KY + 164, 48, 15, 'rgba(255,214,140,.18)'); cyl(g, KX + 204, KY + 164, 42, 7, 10, '#f3e3c3', { top: '#fff4dc' });
    });
    add(KX + 12 + KY + 166, g => plant(g, KX + 12, KY + 166, .9));
    add(KX + 190 + KY + 150, g => { // the karinderya cat, tail flicking
      const x = KX + 190, y = KY + 150; box(g, x - 3, y - 2, 0, 7, 5, 6, '#4a4550'); box(g, x - 2, y - 1, 6, 5, 4, 5, '#4a4550');
      const c = P(x, y + 2, 9); g.fillStyle = '#4a4550'; g.fillRect(c[0] - 3, c[1] - 7, 2, 2); g.fillRect(c[0] + 2, c[1] - 7, 2, 2); g.fillStyle = '#f3ede2'; g.fillRect(c[0] - 1.5, c[1] - 2, 3, 2); g.fillStyle = '#ffd23f'; g.fillRect(c[0] - 2.5, c[1] - 4, 1.2, 1.2); g.fillRect(c[0] + 1.5, c[1] - 4, 1.2, 1.2);
      const t = P(x + 5, y + 3, 2), w = Math.sin(ST.T * 3) * 3; g.strokeStyle = '#4a4550'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(t[0], t[1]); g.quadraticCurveTo(t[0] + 5, t[1] - 2, t[0] + 4 + w, t[1] - 8); g.stroke();
    });
  }, { spots: [...KSEATS.map((st, i) => ({ id: 'kain:' + (i + 1), dx: st.dx, dy: st.dy, face: st.face, zone: 'kain', seat: true })), { id: 'npc:cook', dx: 116, dy: 16, face: 's', zone: 'kain' }] });
  // Broom corner (phase 6): a mop bucket and broom; placing one adds the sweeper NPC, who starts from its npc:sweeper spot.
  def('broom-corner', [400, 380], () => add(400 + 380 + 8, g => {
    cyl(g, 404, 384, 0, 7, 12, '#e8c53a', { top: '#5a7fa8' }); box(g, 397, 383, 12, 14, 2, 2, '#9a9aa6');
    poly(g, [P(414, 380, 0), P(416, 380, 0), P(416, 380, 46), P(414, 380, 46)], '#a0643a'); poly(g, [P(411, 378, 0), P(419, 382, 0), P(417, 382, 9), P(413, 378, 9)], '#d9b45a', EDGE, .6);
  }), { spots: [{ id: 'npc:sweeper', dx: 10, dy: 26, face: 's', zone: 'utility' }] });
  def('water-cooler', [446, 596], () => add(290 + 590, g => { // water cooler (rate-limit corner)
    box(g, 446, 596, 0, 20, 18, 44, '#e8e4dc'); cyl(g, 456, 605, 44, 8, 22, 'rgba(120,190,240,.75)', { top: 'rgba(170,220,250,.85)' }); box(g, 452, 614, 22, 8, 2, 4, '#3a8ae0'); Fy(g, 614, 40, () => { g.translate(446, 0); g.fillStyle = '#7ad0ff'; g.fillRect(6, 6, 4, 4); g.fillStyle = '#ff7a6b'; g.fillRect(12, 6, 4, 4); });
  }));
  put('water-cooler', 'water-cooler', 446, 596);
  def('coffee-counter', [360, 592], () => { const coffeeItem = add(400 + 600, g => { // coffee counter with the espresso machine
    box(g, 360, 592, 0, 76, 30, 34, '#8d6840', { t: '#d8d2c6' }); Fy(g, 622, 34, () => { g.translate(360, 0); g.fillStyle = '#6b4a2a'; g.fillRect(3, 3, 32, 26); g.fillRect(41, 3, 32, 26); g.fillStyle = '#c9a878'; g.fillRect(14, 12, 10, 2); g.fillRect(52, 12, 10, 2); });
    const on = !!(ST.ex.switches || {}).espresso;
    box(g, 372, 596, 34, 30, 20, 30, '#3b3f45'); Fy(g, 616, 64, () => { g.translate(372, 0); g.fillStyle = '#1f2125'; g.fillRect(4, 4, 22, 9); g.fillStyle = on ? '#5fd38d' : '#555'; g.beginPath(); g.arc(8, 8.5, 1.6, 0, 6.2832); g.fill(); g.fillStyle = '#f3ede2'; g.fillRect(11, 20, 9, 8); });
    if (on) { const c = P(381, 612, 40); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(c[0] + i * 5, c[1]); g.quadraticCurveTo(c[0] + i * 5 + 3, c[1] - 6, c[0] + i * 5, c[1] - 12 - (ST.T * 8 % 4)); g.stroke(); } }
    mug(g, 414, 604, 34, '#ffcf6b'); mug(g, 424, 610, 34, '#f3ede2');
  });
  reg('coffee', 'Coffee machine', [372, 596, 34, 30, 20, 30], coffeeItem, { clip: true }); });
  put('coffee-counter', 'coffee-counter', 360, 592);
  def('printer', [204, 592], () => add(225 + 600, g => { // printer: animates when a report is filed
    box(g, 204, 592, 0, 50, 26, 22, '#8d6840'); box(g, 206, 594, 22, 46, 22, 14, '#d8d2c6'); box(g, 208, 596, 36, 40, 18, 3, '#b9b3a6');
    Fy(g, 616, 36, () => { g.translate(206, 0); g.fillStyle = '#2b2b36'; g.fillRect(4, 4, 38, 4); g.fillStyle = ST.printer > 0 ? '#5fd38d' : '#7a7a86'; g.fillRect(36, 9, 3, 2); });
    if (ST.printer > 0) { const t = ST.printer; box(g, 218, 598, 39 + Math.min(10, (3 - t) * 6), 20, 12, 1, '#fff'); led(g, 238, 612, 30, '#5ef0a0', true); }
  }));
  put('printer', 'printer', 204, 592);
  def('recycling-bin', [468, 618], () => add(466 + 646, g => { // recycling bin
    box(g, 468, 618, 0, 14, 14, 20, '#3a8a5a'); Fy(g, 632, 20, () => { g.translate(468, 0); g.fillStyle = '#e8f5ec'; g.fillRect(3, 3, 8, 8); });
  }));
  put('recycling-bin', 'recycling-bin', 468, 618);
  // hot desks for visitors (spill desks): two small tables
  def('hot-desk', [98, 600], (p, x) => add(x + 36 + 612, g => { box(g, x, 600, 0, 74, 28, 30, '#8d6840', { t: '#d8d2c6' }); box(g, x + 8, 606, 30, 24, 14, 1.5, '#2b2f3a'); box(g, x + 42, 606, 30, 24, 14, 1.5, '#2b2f3a'); Fg(g, 32, () => { g.fillStyle = '#7cc4ff'; g.fillRect(x + 12, 609, 16, 7); g.fillRect(x + 46, 609, 16, 7); }); }));
  [98, 290].forEach((x, i) => put('hot-desk-' + (i + 1), 'hot-desk', x, 600));
  def('hot-chair', [118, 654], (p, x) => add(x + 645, g => chair(g, x, 654, '#6b6b78', { h: 16 })));
  [118, 152, 306, 346].forEach((x, i) => put('hot-chair-' + (i + 1), 'hot-chair', x, 654));
  walls.push(g => { Fg(g, 0.3, () => { if (ST.labels > 0.02) { g.globalAlpha = ST.labels; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = "700 15px 'Pixelify Sans',monospace"; g.textAlign = 'center';
      const L = (s, x, y, c) => { g.fillStyle = c || 'rgba(255,255,255,.55)'; g.fillText(s, x, y); };
      L('MANAGER', 400, 120, 'rgba(255,255,255,.5)'); L('FOCUS WORK', 500, 270, 'rgba(255,255,255,.55)'); L('GARDEN', 880, 212, 'rgba(255,255,255,.6)'); L('PARK', 1120, 540, 'rgba(255,255,255,.6)'); L('GARAGE', 1120, 776, 'rgba(255,255,255,.7)'); L('PLAYROOM', 560, 778, 'rgba(255,255,255,.6)'); L('UTILITY', 150, 776, 'rgba(60,40,20,.55)'); g.globalAlpha = 1; } }); });

  // ---------- east park ----------
  // low fence along the focus band's east edge, with a gate gap at the aisle (y 380..412)
  def('fence', [999, 236], (p, x, y) => add(1000 + y + 12, g => { box(g, 999, y, 0, 3, 22, 14, '#d8d2c6', { t: '#efe9dc' }); box(g, 999, y, 8, 3, 22, 3, '#c9c2b4'); }));
  let fenceN = 0; [[236, 380], [412, 548]].forEach(([y0, y1]) => { for (let y = y0; y < y1; y += 24) put('fence-' + ++fenceN, 'fence', 999, y); });
  def('gate', [997, 379], () => add(1000 + 396, g => { [380, 410].forEach(y => box(g, 997, y - 1, 0, 7, 4, 26, '#7a5230', { t: '#9a6a3c' })); }, { fp: [997, 379, 1004, 413] }), { gaps: true });
  put('gate', 'gate', 997, 379);
  def('pond-east', [1120, 290], () => add(1120 + 290 + 2, g => { // east pond, a little bigger than the garden one
    const c = P(1120, 290, 0); g.fillStyle = '#9a8f7a'; g.beginPath(); g.ellipse(c[0], c[1], 66, 33, 0, 0, 6.2832); g.fill();
    g.fillStyle = '#7a705f'; g.beginPath(); g.ellipse(c[0], c[1] + 1, 62, 31, 0, 0, 6.2832); g.fill();
    const gr = g.createRadialGradient(c[0] - 14, c[1] - 7, 3, c[0], c[1], 58); gr.addColorStop(0, '#6ec2e6'); gr.addColorStop(1, '#2f7aa8'); g.fillStyle = gr; g.beginPath(); g.ellipse(c[0], c[1], 57, 28.5, 0, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; for (let i = 0; i < 2; i++) { const r = 8 + ((ST.T * 5 + i * 14) % 34); g.globalAlpha = Math.max(0, 1 - r / 44) * .8; g.beginPath(); g.ellipse(c[0] - 12, c[1] + 3, r, r / 2, 0, 0, 6.2832); g.stroke(); } g.globalAlpha = 1;
    [[-30, 6], [22, -9], [34, 8]].forEach(([dx, dy]) => { g.fillStyle = '#3d8a4a'; g.beginPath(); g.ellipse(c[0] + dx, c[1] + dy, 7, 3.4, 0, 0, 6.2832); g.fill(); g.fillStyle = '#ffd1e0'; g.beginPath(); g.arc(c[0] + dx + 1, c[1] + dy - 1, 1.8, 0, 6.2832); g.fill(); });
  }, { floor: true }), { walkable: true });
  put('pond-east', 'pond-east', 1120, 290);
  put('bench-3', 'bench', 1050, 440, { spot: 'pk:b1' }); put('bench-4', 'bench', 1150, 440, { spot: 'pk:b2' });
  def('picnic-table', [1100, 150], () => add(1100 + 150, g => { // picnic table with two benches
    box(g, 1070, 140, 0, 6, 26, 14, COL.dwood); box(g, 1124, 140, 0, 6, 26, 14, COL.dwood);
    box(g, 1064, 128, 10, 72, 10, 3, '#a5764a'); box(g, 1064, 172, 10, 72, 10, 3, '#a5764a'); box(g, 1066, 138, 14, 68, 32, 4, '#b98a57');
    mug(g, 1090, 150, 18, '#ffcf6b'); box(g, 1112, 154, 18, 14, 10, 3, '#d35a4a');
  }));
  put('picnic-table', 'picnic-table', 1100, 150);
  [[1190, 44, 1.15], [1205, 200, 1.0], [1040, 470, 1.0], [1212, 440, 1.1], [1045, 150, .95], [1070, 330, 1.0]].forEach(([x, y, s], i) => put('tree-' + (i + 3), 'tree', x, y, { s }));
  put('plant-4', 'plant', 1180, 120, { s: 1.1 }); put('plant-5', 'plant', 1012, 252, { s: 1, dd: -4 });
  def('lamp-post', [1010, 330], (p, x, y) => add(x + y + 2, g => { // lamp posts
    cyl(g, x, y, 0, 2, 66, '#2b2b36'); const c = P(x, y, 70); g.fillStyle = '#ffe8a8'; g.beginPath(); g.arc(c[0], c[1], 5, 0, 6.2832); g.fill();
    const gr = g.createRadialGradient(c[0], c[1], 1, c[0], c[1], 24); gr.addColorStop(0, 'rgba(255,225,150,' + (.3 + .3 * ST.night) + ')'); gr.addColorStop(1, 'rgba(255,225,150,0)'); g.fillStyle = gr; g.fillRect(c[0] - 24, c[1] - 24, 48, 48);
  }));
  put('lamp-post-1', 'lamp-post', 1010, 330); put('lamp-post-2', 'lamp-post', 1190, 280);

  // ---------- garage + scheduler station ----------
  // Status comes from /api/scheduler (the scheduler job writes scheduler.json); ST.ex.scheduler is that payload, or null = no data yet.
  const sched = () => ST.ex.scheduler || null;
  const ago = iso => { if (!iso) return 'never'; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  def('garage', [1030, 590], () => { const garageItem = add(1220 + 690, g => { // building with a half-open roller door, status screen and a bay interior
    const x0 = 1030, y0 = 590, w = 190, d = 100, h = 96, S = sched();
    box(g, x0, y0, 0, w, d, h, '#8f95a3', { t: '#6e7482', l: '#9aa0ae', r: '#6f7583' });
    box(g, x0 - 4, y0 - 4, h, w + 8, d + 8, 6, '#3a3f4e', { t: '#4a5062' });
    Fy(g, y0 + d, h, () => {
      g.translate(x0, 0);
      g.fillStyle = '#6a707e'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 6; i++) g.fillRect(0, 8 + i * 15, w, 1);
      g.fillStyle = '#16171f'; g.fillRect(16, 26, 104, 70); g.fillStyle = '#2a2c38'; g.fillRect(16, 26, 104, 6);
      g.fillStyle = '#7a4a22'; g.fillRect(12, 22, 112, 4); g.fillRect(12, 26, 4, 70); g.fillRect(120, 26, 4, 70);
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#c9ccd4' : '#b4b8c2'; g.fillRect(16, 26 + i * 6, 104, 5.4); }
      g.fillStyle = '#3a3d4e'; g.fillRect(24, 56, 88, 30); g.fillStyle = '#20222c'; g.fillRect(28, 62, 20, 14); g.fillRect(52, 62, 20, 14); g.fillStyle = '#d6b13a'; g.fillRect(34, 66, 8, 2); g.fillRect(58, 70, 8, 2);
      g.fillStyle = '#8d6840'; g.fillRect(24, 82, 88, 6); g.fillStyle = '#5fd38d'; g.fillRect(84, 66, 20, 14); g.fillStyle = '#0d2a1c'; g.fillRect(86, 68, 16, 10);
      g.fillStyle = '#ffe8a8'; g.fillRect(60, 48, 16, 2);
      g.fillStyle = '#20222c'; g.fillRect(134, 22, 50, 42); g.fillStyle = '#0d2a1c'; g.fillRect(136, 24, 46, 38);
      const ok = S && S.present;
      txt(g, 'SCHEDULER', 159, 32, 6, '#7cf0b0', 'center');
      txt(g, ok ? 'check ' + ago(S.lastCheck) : 'no data yet', 159, 42, 5.2, ok && S.stale ? '#ffb547' : '#cfe0d0', 'center');
      txt(g, ok ? S.itemsFound + ' item' + (S.itemsFound === 1 ? '' : 's') : '--', 159, 50, 5.2, '#cfe0d0', 'center');
      txt(g, ok ? 'Tiro ' + ago(S.lastUpdateToTiro) : '', 159, 58, 5.2, '#ffcf6b', 'center');
      g.fillStyle = '#2a2030'; g.fillRect(24, 6, 88, 13); g.strokeStyle = '#ffcf6b'; g.strokeRect(24.5, 6.5, 87, 12); txt(g, 'SCHEDULER GARAGE', 68, 15.5, 6.6, '#ffcf6b', 'center');
    });
  });
  reg('garage', 'Garage: scheduler status', [1030, 590, 0, 190, 100, 102], garageItem); });
  // The bench and the mailbox are separate pieces with their own footprints: as one piece its footprint stretched over the
  // mailbox post and swallowed the Scheduler character, who then sorted behind the bench and the mailbox.
  def('mail-bench', [1068, 704], () => { const stationItem = add(1140 + 730, g => { // mail-sorting bench with a monitor
    const S = sched();
    box(g, 1072, 707, 0, 5, 5, 20, '#4a3420'); box(g, 1130, 707, 0, 5, 5, 20, '#4a3420'); box(g, 1072, 721, 0, 5, 5, 20, '#4a3420'); box(g, 1130, 721, 0, 5, 5, 20, '#4a3420');
    box(g, 1068, 704, 20, 72, 26, 4, '#b98a57', { t: '#d8b27a' });
    box(g, 1086, 712, 24, 22, 3, 14, '#20222a'); box(g, 1090, 713, 38, 14, 1.5, 2, '#3a3a44');
    Fy(g, 715, 38, () => { g.translate(1088, 0); g.fillStyle = S && S.present ? '#0d2a1c' : '#0c1024'; g.fillRect(0, 0, 18, 11); g.fillStyle = '#5ef0a0'; for (let i = 0; i < 3; i++) g.fillRect(2, 2 + i * 3, 4 + ((i * 5) % 7), 1.2); });
    box(g, 1108, 712, 24, 14, 10, 1.5, '#fff'); box(g, 1112, 714, 25.5, 14, 10, 1.5, '#f3ede2');
  }, { fp: [1068, 704, 1140, 730] });
  reg('scheduler', 'Scheduler station: mail and check-ins', [1068, 704, 0, 72, 26, 48], stationItem); });
  def('mailbox', [1166, 726], () => { const mailboxItem = add(1190 + 740, g => { // mailbox on a post whose flag goes up when items were found
    const S = sched(), up = S && S.present && S.itemsFound > 0;
    cyl(g, 1178, 735, 0, 2.2, 34, '#6b4220');
    box(g, 1168, 726, 34, 22, 18, 14, '#3a7ad0', { t: '#5a9af0', l: '#3a7ad0', r: '#2a5aa0' });
    Fy(g, 744, 48, () => { g.translate(1168, 0); g.fillStyle = '#10305a'; g.fillRect(3, 4, 16, 7); });
    const fl = P(1190, 732, up ? 58 : 40); g.fillStyle = '#e0573f'; g.fillRect(fl[0] - 1.5, fl[1] - (up ? 14 : 5), 3, up ? 14 : 5); g.fillRect(fl[0] - 1.5, fl[1] - (up ? 14 : 5), 7, 4);
  }, { fp: [1166, 724, 1190, 746] });
  reg('mailbox', 'Mailbox: scheduler check-ins', [1166, 726, 0, 24, 20, 58], mailboxItem); });
  def('tires', [1022, 760], (p, x, y) => add(x + y, spriteOr('tires', g => { cyl(g, x, y, 0, 8, 6, '#2a2a30'); cyl(g, x, y, 6, 8, 6, '#34343c'); })));
  // the garage is listed after the bench and mailbox so the click objects keep their 1.2.9 order
  put('mail-bench', 'mail-bench', 1068, 704); put('mailbox', 'mailbox', 1166, 726); put('garage', 'garage', 1030, 590);
  put('tires-1', 'tires', 1022, 760); put('tires-2', 'tires', 1034, 766);

  // pendant lamps are painted after everything (overlay)
  function overlay(g) {
    const tI = Math.min(1, ST.night + ST.dim * .5);
    pendants.forEach(([x, y]) => { const a = P(x, y, 150), b = P(x, y, 118); g.strokeStyle = '#2b2b36'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.fillStyle = '#d6b13a'; g.beginPath(); g.moveTo(b[0] - 9, b[1] + 6); g.lineTo(b[0] - 3, b[1] - 3); g.lineTo(b[0] + 3, b[1] - 3); g.lineTo(b[0] + 9, b[1] + 6); g.closePath(); g.fill(); g.fillStyle = '#fff3c8'; g.fillRect(b[0] - 5, b[1] + 5, 10, 2); });
    // light pools on the floor
    g.globalCompositeOperation = 'lighter';
    pendants.forEach(([x, y]) => { const c = P(x, y, 0), gr = g.createRadialGradient(c[0], c[1], 2, c[0], c[1], 90); gr.addColorStop(0, 'rgba(255,214,140,' + (.12 + .1 * tI * (1 - ST.dim * .6)) + ')'); gr.addColorStop(1, 'rgba(255,214,140,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(c[0], c[1], 92, 46, 0, 0, 6.2832); g.fill(); });
    // sunbeams from the garden and office windows
    [[560, 0, 20], [740, 0, 24], [150, 0, 14]].forEach(([x, y, a]) => { const p1 = P(x, y, 128), p2 = P(x + 120, y, 128), p3 = P(x + 230, y + 150, 0), p4 = P(x + 60, y + 150, 0); const gr = g.createLinearGradient(p1[0], p1[1], p3[0], p3[1]); const k = (.14 - ST.night * .12) * (1 - ST.dim * .4); gr.addColorStop(0, 'rgba(255,230,160,' + Math.max(0, k) + ')'); gr.addColorStop(1, 'rgba(255,230,160,0)'); poly(g, [p1, p2, p3, p4], gr, null); void a; });
    if (ST.dim > .05 && ST.ex.playlit !== false) { // playroom party lights when the board is empty
      [[560, 640, '#ff6b8a'], [720, 700, '#3dd6ff'], [880, 650, '#ffd23f']].forEach(([x, y, c], i) => { const q = P(x, y, 0), pul = .5 + .5 * Math.sin(ST.T * 1.6 + i * 2), gr = g.createRadialGradient(q[0], q[1], 2, q[0], q[1], 70); gr.addColorStop(0, alpha(c, .16 * ST.dim * (.6 + .4 * pul))); gr.addColorStop(1, alpha(c, 0)); g.fillStyle = gr; g.beginPath(); g.ellipse(q[0], q[1], 80, 40, 0, 0, 6.2832); g.fill(); });
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- pixel-tight measuring ----------
  // Every painter is rendered once on a scratch canvas. From that we get (1) the tight bounding box of its opaque pixels
  // (alpha >= TH, so soft shadows and glows do not count) for click areas, hover outlines and focus rings, and (2) the
  // ground footprint of whatever boxes and cylinders it stands on, which the world uses as the base line for depth sorting.
  const TH = 96;
  function scanTight(ctx, fn, clip, noPix, hint) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, STW, STH);
    ctx.save();
    if (clip) { ctx.beginPath(); ctx.rect(clip.l, clip.t, clip.w, clip.h); ctx.clip(); }
    const rec = []; REC = rec;
    try { fn(ctx); } catch (e) { /* a painter that needs live state may fail on the scratch pass; fall back to the loose box */ }
    REC = null; ctx.restore();
    if (noPix) return { rec, rect: null };
    let l = STW, t = STH, r = -1, b = -1, mask = null;
    try { // read only the region that can hold pixels: the clip, else the hint (the loose box plus slack), else the stage
      const R = clip || hint || { l: 0, t: 0, w: STW, h: STH }, x0 = Math.max(0, Math.floor(R.l)), y0 = Math.max(0, Math.floor(R.t)), x1 = Math.min(STW, Math.ceil(R.l + R.w)), y1 = Math.min(STH, Math.ceil(R.t + R.h)), w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return { rec, rect: null };
      const px = new Uint32Array(ctx.getImageData(x0, y0, w, h).data.buffer), thr = TH << 24 >>> 0;
      for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { if (((px[o + x] & 0xFF000000) >>> 0) >= thr) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; } } }
      if (r >= 0) { // keep the silhouette itself (1 = opaque), cropped to its bounding box
        const mw = r - l + 1, mh = b - t + 1, md = new Uint8Array(mw * mh);
        for (let y = 0; y < mh; y++) { const o = (y + t) * w + l; for (let x = 0; x < mw; x++) if (((px[o + x] & 0xFF000000) >>> 0) >= thr) md[y * mw + x] = 1; }
        mask = { l: l + x0, t: t + y0, w: mw, h: mh, d: md };
        l += x0; r += x0; t += y0; b += y0;
      }
    } catch (e) { return { rec, rect: null }; }
    return { rec, rect: r < 0 ? null : { l, t, r: r + 1, b: b + 1 }, mask };
  }
  const padRect = q => { // 0.5% for square things, 1.5% (min 1px) otherwise
    const w = q.r - q.l, h = q.b - q.t, sq = Math.abs(w - h) <= .05 * Math.max(w, h), p = Math.max(sq ? .5 : 1, (sq ? .005 : .015) * Math.max(w, h));
    return { l: q.l - p, t: q.t - p, w: w + 2 * p, h: h + 2 * p };
  };
  let measured = false;
  function measure(doc) {
    if (measured || !doc) return; measured = true;
    const cvs = doc.createElement('canvas'); cvs.width = STW; cvs.height = STH;
    const ctx = cvs.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
    const want = new Set(objects.map(o => o.src).filter(Boolean));
    for (const it of items) {
      if (it.fp && !want.has(it)) continue;
      const m = scanTight(ctx, it.fn, null, !want.has(it));
      if (m.rect) it.tight = m.rect;
      if (!it.fp && !it.o.nofp && !it.o.floor && m.rec.length) {
        const f = m.rec.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [1e9, 1e9, -1e9, -1e9]);
        if (f[2] - f[0] <= 400 && f[3] - f[1] <= 400) it.fp = f;
      }
    }
    resort();
    for (const o of objects) {
      if (!o.src) continue;
      const loose = looseBB(o.box), src = o.src;
      // shared painters (wall boards, the coffee counter) are clipped to the object's own loose box; dedicated painters are not
      const clip = o.clip ? { l: loose.l - 1, t: loose.t - 1, w: loose.w + 2, h: loose.h + 2 } : null, hint = { l: loose.l - 120, t: loose.t - 160, w: loose.w + 240, h: loose.h + 220 };
      const m = scanTight(ctx, typeof src === 'function' ? src : src.fn, clip, false, hint);
      if (m.rect) { o.tight = padRect(m.rect); if (m.mask) o.mask = dilate(m.mask, Math.max(1, Math.round(.005 * Math.max(m.mask.w, m.mask.h)))); }
    }
  }
  // Furniture against furniture: x+y depth is only a guess for wide pieces (a desk row can sort after a sofa that stands in
  // front of it). Re-order by footprint where two pieces are clearly apart (north of / west of), keeping the x+y order
  // everywhere else; a stable topological pass, so overlapping pieces (chair in a desk block) keep their tuned order.
  function resort() {
    const n = items.length, behind = (a, b) => a.fp && b.fp && (a.fp[3] <= b.fp[1] || a.fp[2] <= b.fp[0]);
    const pre = items.map(() => []), indeg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue; const a = items[i], b = items[j];
      if (behind(a, b) && !behind(b, a)) { pre[i].push(j); indeg[j]++; } // a draws before b
    }
    const done = new Array(n).fill(false), out = [];
    for (let k = 0; k < n; k++) {
      let pick = -1; for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0) { pick = i; break; }
      if (pick < 0) for (let i = 0; i < n; i++) if (!done[i]) { pick = i; break; } // cycle: fall back to depth order
      done[pick] = true; out.push(items[pick]); for (const j of pre[pick]) indeg[j]--;
    }
    items.splice(0, n, ...out);
  }
  // grow a silhouette by r px (square structuring element, separable) so a click just outside the edge still lands
  function dilate(m, r) {
    const w = m.w + 2 * r, h = m.h + 2 * r, a = new Uint8Array(w * h), c = new Uint8Array(w * h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) a[(y + r) * w + x + r] = 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x]) for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) c[y * w + k] = 1;
    const o = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (c[y * w + x]) for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) o[k * w + x] = 1;
    return { l: m.l - r, t: m.t - r, w, h, d: o };
  }
  const maskHit = (m, x, y) => { const mx = Math.floor(x - m.l), my = Math.floor(y - m.t); return mx >= 0 && my >= 0 && mx < m.w && my < m.h && m.d[my * m.w + mx] === 1; };
  function looseBB(b) {
    const [x, y, z, w, d, h] = b, pts = [];
    for (const dx of [0, w]) for (const dy of [0, d]) for (const dz of [0, h]) pts.push(P(x + dx, y + dy, z + dz));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { l: Math.floor(Math.min(...xs)) - 2, t: Math.floor(Math.min(...ys)) - 2, w: Math.ceil(Math.max(...xs) - Math.min(...xs)) + 4, h: Math.ceil(Math.max(...ys) - Math.min(...ys)) + 4 };
  }

  // Merge walkers into the depth-sorted furniture. A walker is behind a piece if it is north of or west of the piece's
  // footprint, in front if it is south of or east of it; only when it is level with the footprint (seated in it) or the
  // piece has no footprint does the old x+y compare decide; a piece diagonally off the walker's corner imposes no order. Walkers keep their own x+y order inside a slot.
  const WR = 7;
  function layer(people) {
    const n = items.length, slots = [];
    for (const p of people) {
      let lo = -1, hi = n, q = 0;
      for (let i = 0; i < n; i++) {
        const it = items[i], f = it.fp; let r = 0, free = false;
        if (f) {
          const bh = p.x + WR <= f[0] || p.y + WR <= f[1], fr = p.x - WR >= f[2] || p.y - WR >= f[3];
          if (bh && !fr) r = -1; else if (fr && !bh) r = 1; else if (bh && fr) free = true; // diagonal: far apart on screen, any order is fine
        }
        const sc = p.d < it.d ? -1 : 1; if (sc > 0) q = i + 1;
        if (free) continue;
        if (!r) r = sc;
        if (r > 0) lo = i; else if (hi === n) hi = i;
      }
      let at = q; if (lo < hi) at = Math.max(lo + 1, Math.min(hi, q));
      (slots[at] || (slots[at] = [])).push(p);
    }
    const out = [];
    for (let i = 0; i <= n; i++) { if (slots[i]) slots[i].sort((a, b) => a.d - b.d).forEach(p => out.push(p)); if (i < n) out.push(items[i]); }
    return out;
  }
  // ---------- placing the catalog ----------
  function build(instances, its, obs) {
    IT = its; OB = obs;
    try {
      for (const p of instances) {
        const T = CATALOG[p.type]; if (!T) continue; // unknown types are WorldModel.validate's job
        const [hx, hy] = homeOf(T, p); CUR = { dx: p.x - hx, dy: p.y - hy }; INST = p.id; HOME = [hx, hy];
        T.build(p, hx, hy);
      }
    } finally { CUR = null; INST = null; HOME = null; IT = items; OB = objects; }
  }
  // Rebuild the painters and click objects from instances (in place: the world holds these arrays).
  function place(instances) {
    items.length = 0; objects.length = 0; build(instances, items, objects);
    items.sort((a, b) => a.d - b.d); measured = false;
  }
  // Blocking rects, one per painter as measure() sees it: its explicit fp, else the union of the boxes and cylinders it
  // stands on. Walkable types give none; a type with `gaps` (the gate posts) keeps one rect per box so its opening stays open.
  const NUL = new Proxy(function () {}, { get: () => NUL, apply: () => NUL, set: () => true }); // a 2D context that does nothing
  const union = rs => rs.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [1e9, 1e9, -1e9, -1e9]);
  // One instance's painters in add() order (the part index), each with the boxes it stands on.
  function parts(p) { const its = []; build([p], its, []); return its.map(it => ({ it, rec: scanTight(NUL, it.fn, null, true).rec })); }
  function footprints(instances) {
    const out = [];
    for (const p of instances) {
      const T = CATALOG[p.type]; if (!T || T.walkable) continue;
      for (const { it, rec } of parts(p)) {
        if (T.gaps && rec.length) out.push(...rec); else if (it.fp) out.push(it.fp); else if (rec.length) out.push(union(rec));
      }
    }
    return out;
  }
  // The spots the pieces carry, at their placed positions: {id: {id, x, y, face, zone, seat?, desk?, game?}}. A spot id
  // already taken by an earlier piece gets the suffix @<objectId>.
  function spotsOf(instances) {
    const out = {};
    for (const p of instances) for (const sp of (CATALOG[p.type] || {}).spots || []) {
      const { id, dx, dy, ...rest } = sp, base = typeof id === 'function' ? id(p) : id;
      const sid = base in out ? base + '@' + p.id : base; // a second copy of a piece keeps its spot ids unique
      out[sid] = Object.assign({ id: sid, x: p.x + dx, y: p.y + dy }, rest);
    }
    return out;
  }
  const defaultInstances = () => JSON.parse(JSON.stringify(DEFAULTS));
  place(defaultInstances());

  root.OfficeFurniture = { CATALOG, defaultInstances, place, footprints, parts, homeOf, useAtlas, sprite, spriteOr, spotsOf, measure, layer, maskHit, looseBB, P, K, K2, OXS, OYS, STW, STH, WH, bake, setZones, zoneColor, items, walls, objects, state, overlay, box, poly, flat, gell, cyl, ball, Fy, Fx, Fg, sh, mix, alpha, txt, FONT, rnd, add, pendants };
})(typeof globalThis !== 'undefined' ? globalThis : this);
