// Canvas2D town renderer (town step 4): the Low preset, and the fallback when WebGL is unavailable. Classic script after
// town-render.js: root.TownRender2D, the same api as TownRender.mount plus kind 'canvas', built on its pure helpers.
// Draws the chunked ground, shadows (blob ellipses or the shadow sheet), sprites and characters in depth order, the
// day/night tint and the window glow. No ambient animation and no lamp pools (spec §12), so there is no frame loop:
// it renders on demand only, and ambient settings are ignored.
(function (root) {
  'use strict';
  const R = root.TownRender;
  const hex = n => '#' + n.toString(16).padStart(6, '0');

  // rgba bytes in place: rgb multiplied by the 0xRRGGBB tint (rounded), alpha untouched.
  function mulTint(px, tint) {
    const r = (tint >> 16 & 255) / 255, g = (tint >> 8 & 255) / 255, b = (tint & 255) / 255;
    for (let i = 0; i < px.length; i += 4) { px[i] = Math.round(px[i] * r); px[i + 1] = Math.round(px[i + 1] * g); px[i + 2] = Math.round(px[i + 2] * b); }
    return px;
  }

  async function mount(canvas, { map, atlasUrl, terrainUrl, graphics = root.Graphics.PRESETS.low, hour = null }) {
    const SP = root.OfficeSprites;
    const cx = canvas.getContext('2d');
    if (!cx) throw new Error('Canvas2D unavailable');
    const get = R.fetchOk; // one retry, then an asset error
    const [atlas, terrain] = await Promise.all([atlasUrl, terrainUrl].map(async u => (await get(u)).json()));
    R.setOrigin(terrain.originPx); R.setMap(map);
    const base = terrainUrl.replace(/[^/]*$/, ''), n = terrain.chunk;
    const colourUrl = atlasUrl.replace(/\.json$/, '.png'), shadowUrl = atlasUrl.replace(/\.json$/, '-shadow.png'), glowUrl = atlasUrl.replace(/\.json$/, '-glow.png');
    const hasGlow = Object.values(atlas.frames).some(f => f.glow); // atlas-glow.png ships only with lit frames
    const chunkUrl = (r, c) => base + 'terrain/r' + r + 'c' + c + '.png';
    const urls = hasGlow ? [colourUrl, shadowUrl, glowUrl] : [colourUrl, shadowUrl];
    for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) urls.push(chunkUrl(r, c));
    const imgs = await Promise.all(urls.map(async u => createImageBitmap(await (await get(u)).blob())));
    const img = {};
    let textureBytes = 0;
    urls.forEach((u, i) => { img[u] = imgs[i]; textureBytes += imgs[i].width * imgs[i].height * 4; });
    // One ellipse for every blob shadow, scaled per sprite (as the GPU path).
    const BW = 64, BH = 32, bcv = document.createElement('canvas');
    bcv.width = BW; bcv.height = BH;
    const bx = bcv.getContext('2d');
    bx.fillStyle = 'rgba(26,34,64,0.35)'; bx.beginPath(); bx.ellipse(BW / 2, BH / 2, BW / 2, BH / 2, 0, 0, Math.PI * 2); bx.fill();
    textureBytes += BW * BH * 4;

    // Static sprites, sorted once by depth: {f, px, py, z, glow, blob}.
    const items = [];
    const place = (type, x, y) => {
      const f = atlas.frames[type];
      if (!f) return;
      const [sx, sy] = R.ground(x, y);
      items.push({ f, px: Math.round(sx - f.ax), py: Math.round(sy - f.ay), z: R.depthOf(x, y), glow: !!(f.glow && hasGlow), blob: f.footprint && R.blobOf(f) });
    };
    for (const l of map.lots) place(l.building.type, l.building.x, l.building.y);
    for (const d of map.decor) place(d.type, d.x, d.y);
    items.sort((a, b) => a.z - b.z);

    // Tinted copies (multiply by the tint, alpha kept), one per source image, rebuilt when the tint moves a tenth.
    const tints = new Map(); // source -> {tint, cv}
    function tinted(src, tint) {
      if (tint === 0xffffff) return src;
      const e = tints.get(src);
      if (e && e.tint === tint) { tints.delete(src); tints.set(src, e); return e.cv; }
      const cv = document.createElement('canvas'), w = cv.width = src.width, h = cv.height = src.height, x = cv.getContext('2d');
      // Per pixel, as the GPU tint does: rgb x tint, alpha kept. A 'multiply' fill over semi-transparent pixels (the shadow
      // sheet) blends the fill with the backdrop's transparency (about 0.65 tint + 0.35 tint x src), so shadows got lighter.
      x.drawImage(src, 0, 0);
      const d = x.getImageData(0, 0, w, h); mulTint(d.data, tint); x.putImageData(d, 0, 0);
      if (e) textureBytes -= e.cv.width * e.cv.height * 4;
      tints.set(src, { tint, cv }); textureBytes += w * h * 4;
      // character copies come and go with walk frames: cap them as the GPU char cache, never dropping one on screen
      const keep = new Set([img[colourUrl], img[shadowUrl], src, ...chars().map(c => c.cv)]);
      for (const o of R.lruEvict(tints, R.CHAR_CAP, keep)) textureBytes -= o.cv.width * o.cv.height * 4;
      return cv;
    }

    // Characters: {cv, px, py, z, flip}, placed by charPlace as the GPU put().
    let player = null, trav = [];
    const shown = new Map(); // traveller id -> {x, y, name, dh}
    const chars = () => player ? trav.concat(player) : trav;
    function charItem(x, y, face, pose, frame, look) {
      const c = R.charPlace(x, y, face), g = SP.get(look, c.view, pose, frame, c.dir);
      return { cv: g.cv, w: g.w, h: g.h, px: c.px, py: c.py - (g.h - SP.H), z: c.z, flip: c.flip }; // a short/tall sprite keeps its feet on the ground point
    }

    let camX = map.spawn.x, camY = map.spawn.y, zoom = 1, viewW = 1, viewH = 1;
    let left = 0, top = 0, dirty = true, raf = 0, frames_ = 0, lastRenderMs = 0, draws = 0, lastDraws = 0, dead = false;
    let G = graphics, L = R.lightAt(12, 'off'), shadowTint = 0xffffff;
    const clock = R.lightClock(hour, () => mark()); // the GPU path's day/night clock: no extra frames
    function applyGraphics() {
      if (!clock.changed(G)) return;
      const h = clock.now();
      L = R.lightAt(h, G.lighting);
      shadowTint = G.shadows === 'tint' ? root.Graphics.tintOf(root.Graphics.nightOf(h)) : 0xffffff;
      if (L.tint === 0xffffff && shadowTint === 0xffffff) { // day: nothing is tinted, so drop the night copies and scratch
        for (const e of tints.values()) textureBytes -= e.cv.width * e.cv.height * 4;
        tints.clear(); gcv.width = gcv.height = 1;
      }
    }

    function layout() { ({ left, top } = R.cameraRect(camX, camY, viewW, viewH, zoom, terrain)); }

    const gcv = document.createElement('canvas'), gx = gcv.getContext('2d'); // night ground scratch (view-sized when used)
    const draw = (...a) => { cx.drawImage(...a); draws++; };
    function render() {
      raf = 0;
      if (dead || !dirty || document.hidden) return;
      const t0 = performance.now();
      applyGraphics();
      layout();
      draws = 0;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
      cx.clearRect(0, 0, viewW, viewH);
      cx.imageSmoothingEnabled = false;
      const vw = viewW / zoom, vh = viewH / zoom, on = (x, y, w, h) => x < left + vw && x + w > left && y < top + vh && y + h > top;
      // visibleChunks keeps a 1-chunk margin for the GPU culler; here only chunks that overlap the view are drawn
      const ground = R.visibleChunks({ x: left, y: top }, { w: vw, h: vh }, terrain).filter(({ r, c }) => on(c * n, r * n, n, n));
      const T = [zoom, 0, 0, zoom, -Math.round(left * zoom), -Math.round(top * zoom)];
      cx.setTransform(...T);
      if (L.tint === 0xffffff) for (const { r, c } of ground) draw(img[chunkUrl(r, c)], c * n, r * n);
      else { // tint: the ground goes to a scratch canvas, then multiply by the tint, keeping only the ground's own pixels
        // (one destination-in draw: per chunk, each would erase the chunks drawn before it)
        if (gcv.width !== viewW || gcv.height !== viewH) { gcv.width = viewW; gcv.height = viewH; }
        gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, viewW, viewH); gx.imageSmoothingEnabled = false; gx.setTransform(...T);
        for (const { r, c } of ground) { gx.drawImage(img[chunkUrl(r, c)], c * n, r * n); draws++; }
        cx.setTransform(1, 0, 0, 1, 0, 0);
        draw(gcv, 0, 0);
        cx.globalCompositeOperation = 'multiply'; cx.fillStyle = hex(L.tint); cx.fillRect(0, 0, viewW, viewH);
        cx.globalCompositeOperation = 'destination-in'; draw(gcv, 0, 0);
        cx.globalCompositeOperation = 'source-over';
        cx.setTransform(...T);
      }
      const vis = items.filter(it => on(it.px, it.py, it.f.w, it.f.h));
      if (G.shadows === 'blob') {
        for (const it of items) {
          const b = it.blob;
          if (b && on(it.px + b.cx - b.rx, it.py + b.cy - b.ry, b.rx * 2, b.ry * 2)) draw(bcv, it.px + b.cx - b.rx, it.py + b.cy - b.ry, b.rx * 2, b.ry * 2);
        }
      } else if (G.shadows === 'soft' || G.shadows === 'tint') {
        const src = tinted(img[shadowUrl], shadowTint);
        for (const { f, px, py } of vis) draw(src, f.x, f.y, f.w, f.h, px, py, f.w, f.h);
      }
      const colour = tinted(img[colourUrl], L.tint);
      const list = vis.concat(chars().filter(c => on(c.flip ? c.px - c.w : c.px, c.py, c.w, c.h))).sort((a, b) => a.z - b.z);
      for (const it of list) {
        if (it.cv) {
          const src = tinted(it.cv, L.tint);
          if (it.flip) { cx.save(); cx.translate(it.px, it.py); cx.scale(-1, 1); draw(src, 0, 0); cx.restore(); } else draw(src, it.px, it.py);
          continue;
        }
        const f = it.f;
        draw(colour, f.x, f.y, f.w, f.h, it.px, it.py, f.w, f.h);
        // lit windows over the pane, untinted, normal blend: adding warm light to the near-white day pane clips to white
        if (it.glow && L.glow > 0) { cx.globalAlpha = L.glow; draw(img[glowUrl], f.x, f.y, f.w, f.h, it.px, it.py, f.w, f.h); cx.globalAlpha = 1; }
      }
      lastDraws = draws; dirty = false; frames_++;
      lastRenderMs = performance.now() - t0;
    }
    const mark = () => { dirty = true; if (!raf && !dead && !document.hidden) raf = requestAnimationFrame(render); };
    const onVis = () => { if (!document.hidden && (dirty || clock.stale())) mark(); };
    document.addEventListener('visibilitychange', onVis);

    function resize() {
      const { w, h, zoom: z } = R.backingSize(canvas, G); // the browser upscales it pixelated
      zoom = z;
      if (w !== viewW || h !== viewH) { viewW = canvas.width = w; viewH = canvas.height = h; }
      mark();
    }
    resize();

    return {
      kind: 'canvas',
      setPlayer({ x, y, face = 's', pose = 'stand', frame = 0, look }) { player = charItem(x, y, face, pose, frame, look); mark(); },
      setTravellers(list) {
        if (!list.length && !trav.length) return;
        shown.clear();
        trav = list.map(t => {
          const c = charItem(t.x, t.y, t.face, 'walk', t.frame, t.look);
          shown.set(t.id, { x: t.x, y: t.y, name: t.name, dh: c.h - SP.H });
          return c;
        });
        mark();
      },
      travellerAt(x, y) { layout(); return R.travellerHit(shown, x, y, left, top, zoom, viewW / canvas.clientWidth); },
      toWorld(x, y) { layout(); return R.toWorldAt(x, y, left, top, zoom, viewW / canvas.clientWidth); },
      setCamera(x, y) { camX = x; camY = y; mark(); },
      resize,
      setGraphics(g) {
        const rs = G.renderScale; G = g; clock.reset();
        if (g.renderScale !== rs) resize(); else mark();
      },
      frameCount: () => frames_,
      stats: () => ({ textureBytes, sprites: items.length + chars().length, drawCalls: lastDraws, lastRenderMs, graphics: G }),
      destroy() {
        dead = true;
        clock.stop();
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        for (const i of imgs) if (i.close) i.close();
        tints.clear();
      },
    };
  }

  root.TownRender2D = { mount, mulTint };
})(globalThis);
