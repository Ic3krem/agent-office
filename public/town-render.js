// Town renderer: draws the pre-rendered town (terrain chunks + atlas sprites + the player) with PixiJS v8, only when
// something changed. Classic script: root.TownRender. The pure helpers never touch PIXI, so tests load this without it.
// Contract: input is DOM events only. While mounted, PIXI.Ticker.system is stopped (Pixi's scheduler and pointer-move
// ticking would otherwise run a rAF loop forever), so Pixi pointer events, AnimatedSprite and video textures do not tick.
// destroy() restores the ticker's previous state.
(function (root) {
  'use strict';
  const K = 0.7071, K2 = 0.3536;
  const MIN_W = 900, MIN_H = 560; // css px of map that must stay in view
  const CHAR_CAP = 128; // up to 12 travellers (MAX_DESKS) x 4 faces x 2 walk frames, plus the player: no eviction while walking
  const FEET = [9, 25]; // OfficeSprites pixel under the feet (same as office-world drawPerson)
  let O = [961, 4]; // terrain.json originPx; mount() replaces it with the loaded value

  const project = (x, y, z) => [O[0] + K * (x - y), O[1] + K2 * (x + y) - z];
  // Inverse of project at z = 0: terrain px -> world units.
  const unproject = (sx, sy) => { const u = (sx - O[0]) / K, v = (sy - O[1]) / K2; return [(u + v) / 2, (v - u) / 2]; };
  const depthOf = (x, y) => x + y;

  // Character placement on screen: the OfficeSprites view/dir for a face, a mirror for west, and depth after sprites at the same x+y.
  function charPlace(x, y, face) {
    const front = face === 'e' || face === 's', [sx, sy] = project(x, y, 0), flip = !front && face === 'w';
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

  async function mount(canvas, { map, atlasUrl, terrainUrl, shadows = 'soft' }) {
    const P = root.PIXI, SP = root.OfficeSprites;
    const getJson = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u + ': HTTP ' + r.status); return r.json(); };
    const [atlas, terrain] = await Promise.all([getJson(atlasUrl), getJson(terrainUrl)]);
    O = terrain.originPx;
    const base = terrainUrl.replace(/[^/]*$/, '');
    const colourUrl = atlasUrl.replace(/\.json$/, '.png'), shadowUrl = atlasUrl.replace(/\.json$/, '-shadow.png');
    const chunkUrl = (r, c) => base + 'terrain/r' + r + 'c' + c + '.png';

    P.TextureStyle.defaultOptions.scaleMode = 'nearest';
    const app = new P.Application();
    await app.init({ canvas, preference: 'webgl', antialias: false, autoStart: false, resolution: 1, backgroundAlpha: 0 });
    // No frame loop (see header): app.ticker never starts (autoStart false); the system ticker is paused until destroy().
    const sys = P.Ticker.system, sysWas = { autoStart: sys.autoStart, started: sys.started };
    sys.autoStart = false; sys.stop();

    const urls = [colourUrl, shadowUrl];
    for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) urls.push(chunkUrl(r, c));
    P.Assets.setPreferences({ preferWorkers: false }); // the server's CSP has no worker-src, so Pixi's blob decode worker is blocked
    const tex = await P.Assets.load(urls);
    let textureBytes = 0;
    for (const u of urls) textureBytes += tex[u].source.pixelWidth * tex[u].source.pixelHeight * 4;

    const cam = new P.Container(), ground = new P.Container(), shade = new P.Container(), world = new P.Container();
    world.sortableChildren = true;
    shade.visible = shadows !== 'off';
    cam.addChild(ground, shade, world);
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
    const place = (type, x, y) => {
      const f = atlas.frames[type];
      if (!f) return;
      const [sx, sy] = project(x, y, 0), px = Math.round(sx - f.ax), py = Math.round(sy - f.ay);
      for (const [layer, src] of [[world, tex[colourUrl].source], [shade, tex[shadowUrl].source]]) {
        const s = new P.Sprite(frameTex(src, type));
        s.position.set(px, py); s.cullable = true; s.zIndex = depthOf(x, y);
        layer.addChild(s); sprites++;
      }
    };
    for (const l of map.lots) place(l.building.type, l.building.x, l.building.y);
    for (const d of map.decor) place(d.type, d.x, d.y);

    // Player: one sprite whose texture comes from a small LRU of OfficeSprites canvases.
    const player = new P.Sprite(P.Texture.EMPTY);
    player.visible = false; world.addChild(player); sprites++;
    const charTex = new Map(), crowd = pool(), shown = new Map(); // shown: traveller id -> {x, y, name}
    let crowdOn = false;
    function charTexture(look, view, pose, frame, dir) {
      const key = [look.sig, view, pose, frame, dir].join('/');
      let t = charTex.get(key);
      if (t) { charTex.delete(key); charTex.set(key, t); return t; }
      const g = SP.get(look, view, pose, frame, dir);
      t = new P.Texture({ source: new P.CanvasSource({ resource: g.cv }) });
      charTex.set(key, t); textureBytes += g.w * g.h * 4;
      if (charTex.size > CHAR_CAP) {
        const [k0, t0] = charTex.entries().next().value;
        charTex.delete(k0); textureBytes -= t0.width * t0.height * 4; t0.destroy(true);
      }
      return t;
    }

    function put(s, x, y, face, pose, frame, look) {
      const c = charPlace(x, y, face);
      s.texture = charTexture(look, c.view, pose, frame, c.dir);
      s.scale.x = c.flip ? -1 : 1;
      s.position.set(c.px, c.py - (s.texture.height - SP.H)); // a short/tall sprite keeps its feet on the ground point
      s.zIndex = c.z; // ties: characters after sprites
      s.visible = true;
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
    const view = new P.Rectangle();

    function layout() {
      const [px, py] = project(camX, camY, 0), vw = viewW / zoom, vh = viewH / zoom, [tw, th] = terrain.size;
      const cl = (v, half, size) => size <= half * 2 ? size / 2 : Math.min(size - half, Math.max(half, v));
      left = cl(px, vw / 2, tw) - vw / 2; top = cl(py, vh / 2, th) - vh / 2;
      cam.scale.set(zoom);
      cam.position.set(-Math.round(left * zoom), -Math.round(top * zoom));
      const on = new Set(visibleChunks({ x: left, y: top }, { w: vw, h: vh }, terrain).map(o => o.r * 100 + o.c));
      for (const ch of chunks) ch.s.visible = on.has(ch.r * 100 + ch.c);
    }

    function render() {
      raf = 0;
      if (dead || !dirty || document.hidden) return;
      const t0 = performance.now();
      layout();
      view.width = viewW; view.height = viewH;
      P.Culler.shared.cull(app.stage, view, false); // false: cull with this frame's transforms, not the last render's
      drawCalls = 0;
      app.render();
      lastDraws = drawCalls; dirty = false; frames_++;
      lastRenderMs = performance.now() - t0;
    }
    const mark = () => { dirty = true; if (!raf && !dead && !document.hidden) raf = requestAnimationFrame(render); };
    const onVis = () => { if (!document.hidden && dirty) mark(); };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextrestored', mark);
    app.stage.eventMode = 'none'; // input is DOM-only: skip Pixi's per-move hit-testing

    function resize() {
      const dpr = root.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      zoom = zoomFor(canvas.clientWidth, canvas.clientHeight, dpr, { renderScale: 1 });
      if (w !== viewW || h !== viewH) { viewW = w; viewH = h; app.renderer.resize(w, h); }
      mark();
    }
    resize();

    return {
      setPlayer({ x, y, face = 's', pose = 'stand', frame = 0, look }) {
        put(player, x, y, face, pose, frame, look);
        mark();
      },
      // Agents walking the town: [{id, x, y, face, frame, look, name}]. Pooled sprites; renders only when something shows or just hid.
      setTravellers(list) {
        if (!list.length && !crowdOn) return;
        shown.clear();
        for (const [t, s] of syncPool(crowd, list, () => { const s = new P.Sprite(P.Texture.EMPTY); world.addChild(s); sprites++; return s; })) {
          put(s, t.x, t.y, t.face, 'walk', t.frame, t.look);
          shown.set(t.id, { x: t.x, y: t.y, name: t.name, dh: s.texture.height - SP.H });
        }
        crowdOn = list.length > 0;
        mark();
      },
      // The traveller under css px (cx, cy) inside the canvas, as {id, name, sx, sy (css px of its head)}, or null.
      travellerAt(cx, cy) {
        layout();
        const k = viewW / canvas.clientWidth, tx = left + cx * k / zoom, ty = top + cy * k / zoom;
        let best = null;
        for (const [id, t] of shown) {
          const [sx, sy] = project(t.x, t.y, 0);
          const hd = 30 + (t.dh || 0); // head height follows the sprite's height
          if (Math.abs(tx - sx) <= 10 && ty <= sy + 3 && ty >= sy - hd && (!best || depthOf(t.x, t.y) > best.d))
            best = { id, name: t.name, d: depthOf(t.x, t.y), sx: (sx - left) * zoom / k, sy: (sy - hd - top) * zoom / k };
        }
        return best && { id: best.id, name: best.name, sx: best.sx, sy: best.sy };
      },
      // css px inside the canvas -> world x,y at ground level (uses the last laid-out camera, so call after a render)
      toWorld(cx, cy) { layout(); const k = viewW / canvas.clientWidth; return unproject(left + cx * k / zoom, top + cy * k / zoom); },
      setCamera(x, y) { camX = x; camY = y; mark(); },
      resize,
      setShadows(mode) { shade.visible = mode !== 'off'; mark(); },
      frameCount: () => frames_,
      stats: () => ({ textureBytes, sprites, drawCalls: lastDraws, lastRenderMs }),
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('webglcontextrestored', mark);
        for (const t of charTex.values()) t.destroy(true);
        charTex.clear();
        app.destroy({ removeView: false }, { children: true });
        P.Assets.unload(urls);
        sys.autoStart = sysWas.autoStart; if (sysWas.started) sys.start();
      },
    };
  }

  root.TownRender = { project, unproject, zoomFor, visibleChunks, depthOf, charPlace, faceAlong, walkFrame, STRIDE, pool, syncPool, mount };
})(globalThis);
