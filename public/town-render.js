// Town renderer: draws the pre-rendered town (terrain chunks + atlas sprites + the player) with PixiJS v8, only when
// something changed. Classic script: root.TownRender. The pure helpers never touch PIXI, so tests load this without it.
(function (root) {
  'use strict';
  const K = 0.7071, K2 = 0.3536;
  const MIN_W = 900, MIN_H = 560; // css px of map that must stay in view
  const CHAR_CAP = 64;
  const FEET = [9, 25]; // OfficeSprites pixel under the feet (same as office-world drawPerson)
  let O = [961, 4]; // terrain.json originPx; mount() replaces it with the loaded value

  const project = (x, y, z) => [O[0] + K * (x - y), O[1] + K2 * (x + y) - z];
  const depthOf = (x, y) => x + y;

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
    // No frame loop: Pixi's own tickers (app, shared, and the system one its event plugin uses) stay stopped.
    for (const t of [app.ticker, P.Ticker.shared, P.Ticker.system]) { t.autoStart = false; t.stop(); }

    const urls = [colourUrl, shadowUrl];
    for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) urls.push(chunkUrl(r, c));
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
    const charTex = new Map();
    function charTexture(look, view, pose, frame, dir) {
      const key = [look.sig, view, pose, frame, dir].join('/');
      let t = charTex.get(key);
      if (t) { charTex.delete(key); charTex.set(key, t); return t; }
      const g = SP.get(look, view, pose, frame, dir);
      t = new P.Texture({ source: new P.CanvasSource({ resource: g.cv }) });
      charTex.set(key, t); textureBytes += g.w * g.h * 4;
      if (charTex.size > CHAR_CAP) {
        const [k0, t0] = charTex.entries().next().value;
        charTex.delete(k0); t0.destroy(true); textureBytes -= SP.W * SP.H * 4;
      }
      return t;
    }

    // Count GL draw calls per render (WebGL only).
    let drawCalls = 0, lastDraws = 0;
    const gl = app.renderer.gl;
    if (gl) for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = gl[fn];
      if (orig) gl[fn] = function () { drawCalls++; return orig.apply(this, arguments); };
    }

    let camX = map.spawn.x, camY = map.spawn.y, zoom = 1, viewW = 1, viewH = 1;
    let dirty = true, raf = 0, frames_ = 0, lastRenderMs = 0, dead = false;
    const view = new P.Rectangle();

    function layout() {
      const [px, py] = project(camX, camY, 0), vw = viewW / zoom, vh = viewH / zoom, [tw, th] = terrain.size;
      const cl = (v, half, size) => size <= half * 2 ? size / 2 : Math.min(size - half, Math.max(half, v));
      const left = cl(px, vw / 2, tw) - vw / 2, top = cl(py, vh / 2, th) - vh / 2;
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
      P.Culler.shared.cull(app.stage, view);
      drawCalls = 0;
      app.render();
      lastDraws = drawCalls; dirty = false; frames_++;
      lastRenderMs = performance.now() - t0;
    }
    const mark = () => { dirty = true; if (!raf && !dead && !document.hidden) raf = requestAnimationFrame(render); };
    const onVis = () => { if (!document.hidden && dirty) mark(); };
    document.addEventListener('visibilitychange', onVis);

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
        const front = face === 'e' || face === 's', dir = front ? (face === 's' ? -1 : 1) : 0;
        player.texture = charTexture(look, front ? 'f' : 'b', pose, frame, dir);
        const [sx, sy] = project(x, y, 0), flip = !front && face === 'w';
        player.scale.x = flip ? -1 : 1;
        player.position.set(Math.round(sx) + (flip ? FEET[0] : -FEET[0]), Math.round(sy) - FEET[1]);
        player.zIndex = depthOf(x, y) + 1e-3; // ties: characters after sprites
        player.visible = true;
        mark();
      },
      setCamera(x, y) { camX = x; camY = y; mark(); },
      resize,
      setShadows(mode) { shade.visible = mode !== 'off'; mark(); },
      frameCount: () => frames_,
      stats: () => ({ textureBytes, sprites, drawCalls: lastDraws, lastRenderMs }),
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        for (const t of charTex.values()) t.destroy(true);
        charTex.clear();
        app.destroy({ removeView: false }, { children: true });
        P.Assets.unload(urls);
      },
    };
  }

  root.TownRender = { project, zoomFor, visibleChunks, depthOf, mount };
})(globalThis);
