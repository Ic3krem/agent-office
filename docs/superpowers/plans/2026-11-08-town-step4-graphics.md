# Town Step 4: Graphics Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A graphics panel offers Low / Medium / High / Ultra / Custom presets, with auto-detect on the first run. The settings drive every scene: render scale, fps cap, shadows, ambient animation, day/night lighting, and Canvas2D vs GPU. The step also closes the accepted step 2/3 memory-drift miss.

**Architecture:**
- One pure module, `public/graphics.js` (classic script, `root.Graphics`, loadable in node like `agent-travel.js`), owns:
  - the preset table;
  - normalising and resolving settings;
  - auto-detect;
  - the hour → night/tint helpers.
- Settings persist in `kiro.json` as `graphics`, through a `graphicsStore` like `lookStore`. Pages mirror them in localStorage `ao.graphics`, so the town page and other windows read them at boot and follow changes through the `storage` event.
- Renderers take a resolved settings object `G` through `setGraphics(G)`:
  - the town's Pixi renderer;
  - a new Canvas2D town renderer with the same API;
  - the office/interior Canvas2D renderer.
- Render-on-demand stays the rule. Only ambient animation adds frames, at the preset's fps cap.

**Tech Stack:** Vanilla JS classic scripts, PixiJS v8 (vendored), Canvas2D, Node `node:test`, Electron perf harness (`perf/*.cjs`), Blender 5.2 + Pillow for `npm run art`.

**Spec:** `docs/superpowers/specs/2026-11-06-town-world-design.md`: §8 "Rendering and performance", §11 item 4, §12 "Low preset (Canvas2D)".

## Global Constraints

- Presets, copied verbatim from spec §8:

| Setting | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Render scale | 0.5 | 0.75 | 1 | 1 (2× on HiDPI) |
| Animation fps cap | 15 | 30 | 30 | 60 |
| Shadows | off | simple (blob) | baked soft | baked soft + time-of-day tint |
| Ambient animation (water, trees, fire, fan) | off | water only | all | all + particles (leaves, steam) |
| Day/night lighting | off | tint only | tint + window glow | tint + glow + lamp light pools |
| Renderer | Canvas2D | GPU if available | GPU | GPU |

- Each setting can also be set on its own (Custom).
- Auto-detect on first run:
  - no GPU context, `deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4` → Low;
  - integrated GPU → Medium;
  - otherwise → High.
- "Reduced motion" and the power saver override animation.
- Stored in `kiro.json` as `graphics`. The panel opens from the bottom bar.
- Budgets are measured in Electron and recorded in a perf check that fails on regression:
  - idle renderer CPU < 1% on Low and < 3% on High; hidden window about 0%;
  - walking the town: frame < 8 ms on High and < 16 ms on Low (Canvas2D);
  - renderer process < 250 MB on High and < 180 MB on Low;
  - GPU textures < 96 MB on High and < 48 MB on Low;
  - no growth over enter/leave soaks (heap within ±10%);
  - shipped art < 8 MB total.
- Low preset (Canvas2D) keeps the chunked static ground and buildings, and drops water, tree sway, particles and light pools.
- No new runtime dependencies. Art is original, with provenance in `art/MANIFEST.json`. Builds and CI never run Blender.
- Repo is public: no personal names or paths (the share-ready test).
- Live checks use a temp USERPROFILE/HOME/APPDATA/LOCALAPPDATA and port 4790–4799, never 4795. Never touch 127.0.0.1:4777 or the real config dir.
- Every new `*.test.mjs` is added to the `npm test` list in `package.json`.
- Commits end with the session trailers given by the controller.

## Decisions this plan makes (the spec leaves them to the builder)

- **Settings shape (stored):**
  - `{ preset: 'low'|'medium'|'high'|'ultra'|'custom', custom?: {renderScale, fps, shadows, ambient, lighting, renderer} }`;
  - `custom` is used only when `preset === 'custom'`.
