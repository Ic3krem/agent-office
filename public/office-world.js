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
  let npcs = {}, npcChat = 0; // zero-token NPCs (cook, sweeper) and when one may speak next
  let clock = Date.now(), last = 0, running = false, raf = 0, timer = 0, dirty = true, lastInput = -1e9, lastDraw = 0, drawn = 0, renderMs = 0, saver = readSaver(), lastDemoSig = '', hourOverride = null, legend = false, born = 0, nudged = {}, printerPrev = false;
  let hits = [], scaleCss = 1, moved = false;
  // Town step 2: 'office', or an interior ('kain' | 'games') where only the CEO walks; agents stay in the office scene.
  let scene = 'office', freshCeo = false; // freshCeo: the scene's first layout puts the CEO at its spawn
  const inOffice = () => scene === 'office';
  // Build mode: the edit session (WorldEdit) or null, the page's hooks, the zone tool, the selection {kind: 'obj'|'zone', id},
  // the session's layout as last applied, footprints per object id, the drag in progress and the pointers that are down.
  let build = null, bhooks = {}, tool = null, sel = null, blayout = null, fps = new Map(), drag = null, noClick = false, tap = null;
  const pointers = new Set();
  // Power saver (default on): idle scenes redraw about twice a second, seated animations 8 times, travelling characters 30 times;
  // a hidden window draws nothing. Off = the old flat 30 fps. Stored in localStorage so the page keeps the choice.
  function readSaver() { try { return localStorage.getItem('ao.powerSaver') !== '0'; } catch (e) { return true; } }
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
  let OBJ = [];
  function rebuildObjects() { // after OfficeFurniture.place(): re-measure and rebuild the click/hover objects
    try { if (typeof document !== 'undefined') F.measure(document); } catch (e) { /* keep the loose boxes */ }
    OBJ = F.objects.map((o, i) => { const lb = bboxOf(o.box), t = o.tight; return { ...o, id: o.desk || o.key, bb: o.mask ? { l: o.mask.l, t: o.mask.t, w: o.mask.w, h: o.mask.h } : t ? { l: t.l, t: t.t, w: t.w, h: t.h } : lb, loose: lb, i }; });
  }
  rebuildObjects();
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
      if (o.desk) { const t = o.desk === 'office' ? M.TIRO : M.TEAM.find(x => x.desk === o.desk), a = deskAgent(o.desk); label = (t ? t.name + ', ' + t.role : 'Desk') + (a ? ', ' + (STATUS_WORD[a.status] || a.status) : ', not hired yet'); }
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
  const HIP = s => (s && M.SPOTS[s]) ? (s.startsWith('play:sofa') ? 26 : s.startsWith('play:bean') ? 13 : s === 'play:pit' ? 10 : s === 'tiro:seat' ? 31 : M.SPOTS[s].seat ? 20 : 18) : 18;
  function syncWalkers(dt) {
    const rd = reduced(), seen = new Set();
    for (const a of frame.agents) {
      seen.add(a.id);
      let w = walkers.get(a.id);
      const sp = M.SPOTS[a.spot] || M.SPOTS['tiro:seat'];
      if (!w) {
        const from = (a.first || rd || !a.spawn) ? sp : M.SPAWN;
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

  // ---------- the CEO: you, walking the office (never part of the golden recording: added here at runtime) ----------
  const CEO_AGENT = { id: 'ceo', name: 'You', look: 'ceo', pose: 'stand' }; // pose: drawPerson's standing pose
  const WPL = () => root.WorldPlayer;
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let ceoP = null, ceoShown = true, keys = new Set(), joy = { dx: 0, dy: 0 }, near = null, nearKey = '', cands = [], promptBox = null;
  function ceoPlayer() {
    if (!ceoP) { ceoP = Object.assign(WPL().create(M.SPAWN.x, M.SPAWN.y), { id: 'ceo', hip: 18, alpha: 1, fade: 1, look: null }); WPL().unstick(ceoP, M.grid()); }
    if (SP) ceoP.look = SP.lookOf(CEO_AGENT); // follows wardrobe changes
    return ceoP;
  }
  const ceoOn = () => ceoShown && !build && !demo;
  function clearNear() { if (nearKey) { nearKey = ''; near = null; opts.onNear && opts.onNear(null); } }
  function stepCeo(dt) {
    if (!ceoOn()) { clearNear(); return; }
    const p = ceoPlayer(); let dx = joy.dx, dy = joy.dy;
    for (const k of keys) { const v = WPL().DIRS[k]; dx += v[0]; dy += v[1]; }
    WPL().step(p, dt, { dx, dy }, M.grid());
    if (p.moving && opts.onFollow) { const [sx, sy] = P(p.x, p.y, 30); opts.onFollow(sx, sy); }
    const ws = frame.agents.map(a => { const w = walkers.get(a.id); return w && { id: a.id, x: w.x, y: w.y, isManager: !!a.isManager }; }).filter(Boolean);
    const ds = M.DESKS.map(d => { const a = deskAgent(d.id), s = M.SPOTS[d.id]; return { id: d.id, x: s.x, y: s.y, agentId: a ? a.id : null }; });
    cands = WPL().candidatesFrom(ws, ds);
    const door = M.SPOTS.door; if (door) cands.push({ kind: 'door', id: 'door', x: door.x, y: door.y }); // walking onto it offers Leave
    const n = WPL().nearest(p, cands), k = n ? n.kind + ':' + n.id : '';
    near = n; if (k !== nearKey) { nearKey = k; opts.onNear && opts.onNear(n); }
  }
  // Click-to-walk to a ground point. Off the floor or already there -> false; on the floor but unreachable -> 'blocked' (the only toast case). findPath ends on the exact point even inside furniture or
  // water (so seats work); a clicked spot inside a blocked cell stops at the nearest free cell instead.
  function walkCeo(gp) {
    const gr = M.grid(), p = ceoPlayer();
    const onFloor = gp.x >= 0 && gp.y >= 0 && gp.x <= gr.cols * gr.cell && gp.y <= gr.rows * gr.cell;
    if (!onFloor || !WPL().walkTo(p, gp)) return onFloor ? 'blocked' : false;
    if (gr.blocked[root.WorldPath.cellOf(gr, gp)] && p.path.length > 1) p.path.pop();
    if (p.pi >= p.path.length) { p.path = []; p.pi = 0; return false; } // already there: nothing to walk
    lastInput = nowMs(); wake(); return true;
  }
  // E / Enter / tap on the prompt: the page handles it through opts.onInteract(target) when it has a menu; otherwise select the agent
  function interact() {
    const n = near; if (!n || !ceoOn()) return null;
    lastInput = nowMs(); wake();
    if (opts.onInteract) opts.onInteract(n); else opts.onSelect && opts.onSelect(n.id);
    return n;
  }
  function onPlayerKey(e) {
    if (e.type === 'keyup') { if (keys.delete(WPL().keyOf(e))) wake(); return; } // always release, whatever has focus now
    const act = WPL().takesKey(e, { build: !!build, shown: ceoOn(), dialog: !!document.querySelector('[role=dialog][aria-modal=true], .oo-win'), canvas: cv });
    if (act === 'move') { keys.add(WPL().keyOf(e)); lastInput = nowMs(); wake(); e.preventDefault(); }
    else if (act === 'interact' && interact()) e.preventDefault();
  }
  // the floating "E" (or "Tap") over the nearest thing; its box is clickable
  function drawPrompt(posOf) {
    promptBox = null; if (!near || !ceoOn()) return;
    const pp = near.kind !== 'desk' && posOf.get(near.id), c = cands.find(q => q.kind === near.kind && q.id === near.id);
    if (!pp && !c) return;
    // beside an agent's name tag (the bubble above it stays readable); over the seat for a desk
    const label = near.kind === 'door' ? (coarse() ? 'Leave' : 'Leave · E') : coarse() ? 'Tap' : 'E';
    g.font = '11px ' + FONT; const w = Math.ceil(g.measureText(label).width) + 12, h = 17;
    const [sx, sy] = pp ? [pp.sx + (pp.tagW || 40) / 2 + 4 + w / 2, pp.tagY != null ? pp.tagY - 1 : pp.top - 18] : P(c.x, c.y, 62);
    const x = Math.round(sx - w / 2), y = Math.round(pp ? sy : sy - h);
    g.fillStyle = 'rgba(0,0,0,.3)'; rr(x, y + 2, w, h, 4); g.fill();
    g.fillStyle = '#ffcf6b'; g.strokeStyle = '#2a1a0c'; g.lineWidth = 1.5; rr(x, y, w, h, 4); g.fill(); g.stroke();
    g.fillStyle = '#2a1a0c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, sx, y + h / 2 + .5);
    promptBox = { x, y, w, h };
  }

  // ---------- simulation tick ----------
  function currentSnap() {
    if (demo) return demo.snap || M.demoSnapshot(demo.scene, (clock - demo.t0) / 1000);
    return live;
  }
  function tick(dt) {
    clock += dt * 1000;
    const ST = F.state;
    ST.T = reduced() ? 0 : clock / 1000;
    const s = currentSnap();
    if (demo && opts.onDemoSnap) { const sig = JSON.stringify([s.agents.map(a => a.id + a.status + (a.perm ? 1 : 0)), s.goals.map(x => x.id + x.status)]); if (sig !== lastDemoSig) { lastDemoSig = sig; opts.onDemoSnap(s); } }
    frame = brain.update(s && inOffice() ? s : { agents: [], goals: (s && s.goals) || [], boss: {} }, clock, { arrived: (id, spot) => { const w = walkers.get(id); return !!w && M.arrivedAt(w, spot); } });
    syncWalkers(dt);
    stepCeo(dt);
    stepNpcs(dt);
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
      const eat = eaters(), CH = root.Chismis, pick = l => l[Math.random() * l.length | 0];
      if (eat.length && CH && !reduced()) { // karinderya chismis: a line and its reply when two are eating
        nextChat = clock + 6000 + Math.random() * 4000;
        if (eat.length > 1) { const i = Math.random() * eat.length | 0, j = (i + 1 + (Math.random() * (eat.length - 1) | 0)) % eat.length, pr = pick(CH.PAIRS);
          chatter = { id: eat[i].id, text: pr[0], until: clock + 3500, next: { id: eat[j].id, text: pr[1] } }; }
        else chatter = { id: eat[0].id, text: pick(CH.SOLO), until: clock + 4000 };
      } else if (idle.length && !reduced()) { const a = idle[Math.random() * idle.length | 0]; chatter = { id: a.id, text: CHATTER[Math.random() * CHATTER.length | 0], until: clock + 4500 }; }
    }
    if (chatter && chatter.until < clock) chatter = chatter.next ? { ...chatter.next, until: clock + 3500 } : null;
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
  // ---------- zero-token NPCs (phase 6): a cook behind the karinderya, a sweeper from each broom corner ----------
  const COOK_A = { id: 'npc-cook', name: 'Aling Nena', pose: 'stand', color: '#f3ede2', accent: '#c0392b' };
  const SWEEP_A = { id: 'npc-sweep', name: 'Mang Ben', pose: 'stand', color: '#5a7fa8', accent: '#e8c53a' };
  const eaters = () => frame ? frame.agents.filter(a => a.spot && a.spot.startsWith('kain:') && !(walkers.get(a.id) || {}).moving) : [];
  const npcBody = (a, x, y) => Object.assign(WPL().create(x, y), { id: a.id, hip: 18, alpha: 1, fade: 1, look: SP.lookOf(a) });
  function stepNpcs(dt) {
    if (build || !SP) { npcs = {}; return; }
    stepGuests(dt);
    const k1 = M.SPOTS['npc:cook'], b = M.SPOTS['npc:sweeper'], CH = root.Chismis;
    if (k1 && !npcs.cook) npcs.cook = { kind: 'cook', a: COOK_A, w: npcBody(COOK_A, k1.x, k1.y) };
    if (!k1) delete npcs.cook;
    if (b && !npcs.sweep) { npcs.sweep = { kind: 'sweep', a: SWEEP_A, w: npcBody(SWEEP_A, b.x, b.y), wait: 3 }; WPL().unstick(npcs.sweep.w, M.grid()); }
    if (!b) delete npcs.sweep;
    const s = npcs.sweep;
    if (s && !reduced()) { // sweep a while, then walk to a random open spot (never a seat or a desk)
      WPL().step(s.w, dt, null, M.grid());
      if (!s.w.moving && s.w.pi >= s.w.path.length && (s.wait -= dt) <= 0) {
        const open = Object.values(M.SPOTS).filter(q => !q.seat && !q.desk && !q.id.startsWith('kain:') && !q.id.startsWith('npc:'));
        if (open.length) WPL().walkTo(s.w, open[Math.random() * open.length | 0]);
        s.wait = 4 + Math.random() * 5;
      }
    }
    if (CH && clock > npcChat) { // now and then one of them says something
      npcChat = clock + 14000 + Math.random() * 10000;
      const who = npcs.cook && eaters().length ? npcs.cook : npcs.sweep && Math.random() < .5 ? npcs.sweep : null;
      if (who) { const l = who.kind === 'cook' ? CH.COOK : CH.SWEEP; who.line = l[Math.random() * l.length | 0]; who.lineUntil = clock + 4000; }
    }
  }
  // Party guests (phase 7): friends whose avatar is in the office on screen. They glide to the position their app reports
  // and carry a name tag with their presence. list: [{id, name, x, y, presence}].
  const GUEST_COL = ['#3f5f8a', '#8a3f6b', '#3e7d55', '#a0643a', '#5a4a8a', '#2f7f86'];
  function setGuests(list) {
    const keep = new Set();
    for (const gq of (Array.isArray(list) && inOffice() ? list : []).slice(0, 16)) {
      const k = 'guest:' + gq.id; keep.add(k);
      let n = npcs[k];
      if (!n) { const a = { id: 'guest-' + gq.id, name: gq.name, pose: 'stand', color: GUEST_COL[hashId(gq.id) % GUEST_COL.length], accent: '#ffd23f' }; n = npcs[k] = { kind: 'guest', a, w: npcBody(a, gq.x, gq.y) }; }
      n.tx = gq.x; n.ty = gq.y; n.line = gq.name + ' · ' + gq.presence; n.lineUntil = Infinity;
    }
    for (const k of Object.keys(npcs)) if (k.startsWith('guest:') && !keep.has(k)) delete npcs[k];
    wake();
  }
  function stepGuests(dt) {
    for (const n of Object.values(npcs)) if (n.kind === 'guest') {
      const dx = n.tx - n.w.x, dy = n.ty - n.w.y, d = Math.hypot(dx, dy), st = 170 * dt;
      if (d > 400) { n.w.x = n.tx; n.w.y = n.ty; n.w.moving = false; } // far jump (room change): appear there
      else if (d > 1) { const k = Math.min(1, st / d); n.w.x += dx * k; n.w.y += dy * k; n.w.moving = true; n.w.face = M.faceOf(dx, dy, n.w.face); }
      else n.w.moving = false;
    }
  }
  function dust(w) { // little puffs at the broom
    const T = F.state.T;
    for (let i = 0; i < 3; i++) { const t = (T * 1.6 + i / 3) % 1, [x, y] = P(w.x + 8 + i * 3, w.y + 6, t * 8); g.fillStyle = 'rgba(190,180,160,' + (.55 * (1 - t)) + ')'; g.beginPath(); g.arc(x, y, 1.5 + t * 2.5, 0, 6.2832); g.fill(); }
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
    if (inOffice()) for (const w of F.walls) w(g); // boards, clock and labels hang on the office walls
    // depth sorted: furniture and people
    const people = [];
    for (const a of frame.agents) { const w = walkers.get(a.id); if (!w) continue; people.push({ d: w.x + w.y + 3 + (w.moving ? 0 : 0.5), x: w.x, y: w.y, a, w }); }
    if (M.SPOTS['sched:npc']) { const nw = npcWalker(); people.push({ d: nw.x + nw.y + 3.5, x: nw.x, y: nw.y, npc: true }); }
    for (const n of Object.values(npcs)) people.push({ d: n.w.x + n.w.y + 3, x: n.w.x, y: n.w.y, extra: n });
    if (ceoOn()) { const p = ceoPlayer(); people.push({ d: p.x + p.y + 3, x: p.x, y: p.y, a: CEO_AGENT, w: p }); }
    for (const gh of ghosts) people.push({ d: gh.w.x + gh.w.y + 3, x: gh.w.x, y: gh.w.y, ghost: gh });
    const all = F.layer(people); // furniture and walkers, ordered by each piece's tight ground footprint
    hits = []; let npcPos = null, ceoPos = null;
    const posOf = new Map();
    for (const it of all) {
      if (it.fn) { it.fn(g); continue; }
      if (it.npc) { const nw = npcWalker(), p = drawPerson(NPC.a, nw); hits.push({ id: 'sched-npc', l: p.hit.l, r: p.hit.r, t: p.hit.t, b: p.hit.b }); npcPos = p; continue; }
      if (it.extra) { const n = it.extra; n.pos = drawPerson(n.a, n.w); if (n.kind === 'sweep' && !n.w.moving && !reduced()) dust(n.w); continue; }
      if (it.ghost) { const gh = it.ghost; const fake = { id: gh.w.id, name: gh.name, pose: 'stand' }; g.save(); g.globalAlpha = gh.a; gh.w.alpha = 1; const p0 = drawPerson({ ...fake, accent: null }, gh.w); void p0; g.restore(); continue; }
      if (it.a === CEO_AGENT) { ceoPos = drawPerson(it.a, it.w); continue; } // not clickable: a click near you walks
      const p = drawPerson(it.a, it.w); posOf.set(it.a.id, p);
      hits.push({ id: it.a.id, l: p.hit.l, r: p.hit.r, t: p.hit.t, b: p.hit.b });
    }
    if (inOffice()) F.overlay(g); // pendants, sunbeams and party lights are placed for the office
    // ambient tint by time of day, and dim lights when the board is empty
    g.globalCompositeOperation = 'source-atop';
    if (ST.night > .02) { g.fillStyle = 'rgba(10,14,56,' + (.36 * ST.night) + ')'; g.fillRect(0, 0, STW, STH); }
    if (ST.dim > .02) { g.fillStyle = 'rgba(14,8,34,' + (.14 * ST.dim) + ')'; g.fillRect(0, 0, STW, STH); }
    g.globalCompositeOperation = 'source-over';
    if (build) { drawBuild(); hits.nudge = {}; promptBox = null; return; } // Build mode: the edit overlay instead of hover rings and tags
    // hover outline on an object
    if (hover && hover.kind === 'obj') { const o = OBJ.find(x => x.id === hover.id); if (o && o.mask) { const rg = ringOf(o); g.drawImage(rg.c, o.mask.l - rg.pad, o.mask.t - rg.pad); } else if (o) { g.strokeStyle = 'rgba(255,207,107,.9)'; g.lineWidth = 2; g.setLineDash([6, 4]); rr(o.bb.l, o.bb.t, o.bb.w, o.bb.h, 6); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,207,107,.08)'; g.fill(); } }
    // tags and bubbles on top
    const nudgeBoxes = {};
    // keep name tags from stacking on top of each other (sofa, arcade): front-most keeps its place, others lift
    taskBubbles = frame.agents.filter(a => a.working).length <= 4;
    const placed = [], order = frame.agents.filter(a => posOf.get(a.id)).sort((p, q) => posOf.get(q.id).sy - posOf.get(p.id).sy);
    g.font = '11px ' + FONT;
    for (const a of order) { const p = posOf.get(a.id), nw = Math.ceil(g.measureText(clip(a.name || 'Helper', 14)).width), mb = MODEL[a.model] ? 17 : 0, w = nw + 21 + mb; const x = Math.round(p.sx - w / 2); let y = Math.round(p.top - 17); for (let k = 0; k < 4 && placed.some(b => x < b.x + b.w && x + w > b.x && y < b.y + 17 && y + 15 > b.y - 2); k++) y -= 17; placed.push({ x, y, w }); p.tagY = y; p.tagW = w; }
    for (const a of frame.agents) { const p = posOf.get(a.id); if (!p) continue; const w = walkers.get(a.id); g.save(); g.globalAlpha = Math.max(0, Math.min(1, (w.alpha == null ? 1 : w.alpha)) * (w.fadeDir || w.fade < 1 ? w.fade : 1)); const r = drawTag(a, p, hover && hover.kind === 'agent' && hover.id === a.id); g.restore(); if (r.nudge) nudgeBoxes[a.id] = r.nudge; }
    if (npcPos) { g.save(); g.font = '11px ' + FONT; bubble(npcPos.sx, Math.round(npcPos.top - 6), schedLine(), '#f4efe4', '#2a2420', '#4a86c9'); g.restore(); }
    for (const n of Object.values(npcs)) if (n.pos && n.line && n.lineUntil > clock) { g.save(); g.font = '11px ' + FONT; bubble(n.pos.sx, Math.round(n.pos.top - 6), n.line, '#f4efe4', '#2a2420', n.kind === 'cook' ? '#c0392b' : n.kind === 'guest' ? '#5fd38d' : '#e8c53a'); g.restore(); }
    if (ceoPos) { ceoPos.tagY = Math.round(ceoPos.top - 17); drawTag(CEO_AGENT, ceoPos, false); }
    drawPrompt(posOf);
    hits.nudge = nudgeBoxes;
  }

  // ---------- loop ----------
  // One timer-aligned rAF: nextFrameDelay (office-motion.js) decides how long to wait; anything that changes what is on
  // screen calls wake() so it shows at once. Hidden windows schedule nothing at all.
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function isMoving() {
    if (!frame || build) return false;
    const ST = F.state;
    if (ceoOn() && WPL().ceoActive(ceoP, keys.size, joy)) return true;
    if (Object.values(npcs).some(n => n.w.moving || n.lineUntil > clock)) return true;
    if (ghosts.length || ST.printer > 0 || Object.keys(nudged).length) return true;
    if (!legend && ST.labels > 0.02 && ST.labels < 1) return true;
    if (Math.abs(ST.dim - (frame.board.empty ? 1 : 0)) > .01) return true;
    for (const a of frame.agents) { const w = walkers.get(a.id); if (!w) continue; if (w.moving || w.fadeDir || w.fade < 1 || (w.alpha != null && w.alpha < 1)) return true; if (Math.abs(w.hip - (!w.moving ? HIP(a.spot) : 18)) > .3) return true; }
    return false;
  }
  function isActive() {
    if (!frame || build) return false;
    if (chatter || npcs.sweep || eaters().length || extras.music || extras.pending || frame.reportIcon || demo) return true;
    const A = ['play', 'sit-play', 'think', 'sit-think', 'hand', 'report', 'cup', 'type', 'celebrate'];
    return frame.agents.some(a => a.working || a.state === M.S.WINDOW || A.includes(a.pose));
  }
  function frameState() {
    return { hidden: typeof document !== 'undefined' && document.hidden, reduced: reduced(), saver, dirty, interactMs: nowMs() - lastInput, moving: isMoving(), active: isActive(), blurred: typeof document !== 'undefined' && document.hasFocus && !document.hasFocus() };
  }
  function schedule() {
    if (!running) return;
    clearTimeout(timer); timer = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const wait = M.frameWait(frameState(), nowMs() - lastDraw);
    if (wait < 0) return; // paused until visibilitychange or wake()
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(loop); }, wait);
  }
  function wake() { dirty = true; if (running) schedule(); }
  function loop(t) {
    raf = 0;
    const n = nowMs(); if (!last) last = n;
    const moving = isMoving(), dt = Math.min(moving ? 0.25 : 1, (n - last) / 1000); last = n;
    if (!build) tick(dt); // Build mode freezes the agents where they are
    const n0 = nowMs();
    render(); dirty = false; lastDraw = n; drawn++; renderMs = nowMs() - n0;
    schedule();
  }
  function start() { if (running) return; running = true; last = 0; schedule(); }
  function stop() { running = false; clearTimeout(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0; }

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
    lastInput = nowMs();
    if (build) { const [px, py] = toStage(e); cv.style.cursor = drag ? 'grabbing' : buildPiece(px, py) ? 'move' : tool ? 'crosshair' : 'default'; cv.title = ''; return; }
    const [px, py] = toStage(e), h = pick(px, py);
    if (h && h.kind === 'nudge') { cv.style.cursor = 'pointer'; return; }
    const same = (!h && !hover) || (h && hover && h.kind === hover.kind && h.id === hover.id);
    if (!same) { hover = h; moved = true; if (h && h.kind === 'obj') { const o = OBJ.find(x => x.id === h.id); cv.title = hotspots().find(q => q.id === h.id).label; void o; } else if (h && h.kind === 'agent') { const a = agentById(h.id); cv.title = a ? (a.name + ' · ' + (a.role || '')) : h.id === 'sched-npc' ? 'Scheduler · ' + schedLine() : ''; } else cv.title = ''; wake(); }
    cv.style.cursor = h ? 'pointer' : 'default';
  }
  function onClick(e) {
    lastInput = nowMs(); wake();
    if (build) { if (noClick) { noClick = false; e.stopPropagation(); } return; } // a finished drag is not a click
    const [px, py] = toStage(e), b = promptBox;
    if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h && interact()) return;
    const h = pick(px, py);
    if (!h) { // empty ground: walk there
      if (ceoOn() && root.WorldEdit && walkCeo(root.WorldEdit.toGround(px, py)) === 'blocked') opts.onToast && opts.onToast("Can't walk there");
      return;
    }
    if (h.kind === 'nudge') { opts.onNudge && opts.onNudge(h.id); return; }
    if (h.kind === 'agent' && h.id === 'sched-npc') { activate('scheduler'); return; }
    if (h.kind === 'agent') { opts.onSelect && opts.onSelect(h.id); return; }
    activate(h.id);
  }
  function onLeave() { if (hover) { hover = null; wake(); } }

  // ---------- build mode: overlay, pointer and keys over a WorldEdit session ----------
  const WE = () => root.WorldEdit;
  const toast = t => bhooks.onToast && bhooks.onToast(t);
  let zoneNoted = false; // the first zone edit swaps the hand-painted floor for the procedural one: say so once
  const noteZone = r => { if (r && r.ok && !zoneNoted) { zoneNoted = true; toast('Custom zones use simple floor textures — the original hand-painted floor returns on Reset to default.'); } };
  function setSel(s) { sel = s; bhooks.onSelect && bhooks.onSelect(s ? s.id : null, s ? s.kind : null); wake(); }
  const fpCache = new Map(); // footprints by instance JSON: one op changes one or two pieces
  function footprintsOf(o) { const k = JSON.stringify(o); if (!fpCache.has(k)) fpCache.set(k, F.footprints([o])); return fpCache.get(k); }
  function syncBuild() { blayout = build.layout(); fps = new Map(blayout.objects.map(o => [o.id, footprintsOf(o)])); }
  // After every op: show the session's layout, drop a selection the op removed, tell the page.
  function afterOp() {
    syncBuild(); applyLayout(blayout);
    if (sel && !(sel.kind === 'zone' ? blayout.zones : blayout.objects).some(q => q.id === sel.id)) setSel(null);
    bhooks.onChange && bhooks.onChange({ dirty: build.dirty(), canUndo: build.canUndo(), canRedo: build.canRedo(), selected: sel ? sel.id : null, selectedKind: sel ? sel.kind : null });
  }
  // The piece under stage point (px, py): ground footprints first, then the click silhouettes of non-fixture pieces.
  function buildPiece(px, py) {
    const gp = WE().toGround(px, py), id = WE().pieceAt(blayout.objects, gp.x, gp.y, fps);
    if (id) return id;
    const area = o => o.mask ? o.mask.w * o.mask.h : o.bb.w * o.bb.h, mine = new Set(blayout.objects.filter(o => !WE().isFixture(o.type)).map(o => o.id));
    const o = OBJ.filter(q => mine.has(q.inst) && inObj(q, px, py)).sort((a, b) => area(a) - area(b))[0];
    return o ? o.inst : null;
  }
  const pathOn = () => tool === 'zone:path';
  const zoneAt = gp => blayout.zones.filter(z => (z.type !== 'path' || pathOn()) && gp.x >= z.rect[0] && gp.x <= z.rect[2] && gp.y >= z.rect[1] && gp.y <= z.rect[3])
    .sort((a, b) => (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]) - (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]))[0] || null;
  const selZone = () => sel && sel.kind === 'zone' ? blayout.zones.find(z => z.id === sel.id) : null;
  function cancelDrag() { // put a half-dragged piece back where the session has it
    const d = drag; drag = null; if (!d) return;
    if (d.kind === 'piece' && d.x != null) applyLayout(blayout);
    wake();
  }
  function onDown(e) {
    if (!build) return;
    noClick = false; pointers.add(e.pointerId);
    if (pointers.size > 1) { cancelDrag(); tap = null; return; } // a second finger: pinch and pan belong to the camera
    if (e.button !== 0) return;
    const [px, py] = toStage(e), gp = WE().toGround(px, py), z = selZone();
    let d = null;
    if (z) { const [hx, hy] = P(z.rect[2], z.rect[3], 0); if (Math.hypot(px - hx, py - hy) <= 10) d = { kind: 'resize', id: z.id, r0: z.rect }; }
    if (!d) { const id = buildPiece(px, py); if (id) { d = { kind: 'piece', id, o: blayout.objects.find(q => q.id === id) }; setSel({ kind: 'obj', id }); } }
    if (!d && tool && tool.startsWith('zone:')) d = { kind: 'zone', type: tool.slice(5) };
    if (!d) { tap = { pid: e.pointerId, cx: e.clientX, cy: e.clientY, gp }; return; } // empty ground: let it through so the camera can pan; a tap selects the zone there
    e.stopPropagation();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
    drag = Object.assign(d, { pid: e.pointerId, cx: e.clientX, cy: e.clientY, g0: gp, moved: false, ok: true });
  }
  function onDrag(e) {
    const d = drag; if (!build || !d || e.pointerId !== d.pid) return;
    if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return;
    d.moved = true; lastInput = nowMs();
    const [px, py] = toStage(e), gp = WE().toGround(px, py), dx = gp.x - d.g0.x, dy = gp.y - d.g0.y, S = WE().snap;
    if (d.kind === 'piece') {
      const x = S(d.o.x + dx), y = S(d.o.y + dy);
      if (x === d.x && y === d.y) return;
      d.x = x; d.y = y; d.ok = build.check({ op: 'move', id: d.id, x, y }).ok;
      F.place(blayout.objects.map(q => q.id === d.id ? Object.assign({}, q, { x, y }) : q)); // painters only; re-measured on release
    } else if (d.kind === 'zone') {
      d.rect = [Math.min(d.g0.x, gp.x), Math.min(d.g0.y, gp.y), Math.max(d.g0.x, gp.x), Math.max(d.g0.y, gp.y)].map(S);
      d.ok = build.check({ op: 'addZone', type: d.type, rect: d.rect }).ok;
    } else {
      d.rect = [d.r0[0], d.r0[1], S(d.r0[2] + dx), S(d.r0[3] + dy)];
      d.ok = build.check({ op: 'setZone', id: d.id, rect: d.rect }).ok;
    }
    wake();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    const t = tap; if (t && t.pid === e.pointerId) { tap = null; if (build && e.type === 'pointerup' && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) < 4) { const z = zoneAt(t.gp); setSel(z ? { kind: 'zone', id: z.id } : null); } }
    const d = drag; if (!build || !d || e.pointerId !== d.pid) return;
    drag = null;
    if (e.type === 'pointercancel') { drag = d; cancelDrag(); return; }
    if (!d.moved) { if (d.kind === 'zone') { const z = zoneAt(d.g0); setSel(z ? { kind: 'zone', id: z.id } : null); } wake(); return; }
    noClick = true;
    let r = null;
    if (d.kind === 'piece') { if (d.x != null && (d.x !== d.o.x || d.y !== d.o.y)) r = build.move(d.id, d.x, d.y); }
    else if (d.rect && d.kind === 'zone') { r = build.addZone(d.type, d.rect); if (r.ok) setSel({ kind: 'zone', id: r.id }); noteZone(r); }
    else if (d.rect) { r = build.setZone(d.id, { rect: d.rect }); noteZone(r); }
    if (r && !r.ok) toast(d.kind === 'piece' ? "Can't put the " + WE().labelOf(d.o.type) + ' there: ' + r.reason : r.reason);
    afterOp(); // also snaps an illegal or unchanged drag back
  }
  function onKey(e) {
    if (!build || e.defaultPrevented || document.querySelector('[role=dialog][aria-modal=true]')) return; // a page dialog owns the keys
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    const k = (e.key || '').length === 1 ? e.key.toLowerCase() : e.key || '', mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z' && !e.shiftKey) buildOp('undo');
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) buildOp('redo');
    else if (mod && k === 'd') buildOp('duplicate');
    else if ((k === 'Delete' || k === 'Backspace') && !mod) buildOp('delete');
    else if (k === 'r' && !mod && !e.altKey) toast('Rotation is coming in a later update');
    else if (k === 'Escape') { cancelDrag(); setSel(null); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation(); // the page's own keys (Escape, zoom) stay out of Build mode
  }
  // One edit from a key or the page's edit bar: 'undo' | 'redo' | 'duplicate' | 'delete' (the selection),
  // 'zoneType' (arg: type, the selected zone), 'load' (arg: a whole layout). Refusals are toasted; returns the Result.
  // Deleting a department desk goes through hooks.onRetire(desk, confirm) when the page set it (arg 'confirmed' skips it).
  function buildOp(name, arg) {
    if (!build) return { ok: false, reason: 'not in build mode' };
    const none = { ok: false, reason: 'nothing selected' };
    cancelDrag();
    let r = { ok: true };
    if (name === 'undo') build.undo();
    else if (name === 'redo') build.redo();
    else if (name === 'duplicate') { if (!sel || sel.kind !== 'obj') return none; r = build.duplicate(sel.id); if (r.ok) setSel({ kind: 'obj', id: r.id }); }
    else if (name === 'delete') {
      if (!sel) return none;
      const o = sel.kind === 'obj' && arg !== 'confirmed' && bhooks.onRetire && blayout.objects.find(p => p.id === sel.id);
      if (o && o.type === 'dept-desk') { // retiring a role: the page asks first, then calls back to delete
        const c = build.check({ op: 'remove', id: o.id });
        if (!c.ok) { toast(c.reason); return c; }
        const id = o.id; bhooks.onRetire(o, () => { if (build && blayout.objects.some(p => p.id === id)) { setSel({ kind: 'obj', id }); buildOp('delete', 'confirmed'); } });
        return { ok: false, reason: 'asking' };
      }
      r = sel.kind === 'zone' ? build.removeZone(sel.id) : build.remove(sel.id); if (sel.kind === 'zone') noteZone(r);
    }
    else if (name === 'zoneType') { if (!sel || sel.kind !== 'zone') return none; r = build.setZone(sel.id, { type: arg }); noteZone(r); }
    else if (name === 'load') { r = build.load(arg); if (r.ok) setSel(null); }
    else return { ok: false, reason: 'unknown op ' + name };
    if (!r.ok) toast(r.reason);
    afterOp();
    return r;
  }
  // The overlay: faint 10-unit grid, zones at 25% in their floor colour with labels, the selection, the drag ghost.
  function drawBuild() {
    const { w, h } = blayout.size, d = drag && drag.moved ? drag : null, okCol = ok => ok ? 'rgba(94,240,160,.45)' : 'rgba(255,90,74,.5)';
    const rectOf = z => d && d.kind === 'resize' && d.id === z.id ? d.rect : z.rect;
    F.Fg(g, 0, () => {
      g.lineWidth = .6; g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath();
      for (let x = 0; x <= w; x += 10) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (let y = 0; y <= h; y += 10) { g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
      for (const z of blayout.zones) { // walkway strips are outlines only unless the path brush is on: they would bury the scene
        const [x0, y0, x1, y1] = rectOf(z);
        if (z.type === 'path' && !pathOn()) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = .8; g.strokeRect(x0, y0, x1 - x0, y1 - y0); continue; }
        g.globalAlpha = .25; g.fillStyle = F.zoneColor(z.type); g.fillRect(x0, y0, x1 - x0, y1 - y0); g.globalAlpha = 1;
      }
      const zs = selZone();
      if (zs) { const [x0, y0, x1, y1] = rectOf(zs); g.strokeStyle = '#ffcf6b'; g.lineWidth = 2; g.strokeRect(x0, y0, x1 - x0, y1 - y0); }
      if (sel && sel.kind === 'obj' && !(d && d.kind === 'piece')) { g.strokeStyle = '#ffcf6b'; g.lineWidth = 1.5; for (const r of fps.get(sel.id) || []) g.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
      if (d && d.kind === 'piece' && d.x != null) { g.fillStyle = okCol(d.ok); for (const r of fps.get(d.id) || []) g.fillRect(r[0] + d.x - d.o.x, r[1] + d.y - d.o.y, r[2] - r[0], r[3] - r[1]); }
      if (d && d.kind !== 'piece' && d.rect) { const [x0, y0, x1, y1] = d.rect; g.fillStyle = okCol(d.ok); g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    });
    g.font = '10px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,255,255,.75)';
    for (const z of blayout.zones) { if (z.type === 'path' && !pathOn()) continue; const [x0, y0, x1, y1] = rectOf(z), [sx, sy] = P((x0 + x1) / 2, (y0 + y1) / 2, 0); g.fillText(z.id, sx, sy); }
    const zs = selZone();
    if (zs) { const r = rectOf(zs), [hx, hy] = P(r[2], r[3], 0); g.fillStyle = '#ffcf6b'; g.strokeStyle = '#2a1a0c'; g.lineWidth = 1.5; g.fillRect(hx - 5, hy - 5, 10, 10); g.strokeRect(hx - 5, hy - 5, 10, 10); }
    if (sel && sel.kind === 'obj' && !(d && d.kind === 'piece')) for (const o of OBJ) if (o.inst === sel.id && o.mask) { const rg = ringOf(o); g.drawImage(rg.c, o.mask.l - rg.pad, o.mask.t - rg.pad); }
  }
  // session = a WorldEdit session (null leaves Build mode); hooks = {onChange(state), onSelect(id|null, kind), onToast(text), onRetire(desk, confirm)}.
  function setBuild(session, hooks) {
    cancelDrag(); build = session || null; bhooks = hooks || {}; sel = null; tool = null; noClick = false; hover = null; tap = null; pointers.clear();
    keys.clear(); if (build) clearNear();
    if (build) syncBuild(); else blayout = null;
    if (cv) { cv.style.cursor = ''; cv.title = ''; }
    wake();
  }
  function setTool(t) { tool = t || null; if (build && sel && sel.kind === 'zone' && !pathOn() && (blayout.zones.find(z => z.id === sel.id) || {}).type === 'path') setSel(null); wake(); } // null, or 'zone:<type>'
  // Add a catalog piece at the snapped ground point under a client point (the drawer's drop, mouse or touch).
  // params: the piece's params ({role} for a department desk). A desk goes to the nearest legal spot within
  // DESK_REACH of the drop point, since free desk-sized spots are rare; none -> {ok:false, toast} for the page.
  function dropAt(type, clientX, clientY, params) {
    if (!build || !cv) return { ok: false, reason: 'not in build mode' };
    cancelDrag();
    const [px, py] = toStage({ clientX, clientY }), gp = WE().toGround(px, py);
    let at = [gp.x, gp.y];
    if (type === 'dept-desk' && deskFits(params)) {
      at = nearestFree(type, gp.x, gp.y, params);
      if (!at) return { ok: false, reason: 'no room nearby', toast: 'No room nearby — move something first' };
    }
    const r = build.add(type, at[0], at[1], params);
    if (r.ok) { setSel({ kind: 'obj', id: r.id }); afterOp(); }
    return r;
  }
  // Role free and under the desk limit: otherwise add() gives its own refusal at the drop point.
  function deskFits(params) {
    const l = build.layout(), desks = l.objects.filter(o => o.type === 'dept-desk').length;
    return !!(params && WE().availableRoles(l).some(r => r.key === params.role)) && desks < root.WorldModel.MAX_DESKS;
  }
  const DESK_REACH = 150;
  // Snapped grid points within DESK_REACH of (x, y), nearest first; the first one session.check accepts.
  function nearestFree(type, x, y, params) {
    const S = WE().snap, cx = S(x), cy = S(y), pts = [];
    for (let dx = -DESK_REACH; dx <= DESK_REACH; dx += 10) for (let dy = -DESK_REACH; dy <= DESK_REACH; dy += 10) {
      const d = Math.hypot(cx + dx - x, cy + dy - y); if (d <= DESK_REACH) pts.push([d, cx + dx, cy + dy]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    for (const [, px, py] of pts) if (build.check({ op: 'add', type, x: px, y: py, params }).ok) return [px, py];
    return null;
  }

  // ---------- public API ----------
  function mount(canvas, o) {
    opts = o || {}; cv = canvas; g = cv.getContext('2d'); born = clock;
    cv.addEventListener('mousemove', onMove); cv.addEventListener('click', onClick); cv.addEventListener('mouseleave', onLeave);
    setScale(scaleCss); start(); // keep a scale set before mount (the page may mount after its first fit)
    cv.addEventListener('wheel', () => { lastInput = nowMs(); wake(); }, { passive: true }); cv.addEventListener('pointerdown', e => { lastInput = nowMs(); wake(); onDown(e); });
    cv.addEventListener('pointermove', onDrag);
    cv.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.pid) { pointers.delete(e.pointerId); cancelDrag(); } }); // capture taken away: same as a cancel
    root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp); // window: a finger lifted anywhere
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onPlayerKey); document.addEventListener('keyup', onPlayerKey);
    root.addEventListener('blur', () => keys.clear()); // a key released while the window was unfocused never sends keyup
    document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); joy = { dx: 0, dy: 0 }; stop(); } else { running = false; dirty = true; start(); } });
    root.addEventListener('focus', wake); root.addEventListener('blur', wake);
    if (reducedMQ && reducedMQ.addEventListener) reducedMQ.addEventListener('change', () => { dirty = true; render(); schedule(); });
    loadAtlas();
  }
  // Office art (/art/office/atlas.json + atlas.png). Missing or broken: every piece draws as a plain placeholder box of its
  // footprint geometry (live bits still on top), with one log line.
  function loadAtlas() {
    if (typeof fetch !== 'function' || typeof Image !== 'function') return;
    fetch('/art/office/atlas.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(a => { if (!a || typeof a.frames !== 'object') throw new Error('atlas.json has no frames'); return a; })
      .then(a => new Promise((ok, no) => { const image = new Image(); image.onload = () => ok(Object.assign({}, a, { image })); image.onerror = () => no(new Error('atlas.png did not load')); image.src = '/art/office/atlas.png'; }))
      .then(a => new Promise(ok => { const glow = new Image(); glow.onload = () => ok(Object.assign(a, { glow })); glow.onerror = () => ok(a); glow.src = '/art/office/atlas-glow.png'; })) // night windows; optional
      .then(a => { F.useAtlas(a); bg = null; rebuildObjects(); wake(); }) // re-bake: floors and walls come from the atlas too
      .catch(e => console.info('Office art not loaded, drawing placeholder boxes instead:', e.message));
  }
  function setScale(s) { // css scale of the stage * device pixel ratio -> internal canvas resolution
    scaleCss = s; const r = Math.max(1, Math.min(3, Math.round(s * (root.devicePixelRatio || 1) * 4) / 4)); if (!cv) return;
    if (r !== res || cv.width !== Math.round(STW * r)) { res = r; cv.width = Math.round(STW * res); cv.height = Math.round(STH * res); bg = null; }
    wake();
  }
  function advance(sec) { // fast-forward the simulation (used by smoke tests and the demo preview)
    const n = Math.ceil(sec * 30); for (let i = 0; i < n; i++) tick(1 / 30);
    render();
  }
  // Swap in a layout (WorldModel format): motion spots and grid, furniture, click objects, then repaint the baked floor.
  function applyLayout(layout) {
    M.useLayout(layout); F.place(layout.objects); rebuildObjects(); F.setZones(layout.zones, layout.scene ? { size: layout.size, door: layout.spots.find(q => q.id === 'door') } : null);
    if (freshCeo) { freshCeo = false; ceoP = null; } // a snapshot may have placed the CEO before the scene's layout arrived
    if (ceoP) { ceoP.path = []; ceoP.pi = 0; WPL().unstick(ceoP, M.grid()); } // the old route may cross the new furniture
    // seated characters snap to their spot's new place; walking ones re-route on the new grid
    for (const w of walkers.values()) if (w.target && M.SPOTS[w.target]) M.setTarget(w, w.target, { instant: !w.moving });
    hover = null; NPC.w = null; npcs = {}; bg = null; bgKey = ''; opts.onLayout && opts.onLayout(); wake();
  }
  function reset() { brain = M.createBrain(); walkers = new Map(); ghosts = []; frame = null; lastDemoSig = ''; }
    root.OfficeWorld = {
      npcInfo: () => Object.values(npcs).map(n => ({ kind: n.kind, x: Math.round(n.w.x), y: Math.round(n.w.y), moving: !!n.w.moving, line: n.lineUntil > clock ? n.line : null })), // read-only, for checks
    mount, setScale, advance, hotspots, activate, applyLayout,
    // Enter a scene before applying its layout: the brain, walkers and the CEO start afresh (the CEO at the layout's spawn).
    setScene(name) { scene = name === 'kain' || name === 'games' ? name : 'office'; reset(); ceoP = null; freshCeo = true; NPC.w = null; npcs = {}; clearNear(); wake(); },
    scene: () => scene,
    nearKind: () => (near && ceoOn() ? near.kind : null), // read-only, for checks
    setBuild, setTool, dropAt, buildOp, STW, STH,
    setSnapshot(s) { live = s; if (!frame && !demo) { tick(0.001); render(); } wake(); },
    setExtras(e) { extras = Object.assign(extras, e); wake(); },
    setSelected(id) { selected = id; wake(); },
    setHover(v) { hover = v; wake(); },
    nudge(id) { nudged[id] = clock + 1800; wake(); },
    setJoystick(dx, dy) { joy = { dx: +dx || 0, dy: +dy || 0 }; lastInput = nowMs(); wake(); },
    interact,
    ceo() { const p = ceoPlayer(); return { x: p.x, y: p.y }; },
    setCeoVisible(on) { ceoShown = !!on; if (!ceoShown) { keys.clear(); clearNear(); } wake(); },
    powerSaver: () => saver,
    setPowerSaver(on) { saver = !!on; try { localStorage.setItem('ao.powerSaver', saver ? '1' : '0'); } catch (e) { } wake(); },
    framesDrawn: () => drawn,
    lastRenderMs: () => renderMs, // the last frame's draw time (perf harness)
    setLegend(on) { wake(); legend = !!on; F.state.labels = on ? 1 : (F.state.labels > 0 ? F.state.labels : 0); if (on) F.state.labels = 1; born = clock; },
    legend: () => legend,
    setHour(h) { hourOverride = h; bg = null; wake(); },
    setDemo(scene) { // scene string, or null to return to live data
      wake();
      if (!scene) { demo = null; reset(); lastDemoSig = ''; return; }
      if (!demo) reset(); demo = { scene, t0: clock }; lastDemoSig = ''; brain.cfg.idleDelay = 3000;
    },
    demoScene: () => demo && demo.scene,
    // A party visit: a ready snapshot of a friend's office (generic bubbles only), drawn like a preview scene.
    setGuests,
    setVisit(snap) { wake(); if (!snap) { demo = null; reset(); lastDemoSig = ''; return; } if (!demo) reset(); demo = { scene: 'visit', snap, t0: clock }; lastDemoSig = ''; brain.cfg.idleDelay = 3000; },
    debug() { return frame && { agents: frame.agents.map(a => { const w = walkers.get(a.id) || {}; return { id: a.id, name: a.name, state: a.state, spot: a.spot, pose: a.pose, badge: a.badge, x: Math.round(w.x), y: Math.round(w.y), moving: !!w.moving, face: w.face }; }), board: frame.board, reporter: frame.reporter, reps: frame.reps, reportIcon: frame.reportIcon, clock }; },
    pointOf(id) { const p = frame && frame.agents.find(a => a.id === id) && walkers.get(id); if (!p || !cv) return null; const [sx, sy] = P(p.x, p.y, 30), r = cv.getBoundingClientRect(); return { x: r.left + sx / STW * r.width, y: r.top + sy / STH * r.height }; },
    render,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
