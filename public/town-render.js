// Town renderer: draws the pre-rendered town (terrain chunks + atlas sprites + the player) with PixiJS v8, only when
// something changed. Classic script: root.TownRender. The pure helpers never touch PIXI, so tests load this without it.
// Contract: input is DOM events only. While mounted, PIXI.Ticker.system is stopped (Pixi's scheduler and pointer-move
// ticking would otherwise run a rAF loop forever), so Pixi pointer events, AnimatedSprite and video textures do not tick.
// destroy() restores the ticker's previous state and clears the one 60 s hour timer (it only marks when the night tenth changes).
// The one frame loop: ambient animation (TownAmbient), a rAF that renders at G.ambientFps only while the ambient plan is
// non-empty, the page is visible and the fps is > 0. Its frames go through the same render(), at most once per rAF.
(function (root) {
  'use strict';
  const K = 0.7071, K2 = 0.3536;
  const MIN_W = 900, MIN_H = 560; // css px of map that must stay in view
  const CHAR_CAP = 128; // soft cap on cached character textures; own agents and friends share it, and lruEvict never drops one on screen
  const FEET = [9, 25]; // OfficeSprites pixel under the feet (same as office-world drawPerson)
  let O = [961, 61]; // terrain.json originPx; mount() replaces it with the loaded value

  const project = (x, y, z) => [O[0] + K * (x - y), O[1] + K2 * (x + y) - z];
  // Inverse of project at z = 0: terrain px -> world units.
  const unproject = (sx, sy) => { const u = (sx - O[0]) / K, v = (sy - O[1]) / K2; return [(u + v) / 2, (v - u) / 2]; };
  const depthOf = (x, y) => x + y;
  // Land levels (town step 4): everything standing on the town is drawn at its ground height. mount() sets the map.
  let M = null;
  const atGround = (x, y) => project(x, y, root.TownMap ? root.TownMap.heightAt(M, x, y) : 0);

  // Character placement on screen: the OfficeSprites view/dir for a face, a mirror for west, and depth after sprites at the same x+y.
  function charPlace(x, y, face) {
    const front = face === 'e' || face === 's', [sx, sy] = atGround(x, y), flip = !front && face === 'w';
    return { view: front ? 'f' : 'b', dir: front ? (face === 's' ? -1 : 1) : 0, flip,
      px: Math.round(sx) + (flip ? FEET[0] : -FEET[0]), py: Math.round(sy) - FEET[1], z: depthOf(x, y) + 1e-3 };
  }
  // Travellers: the face is the path segment's direction; the walk frame flips every STRIDE units (the player's stride:
  // it flips 6 times a second at WorldPlayer.SPEED).
  const STRIDE = root.WorldPlayer.SPEED / 6;
  const faceAlong = (a, b, fallback) => root.OfficeMotion.faceOf(b.x - a.x, b.y - a.y, fallback);
  const walkFrame = dist => 1 + (Math.floor(dist / STRIDE) % 2);
  // Sprite pool keyed by id: an id keeps its sprite; ids that left hide theirs for reuse (never destroyed). -> [[item, sprite]]
  const pool = () => ({ byId: new Map(), free: [] });
  // Texture cache trim: drop the oldest entries past cap, skipping keys in use (on a sprite now). -> the dropped values
  function lruEvict(map, cap, keep) {
    const out = [];
    for (const [k, v] of map) { if (map.size <= cap) break; if (!keep.has(k)) { map.delete(k); out.push(v); } }
    return out;
  }
  function syncPool(pl, list, make) {
    const out = [], seen = new Set();
    for (const t of list) {
      let s = pl.byId.get(t.id);
      if (!s) { s = pl.free.pop() || make(); pl.byId.set(t.id, s); }
      s.visible = true; seen.add(t.id); out.push([t, s]);
    }
    for (const [id, s] of pl.byId) if (!seen.has(id)) { s.visible = false; pl.byId.delete(id); pl.free.push(s); }
    return out;
  }

  function zoomFor(viewW, viewH, dpr, preset) {
    const s = dpr * ((preset && preset.renderScale) || 1);
    return Math.max(1, Math.floor(Math.min(viewW * s / MIN_W, viewH * s / MIN_H)));
  }

  const r2 = v => Math.round(v * 100) / 100;
  // Blob shadow of an atlas frame: centre at the anchor; half-width 1.4x the footprint diamond's, at least 0.45 x frame
  // width, so it shows past the sprite's base.
  function blobOf(f) {
    const [x0, y0, x1, y1] = f.footprint, rx = Math.max(1.4 * K * (x1 - x0 + y1 - y0) / 2, 0.45 * f.w);
    return { cx: f.ax, cy: f.ay, rx: r2(rx), ry: r2(rx / 2) };
  }
  // Day/night light at an hour for a lighting level: sprite tint, window glow alpha and lamp pool alpha (0..1).
  function lightAt(hour, lighting) {
    const n = root.Graphics.nightOf(hour), glow = lighting === 'glow' || lighting === 'pools';
    return { tint: lighting === 'off' ? 0xffffff : root.Graphics.tintOf(n), glow: glow ? n : 0, pools: lighting === 'pools' ? n : 0 };
  }

  // The traveller under css px (cx, cy), front-most first: shown = id -> {x, y, name, dh}; left/top/zoom: the laid-out
  // camera; k: backing px per css px. -> {id, name, sx, sy (css px of its head)} or null. Shared by both renderers.
  function travellerHit(shown, cx, cy, left, top, zoom, k) {
    const tx = left + cx * k / zoom, ty = top + cy * k / zoom;
    let best = null;
    for (const [id, t] of shown) {
      const [sx, sy] = atGround(t.x, t.y);
      const hd = 30 + (t.dh || 0); // head height follows the sprite's height
      if (Math.abs(tx - sx) <= 10 && ty <= sy + 3 && ty >= sy - hd && (!best || depthOf(t.x, t.y) > best.d))
        best = { id, name: t.name, d: depthOf(t.x, t.y), sx: (sx - left) * zoom / k, sy: (sy - hd - top) * zoom / k };
    }
    return best && { id: best.id, name: best.name, sx: best.sx, sy: best.sy };
  }

  // View rect in terrain px for a camera on world (x, y): centred on it, clamped to the map (centred when the map is
  // smaller than the view). viewW/viewH: backing px. -> {left, top, w, h}. Shared by both renderers.
  function cameraRect(x, y, viewW, viewH, zoom, terrain) {
    const [px, py] = atGround(x, y), w = viewW / zoom, h = viewH / zoom, [tw, th] = terrain.size;
    const cl = (v, half, size) => size <= half * 2 ? size / 2 : Math.min(size - half, Math.max(half, v));
    return { left: cl(px, w / 2, tw) - w / 2, top: cl(py, h / 2, th) - h / 2, w, h };
  }
  // css px inside the canvas -> world x,y on the ground, for a laid-out view (k: backing px per css px). With land levels the
  // pixel's ray is marched from the front (nearest the camera) back until it meets the ground: the first hit is what the
  // pixel shows, so a hill top wins over the low ground hidden behind it. A hit on a level top or ramp is refined by
  // re-projecting at heightAt; a hit on a cliff face snaps to the low ground at the cliff's base, just in front of it.
  function toWorldAt(cx, cy, left, top, zoom, k) {
    const sx = left + cx * k / zoom, sy = top + cy * k / zoom, TM = root.TownMap, p0 = unproject(sx, sy);
    const top_ = M && TM ? Math.max(0, ...(M.levels || []).map(t => t.level)) * TM.LEVEL_H : 0;
    if (!top_) return p0;
    const H = (x, y) => TM.heightAt(M, x, y), STEP = 0.5, RISE = 2 * K2; // along the ray (+1, +1) per unit, z rises 2 x K2
    let prev = null;
    for (let s = Math.ceil(top_ / RISE / STEP) * STEP; s >= 0; s -= STEP) {
      const q = [p0[0] + s, p0[1] + s], z = s * RISE, h = H(q[0], q[1]);
      if (h < z - 1e-6) { prev = q; continue; }
      if (prev && H(prev[0], prev[1]) < h - 1e-6 && h - z > RISE * STEP + 1e-6) return prev; // entered under a higher top: a cliff face, so its base
      let p = unproject(sx, sy + h);
      for (let i = 0; i < 2; i++) p = unproject(sx, sy + H(p[0], p[1]));
      return p;
    }
    return p0;
  }
  // Backing store = css px x renderScale (G.renderScale already has the HiDPI cap applied, so dpr is 1 here), and the zoom.
  function backingSize(canvas, G) {
    const rs = G.renderScale, cw = canvas.clientWidth, ch = canvas.clientHeight;
    return { w: Math.max(1, Math.round(cw * rs)), h: Math.max(1, Math.round(ch * rs)), zoom: zoomFor(cw, ch, 1, G) };
  }
  // Day/night clock for render on demand: changed(G) is true once per move of the light key (night tenth | lighting |
  // shadows); a 60 s timer calls onStale only when the tenth moved and the page is visible. stop() on destroy.
  function lightClock(hour, onStale) {
    let key = '';
    const now = () => hour != null ? hour : new Date().getHours() + new Date().getMinutes() / 60;
    const bucket = () => Math.round(root.Graphics.nightOf(now()) * 10); // tints change per tenth of night, as the office's ensureBG
    const stale = () => !key.startsWith(bucket() + '|');
    const timer = setInterval(() => { if (!root.document.hidden && stale()) onStale(); }, 60000);
    return {
      now, stale,
      changed(G) { const k = bucket() + '|' + G.lighting + '|' + G.shadows; if (k === key) return false; key = k; return true; },
      reset() { key = ''; },
      stop() { clearInterval(timer); },
    };
  }

  // cam: top-left of the view in terrain px; view: its size in terrain px.
  function visibleChunks(cam, view, terrain) {
    const n = terrain.chunk, cl = v => Math.max(0, v);
    const c0 = cl(Math.floor(cam.x / n) - 1), r0 = cl(Math.floor(cam.y / n) - 1);
    const c1 = Math.min(terrain.cols - 1, Math.floor((cam.x + view.w - 1) / n) + 1);
    const r1 = Math.min(terrain.rows - 1, Math.floor((cam.y + view.h - 1) / n) + 1);
    const out = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ r, c });
    return out;
  }

  // fetch that must answer 2xx; one retry after a short wait, then the error is tagged asset (a network or server
  // problem, not a GPU one: the page must not fall back to Canvas2D for it).
  async function fetchOk(u, delay = 250) {
    for (let i = 0; ; i++) {
      try { const r = await root.fetch(u); if (r.ok) return r; throw new Error(u + ': HTTP ' + r.status); } catch (e) {
        if (i) { e.asset = true; throw e; }
        await new Promise(res => root.setTimeout(res, delay));
      }
    }
  }

  // graphics: Graphics.resolve(...) output. hour: a fixed hour (visual checks), else the clock.
  // A failed mount undoes what it built (Pixi app, paused system ticker, loaded textures) before it rejects.
  async function mount(canvas, opts) {
    const undo = [];
    try { return await build(canvas, opts, undo); } catch (e) { for (const f of undo.reverse()) try { f(); } catch {} throw e; }
  }
  // animals (town step 5): (t, on, visitors) -> [{id, kind, x, y, face: 'l' | 'r', frame}], asked on ambient frames.
  async function build(canvas, { map, atlasUrl, terrainUrl, graphics = root.Graphics.PRESETS.high, hour = null, animals = null }, undo) {
    const P = root.PIXI, SP = root.OfficeSprites;
    const getJson = async u => (await fetchOk(u)).json();
    const [atlas, terrain] = await Promise.all([getJson(atlasUrl), getJson(terrainUrl)]);
    O = terrain.originPx; M = map;
    const base = terrainUrl.replace(/[^/]*$/, '');
    const colourUrl = atlasUrl.replace(/\.json$/, '.png'), shadowUrl = atlasUrl.replace(/\.json$/, '-shadow.png'), glowUrl = atlasUrl.replace(/\.json$/, '-glow.png');
    const hasGlow = Object.values(atlas.frames).some(f => f.glow); // atlas-glow.png ships only with lit frames
    const chunkUrl = (r, c) => base + 'terrain/r' + r + 'c' + c + '.png';

    P.TextureStyle.defaultOptions.scaleMode = 'nearest';
    const app = new P.Application();
    undo.push(() => app.destroy({ removeView: false }, { children: true }));
    // e.gpu: WebGL could not start; only this failure makes the page give up on the GPU for the session
    await app.init({ canvas, preference: 'webgl', antialias: false, autoStart: false, resolution: 1, backgroundAlpha: 0 }).catch(e => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { gpu: true }); });
    // No frame loop (see header): app.ticker never starts (autoStart false); the system ticker is paused until destroy().
    const sys = P.Ticker.system, sysWas = { autoStart: sys.autoStart, started: sys.started };
    sys.autoStart = false; sys.stop();
    undo.push(() => { sys.autoStart = sysWas.autoStart; if (sysWas.started) sys.start(); });

    const urls = hasGlow ? [colourUrl, shadowUrl, glowUrl] : [colourUrl, shadowUrl];
    for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) urls.push(chunkUrl(r, c));
    P.Assets.setPreferences({ preferWorkers: false }); // the server's CSP has no worker-src, so Pixi's blob decode worker is blocked
    holdUrls(urls); undo.push(() => releaseUrls(urls));
    const tex = await P.Assets.load(urls, { strategy: 'retry', retryCount: 1, retryDelay: 250 }).catch(e => { e.asset = true; throw e; });
    let textureBytes = 0;
    for (const u of urls) textureBytes += tex[u].source.pixelWidth * tex[u].source.pixelHeight * 4;

    const cam = new P.Container(), ground = new P.Container(), shade = new P.Container(), world = new P.Container();
    const blobs = new P.Container(), soft = new P.Container(); // shade holds one of: blob ellipses, the shadow atlas
    const pools = new P.Container(); // lamp light on the ground, under the sprites (Ultra)
    const ambLow = new P.Container(); // water sparkles under the sprites; leaves and steam are depth-sorted in world, just after their emitter
    world.sortableChildren = true; pools.blendMode = 'add';
    shade.addChild(blobs, soft);
    cam.addChild(ground, shade, pools, ambLow, world);
    // One ellipse texture for every blob shadow, scaled per sprite.
    const BW = 64, BH = 32, bcv = document.createElement('canvas');
    bcv.width = BW; bcv.height = BH;
    const bx = bcv.getContext('2d');
    bx.fillStyle = 'rgba(26,34,64,0.35)'; bx.beginPath(); bx.ellipse(BW / 2, BH / 2, BW / 2, BH / 2, 0, 0, Math.PI * 2); bx.fill();
    const blobTex = new P.Texture({ source: new P.CanvasSource({ resource: bcv }) });
    textureBytes += BW * BH * 4;
    // One warm radial gradient for every lamp pool, squashed to the ground diamond's 2:1.
    const PW = 64, POOL_R = 34, pcv = document.createElement('canvas');
    pcv.width = pcv.height = PW;
    const pctx = pcv.getContext('2d'), grad = pctx.createRadialGradient(PW / 2, PW / 2, 0, PW / 2, PW / 2, PW / 2);
    grad.addColorStop(0, 'rgba(255,213,138,0.6)'); grad.addColorStop(0.5, 'rgba(255,213,138,0.25)'); grad.addColorStop(1, 'rgba(255,213,138,0)');
    pctx.fillStyle = grad; pctx.fillRect(0, 0, PW, PW);
    const poolTex = new P.Texture({ source: new P.CanvasSource({ resource: pcv }) });
    textureBytes += PW * PW * 4;
    // Ambient pixel sprites, drawn once: [colour, x, y] per pixel.
    const pix = (w, h, cells) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const x = cv.getContext('2d');
      for (const [c, px, py] of cells) { x.fillStyle = c; x.fillRect(px, py, 1, 1); }
      textureBytes += w * h * 4;
      return new P.Texture({ source: new P.CanvasSource({ resource: cv }) });
    };
    const sparkTex = pix(3, 3, [['#ffffff', 1, 1], ['#d8f4ff', 1, 0], ['#d8f4ff', 0, 1], ['#d8f4ff', 2, 1], ['#d8f4ff', 1, 2]]);
    const leafTex = [pix(2, 2, [['#b8d65a', 0, 0], ['#8fb43c', 1, 0], ['#b8d65a', 1, 1]]), pix(2, 2, [['#c98a2e', 0, 0], ['#a8681f', 1, 1], ['#c98a2e', 0, 1]])];
    const steamTex = pix(3, 3, [['#f2f2ee', 1, 0], ['#f2f2ee', 0, 1], ['#ffffff', 1, 1], ['#f2f2ee', 2, 1], ['#f2f2ee', 1, 2]]);
    const ambTex = [sparkTex, ...leafTex, steamTex];
    app.stage.addChild(cam);

    const chunks = [];
    for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) {
      const s = new P.Sprite(tex[chunkUrl(r, c)]);
      s.position.set(c * terrain.chunk, r * terrain.chunk);
      ground.addChild(s); chunks.push({ r, c, s });
    }

    const frames = {}, frameTex = (src, name) => {
      const f = atlas.frames[name], k = src.uid + name;
      return frames[k] || (frames[k] = new P.Texture({ source: src, frame: new P.Rectangle(f.x, f.y, f.w, f.h) }));
    };
    let sprites = chunks.length;
    const glows = new Set(), trees = new Map(); // trees: decor index -> colour sprite (ambient sway)
    const place = (type, x, y, decorId) => { // -> the colour sprite
      const f = atlas.frames[type];
      if (!f) return null;
      const [sx, sy] = atGround(x, y), px = Math.round(sx - f.ax), py = Math.round(sy - f.ay);
      let col = null;
      for (const [layer, src] of [[world, tex[colourUrl].source], [soft, tex[shadowUrl].source]]) {
        const s = new P.Sprite(frameTex(src, type));
        s.position.set(px, py); s.cullable = true; s.zIndex = depthOf(x, y);
        layer.addChild(s); sprites++;
        if (layer === world) col = s;
        if (layer === world && /^tree/.test(type)) { s.pivot.set(f.ax, f.ay); s.position.set(px + f.ax, py + f.ay); trees.set(decorId, s); } // sway skews about the foot
      }
      if (f.glow && hasGlow) { // lit windows: just after the colour sprite, untinted; alpha set by applyGraphics
        // Drawn over the pane, not added: the day pane is near-white, so adding warm light to it at night clips to white.
        const s = new P.Sprite(frameTex(tex[glowUrl].source, type));
        s.position.set(px, py); s.cullable = true; s.zIndex = depthOf(x, y) + 1e-4; s.visible = false;
        world.addChild(s); glows.add(s); sprites++;
      }
      if (type === 'lamp') {
        const s = new P.Sprite(poolTex);
        s.anchor.set(0.5); s.position.set(Math.round(sx), Math.round(sy)); s.scale.set(POOL_R * 2 / PW, POOL_R / PW); s.cullable = true;
        pools.addChild(s); sprites++;
      }
      if (f.footprint && f.footprint[2] > f.footprint[0]) { // fences, water and animals have no contact blob
        const b = blobOf(f), s = new P.Sprite(blobTex);
        s.anchor.set(0.5); s.position.set(px + b.cx, py + b.cy); s.scale.set(b.rx * 2 / BW, b.ry * 2 / BH); s.cullable = true;
        blobs.addChild(s); sprites++;
      }
      return col;
    };
    for (const l of map.lots) place(l.building.type, l.building.x, l.building.y);
    map.decor.forEach((d, i) => place(d.type, d.x, d.y, i));
    // Spots (town step 5): their props; the waterfall's colour sprite flips through waterfall.0..3 on ambient frames.
    const falls = [];
    for (const sp of map.spots || []) for (const p of sp.props || []) { const s = place(p.type, p.x, p.y); if (s && p.type === 'waterfall') falls.push({ s, x: p.x, y: p.y, name: p.type }); }
    // An atlas frame on a pooled sprite at world (x, y), z px up, mirrored for flip (animals face right): balls and dogs.
    const atlasSprite = () => { const s = new P.Sprite(P.Texture.EMPTY); s.cullable = true; world.addChild(s); sprites++; return s; };
    function putFrame(s, e) {
      const f = atlas.frames[e.frame];
      if (!f) { s.visible = false; return; }
      const [sx, sy] = atGround(e.x, e.y);
      s.texture = frameTex(tex[colourUrl].source, e.frame); s.anchor.set(f.ax / f.w, f.ay / f.h);
      s.position.set(Math.round(sx), Math.round(sy - (e.z || 0))); s.scale.x = e.flip ? -1 : 1;
      s.zIndex = depthOf(e.x, e.y) + 2e-3; s.tint = tintNow;
    }

    // Ambient (town step 4): sprites made once; animate(t) shows what the plan for G.ambient asks for.
    const AMB = root.TownAmbient, sparkles = [], parts = [];
    for (const q of AMB.plan(map, 'water').water) {
      const [sx, sy] = atGround(q.x, q.y), s = new P.Sprite(sparkTex);
      s.position.set(Math.round(sx) - 1, Math.round(sy) - 1); s.cullable = true; s.visible = false;
      ambLow.addChild(s); sparkles.push(s); sprites++;
    }
    // Particles draw just after their emitter (tree or karinderya), so a building in front hides them: each emitter has a
    // fixed container in world at its depth, and a respawning particle moves into its new emitter's container (no zIndex
    // change, so world is never re-sorted for it).
    const emitBox = new Map(), emitKey = e => e.kind + e.x + ',' + e.y;
    for (const e of AMB.plan(map, 'particles').particles) {
      const c = new P.Container(); c.zIndex = depthOf(e.x, e.y) + 2e-4; world.addChild(c); emitBox.set(emitKey(e), c);
    }
    for (let i = 0; i < AMB.MAX_LIVE; i++) { const s = new P.Sprite(P.Texture.EMPTY); s.cullable = true; s.visible = false; parts.push(s); sprites++; }
    const START = { leaf: [-4, -44], steam: [-30, -96] }; // particle start, screen px from the emitter's ground point (canopy; karinderya roof)
    const treeList = [...trees].map(([id, s]) => ({ id, s, on: false })), live = []; // made once: animate() allocates nothing
    let plan = AMB.plan(map, 'off'), ambRaf = 0, ambLast = -1e9, ambT = 0, renderTs = -1;
    const replan = () => {
      plan = AMB.plan(map, G.ambient);
      const ids = new Set(plan.trees.map(t => t.id));
      for (const t of treeList) t.on = ids.has(t.id);
      for (const e of plan.particles) { const [sx, sy] = atGround(e.x, e.y), o = START[e.kind]; e.px = Math.round(sx) + o[0]; e.py = Math.round(sy) + o[1]; e.box = emitBox.get(emitKey(e)); }
    };
    function animate(t) {
      ambT = t;
      const fk = plan.falls.length ? 'waterfall.' + (Math.floor(t / 160) % 4) : 'waterfall';
      for (const w of falls) if (w.name !== fk && atlas.frames[fk]) {
        const f = atlas.frames[fk], [sx, sy] = atGround(w.x, w.y);
        w.name = fk; w.s.texture = frameTex(tex[colourUrl].source, fk); w.s.position.set(Math.round(sx - f.ax), Math.round(sy - f.ay));
      }
      if (travOn !== plan.visitors || (plan.visitors && trav.some(v => v.pose === 'shoot' || v.pose === 'dogwalk'))) drawTrav(); // spot activities move only on ambient frames
      if (animals && (plan.visitors || zooOn !== plan.visitors)) drawZoo(); // animals walk on ambient frames; otherwise they rest
      const water = plan.water.length > 0;
      for (let i = 0; i < sparkles.length; i++) sparkles[i].visible = water && AMB.sparkleOn(i, t);
      for (let i = 0; i < treeList.length; i++) { const { s, id, on } = treeList[i]; s.skew.x = on ? -AMB.sway(id, t) / s.pivot.y : 0; } // crown moves sway px (sin x ~ x)
      AMB.particles(plan.particles, t, live);
      for (let i = 0; i < parts.length; i++) {
        const s = parts[i], q = live[i];
        if (!q || q.a <= 0) { s.visible = false; continue; }
        s.texture = q.kind === 'steam' ? steamTex : leafTex[i % 2];
        if (s.parent !== q.e.box) q.e.box.addChild(s);
        s.position.set(q.e.px + q.dx, q.e.py + q.dy); s.alpha = q.a; s.visible = true;
      }
    }

    // Player: one sprite whose texture comes from a small LRU of OfficeSprites canvases.
    const player = new P.Sprite(P.Texture.EMPTY);
    player.visible = false; world.addChild(player); sprites++;
    const charTex = new Map(), crowd = pool(), shown = new Map(); // shown: traveller id -> {x, y, name}
    let crowdOn = false, travKeys = new Set(), playerKey = null; // texture keys on screen: never evicted
    // trav: the last setTravellers list; travOn: plan.visitors when it was last drawn. Parked visitors (pose: their spot act)
    // are posed by TownAmbient.visit at the last ambient time, so a traveller frame never undoes an ambient one.
    let trav = [], travOn = false;
    const extras = pool(), zoo = pool(), leash = new P.Graphics();
    let zooOn = null;
    leash.visible = false; world.addChild(leash);
    function charTexture(look, view, pose, frame, dir) {
      const key = [look.sig, view, pose, frame, dir].join('/');
      let t = charTex.get(key);
      if (t) { charTex.delete(key); charTex.set(key, t); return [t, key]; }
      const g = SP.get(look, view, pose, frame, dir);
      t = new P.Texture({ source: new P.CanvasSource({ resource: g.cv }) });
      charTex.set(key, t); textureBytes += g.w * g.h * 4;
      for (const t0 of lruEvict(charTex, CHAR_CAP, new Set([...travKeys, playerKey, key]))) { textureBytes -= t0.width * t0.height * 4; t0.destroy(true); }
      return [t, key];
    }

    function put(s, x, y, face, pose, frame, look) {
      const c = charPlace(x, y, face);
      const [t, key] = charTexture(look, c.view, pose, frame, c.dir);
      s.texture = t; s.tint = tintNow;
      s.scale.x = c.flip ? -1 : 1;
      s.position.set(c.px, c.py - (s.texture.height - SP.H)); // a short/tall sprite keeps its feet on the ground point
      s.zIndex = c.z; // ties: characters after sprites
      s.visible = true;
      return key;
    }

    function drawZoo() {
      zooOn = plan.visitors;
      const list = animals(ambT, plan.visitors, trav).map(a => ({ id: a.id, frame: a.kind + '.' + a.frame, x: a.x, y: a.y, flip: a.face === 'l' }));
      for (const [e, s] of syncPool(zoo, list, atlasSprite)) putFrame(s, e);
    }
    function drawTrav() {
      shown.clear(); travKeys = new Set(); travOn = plan.visitors;
      const more = [], lines = [];
      for (const [t, s] of syncPool(crowd, trav, () => { const s = new P.Sprite(P.Texture.EMPTY); world.addChild(s); sprites++; return s; })) {
        const v = t.pose && t.pose !== 'walk' ? AMB.visit(t, ambT, map, plan.visitors) : t;
        travKeys.add(put(s, v.x, v.y, v.face, v.pose || 'walk', v.frame, t.look));
        shown.set(t.id, { x: v.x, y: v.y, name: t.name, dh: s.texture.height - SP.H });
        if (v.ball) more.push({ id: 'ball:' + t.id, frame: 'ball', x: v.ball.x, y: v.ball.y, z: v.ball.z });
        if (v.dog) { more.push({ id: 'dog:' + t.id, frame: 'dog.' + v.dog.frame, x: v.dog.x, y: v.dog.y, flip: v.dog.face === 's' || v.dog.face === 'w' }); lines.push([v, v.dog]); }
      }
      for (const [e, s] of syncPool(extras, more, atlasSprite)) putFrame(s, e);
      if (!lines.length && !leash.visible) return;
      leash.clear(); let z = 0;
      for (const [v, d] of lines) { // hand to collar, 1 px
        const [hx, hy] = atGround(v.x, v.y), [dx, dy] = atGround(d.x, d.y);
        leash.moveTo(Math.round(hx) + 5, Math.round(hy) - 9).lineTo(Math.round(dx), Math.round(dy) - 5); z = Math.max(z, depthOf(v.x, v.y));
      }
      if (lines.length) leash.stroke({ width: 1, color: 0x3a2416 });
      leash.visible = lines.length > 0; leash.zIndex = z + 3e-3; leash.tint = tintNow;
    }

    // Count GL draw calls per render (WebGL only).
    let drawCalls = 0, lastDraws = 0;
    const gl = app.renderer.gl;
    if (gl) for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = gl[fn];
      if (orig) gl[fn] = function () { drawCalls++; return orig.apply(this, arguments); };
    }

    let camX = map.spawn.x, camY = map.spawn.y, zoom = 1, viewW = 1, viewH = 1;
    let left = 0, top = 0, dirty = true, raf = 0, frames_ = 0, lastRenderMs = 0, dead = false;
    let G = graphics, tintNow = 0xffffff;
    const clock = lightClock(hour, () => mark()); // render on demand: once a minute (and on becoming visible), re-render only if the night tenth moved
    function applyGraphics() {
      shade.visible = G.shadows !== 'off'; blobs.visible = G.shadows === 'blob'; soft.visible = G.shadows === 'soft' || G.shadows === 'tint';
      if (!clock.changed(G)) return;
      const h = clock.now();
      const L = lightAt(h, G.lighting);
      tintNow = ground.tint = ambLow.tint = L.tint;
      // world is tinted per sprite, not as a container: a container tint would also darken the additive glow sprites in it
      for (const s of world.children) if (!glows.has(s)) s.tint = L.tint;
      for (const s of glows) { s.alpha = L.glow; s.visible = L.glow > 0; }
      pools.alpha = L.pools; pools.visible = L.pools > 0;
      soft.tint = G.shadows === 'tint' ? root.Graphics.tintOf(root.Graphics.nightOf(h)) : 0xffffff;
    }
    const view = new P.Rectangle();

    function layout() {
      const v = cameraRect(camX, camY, viewW, viewH, zoom, terrain), vw = v.w, vh = v.h;
      left = v.left; top = v.top;
      cam.scale.set(zoom);
      cam.position.set(-Math.round(left * zoom), -Math.round(top * zoom));
      const on = new Set(visibleChunks({ x: left, y: top }, { w: vw, h: vh }, terrain).map(o => o.r * 100 + o.c));
      for (const ch of chunks) ch.s.visible = on.has(ch.r * 100 + ch.c);
    }

    function render(ts) {
      raf = 0;
      if (dead || !dirty || document.hidden) return;
      renderTs = ts;
      const t0 = performance.now();
      applyGraphics();
      layout();
      view.width = viewW; view.height = viewH;
      P.Culler.shared.cull(app.stage, view, false); // false: cull with this frame's transforms, not the last render's
      drawCalls = 0;
      app.render();
      lastDraws = drawCalls; dirty = false; frames_++;
      lastRenderMs = performance.now() - t0;
    }
    const mark = () => { dirty = true; if (!raf && !dead && !document.hidden) raf = requestAnimationFrame(render); };
    const ambOn = () => !dead && !document.hidden && G.ambientFps > 0 && !AMB.isEmpty(plan);
    function ambTick(now) {
      ambRaf = 0;
      if (!ambOn()) return; // hidden, ambient off or 0 fps: the loop ends; onVis / setGraphics restart it
      if (AMB.frameDue(ambLast, now, G.ambientFps)) {
        ambLast = now; animate(now);
        if (raf || now === renderTs) mark(); else { dirty = true; render(now); } // a render already queued or done this rAF draws it
      }
      ambRaf = requestAnimationFrame(ambTick);
    }
    const ambStart = () => { if (!ambRaf && ambOn()) ambRaf = requestAnimationFrame(ambTick); };
    const onVis = () => { if (!document.hidden && (dirty || clock.stale())) mark(); ambStart(); };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextrestored', mark);
    app.stage.eventMode = 'none'; // input is DOM-only: skip Pixi's per-move hit-testing

    function resize() {
      const { w, h, zoom: z } = backingSize(canvas, G);
      zoom = z;
      if (w !== viewW || h !== viewH) { viewW = w; viewH = h; app.renderer.resize(w, h); }
      mark();
    }
    resize();
    replan(); animate(0); ambStart();

    return {
      kind: 'gpu',
      setPlayer({ x, y, face = 's', pose = 'stand', frame = 0, look }) {
        playerKey = put(player, x, y, face, pose, frame, look);
        mark();
      },
      // Agents walking the town: [{id, x, y, face, frame, look, name}]. Pooled sprites; renders only when something shows or just hid.
      setTravellers(list) {
        if (!list.length && !crowdOn) return;
        trav = list; drawTrav(); if (animals) drawZoo(); // a dog walker takes its dog off the herd
        crowdOn = list.length > 0;
        mark();
      },
      // The traveller under css px (cx, cy) inside the canvas, as {id, name, sx, sy (css px of its head)}, or null.
      travellerAt(cx, cy) {
        layout();
        return travellerHit(shown, cx, cy, left, top, zoom, viewW / canvas.clientWidth);
      },
      // css px inside the canvas -> world x,y at ground level (uses the last laid-out camera, so call after a render)
      toWorld(cx, cy) { layout(); return toWorldAt(cx, cy, left, top, zoom, viewW / canvas.clientWidth); },
      // world (x, y), `up` terrain px above the ground -> css px inside the canvas (the scenery bubble's anchor)
      toScreen(x, y, up = 0) { layout(); const [sx, sy] = atGround(x, y), k = viewW / canvas.clientWidth; return [(sx - left) * zoom / k, (sy - up - top) * zoom / k]; },
      setCamera(x, y) { camX = x; camY = y; mark(); },
      resize,
      setGraphics(g) {
        const rs = G.renderScale, amb = G.ambient; G = g; clock.reset();
        if (g.ambient !== amb) { replan(); animate(ambT); }
        if (g.renderScale !== rs) resize(); else mark();
        ambStart();
      },
      frameCount: () => frames_,
      stats: () => ({ textureBytes, sprites, drawCalls: lastDraws, lastRenderMs, graphics: G }),
      destroy() {
        dead = true;
        clock.stop();
        if (raf) cancelAnimationFrame(raf);
        if (ambRaf) cancelAnimationFrame(ambRaf);
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('webglcontextrestored', mark);
        for (const t of charTex.values()) t.destroy(true);
        blobTex.destroy(true); poolTex.destroy(true); for (const t of ambTex) t.destroy(true);
        for (const s of parts) if (!s.parent) s.destroy(); // never shown: not in world, so app.destroy misses it
        charTex.clear();
        app.destroy({ removeView: false }, { children: true });
        releaseUrls(urls);
        sys.autoStart = sysWas.autoStart; if (sysWas.started) sys.start();
      },
    };
  }

  // PIXI.Assets is one cache for the page: a remount (renderer swap, party lots) loads the same files while the old
  // renderer still holds them, so a file is unloaded only when the last renderer using it lets go.
  const held = new Map();
  const holdUrls = urls => { for (const u of urls) held.set(u, (held.get(u) || 0) + 1); };
  function releaseUrls(urls) {
    const free = [];
    for (const u of urls) { const n = (held.get(u) || 1) - 1; if (n > 0) held.set(u, n); else { held.delete(u); free.push(u); } }
    if (free.length) root.PIXI.Assets.unload(free);
  }
  root.TownRender = { K, CHAR_CAP, setOrigin: o => { O = o; }, setMap: m => { M = m; }, ground: atGround, travellerHit, cameraRect, toWorldAt, backingSize, lightClock, blobOf, lightAt, project, unproject, zoomFor, visibleChunks, depthOf, charPlace, faceAlong, walkFrame, STRIDE, pool, syncPool, lruEvict, fetchOk, mount };
})(globalThis);