- **Value sets:**
  - `renderScale` ∈ {0.5, 0.75, 1, 2}. 2 means "1, 2× on HiDPI": the renderer uses `min(2, devicePixelRatio)`.
  - `fps` ∈ {15, 30, 60}.
  - `shadows` ∈ {'off','blob','soft','tint'}.
  - `ambient` ∈ {'off','water','all','particles'}.
  - `lighting` ∈ {'off','tint','glow','pools'}.
  - `renderer` ∈ {'canvas','auto','gpu'}. 'auto' and 'gpu' both use GPU when a WebGL context exists, else Canvas2D.
- **Overrides:**
  - Reduced motion (`prefers-reduced-motion` or `html[data-anim=off]`) sets `ambient` to 'off'.
  - Power saver on caps the ambient fps at 8 (the same cadence as seated animations).
  - A hidden window draws nothing.
- **Integrated GPU:** detected from `WEBGL_debug_renderer_info` `UNMASKED_RENDERER_WEBGL`, matching `/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d|apple m\d|adreno|mali|powervr/i`. If the string is unavailable, the GPU counts as discrete.
- **Night:** `nightOf(hour)` moves from `office-world.js` into `Graphics` (same formula), so both renderers share it.
- **Tint:**
  - `tintOf(night)` returns a multiply colour: `0xffffff` by day, `0xffd2a8` at dusk, `0x6f7fb8` at full night.
  - Above night 0.5 it is a linear blend from dusk to night; below it, from day to dusk.
- **Blob shadows:** an ellipse under each building/decor, from its atlas `footprint`: half-widths from the footprint, `#1a2240` at alpha 0.35. Made once as one canvas texture and scaled per sprite.
- **Leaving a building:** every scene is its own page, so navigation already frees that scene's textures. The "release after 30 s" rule is met by the page unloading. Task 9 checks the back/forward cache, the only way a page could stay resident.

## Review Focus

1. **A machine with no WebGL (or a lost context) on a GPU preset:** the town still loads, through Canvas2D, instead of the error box. Pinned in Task 7, which changes the `?failgl=1` check.
2. **A `kiro.json` graphics entry hand-edited to junk (unknown preset, out-of-range scale, wrong types):** it normalises to auto-detect or defaults and never throws. Pinned in Task 1 (`normalize`) and Task 2 (store).
3. **Two windows open, setting changed in one:** the other follows within one `storage` event, with no reload. Pinned in Task 2 (`Graphics.onChange`) and Task 4 (town applies it live).
4. **Power saver or reduced motion with Ultra:** ambient is capped or off, and an idle town with ambient 'off' renders 0 frames. Pinned in Task 6.
5. **Switching High → Low → High repeatedly:** no texture or context leak; texture bytes return to the first value. Pinned in Task 7 (renderer swap) and Task 9 (perf).

---

### Task 1: `Graphics` core (presets, resolve, detect, night)

**Files:**
- Create: `public/graphics.js`
- Modify: `public/office-world.js:264` (use `Graphics.nightOf`; delete the local copy) and the pages that load `office-world.js` (`public/Agent Office.html`; add `<script src="/graphics.js">` before it)
- Test: `graphics.test.mjs` (new; add to `package.json` test list)

**Interfaces:**
- Produces (on `globalThis.Graphics`):
  - `PRESETS`: `{low, medium, high, ultra}`, each `{renderScale, fps, shadows, ambient, lighting, renderer}` per the Global Constraints table.
  - `normalize(raw) -> {preset, custom?}`. Junk returns `null`, meaning "not set, detect".
  - `resolve(stored, env) -> G`. `env = {dpr, reduced, saver, webgl}`. `G = {renderScale (effective, after HiDPI), fps, ambientFps, shadows, ambient, lighting, renderer: 'canvas'|'gpu'}`.
  - `detect({webgl, gpuName, deviceMemory, cores}) -> 'low'|'medium'|'high'`.
  - `isIntegrated(name) -> boolean`.
  - `nightOf(hour) -> 0..1`.
  - `tintOf(night) -> 0xRRGGBB`.

- [ ] **Step 1: Write failing tests** in `graphics.test.mjs`. Load the file in a vm sandbox, as `agent-travel.test.mjs` does.

