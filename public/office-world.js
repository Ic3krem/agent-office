// The office world: one canvas, one rAF loop. Takes the server snapshot (or a demo scene), asks OfficeMotion where each
// agent should be, walks them there along the corridor graph, and paints floor, furniture and characters depth-sorted.
// It spends no tokens and makes no network calls.
(function (root) {
  'use strict';
  const M = root.OfficeMotion, F = root.OfficeFurniture, SP = root.OfficeSprites;
  const { P, STW, STH } = F;
  const CHATTER = ['Coffee break', 'Anyone need a hand?', 'Waiting for the next task…', 'Lo-fi hits different', 'New high score!', 'Watering the plants', 'Back in 5', 'Reading the SOPs'];
  const MODEL = { opus: 'O', sonnet: 'S', haiku: 'H' };
  const FONT = F.FONT;

  let cv = null, g = null, res = 1, opts = {}, bg = null, bgKey = '';
  let brain = M.createBrain(), walkers = new Map(), ghosts = [], frame = null;
  let live = null, demo = null, extras = {}, selected = null, hover = null, chatter = null, nextChat = 0;
  let clock = Date.now(), last = 0, acc = 0, running = false, raf = 0, lastDemoSig = '', hourOverride = null, legend = false, born = 0, nudged = {}, printerPrev = false;
  let hits = [], scaleCss = 1, moved = false;
  const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reducedMQ && reducedMQ.matches) || (typeof document !== 'undefined' && document.documentElement.dataset.anim === 'off');

  // ---------- bounding boxes of interactive things (stage px) ----------
  function bboxOf(b) {
    const [x, y, z, w, d, h] = b, pts = [];
    for (const dx of [0, w]) for (const dy of [0, d]) for (const dz of [0, h]) pts.push(P(x + dx, y + dy, z + dz));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { l: Math.floor(Math.min(...xs)) - 2, t: Math.floor(Math.min(...ys)) - 2, w: Math.ceil(Math.max(...xs) - Math.min(...xs)) + 4, h: Math.ceil(Math.max(...ys) - Math.min(...ys)) + 4 };
  }
  // Click areas, hover outlines and focus rings use the pixel-tight box measured from each painter's opaque pixels
  // (OfficeFurniture.measure); the loose isometric box is only the fallback when a painter could not be measured.
  try { if (typeof document !== 'undefined') F.measure(document); } catch (e) { /* keep the loose boxes */ }
  const OBJ = F.objects.map((o, i) => { const lb = bboxOf(o.box), t = o.tight; return { ...o, id: o.desk || o.key, bb: o.mask ? { l: o.mask.l, t: o.mask.t, w: o.mask.w, h: o.mask.h } : t ? { l: t.l, t: t.t, w: t.w, h: t.h } : lb, loose: lb, i }; });
  const inObj = (o, px, py) => o.mask ? F.maskHit(o.mask, px, py) : (px >= o.bb.l && px <= o.bb.l + o.bb.w && py >= o.bb.t && py <= o.bb.t + o.bb.h);
  // gold outline ring + faint fill that follows the silhouette, built once per object on first hover
  function ringOf(o) {
    if (o.ring) return o.ring; const m = o.mask, pad = 4;
    const gs = document.createElement('canvas'); gs.width = m.w; gs.height = m.h; const gx = gs.getContext('2d'), im = gx.createImageData(m.w, m.h);
    for (let i = 0; i < m.d.length; i++) if (m.d[i]) { im.data[i * 4] = 255; im.data[i * 4 + 1] = 207; im.data[i * 4 + 2] = 107; im.data[i * 4 + 3] = 255; }
    gx.putImageData(im, 0, 0);
    const c = document.createElement('canvas'); c.width = m.w + 2 * pad; c.height = m.h + 2 * pad; const cx = c.getContext('2d');
    for (let a = 0; a < 16; a++) cx.drawImage(gs, pad + Math.round(Math.cos(a * .3927) * 2), pad + Math.round(Math.sin(a * .3927) * 2));
    cx.globalCompositeOperation = 'destination-out'; cx.drawImage(gs, pad, pad);
    cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = .1; cx.drawImage(gs, pad, pad);
    return (o.ring = { c, pad });
  }
  // tight opaque bounds of a character sprite, cached per sprite
  const tbCache = new WeakMap();
  function tightOf(spr) {
    let t = tbCache.get(spr); if (t) return t;
    t = { l: 0, t: 0, r: SP.W, b: SP.H };
    try { const d = spr.cv.getContext('2d').getImageData(0, 0, SP.W, SP.H).data; let l = SP.W, tt = SP.H, r = -1, b = -1; for (let y = 0; y < SP.H; y++) for (let x = 0; x < SP.W; x++) if (d[(y * SP.W + x) * 4 + 3] >= 96) { if (x < l) l = x; if (x > r) r = x; if (y < tt) tt = y; if (y > b) b = y; } if (r >= 0) t = { l, t: tt, r: r + 1, b: b + 1 }; } catch (e) { /* tainted or unavailable: whole sprite */ }
    tbCache.set(spr, t); return t;
  }

  // ---------- the scheduler character: stands at the garage station, status from extras.scheduler ----------
  const NPC = { a: { id: 'sched-npc', name: 'Scheduler', pose: 'stand', color: '#4a86c9', accent: '#cfe6ff' }, w: null };
  function npcWalker() {
    if (!NPC.w) { const sp = M.SPOTS['sched:npc']; NPC.w = { x: sp.x, y: sp.y, face: sp.face, moving: false, fade: 1, alpha: 1, hip: 18, id: 'sched-npc', look: SP.lookOf(NPC.a) }; }
    return NPC.w;
  }
  function schedLine() {
    const S = extras.scheduler;
    if (!S || !S.present) return 'No data yet';
    const m = S.lastCheck ? Math.max(0, Math.round((Date.now() - Date.parse(S.lastCheck)) / 60000)) : null;
    return (m == null ? 'Never checked' : m < 1 ? 'Checked just now' : m < 60 ? 'Checked ' + m + ' min ago' : 'Checked ' + Math.round(m / 60) + ' h ago') + ' · ' + S.itemsFound + ' item' + (S.itemsFound === 1 ? '' : 's');
  }

  // ---------- agents <-> desks ----------
  const deskAgent = id => frame && (id === 'office' ? frame.agents.find(a => a.isManager) : (d => d && frame.agents.find(a => !a.visitor && !a.isManager && a.key === d.key))(M.DESKS.find(x => x.id === id)));
  const agentById = id => frame && frame.agents.find(a => a.id === id);
  const STATUS_WORD = { working: 'working', idle: 'available', blocked: 'waiting for approval', limited: 'at the plan limit', error: 'has an error', nudged: 'nudged' };
  function hotspots() {
    return OBJ.map(o => {
      let label = o.label;
      if (o.desk) { const t = o.desk === 'office' ? M.TIRO : M.TEAM.find(x => x.desk === o.desk), a = deskAgent(o.desk); label = t.name + ', ' + t.role + (a ? ', ' + (STATUS_WORD[a.status] || a.status) : ', not hired yet'); }
      return { id: o.id, key: o.key, desk: o.desk || null, label, l: o.bb.l, t: o.bb.t, w: o.bb.w, h: o.bb.h };
    });
  }
  function activate(id) {
    const o = OBJ.find(x => x.id === id); if (!o) return;
    if (o.desk) { const a = deskAgent(o.desk); if (a) opts.onSelect && opts.onSelect(a.id); else opts.onEmptyDesk && opts.onEmptyDesk(o.desk); return; }
    if (o.key === 'usage' || o.key === 'today') { opts.onUi && opts.onUi(o.key); return; }
    opts.onObject && opts.onObject((o.key === 'garage' || o.key === 'mailbox') ? 'scheduler' : o.key);
  }

  // ---------- walkers ----------
  const HIP = s => (s && M.SPOTS[s]) ? (s.startsWith('play:sofa') ? 26 : s.startsWith('play:bean') ? 13 : s === 'play:pit' ? 10 : s === 'tiro:seat' ? 22 : M.SPOTS[s].seat ? 20 : 18) : 18;
  function syncWalkers(dt) {
    const rd = reduced(), seen = new Set();
    for (const a of frame.agents) {
      seen.add(a.id);
      let w = walkers.get(a.id);
      const sp = M.SPOTS[a.spot] || M.SPOTS['tiro:seat'];
      if (!w) {
        const from = (a.first || rd || !a.spawn) ? sp : M.NODES.spawn;
        w = M.createWalker(a.id, from.x, from.y, sp.face); w.alpha = 0; w.hip = HIP(a.spot); walkers.set(a.id, w);
        if (from === sp) { w.target = a.spot; w.goal = { x: sp.x, y: sp.y }; } else M.setTarget(w, a.spot);
      }
      if (w.target !== a.spot) M.setTarget(w, a.spot, { instant: rd });
      w.alpha = Math.min(1, (w.alpha == null ? 1 : w.alpha) + dt * 4);
    }
    for (const [id, w] of walkers) if (!seen.has(id)) { ghosts.push({ w, a: 1, look: w.look, name: w.nm }); walkers.delete(id); }
    const all = [...walkers.values()];
    for (const w of all) M.stepWalker(w, dt, all);
    for (const a of frame.agents) { const w = walkers.get(a.id); const seated = !w.moving && !w.fadeDir ? HIP(a.spot) : 18; w.hip += (seated - w.hip) * Math.min(1, dt * 9); w.look = SP.lookOf(a); w.nm = a.name; }
    ghosts = ghosts.filter(x => (x.a -= dt * 2.5) > 0);
  }

  // ---------- simulation tick ----------
  function currentSnap() {
    if (demo) return M.demoSnapshot(demo.scene, (clock - demo.t0) / 1000);
    return live;
  }
  function tick(dt) {
    clock += dt * 1000;
    const ST = F.state;
    ST.T = reduced() ? 0 : clock / 1000;
    const s = currentSnap();
    if (demo && opts.onDemoSnap) { const sig = JSON.stringify([s.agents.map(a => a.id + a.status + (a.perm ? 1 : 0)), s.goals.map(x => x.id + x.status)]); if (sig !== lastDemoSig) { lastDemoSig = sig; opts.onDemoSnap(s); } }
    frame = brain.update(s || { agents: [], goals: [], boss: {} }, clock, { arrived: (id, spot) => { const w = walkers.get(id); return !!w && M.arrivedAt(w, spot); } });
    syncWalkers(dt);
    // shared state for the painters
    ST.board = frame.board; ST.reportIcon = frame.reportIcon; ST.ex = extras;
    ST.dim += ((frame.board.empty ? 1 : 0) - ST.dim) * Math.min(1, dt * 1.5);
    const tiro = frame.agents.find(a => a.isManager);
    ST.tiroBusy = !!tiro && tiro.working;
    for (const d of M.DESKS) {
      const a = frame.agents.find(x => !x.visitor && !x.isManager && x.spot === d.id) || frame.agents.find(x => !x.isManager && !x.visitor && x.key === d.key);
      const owner = frame.agents.find(x => !x.visitor && !x.isManager && x.key === d.key);
      const here = owner && walkers.get(owner.id) && M.arrivedAt(walkers.get(owner.id), d.id) ? owner : null;
      const st = owner ? owner.status === 'nudged' ? 'working' : owner.status : null;
      ST.desk[d.id] = { present: !!owner, working: !!(here && here.working && owner.state !== M.S.THINK), led: !owner ? '#555a66' : owner.badge === 'error' ? '#ff5a4a' : (owner.badge === 'perm' || owner.badge === 'limited') ? '#ffb547' : st === 'working' ? '#5ef0a0' : here ? '#2f8f5f' : '#555a66' };
      void a;
    }
    if (frame.reportIcon && !printerPrev) ST.printer = 3; printerPrev = frame.reportIcon; if (ST.printer > 0) ST.printer = Math.max(0, ST.printer - dt);
    for (const k of Object.keys(nudged)) if (nudged[k] < clock) delete nudged[k];
    // idle chatter: canned lines, no model involved
    if (clock > nextChat) {
      nextChat = clock + 11000 + Math.random() * 6000;
      const idle = frame.agents.filter(a => !a.isManager && (a.state === M.S.PLAY || a.state === M.S.IDLE_DESK));
      if (idle.length && !reduced()) { const a = idle[Math.random() * idle.length | 0]; chatter = { id: a.id, text: CHATTER[Math.random() * CHATTER.length | 0], until: clock + 4500 }; }
    }
    if (chatter && chatter.until < clock) chatter = null;
    if (!legend && ST.labels > 0 && clock - born > 14000) ST.labels = Math.max(0, ST.labels - dt * .5);
  }

  // ---------- background (floor and walls) baked once per sky bucket ----------
  const nightOf = h => h >= 20 || h < 5 ? 1 : h >= 18 ? (h - 18) / 2 : h < 7 ? (7 - h) / 2 : 0;
  function ensureBG() {
    const hr = hourOverride != null ? hourOverride : new Date().getHours() + new Date().getMinutes() / 60;
    F.state.night = nightOf(hr);
    const key = res + '|' + Math.round(F.state.night * 10);
    if (bg && bgKey === key) return;
    bgKey = key; bg = document.createElement('canvas'); bg.width = Math.round(STW * res); bg.height = Math.round(STH * res);
    const b = bg.getContext('2d'); b.setTransform(res, 0, 0, res, 0, 0); F.bake(b);
  }

  // ---------- characters ----------
  const hashId = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  function pose(a, w) {
    const T = F.state.T, moving = w.moving || w.fadeDir;
    const nu = nudged[a.id];
    if (moving) return { p: 'walk', f: reduced() ? 0 : 1 + (Math.floor(T * 6) % 2) };
    if (nu) return { p: 'celebrate', f: Math.floor(T * 4) % 2 };
    const p = a.pose;
    const f = p === 'type' ? Math.floor(T * 5) % 2 : p === 'sit-idle' ? (((T + hashId(a.id) % 9) % 9) < 1.4 ? 1 : 0) : p === 'hand' ? Math.floor(T * 3) % 2 : p === 'play' || p === 'sit-play' ? Math.floor(T * 4) % 2 : 0;
    return { p, f: reduced() ? 0 : f };
  }
  function drawPerson(a, w) {
    const T = F.state.T;
    let ps = pose(a, w), face = w.face || 's', px0 = 0, py0 = 0;
    // Tiro paces along the window while he waits: walk, pause with his cup, walk back
    if (a.isManager && a.state === M.S.WINDOW && !w.moving && !w.fadeDir && !reduced() && !nudged[a.id]) {
      const u = (T % 14) / 14, tri = u < .42 ? u / .42 : u < .5 ? 1 : u < .92 ? 1 - (u - .5) / .42 : 0;
      const walking = u < .42 || (u >= .5 && u < .92);
      py0 = tri * 56; face = walking ? (u < .5 ? 's' : 'n') : 'w';
      ps = walking ? { p: 'walk', f: 1 + (Math.floor(T * 5) % 2) } : { p: 'cup', f: 0 };
    }
    const front = face === 'e' || face === 's', dir = front ? (face === 's' ? -1 : 1) : 0;
    const look = w.look || SP.lookOf(a);
    let p = ps.p; if (front && p === 'type') p = 'sit-front';
    const spr = SP.get(look, front ? 'f' : 'b', p, ps.f, dir);
    // position, with a sideways lane while walking so opposing walkers pass
    let x = w.x + px0, y = w.y + py0;
    if (w.moving) { const ln = M.lane(a.id); if (face === 'e' || face === 'w') y += ln; else x += ln; }
    const sc = 3, bob = ((w.moving || ps.p === 'walk') && !reduced()) ? Math.abs(Math.sin(T * 12)) * -1.6 : 0;
    const jump = nudged[a.id] && !reduced() ? -Math.abs(Math.sin(T * 7)) * 12 : 0;
    const [sx, sy0] = P(x, y, 0), hip = w.hip, [, sy] = P(x, y, hip);
    const alpha = (w.alpha == null ? 1 : w.alpha) * (w.fadeDir || w.fade < 1 ? Math.max(0, w.fade) : 1);
    g.save(); g.globalAlpha = alpha;
    // contact shadow
    g.fillStyle = 'rgba(12,6,24,.3)'; g.beginPath(); g.ellipse(sx, sy0 + 1, 13, 6.5, 0, 0, 6.2832); g.fill();
    if (selected === a.id) { g.strokeStyle = '#ffcf6b'; g.lineWidth = 1.6; g.setLineDash([5, 3]); g.beginPath(); g.ellipse(sx, sy0 + 1, 19, 9.5, 0, 0, 6.2832); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,207,107,.14)'; g.fill(); }
    g.imageSmoothingEnabled = false;
    const dx = sx - 9 * sc, dy = sy - 19 * sc + bob + jump;
    if (!front && face === 'w') { g.translate(sx, 0); g.scale(-1, 1); g.translate(-sx, 0); }
    g.drawImage(spr.cv, dx, dy, SP.W * sc, SP.H * sc);
    g.restore();
    const tb = tightOf(spr), flip = !front && face === 'w', tl = flip ? SP.W - tb.r : tb.l, tr = flip ? SP.W - tb.l : tb.r;
    return { sx, sy: sy0, top: dy + 3, left: dx + 3 * sc, right: dx + (SP.W - 3) * sc, bottom: sy0 + 3,
      hit: { l: dx + tl * sc, r: dx + tr * sc, t: dy + tb.t * sc, b: dy + tb.b * sc } };
  }

  // ---------- overlays: name tags and bubbles ----------
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function bubble(cx, bottom, text, bg2, fg, border, o) {
    g.font = '11px ' + FONT; const tw = Math.ceil(g.measureText(text).width) + (o && o.icon ? 16 : 0), w = tw + 14, h = 19, x = Math.round(cx - w / 2), y = Math.round(bottom - h - 6);
    g.fillStyle = 'rgba(0,0,0,.28)'; rr(x, y + 2, w, h, 3); g.fill();
    g.fillStyle = bg2; g.strokeStyle = border || '#1b1220'; g.lineWidth = 1.6; rr(x, y, w, h, 3); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(cx - 4, y + h - .5); g.lineTo(cx, y + h + 5); g.lineTo(cx + 4, y + h - .5); g.fillStyle = bg2; g.fill();
    g.strokeStyle = border || '#1b1220'; g.beginPath(); g.moveTo(cx - 4, y + h); g.lineTo(cx, y + h + 5); g.lineTo(cx + 4, y + h); g.stroke();
    if (o && o.icon) o.icon(x + 8, y + h / 2);
    g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x + 7 + (o && o.icon ? 16 : 0), y + h / 2 + .5);
    return y - 4;
  }
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  function paperIcon(x, y) { g.fillStyle = '#fff'; g.strokeStyle = '#1b1220'; g.lineWidth = 1; g.fillRect(x - 5, y - 7, 10, 13); g.strokeRect(x - 5, y - 7, 10, 13); g.fillStyle = '#3f9f68'; g.fillRect(x - 3, y - 4, 6, 1.3); g.fillRect(x - 3, y - 1, 6, 1.3); g.fillRect(x - 3, y + 2, 4, 1.3); }
  function goalText(ids) { const gs = (currentSnap() || {}).goals || []; const x = gs.find(q => ids && ids.includes(q.id)); return x ? x.text : 'a goal'; }
  let taskBubbles = true;
  function drawTag(a, pos, hovered) {
    const T = F.state.T, acc = a.accent || '#d8d2c4', name = clip(a.name || 'Helper', 14), mb = MODEL[a.model] || '';
    g.font = '11px ' + FONT; const nw = Math.ceil(g.measureText(name).width), bw = mb ? 13 : 0, w = nw + 13 + 8 + bw + (mb ? 4 : 0), h = 15;
    const x = Math.round(pos.sx - w / 2), y = pos.tagY != null ? pos.tagY : Math.round(pos.top - 17);
    g.fillStyle = 'rgba(0,0,0,.3)'; rr(x, y + 2, w, h, 4); g.fill();
    g.fillStyle = acc; g.strokeStyle = '#1b1220'; g.lineWidth = 1.2; rr(x, y, w, h, 4); g.fill(); g.stroke();
    const st = a.badge === 'perm' || a.badge === 'limited' ? '#ffb547' : a.badge === 'error' ? '#ff4d4d' : a.working ? '#2fbf6f' : '#e9e2d6';
    g.fillStyle = '#1b1220'; g.beginPath(); g.arc(x + 7.5, y + h / 2, 4, 0, 6.2832); g.fill(); g.fillStyle = st; g.beginPath(); g.arc(x + 7.5, y + h / 2, 3, 0, 6.2832); g.fill();
    g.fillStyle = '#1b1220'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(name, x + 14, y + h / 2 + .5);
    if (mb) { g.fillStyle = '#1b1220'; rr(x + w - bw - 3, y + 2.5, bw, h - 5, 2); g.fill(); g.fillStyle = acc; g.font = '9px ' + FONT; g.textAlign = 'center'; g.fillText(mb, x + w - bw / 2 - 3, y + h / 2 + .5); }
    let top = y;
    // one bubble at a time
    const tok = a.turnTok >= 1000 ? (a.turnTok / 1000).toFixed(1) + 'k' : String(a.turnTok || 0);
    let b = null;
    const cx = pos.sx;
    if (nudged[a.id]) b = ['On it!', '#7cc4ff', '#0b1c33', '#244a7a'];
    else if (chatter && chatter.id === a.id) b = [chatter.text, '#f4efe4', '#2a2420', '#5a4a3c'];
    else if (a.badge === 'limited') b = [clip(a.errText && /limit/i.test(a.errText) ? a.errText : 'Plan limit: ' + (a.errText || 'resting'), 30), '#ffe2a0', '#2a1600', '#7a4a00'];
    else if (a.badge === 'error') b = [clip(a.errText || 'Error', 28), '#ff9a8d', '#2a0b06', '#7a2a1c'];
    else if (a.badge === 'perm') b = ['Needs approval: ' + clip(a.perm ? a.perm.short : '', 20), '#ffb547', '#2a1600', '#7a4a00'];
    else if (a.state === M.S.REPORT) b = ['Done: ' + clip(goalText(a.goalIds), 26), '#f6f1e3', '#1f3a2a', '#3f9f68', { icon: paperIcon }];
    else if (a.state === M.S.GO || a.state === M.S.QUEUED) b = [a.state === M.S.QUEUED ? 'Waiting to report' : 'Report ready', '#f6f1e3', '#1f3a2a', '#3f9f68', { icon: paperIcon }];
    else if (a.state === M.S.THINK) {
      const n = reduced() ? 3 : 1 + (Math.floor(T * 2.2) % 3), s = '.'.repeat(n); b = [s + ' thinking', '#e9e4f6', '#2a2145', '#6b5aa8'];
    } else if (a.working && a.task && (hovered || selected === a.id || taskBubbles)) b = [clip(a.task, 26) + (hovered || selected === a.id ? ' · ' + tok + ' tok' : ''), '#f4efe4', '#2a2420', '#5a4a3c'];
    if (b) top = bubble(cx, y, b[0], b[1], b[2], b[3], b[4]);
    if (hovered && !a.isManager || hovered && a.isManager) { // nudge pill
      const lbl = '⚡ Nudge', nw2 = 58, nx = Math.round(pos.sx - nw2 / 2), ny = Math.round(top - 22);
      g.fillStyle = '#8a5a1c'; rr(nx, ny + 3, nw2, 19, 5); g.fill(); g.fillStyle = '#ffcf6b'; g.strokeStyle = '#2a1a0c'; g.lineWidth = 1.5; rr(nx, ny, nw2, 19, 5); g.fill(); g.stroke();
      g.fillStyle = '#2a1a0c'; g.font = '12px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lbl, pos.sx, ny + 10);
      return { nudge: { x: nx, y: ny, w: nw2, h: 22 } };
    }
    return {};
  }

  // ---------- render ----------
  function render() {
    if (!g || !frame) return;
    ensureBG();
    const ST = F.state;
    g.setTransform(res, 0, 0, res, 0, 0); g.clearRect(0, 0, STW, STH);
    g.globalAlpha = 1; g.imageSmoothingEnabled = true;
    g.drawImage(bg, 0, 0, STW, STH);
    for (const w of F.walls) w(g);
    // depth sorted: furniture and people
    const people = [];
    for (const a of frame.agents) { const w = walkers.get(a.id); if (!w) continue; people.push({ d: w.x + w.y + 3 + (w.moving ? 0 : 0.5), x: w.x, y: w.y, a, w }); }
    { const nw = npcWalker(); people.push({ d: nw.x + nw.y + 3.5, x: nw.x, y: nw.y, npc: true }); }
    for (const gh of ghosts) people.push({ d: gh.w.x + gh.w.y + 3, x: gh.w.x, y: gh.w.y, ghost: gh });
    const all = F.layer(people); // furniture and walkers, ordered by each piece's tight ground footprint
    hits = []; let npcPos = null;
    const posOf = new Map();
    for (const it of all) {
      if (it.fn) { it.fn(g); continue; }
      if (it.npc) { const nw = npcWalker(), p = drawPerson(NPC.a, nw); hits.push({ id: 'sched-npc', l: p.hit.l, r: p.hit.r, t: p.hit.t, b: p.hit.b }); npcPos = p; continue; }
      if (it.ghost) { const gh = it.ghost; const fake = { id: gh.w.id, name: gh.name, pose: 'stand' }; g.save(); g.globalAlpha = gh.a; gh.w.alpha = 1; const p0 = drawPerson({ ...fake, accent: null }, gh.w); void p0; g.restore(); continue; }
      const p = drawPerson(it.a, it.w); posOf.set(it.a.id, p);
      hits.push({ id: it.a.id, l: p.hit.l, r: p.hit.r, t: p.hit.t, b: p.hit.b });
    }
    F.overlay(g);
    // ambient tint by time of day, and dim lights when the board is empty
    g.globalCompositeOperation = 'source-atop';
    if (ST.night > .02) { g.fillStyle = 'rgba(10,14,56,' + (.36 * ST.night) + ')'; g.fillRect(0, 0, STW, STH); }
    if (ST.dim > .02) { g.fillStyle = 'rgba(14,8,34,' + (.14 * ST.dim) + ')'; g.fillRect(0, 0, STW, STH); }
    g.globalCompositeOperation = 'source-over';
    // hover outline on an object
    if (hover && hover.kind === 'obj') { const o = OBJ.find(x => x.id === hover.id); if (o && o.mask) { const rg = ringOf(o); g.drawImage(rg.c, o.mask.l - rg.pad, o.mask.t - rg.pad); } else if (o) { g.strokeStyle = 'rgba(255,207,107,.9)'; g.lineWidth = 2; g.setLineDash([6, 4]); rr(o.bb.l, o.bb.t, o.bb.w, o.bb.h, 6); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,207,107,.08)'; g.fill(); } }
    // tags and bubbles on top
    const nudgeBoxes = {};
    // keep name tags from stacking on top of each other (sofa, arcade): front-most keeps its place, others lift
    taskBubbles = frame.agents.filter(a => a.working).length <= 4;
    const placed = [], order = frame.agents.filter(a => posOf.get(a.id)).sort((p, q) => posOf.get(q.id).sy - posOf.get(p.id).sy);
    g.font = '11px ' + FONT;
    for (const a of order) { const p = posOf.get(a.id), nw = Math.ceil(g.measureText(clip(a.name || 'Helper', 14)).width), mb = MODEL[a.model] ? 17 : 0, w = nw + 21 + mb; const x = Math.round(p.sx - w / 2); let y = Math.round(p.top - 17); for (let k = 0; k < 4 && placed.some(b => x < b.x + b.w && x + w > b.x && y < b.y + 17 && y + 15 > b.y - 2); k++) y -= 17; placed.push({ x, y, w }); p.tagY = y; }
    for (const a of frame.agents) { const p = posOf.get(a.id); if (!p) continue; const w = walkers.get(a.id); g.save(); g.globalAlpha = Math.max(0, Math.min(1, (w.alpha == null ? 1 : w.alpha)) * (w.fadeDir || w.fade < 1 ? w.fade : 1)); const r = drawTag(a, p, hover && hover.kind === 'agent' && hover.id === a.id); g.restore(); if (r.nudge) nudgeBoxes[a.id] = r.nudge; }
    if (npcPos) { g.save(); g.font = '11px ' + FONT; bubble(npcPos.sx, Math.round(npcPos.top - 6), schedLine(), '#f4efe4', '#2a2420', '#4a86c9'); g.restore(); }
    hits.nudge = nudgeBoxes;
  }

  // ---------- loop ----------
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!last) last = t;
    let dt = Math.min(0.25, (t - last) / 1000); last = t; acc += dt;
    const step = reduced() ? 0.5 : 1 / 30;
    if (acc < step) return;
    const d = Math.min(acc, 0.25); acc = 0;
    tick(d); render();
  }
  function start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(loop); }

  // ---------- pointer ----------
  function toStage(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * STW, (e.clientY - r.top) / r.height * STH]; }
  function pick(px, py) {
    const nb = hits.nudge && hover && hover.kind === 'agent' ? hits.nudge[hover.id] : null;
    if (nb && px >= nb.x && px <= nb.x + nb.w && py >= nb.y && py <= nb.y + nb.h) return { kind: 'nudge', id: hover.id };
    for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (px >= h.l - 2 && px <= h.r + 2 && py >= h.t - 2 && py <= h.b + 2) return { kind: 'agent', id: h.id }; }
    // smallest silhouette first (desks last), so a small piece in front of a big one (mailbox, station vs garage) is never stolen by it
    const area = o => o.mask ? o.mask.w * o.mask.h : o.bb.w * o.bb.h;
    const order = OBJ.slice().sort((a, b) => ((a.key === 'desk') - (b.key === 'desk')) || (a.key === 'desk' ? 0 : area(a) - area(b)));
    for (const o of order) if (inObj(o, px, py)) { if (o.key === 'desk') continue; return { kind: 'obj', id: o.id }; }
    for (const o of OBJ) if (o.key === 'desk' && inObj(o, px, py)) return { kind: 'obj', id: o.id };
    return null;
  }
  function onMove(e) {
    const [px, py] = toStage(e), h = pick(px, py);
    if (h && h.kind === 'nudge') { cv.style.cursor = 'pointer'; return; }
    const same = (!h && !hover) || (h && hover && h.kind === hover.kind && h.id === hover.id);
    if (!same) { hover = h; moved = true; if (h && h.kind === 'obj') { const o = OBJ.find(x => x.id === h.id); cv.title = hotspots().find(q => q.id === h.id).label; void o; } else if (h && h.kind === 'agent') { const a = agentById(h.id); cv.title = a ? (a.name + ' · ' + (a.role || '')) : h.id === 'sched-npc' ? 'Scheduler · ' + schedLine() : ''; } else cv.title = ''; if (!running || reduced()) render(); }
    cv.style.cursor = h ? 'pointer' : 'default';
  }
  function onClick(e) {
    const [px, py] = toStage(e), h = pick(px, py);
    if (!h) { return; }
    if (h.kind === 'nudge') { opts.onNudge && opts.onNudge(h.id); return; }
    if (h.kind === 'agent' && h.id === 'sched-npc') { activate('scheduler'); return; }
    if (h.kind === 'agent') { opts.onSelect && opts.onSelect(h.id); return; }
    activate(h.id);
  }
  function onLeave() { if (hover) { hover = null; if (reduced()) render(); } }

  // ---------- public API ----------
  function mount(canvas, o) {
    opts = o || {}; cv = canvas; g = cv.getContext('2d'); born = clock;
    cv.addEventListener('mousemove', onMove); cv.addEventListener('click', onClick); cv.addEventListener('mouseleave', onLeave);
    setScale(1); start();
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); running = false; } else start(); });
    if (reducedMQ && reducedMQ.addEventListener) reducedMQ.addEventListener('change', () => { render(); });
  }
  function setScale(s) { // css scale of the stage * device pixel ratio -> internal canvas resolution
    scaleCss = s; const r = Math.max(1, Math.min(3, Math.round(s * (root.devicePixelRatio || 1) * 4) / 4)); if (!cv) return;
    if (r !== res || cv.width !== Math.round(STW * r)) { res = r; cv.width = Math.round(STW * res); cv.height = Math.round(STH * res); bg = null; }
  }
  function advance(sec) { // fast-forward the simulation (used by smoke tests and the demo preview)
    const n = Math.ceil(sec * 30); for (let i = 0; i < n; i++) tick(1 / 30);
    render();
  }
  function reset() { brain = M.createBrain(); walkers = new Map(); ghosts = []; frame = null; lastDemoSig = ''; }
    root.OfficeWorld = {
    mount, setScale, advance, hotspots, activate, STW, STH,
    setSnapshot(s) { live = s; if (!frame && !demo) { tick(0.001); render(); } },
    setExtras(e) { extras = Object.assign(extras, e); },
    setSelected(id) { selected = id; },
    setHover(v) { hover = v; },
    nudge(id) { nudged[id] = clock + 1800; },
    setLegend(on) { legend = !!on; F.state.labels = on ? 1 : (F.state.labels > 0 ? F.state.labels : 0); if (on) F.state.labels = 1; born = clock; },
    legend: () => legend,
    setHour(h) { hourOverride = h; bg = null; },
    setDemo(scene) { // scene string, or null to return to live data
      if (!scene) { demo = null; reset(); lastDemoSig = ''; return; }
      if (!demo) reset(); demo = { scene, t0: clock }; lastDemoSig = ''; brain.cfg.idleDelay = 3000;
    },
    demoScene: () => demo && demo.scene,
    debug() { return frame && { agents: frame.agents.map(a => { const w = walkers.get(a.id) || {}; return { id: a.id, name: a.name, state: a.state, spot: a.spot, pose: a.pose, badge: a.badge, x: Math.round(w.x), y: Math.round(w.y), moving: !!w.moving, face: w.face }; }), board: frame.board, reporter: frame.reporter, reps: frame.reps, reportIcon: frame.reportIcon, clock }; },
    pointOf(id) { const p = frame && frame.agents.find(a => a.id === id) && walkers.get(id); if (!p || !cv) return null; const [sx, sy] = P(p.x, p.y, 30), r = cv.getBoundingClientRect(); return { x: r.left + sx / STW * r.width, y: r.top + sy / STH * r.height }; },
    render,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