```js
test('presets match the spec table', () => {
  assert.deepEqual(G.PRESETS.low, { renderScale: .5, fps: 15, shadows: 'off', ambient: 'off', lighting: 'off', renderer: 'canvas' });
  assert.deepEqual(G.PRESETS.medium, { renderScale: .75, fps: 30, shadows: 'blob', ambient: 'water', lighting: 'tint', renderer: 'auto' });
  assert.deepEqual(G.PRESETS.high, { renderScale: 1, fps: 30, shadows: 'soft', ambient: 'all', lighting: 'glow', renderer: 'gpu' });
  assert.deepEqual(G.PRESETS.ultra, { renderScale: 2, fps: 60, shadows: 'tint', ambient: 'particles', lighting: 'pools', renderer: 'gpu' });
});
test('normalize: junk -> null, custom keeps only valid fields and fills the rest from high', () => {
  for (const j of [null, 5, 'x', { preset: 'mega' }, { preset: 'custom', custom: 'no' }]) assert.equal(G.normalize(j), null);
  assert.deepEqual(G.normalize({ preset: 'low', extra: 1 }), { preset: 'low' });
  assert.deepEqual(G.normalize({ preset: 'custom', custom: { fps: 60, shadows: 'nope', renderScale: 3 } }),
    { preset: 'custom', custom: { ...G.PRESETS.high, fps: 60 } });
});
test('resolve: ultra scale is min(2, dpr); no webgl forces canvas; reduced -> ambient off; saver caps ambientFps at 8', () => {
  const env = { dpr: 1.5, reduced: false, saver: false, webgl: true };
  assert.equal(G.resolve({ preset: 'ultra' }, env).renderScale, 1.5);
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, dpr: 3 }).renderScale, 2);
  assert.equal(G.resolve({ preset: 'high' }, { ...env, webgl: false }).renderer, 'canvas');
  assert.equal(G.resolve({ preset: 'medium' }, env).renderer, 'gpu');
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, reduced: true }).ambient, 'off');
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, saver: true }).ambientFps, 8);
  assert.equal(G.resolve({ preset: 'ultra' }, env).ambientFps, 60);
});
test('detect: spec rules', () => {
  const hi = { webgl: true, gpuName: 'NVIDIA GeForce RTX 3050', deviceMemory: 8, cores: 16 };
  assert.equal(G.detect(hi), 'high');
  assert.equal(G.detect({ ...hi, webgl: false }), 'low');
  assert.equal(G.detect({ ...hi, deviceMemory: 4 }), 'low');
  assert.equal(G.detect({ ...hi, cores: 4 }), 'low');
  assert.equal(G.detect({ ...hi, gpuName: 'Intel(R) UHD Graphics 620' }), 'medium');
  assert.equal(G.detect({ ...hi, gpuName: 'AMD Radeon(TM) Graphics' }), 'medium');
  assert.equal(G.detect({ ...hi, gpuName: '' }), 'high');
  assert.equal(G.detect({ ...hi, deviceMemory: undefined }), 'high'); // unknown memory is not low
});
test('nightOf matches the office formula; tintOf ends', () => {
  assert.equal(G.nightOf(12), 0); assert.equal(G.nightOf(22), 1); assert.equal(G.nightOf(19), .5); assert.equal(G.nightOf(6), .5);
  assert.equal(G.tintOf(0), 0xffffff); assert.equal(G.tintOf(.5), 0xffd2a8); assert.equal(G.tintOf(1), 0x6f7fb8);
});
```

- [ ] **Step 2:** Run `node --test graphics.test.mjs`. Expected: FAIL (file missing).
- [ ] **Step 3:** Implement `public/graphics.js` with the interfaces above. `tintOf` blends per channel, rounded. Replace `nightOf` in `office-world.js` with `root.Graphics.nightOf`, and add the script tag.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, `fail 0`.
- [ ] **Step 5:** Commit with the message `Town step 4: Graphics presets, resolve and auto-detect`.

### Task 2: Persisting settings (`kiro.json` `graphics`) and syncing them to pages

**Files:**
- Modify: `company.mjs` (add `graphicsStore(file)` next to `lookStore`, about :264)
- Modify: `server.mjs`:
  - create `graphicsBox` next to `lookBox` (about :83);
  - add `case '/api/graphics'` (returns `{graphics}`);
  - add `case '/api/graphics/set'` next to `/api/looks/set` (about :779), behind the same nonce/auth as `/api/looks/set`.
- Modify: `public/graphics.js` (client side: `load`, `save`, `onChange`, `probe`)
- Test: `graphics.test.mjs` (store and client), `security.test.mjs` (the new POST route needs the nonce, like `/api/looks/set`; follow how that file covers `looks/set`)

**Interfaces:**
- Consumes: `Graphics.normalize` (Task 1).
- Produces:
  - `graphicsStore(file) -> {get(): stored|null, set(raw): stored}`. `set` throws `Error('Invalid graphics settings')` when `normalize` returns null, and leaves the other `kiro.json` keys untouched.
  - `Graphics.probe() -> {webgl, gpuName, deviceMemory, cores}`. It uses a throwaway WebGL context and calls `WEBGL_lose_context` afterwards.
  - `Graphics.load(fetchFn?) -> Promise<stored>`:
    - reads `/api/graphics` (with the `x-nonce` header from the `ao_nonce` cookie, as `town.html` `officeFlags` does);
    - on `null`, runs `detect(probe())` and saves `{preset}`;
    - on a network failure, uses localStorage `ao.graphics`, else detect;
    - always writes the result to localStorage `ao.graphics`.
  - `Graphics.save(stored) -> Promise<stored>`: POSTs `/api/graphics/set` and mirrors the result to localStorage.
  - `Graphics.onChange(fn) -> unsubscribe`: calls `fn(stored)` on a `storage` event for `ao.graphics`, and also when this page calls `save`.
  - `Graphics.env() -> {dpr, reduced, saver, webgl}`, read live.

- [ ] **Step 1:** Write failing tests:
  - `graphicsStore`:
    - with a temp `kiro.json` containing `{looks:{...}, other:1}`, `set({preset:'low'})` keeps `looks` and `other`;
    - `get()` returns `{preset:'low'}`;
    - `set({preset:'x'})` throws;
    - a `kiro.json` with `graphics:'junk'` → `get()` returns `null`.
  - Client `load`, in a vm sandbox with fake `fetch`/`localStorage`:
    - server `null` → detect runs and `save` is POSTed once;
    - fetch rejects → the localStorage value is used.
  - `onChange` fires on a dispatched `storage` event.
- [ ] **Step 2:** Run `node --test graphics.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the store, the routes and the client functions. The route returns `400 {error}` on a throw, like `/api/looks/set`.
- [ ] **Step 4:** Run `npm test`. Expected: `fail 0`.
- [ ] **Step 5:** Commit with the message `Town step 4: graphics settings stored in kiro.json and shared by pages`.

### Task 3: Graphics panel in the bottom bar

**Files:**
- Modify: `public/Agent Office.html`:
  - add a "Graphics" pill beside the power-saver pill (about :189);
  - add a small panel window in the same style as the existing `.oo-win` panels, with `role=dialog`, `aria-modal`, and closing on Esc.
- Test: `graphics.test.mjs` (the copy and value lists are exported from `Graphics.UI`)

**Interfaces:**
- Consumes: `Graphics.PRESETS`, `Graphics.load/save/onChange` (Tasks 1–2).
- Produces: `Graphics.UI`, a list of rows `[{key, label, options: [[value, label], ...]}]`. Labels:
  - Render scale: 50% / 75% / 100% / 100% (2× HiDPI)
  - Frame rate cap: 15 / 30 / 60
  - Shadows: Off / Simple / Soft / Soft + time of day
  - Ambient animation: Off / Water only / All / All + particles
  - Day and night: Off / Tint / Tint + window glow / Tint + glow + lamp light
  - Renderer: Canvas2D / GPU if available / GPU
- Panel behaviour:
  - preset chips Low / Medium / High / Ultra / Custom, with the active one pressed;
  - changing any row switches to Custom, starting from the current resolved values;
  - picking a preset drops `custom`;
  - each change calls `Graphics.save` at once;
  - a note line under the panel reads "Reduced motion and Power saver slow or stop animation." while either is on.

- [ ] **Step 1:** Failing test: `Graphics.UI` has the 6 rows in that order, and every row's option values equal that setting's allowed set from Task 1.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `Graphics.UI` and the panel. The pill shows the current preset name.
- [ ] **Step 4:** Run `npm test`, then run the app live (temp profile, port 4791). Open the panel, pick Low, and check that `kiro.json` in the temp profile has `"graphics":{"preset":"low"}`. Expected: pass.
- [ ] **Step 5:** Commit with the message `Town step 4: graphics panel`.

### Task 4: Town GPU renderer honours scale, shadows and lighting tint

**Files:**
- Modify: `public/town-render.js`:
  - `mount(canvas, {map, atlasUrl, terrainUrl, graphics})` replaces `shadows`;
  - add `setGraphics(G)`, which replaces `setShadows`.
- Modify: `public/town.html`: load `graphics.js`; `const G = Graphics.resolve(await Graphics.load(), Graphics.env())`; pass it to `mount`; call `Graphics.onChange(s => api.setGraphics(Graphics.resolve(s, Graphics.env())))`. Support `?hour=<0-23>` (perf/visual checks only) as the hour override.
- Test: `town-render.test.mjs` (pure helpers)

**Interfaces:**
- Consumes: `Graphics.resolve`, `Graphics.nightOf`, `Graphics.tintOf`.
- Produces:
  - `TownRender.zoomFor(viewW, viewH, dpr, G)` uses `G.renderScale` as it already does. Renderer resolution = `G.renderScale`, so the canvas backing store is `css px × renderScale` and the zoom is computed from that.
  - `TownRender.blobOf(frame) -> {cx, cy, rx, ry}`: the ellipse centre (the frame anchor) and half-axes in px, from `footprint` projected through `project`. `rx = K*(fx1-fx0+fy1-fy0)/2`, `ry = rx/2`.
  - `TownRender.lightAt(hour, lighting) -> {tint, glow, pools}`. `tint` is `0xffffff` when lighting is 'off'. `glow` is a 0..1 alpha (night) when lighting ∈ {glow, pools}, else 0. `pools` is a 0..1 alpha only for 'pools'.
  - `api.setGraphics(G)`:
    - shadows 'off' hides the shade layer;
    - 'blob' shows a blob layer;
    - 'soft' shows the shadow atlas;
    - 'tint' shows the shadow atlas tinted by `tintOf(night)`;
    - the world/ground containers get `tint = lightAt(...).tint`;
    - a renderScale change resizes.
  - `api.stats()` gains `graphics: G`.

- [ ] **Step 1:** Failing tests in `town-render.test.mjs`:
  - `blobOf({ax: 6, ay: 13, footprint: [-5,-5,5,5]})` returns `{cx: 6, cy: 13, rx: K*10, ry: K*5}`, with `K` as in `town-render.js` and rounded to 2 decimals;
  - `lightAt(12,'glow')` returns `{tint:0xffffff, glow:0, pools:0}`;
  - `lightAt(22,'glow').glow === 1`;
  - `lightAt(22,'tint').glow === 0`;
  - `lightAt(22,'off').tint === 0xffffff`;
  - `lightAt(22,'pools').pools === 1`;
  - `zoomFor(1000, 600, 1, {renderScale: .5})` equals `zoomFor(500, 300, 1, {renderScale: 1})`.
- [ ] **Step 2:** Run `node --test town-render.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. The hour is read on each `render()` and the tint is cached per tenth of `night` (as `ensureBG` keys it), so render-on-demand is unchanged. A 60 s timer calls `mark()` only when the tenth-bucket changes.
- [ ] **Step 4:** Run `npm test`, then run `perf/town-check.cjs`. Expected: ALL PASSED. Then take screenshots with `?hour=12` and `?hour=22` on High and Medium into the shot dir, and look at them: night is blue-tinted and blob shadows sit under the buildings.
- [ ] **Step 5:** Commit with the message `Town step 4: town honours render scale, shadows and day/night tint`.

### Task 5: Town window glow and lamp light pools (art + render)

**Files:**
- Modify: `art/blender/town_assets.py`: glowing window panes on every building exterior and the lamp-post head, using the `glow=` argument the office kit already supports (`art/blender/kit.py`; see `office_assets.py:28-29`).
- Modify: `art/post.py`: the town atlas also writes `atlas-glow.png`, with the same rects and a `glow: true` frame flag, using the code path the office atlas uses (`post.py` about :142-157).
- Modify: `art/build.mjs` and `art/MANIFEST.json` (rerun `npm run art`; commit the regenerated `public/art/town/*`).
- Modify: `public/town-render.js`:
  - load `atlas-glow.png` when present;
  - add a glow layer (additive blend) with alpha = `lightAt().glow`;
  - add a pools layer: one radial-gradient canvas texture (warm `#ffd58a`, made once), drawn at every decor of type `lamp-post`, additive, alpha = `lightAt().pools`.
- Test: `art-output.test.mjs`:
  - the town glow sheet has the same size as `atlas.png`;
  - every building type in `town.json` has `glow: true`;
  - shipped `public/art/**` totals < 8 MB.

**Interfaces:**
- Consumes: `lightAt` (Task 4).
- Produces: `public/art/town/atlas-glow.png`, and `atlas.json` frames carrying `glow: true`.

- [ ] **Step 1:** Write the failing `art-output.test.mjs` cases above. Model them on the office glow test at `art-output.test.mjs:85-137`.
- [ ] **Step 2:** Run `node --test art-output.test.mjs`. Expected: FAIL (no town glow sheet).
- [ ] **Step 3:** Add the glow parts, then run `npm run art` (Blender 5.2 is installed). Any re-render must be reflected in the step 1/2 art tests already in `art-output.test.mjs`, which must stay green. Add the glow and pools layers to the renderer. The atlas stays ≤ 2048 px square.
- [ ] **Step 4:** Run `npm test`. Take a screenshot at `?hour=22` on High (lit windows) and on Ultra (pools under lamps) and look at both. Expected: pass, and visibly lit windows.
- [ ] **Step 5:** Commit with the message `Town step 4: night window glow and lamp light pools`.

### Task 6: Town ambient animation at the fps cap

**Files:**
- Create: `public/town-ambient.js` (classic script, `root.TownAmbient`, pure planning plus Pixi drawing helpers)
- Modify: `public/town-render.js` (an ambient layer and its own throttled loop), `public/town.html` (load it)
- Test: `town-ambient.test.mjs` (new; add to `package.json`)

**Interfaces:**
- Consumes: `G.ambient`, `G.ambientFps` (Task 1); the town map's water zones and decor (`map.zones` with `type === 'water'`, `map.decor` types `tree*`, `karinderya` lot) via `TownMap`.
- Produces:
  - `TownAmbient.plan(map, ambient) -> {water: [{x,y}], trees: [{id,x,y}], particles: [{kind:'leaf'|'steam', x, y}]}`:
    - 'off' → all empty;
    - 'water' → water only;
    - 'all' → water and trees;
    - 'particles' → all three.
    - Water sparkle points are on a 40-unit grid inside water zones, at most 64.
    - Leaf emitters are at most 1 per 4 trees. One steam emitter sits at the karinderya lot's building.
  - `TownAmbient.frameDue(lastMs, nowMs, fps) -> boolean`: true when `nowMs - lastMs >= 1000/fps - 1`.
  - In the renderer:
    - while `plan` is non-empty, the page is visible and fps > 0, a rAF loop renders only on `frameDue`;
    - with an empty plan, no loop runs at all, so ambient off means 0 idle frames;
    - tree sway is a ±1 px skew on the tree sprites, which is pixel-art safe (whole-pixel offsets only).

- [ ] **Step 1:** Failing tests:
  - `plan` per ambient level, using `town.json` loaded from `public/town/town.json`: 'off' → 0/0/0; 'water' → `water.length > 0`, with trees and particles empty; 'all' → no particles; 'particles' → steam count 1;
  - `water.length <= 64`;
  - `frameDue(0, 33, 30) === true`;
  - `frameDue(0, 20, 30) === false`;
  - `frameDue(0, 66, 15) === true`.
- [ ] **Step 2:** Run `node --test town-ambient.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. `setGraphics` rebuilds the plan, and the loop starts or stops accordingly.
- [ ] **Step 4:** Run `npm test` and `perf/town-check.cjs`. Then a live check:
  - on Low (ambient off): idle town for 3 s → 0 frames;
  - on High with power saver on: ≤ 30 frames in 3 s (8 fps cap plus slack);
  - with `html[data-anim=off]`: 0 frames.
  Add these as checks in `perf/town-check.cjs` (keep its ALL PASSED / exit 1 convention).
- [ ] **Step 5:** Commit with the message `Town step 4: ambient water, trees and particles at the fps cap`.

### Task 7: Canvas2D town renderer (Low preset and no-GPU fallback)

**Files:**
- Create: `public/town-render-2d.js` (classic script, `root.TownRender2D`)
- Modify: `public/town.html`:
  - choose `G.renderer === 'canvas' ? TownRender2D.mount : TownRender.mount`;
  - if the GPU mount rejects, fall back to `TownRender2D.mount` and log one `console.info`;
  - on a renderer change from `onChange`, `destroy()` the old one and mount the new one on a fresh canvas element. A WebGL canvas cannot become 2D, so replace the element, keeping its id and listeners through a wrapper.
- Modify: `perf/town-check.cjs`: `?failgl=1` now expects the town to load through Canvas2D (`api.kind === 'canvas'`) with no error box. Add a High → Low → High swap check: `stats().textureBytes` after the swap back equals the first High value.
- Test: `town-render-2d.test.mjs` (new; add to `package.json`): the pure culling and placement match `TownRender`.

**Interfaces:**
- Consumes: `TownRender.project/unproject/zoomFor/visibleChunks/depthOf/charPlace/lruEvict/syncPool/pool/blobOf` (reuse them; do not copy them).
- Produces: `TownRender2D.mount(canvas, {map, atlasUrl, terrainUrl, graphics}) -> api`, with exactly the same API as `TownRender.mount`:
  - `setPlayer`, `setTravellers`, `travellerAt`, `toWorld`, `setCamera`, `resize`, `setGraphics`, `frameCount`, `stats`, `destroy`;
  - plus `kind: 'canvas'`. The GPU api gets `kind: 'gpu'`.
- Drawing:
  - visible terrain chunks, then the shadow sheet (soft/tint only) or blobs (blob), then sprites sorted by `depthOf`, then characters;
  - `imageSmoothingEnabled = false`;
  - lighting tint by a `multiply` fill when lighting ≠ 'off';
  - glow sheet with `lighter` only for glow/pools;
  - no ambient and no pools (spec §12);
  - render-on-demand, the same as the GPU path.
- `stats().textureBytes` counts the decoded images.

- [ ] **Step 1:** Failing test: in a vm sandbox with a stub 2D context that records `drawImage` calls, mount with a two-chunk terrain fixture. Then:
  - a camera that sees chunk 0 only → `drawImage` calls reference chunk 0 and not chunk 1;
  - sprite draw order is ascending `depthOf`;
  - `travellerAt` returns the same `{id}` as `TownRender` for the same inputs. Check this against the pure `charPlace` math, not Pixi.
- [ ] **Step 2:** Run `node --test town-render-2d.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the renderer and the town.html selection, fallback and swap.
- [ ] **Step 4:** Run `npm test` and `perf/town-check.cjs`. Expected: ALL PASSED, including the failgl fallback and the swap texture bytes.
- [ ] **Step 5:** Commit with the message `Town step 4: Canvas2D town renderer and GPU fallback`.

### Task 8: Office and interiors honour graphics

**Files:**
- Modify: `public/office-world.js`:
  - add `setGraphics(G)` to the `OfficeWorld` API;
  - `setScale` (about :780) multiplies its resolution by `G.renderScale` (clamped to ≥ 0.5);
  - the frame pacing caps at `G.fps`, with power saver and reduced motion keeping their current behaviour;
  - `ensureBG` keys on lighting too.
- Modify: `public/office-furniture.js`:
  - `F.state.shadows` ('off'|'blob'|'soft'|'tint'): 'off' skips `contact()` and the other ground-shadow `gell` calls; 'blob' keeps today's contact shadows; 'soft'/'tint' also draw the office `atlas-shadow.png` frame under each sprite in `sprite()`, loaded in `loadAtlas` the way `atlas-glow.png` is (optional).
  - `F.state.lighting`: 'off' → `night` forced to 0 in `ensureBG`; 'tint' → night tint without the glow sheet; 'glow'/'pools' → today's behaviour.
- Modify: `public/Agent Office.html`: on boot, `Graphics.load()` → `OfficeWorld.setGraphics(Graphics.resolve(...))`, and the same on `onChange`.
- Test: `office-motion.test.mjs` or a new `office-graphics.test.mjs` (add to `package.json`), using the existing draw-log/vm patterns:
  - shadows 'off' → no contact ellipse in the draw log for a chair;
  - lighting 'off' at hour 22 → `F.state.night === 0`;
  - fps cap 15 → `advance`-driven scheduling requests no more than 15 frames per simulated second while agents walk with power saver off.

**Interfaces:**
- Consumes: `Graphics.resolve`, `Graphics.nightOf` (Task 1), `Graphics.load/onChange` (Task 2).
- Produces: `OfficeWorld.setGraphics(G)`, `OfficeWorld.graphics() -> G`.

- [ ] **Step 1:** Write the failing tests above.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `perf/office-check.cjs` and `perf/scene-check.cjs`. Expected: ALL PASSED. Take screenshots of the office on Low and on High at `?hour=22`, and look at them.
- [ ] **Step 5:** Commit with the message `Town step 4: office and interiors honour graphics`.

### Task 9: Memory drift fix and per-preset perf budgets

**Files:**
- Modify: `perf/office-perf.cjs`, `perf/town-perf.cjs` (run per preset; add the budgets)
- Modify: whatever leaks are found (diagnose first; see Step 1)
- Create: `docs/perf/town-step4.md`

**Interfaces:**
- Consumes: `api.stats()` (textureBytes, lastRenderMs), `Graphics` presets set through `/api/graphics/set` on the temp profile.

- [ ] **Step 1: Diagnose (superpowers:systematic-debugging).**
  - Run `perf/office-perf.cjs` with 40 town ↔ office cycles. Each cycle samples both renderer private bytes and the V8 heap after `gc()`: use `process.getHeapStatistics` on the renderer through `webContents.executeJavaScript('performance.memory.usedJSHeapSize')`.
  - Take heap snapshots (`webContents.debugger` `HeapProfiler.takeHeapSnapshot`) at cycles 5 and 40 and diff them by constructor.
  - Check whether the town page enters the back/forward cache (`pageshow` with `persisted`). If it does, a hidden page would hold its Pixi textures. Fix that by destroying the renderer on `pagehide` and remounting on `pageshow` when `persisted` is true.
  - Write down every retained-growth source you find, with numbers.
- [ ] **Step 2:** Fix every leak in our code that the diff shows: listeners, caches, `PIXI.Assets` entries, GL contexts, intervals. Re-run the 40 cycles.
- [ ] **Step 3: Budgets.**
  - The cycle budget becomes the spec's measure: **JS heap within ±10%** over 20 cycles, samples after `gc()`.
  - Renderer private bytes stay reported. The check also requires private bytes over cycles 11–20 to rise by no more than 3% (a plateau).
  - Add per-preset runs (Low, High) for:
    - idle CPU (< 1% Low, < 3% High);
    - hidden ≈ 0 frames;
    - town walk frame p95 (< 16 ms Low, < 8 ms High);
    - renderer private (< 180 MB Low, < 250 MB High);
    - GPU textures from `stats().textureBytes` (< 48 MB Low, < 96 MB High).
  - The shipped art < 8 MB check is in `art-output.test.mjs` (Task 5).
- [ ] **Step 4:** Run `perf/office-perf.cjs` and `perf/town-perf.cjs` twice each. Expected: ALL PASSED both times. Record both runs in `docs/perf/town-step4.md` in the same table format as `town-step3.md`, including the Step 1 findings and anything still out of budget, stated plainly.
- [ ] **Step 5:** Commit with the message `Town step 4: memory drift fix and per-preset perf budgets`.

---

## Final

- Run `npm test`, then every `perf/*.cjs` check. Update `CHANGELOG.md` under Unreleased (the graphics panel, presets, Canvas2D town, night glow).
- Whole-branch review, then ask the user before pushing `feature/world`.
