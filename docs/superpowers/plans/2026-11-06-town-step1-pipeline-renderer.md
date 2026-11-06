# Town Step 1: Art Pipeline, GPU Renderer, Walkable Town — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A walkable, cozy isometric town exterior is drawn by a GPU sprite renderer from art produced by a Blender pipeline. It is reachable at `/town`, with a perf harness that enforces the RAM/CPU budgets.

**Architecture:**
- One data file, `public/town/town.json`, describes the town: size, lots, plaza, paths, stream and decor. Both Blender and the browser read it.
- `npm run art` builds the art in two stages:
  - Blender (headless) renders the static ground of the whole town as one big image, cut into 512 px chunks. It also renders every building and prop as its own sprite, with a separate ground-shadow layer.
  - A Pillow post-pass applies one shared palette and a 1 px outline, then packs the atlases.
- At runtime, `public/town-render.js` (PixiJS v8, vendored) draws the ground chunks plus depth-sorted sprites. It renders only when something changed.
- The CEO avatar walks the town on a WorldPath grid built from `town.json`.

**Tech Stack:**
- Runtime: PixiJS 8.22.0 (vendored UMD `pixi.min.js`), classic browser scripts, the Node server.
- Developer-only tools: Blender 5.2 (EEVEE, headless), Python 3 + Pillow 12, and an Electron perf harness.

**Spec:** `docs/superpowers/specs/2026-11-06-town-world-design.md` (step 1 of section 11; the art target is `2026-11-06-town-art-target.png`)

**Ruling (deviation from spec section 8):**
- Only the static ground is cached in chunks, baked offline as 512 px images.
- Buildings and decor stay individual sprites, because characters must sort in front of and behind them. About 150 batched sprites cost nothing while idle under render-on-demand.
- If this is wrong, the cost is one extra render-texture layer for far-away decor in step 4.

## Global Constraints

- Look: cozy, rustic, pixel isometric. Warm sun with cool sky shadows; plank, stone and shingle materials; the same diagonal view as the app (2:1 ground, heights 1:1).
- Art projection matches `P(x,y,z) = [OXS + 0.7071*(x-y), OYS + 0.3536*(x+y) - z]`.
  - 1 Blender unit = 1 grid cell = 10 world units.
  - Renders use **10 px per Blender unit in the camera plane**, with orthographic camera rotation (60°, 0, 135°) and scene heights scaled by `1/sin(60°)`.
- Art is original only (Blender scripts plus code). No art, names or characters from existing games. Every shipped file is recorded in `art/MANIFEST.json`, with source script, date and license `Apache-2.0 (original)`.
- Atlases are at most 2048×2048. All shipped art is under 8 MB.
- One shared palette of at most 64 colours, plus a 1 px outline in `#2b1b16`.
- Blender, Python and Pillow are developer-only. `npm test`, CI and packaging use the committed PNG/JSON only.
- No new runtime npm dependency. PixiJS is vendored at `public/vendor/pixi.min.js`, pinned to **8.22.0**, with its MIT notice added to `THIRD_PARTY_NOTICES.md`.
- Office building styles: `country`, `japanese`, `modern`. Lots: `home`, `kain`, `games`, `friend-1`, `friend-2`, `friend-3`.
- Budgets (High, step 1), measured by `npm run perf:town` in Electron on the dev machine:
  - idle renderer CPU < 3%;
  - hidden window < 0.5%;
  - walking render p95 < 8 ms;
  - renderer private memory < 250 MB;
  - GPU textures < 96 MB.
- The current office app keeps working unchanged. The town is a preview page reached from a bottom-bar button.
- Repo rules: no personal names or paths in tracked files. Commit trailers as in the session (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Claude-Session: …`).

## Review Focus

1. **HiDPI, odd window sizes and resizing.** The town must stay crisp, using integer zoom and nearest-neighbour sampling, and must never blur or leave gaps between ground chunks. Test: `town-render` math `zoomFor(viewW, viewH, dpr)` returns an integer ≥ 1, and chunk positions are integers (Task 5).
2. **WebGL unavailable or context lost.** The page must show a clear message ("Graphics unavailable; the Low preset arrives in step 4") instead of a blank page or an exception loop. Test: in the Task 6 live check, `PIXI.Application.init` rejects (stubbed) and the page shows the message.
3. **Missing or corrupt art files.** A 404 or a bad JSON for an atlas gives one readable error on the page, not a hang. Test: Task 1 route test (404 for unknown art paths, traversal refused) plus a loader error path in the Task 6 live check.
4. **Hidden or minimised window.** No frames are rendered at all. Test: the Task 7 perf harness hides the window and asserts CPU < 0.5% and a frame counter delta of 0.
5. **A key held while the window loses focus.** The avatar must stop and not keep walking. Test: Task 6 live check dispatches keydown, then `blur`, and asserts the avatar position is unchanged 500 ms later.

---

### Task 1: Vendor PixiJS and serve the town page and art

**Files:**
- Create: `public/vendor/pixi.min.js` (from `npm pack pixi.js@8.22.0` → `package/dist/pixi.min.js`)
- Create: `public/town.html` (placeholder page: a canvas with `id="town"` and a "Back to the office" link to `/`)
- Modify: `server.mjs`
  - add `STATIC` entries `/town` → `town.html` and `/vendor/pixi.min.js`;
  - add a guarded prefix handler for `/art/` and `/town/`.
- Modify: `THIRD_PARTY_NOTICES.md` (PixiJS MIT notice, version 8.22.0)
- Test: `town-static.test.mjs` (new; add it to the `npm test` list in `package.json`)

**Interfaces:**
- Produces: `GET /town` (text/html); `GET /vendor/pixi.min.js`; `GET /art/<file>` and `GET /town/<file>` for files under `public/art/` and `public/town/`.
  - Names must match `^[a-z0-9][a-z0-9/_-]*\.(png|json)$`, with no `..` or backslash; anything else returns 404.
  - Content types: png → `image/png`, json → `application/json`.
  - These routes need the UI cookie, like the other pages.

- [ ] **Step 1: Write the failing test** in `town-static.test.mjs`. Start the server with a temp HOME and `AGENT_OFFICE_PORT=4797`, the same pattern as the existing server tests (reuse their helper if one exists), and check:
  - `/town` returns 200 with text/html containing `id="town"`;
  - `/vendor/pixi.min.js` returns 200 and its body contains `8.22.0`;
  - `/art/../server.mjs`, `/art/..%2fserver.mjs`, `/art/x.exe` and `/art/missing.png` each return 404;
  - `/town/town.json` returns 404 (not created yet);
  - all of the above return 401 without the UI cookie.
- [ ] **Step 2: Run** `node --test town-static.test.mjs`. Expected: FAIL (404 or 401 mismatches).
- [ ] **Step 3: Implement.** Download with `npm pack pixi.js@8.22.0` into a scratch directory and copy `dist/pixi.min.js`. Add the routes. The prefix handler resolves inside `public/` and checks the resolved path is still inside the folder before reading.
- [ ] **Step 4: Run** `node --test town-static.test.mjs` and `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with message `Town step 1: vendor PixiJS 8.22.0, serve /town and its art`.

### Task 2: Town map data and walk grid

**Files:**
- Create: `public/town/town.json`
- Create: `public/town-map.js` (classic script exposing `root.TownMap`)
- Modify: `world-vm.mjs` (add `town-map.js` to the loadable extras; do not change ORDER)
- Test: `town-map.test.mjs`

**Interfaces:**
- `town.json` shape:
  - `{ version: 1, size: {w, h}, cell: 10, spawn: {x, y}, block: {depth}, plaza: [x0,y0,x1,y1], paths: [[x0,y0,x1,y1]…], water: [[x0,y0,x1,y1]…], bridges: [[x0,y0,x1,y1]…], lots: [{id, kind, rect:[x0,y0,x1,y1], building:{type, x, y, footprint:[x0,y0,x1,y1]}, door:{x, y, face}}], decor: [{type, x, y}] }`
  - `kind` is `home | kain | games | friend`.
  - `building.type` is `office-country | office-japanese | office-modern | karinderya | gamehall | lot-empty`. `home` defaults to `office-modern`.
  - `decor.type` is `tree-round | tree-pine | bush | bench | lamp | well | barrel | crate | flowers | sign`.
- Values: size `{w: 2160, h: 1350}` (about 3× the office area); `cell: 10`; plaza centred at (1080, 675), about 360×280.
  - `home` north of the plaza, `kain` east, `games` west, friend lots along the south side.
  - The stream runs along the south edge, with one bridge per friend lot.
- `TownMap.validate(data) -> {ok: boolean, errors: string[]}` checks:
  - schema and value ranges (coordinates inside `size`);
  - exactly the six lot ids;
  - each door is on a walkable cell;
  - every door is reachable from `spawn`.
- `TownMap.grid(data) -> {cols, rows, cell, blocked, cost, minCost}`:
  - built with `WorldPath.buildGrid({w, h, cell, blocks})`;
  - blocks are building footprints, decor footprints (a 10×10 square at each decor x,y; `flowers` excluded), water rects minus bridges, and the map edge;
  - paths and plaza are given cost 0.8 through `costs`.
- `TownMap.decorFootprint(item) -> [x0,y0,x1,y1] | null`
- `TownMap.load(url) -> Promise<data>`: fetch plus `validate`. It throws `Error('town map: ' + errors[0])`.

- [ ] **Step 1: Write the failing tests** in `town-map.test.mjs`, loading with `loadWorld({extra: ['town-map.js']})`:
  - `validate(real town.json).ok === true`;
  - lot ids are exactly the six names;
  - every door is reachable: `WorldPath.findPath(grid, spawn, door).length > 0`;
  - the plaza centre cell is free;
  - no decor footprint overlaps a lot `building.footprint`, a door cell or a bridge;
  - `validate` rejects a missing lot, a door inside a footprint, a coordinate outside `size`, and a 5th friend lot. Each gives `ok: false` with a readable error.
- [ ] **Step 2: Run** `node --test town-map.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Write** `town.json` and implement `town-map.js` (UMD pattern `(function(root){…})(globalThis)`, using `root.WorldPath`).
- [ ] **Step 4: Run** the test and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with message `Town step 1: town map data and walk grid`.

### Task 3: Art pipeline (terrain chunks, buildings, props, palette, atlases)

**Files:**
- Create: `art/blender/kit.py`. Shared Blender helpers lifted from `art/spike_town_cozy.py`:
  - `reset_scene()` (EEVEE, `taa_render_samples = 1`, `filter_size = 0`, warm sun `(1.0, 0.86, 0.66)` energy 3.4, sky `(0.42, 0.52, 0.72)` strength 0.75, transparent film, Standard view);
  - `mat(hex, glow=0)`, `box`, `cyl`, `cone`, `blob`, `roof`, `planks`, `stones_base`, `window`;
  - `iso_camera(cx, cy, cz, w_px, h_px)`: orthographic rotation (60°, 0, 135°) with `ortho_scale = max(w_px, h_px) / 10`;
  - `ZS = 1 / sin(60°)`.
- Create: `art/blender/town_assets.py`. Run with `blender -b -P art/blender/town_assets.py -- <in town.json> <out raw dir>`. For each asset, it renders:
  - `<name>.png` (colour, sun shadows on, no ground);
  - `<name>.ground.png` (on a white ground plane, shadows on);
  - `<name>.noshadow.png` (on the plane, shadows off);
  - `<name>.json`: `{anchor:[ax, ay]}` (the pixel of the asset's world origin) and `footprint:[x0,y0,x1,y1]` in world units.
  - Assets: `office-modern`, `office-country`, `office-japanese`, `karinderya`, `gamehall`, `lot-empty`, and every decor type.
  - Task 3 builds `office-modern`, `karinderya`, `gamehall` and the decor from the spike's models. It renders `office-country` and `office-japanese` as **greybox** boxes with the right footprint; Task 4 replaces them.
- Create: `art/blender/town_terrain.py`. Renders the whole ground from `town.json` (grass with variation, plaza pavers, paths, stream with stone banks and bridges, the soil block sides with stones) into one image at 10 px/unit, then writes it to the raw dir as `terrain.png` plus `terrain.json` `{originPx:[ox, oy]}` (the screen pixel of world (0,0,0)).
- Create: `art/post.py`. Run with `python art/post.py <raw dir> <out dir>`:
  - builds the shared palette with median cut over all colour renders and the terrain → `art/palette.json` (≤ 64 colours);
  - maps every image to that palette and adds the 1 px `#2b1b16` outline on sprites (not on terrain chunk edges);
  - shadow alpha = `clamp(1 - ground/noshadow, 0, 0.6)`, masked to where the colour render's alpha is 0, coloured `#1a2240`;
  - packs `atlas.png` and `atlas-shadow.png` (same frame rects) with a shelf packer, 2 px padding, ≤ 2048²;
  - writes `atlas.json`: `{frames: {name: {x, y, w, h, ax, ay}}, size: [W, H]}`;
  - cuts the terrain into `terrain/r<row>c<col>.png` (512×512, the last row and column cropped) and writes `terrain.json`: `{originPx, chunk: 512, cols, rows, size: [W, H]}`;
  - asserts the palette has ≤ 64 colours and each atlas is ≤ 2048, exiting 1 otherwise.
- Create: `art/build.mjs`, run as `npm run art`.
  - It finds Blender via `BLENDER` env, else `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`, else `blender` on PATH. If none is found, it exits 2 with a message.
  - It runs terrain, then assets, then post, into `art/.raw/` (git-ignored) and `public/art/town/`.
  - It writes `art/MANIFEST.json` (each output file, sha256, script, date, license).
- Modify: `package.json` (`"art": "node art/build.mjs"`), `.gitignore` (`art/.raw/`).
- Test: `art-output.test.mjs`

**Interfaces:**
- Consumes: `public/town/town.json` (Task 2).
- Produces:
  - `public/art/town/atlas.png`, `atlas-shadow.png`, `atlas.json`, `terrain.json`, `terrain/r*c*.png`;
  - frame names equal the `building.type` and `decor.type` strings;
  - `ax, ay` is the sprite pixel that sits on the object's world origin. The renderer places a sprite at `P(x, y, 0) - (ax, ay)`.

- [ ] **Step 1: Write the failing test** `art-output.test.mjs`. It reads PNG IHDR width and height from bytes 16–23 and checks:
  - every `building.type` and `decor.type` used in `town.json` has a frame in `atlas.json`;
  - every frame lies inside `atlas.json.size`, and `atlas.png` and `atlas-shadow.png` match that size and are ≤ 2048;
  - the terrain chunk count equals `cols * rows` and the files exist;
  - the total size of `public/art/**` is < 8 MB;
  - every file under `public/art/town` is listed in `art/MANIFEST.json` with a matching sha256.
- [ ] **Step 2: Run** `node --test art-output.test.mjs`. Expected: FAIL (no art).
- [ ] **Step 3: Implement** kit, terrain, assets, post and build. Then run `npm run art`. Expected: it exits 0 and prints the palette size (≤ 64) and the atlas size.
- [ ] **Step 4: Visual check.** Run `python art/post.py --preview public/art/town art/.raw/preview.png`, which composes the terrain plus every sprite at its `town.json` position at 2×. Compare it with `docs/superpowers/specs/2026-11-06-town-art-target.png` for palette warmth, outline and materials, and fix the scripts until it matches the target's feel.
- [ ] **Step 5: Run** `node --test art-output.test.mjs` and `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** the scripts, `art/palette.json`, `art/MANIFEST.json` and `public/art/town/**` with message `Town step 1: Blender art pipeline, palette and atlases`.

### Task 4: Office building styles: countryside and Japanese

**Files:**
- Modify: `art/blender/town_assets.py`
  - replace the `office-country` and `office-japanese` greyboxes;
  - keep their footprints identical to `office-modern`, so any style fits the `home` and friend lots.
- Regenerate: `public/art/town/**`, `art/MANIFEST.json`
- Test: `art-output.test.mjs` (extend)

**Interfaces:**
- Consumes: the `kit.py` helpers (Task 3).
- Produces: frames `office-country` and `office-japanese`, each with the same `footprint` as `office-modern`.

Design notes (the implementer models these; the details are theirs within this brief):
- **country:** a rustic farmhouse; stone base, warm plank walls, a steep shingle roof with a dormer, a porch with posts, window boxes, a chimney.
- **japanese:** a machiya/minka-style house; dark timber frame with light plaster panels, a grey tiled hip roof with upturned eaves, an engawa (veranda), a noren curtain over the door, a lantern, a small pine bonsai.
- Both keep the cozy palette, the warm windows and the 1 px outline. They must read as clearly different from `office-modern` at 1×.

- [ ] **Step 1: Extend the test.** Assert `office-country`, `office-japanese` and `office-modern` have equal `footprint`, and that their colour frames are not identical (compare the PNG crops by sha256).
- [ ] **Step 2: Run** the test. Expected: FAIL on the hash check (the two greyboxes are identical renders).
- [ ] **Step 3: Model both styles** and run `npm run art`.
- [ ] **Step 4: Visual check.** In the preview from Task 3, all three styles on friend lots side by side read clearly at 1× and 2×.
- [ ] **Step 5: Run** the tests. Expected: PASS. **Commit** with message `Town step 1: countryside and Japanese office styles`.

### Task 5: GPU town renderer (render on demand)

**Files:**
- Create: `public/town-render.js` (classic script exposing `root.TownRender`)
- Test: `town-render.test.mjs` (pure helpers only, via `loadWorld({extra: ['town-map.js', 'town-render.js']})` with `PIXI` absent)

**Interfaces:**
- Consumes: `TownMap` (Task 2); atlases and terrain (Task 3); `OfficeSprites.get(look, view, pose, frame, dir)` and `OfficeSprites.lookOf(agent)` for characters; global `PIXI` (v8).
- Pure helpers (exported, testable without PIXI):
  - `TownRender.project(x, y, z) -> [sx, sy]`, using `terrain.json.originPx` as the origin: `[ox + 0.7071*(x-y), oy + 0.3536*(x+y) - z]`;
  - `TownRender.zoomFor(viewW, viewH, dpr, preset) -> integer ≥ 1`, where `preset` is `{renderScale}` (step 1 uses `{renderScale: 1}`). It is the largest integer such that the visible area is at least 900×560 css px of the map, times dpr, times renderScale;
  - `TownRender.visibleChunks(cam, view, terrain) -> [{r, c}]`, the chunks intersecting the view rect with a 1-chunk margin;
  - `TownRender.depthOf(x, y) -> number = x + y` (sprites and characters are sorted by this; ties: characters after sprites).
- Runtime: `TownRender.mount(canvas, {map, atlasUrl, terrainUrl, shadows: 'soft'|'off'}) -> Promise<api>`. The api is:
  - `setPlayer({x, y, face, pose, frame, look})`, `setCamera(x, y)`, `resize()`;
  - `setShadows(mode)`;
  - `frameCount()`;
  - `stats() -> {textureBytes, sprites, drawCalls, lastRenderMs}`;
  - `destroy()`.
- Rendering rules:
  - `PIXI.Application.init({canvas, preference: 'webgl', antialias: false, autoStart: false, resolution: 1, backgroundAlpha: 0})`;
  - `TextureStyle.defaultOptions.scaleMode = 'nearest'`;
  - ground chunks are Sprites at integer positions in a `ground` container;
  - building, decor and shadow sprites come from the atlases;
  - shadows sit in their own container under `world`, with `visible` = `mode !== 'off'`;
  - `world.sortableChildren = true` and `zIndex = depthOf`;
  - only visible chunks get `visible = true`, and `cullable` is set on sprites;
  - character textures are made once per `look.sig/view/pose/frame/dir` from `OfficeSprites.get(...).cv` and cached in a `Map` capped at 64 entries (least recently used is evicted, and its texture destroyed);
  - **render on demand:** a `dirty` flag is set by setters and resize, and one `requestAnimationFrame` renders only when dirty. `app.ticker` never starts. `document.hidden` means no render.
- `textureBytes` is the sum of `w*h*4` over every uploaded texture: atlases, chunks and character cache.

- [ ] **Step 1: Write the failing tests** in `town-render.test.mjs`:
  - `project(0,0,0)` equals `originPx`;
  - `project(10,0,0)` minus `project(0,0,0)` ≈ `[7.071, 3.536]`;
  - `project(0,0,10)[1]` is `originPx[1] - 10`;
  - `zoomFor` gives 1 at 1280×800 dpr 1 if the map would not fit at 2, gives integer results for dpr 1.25, 1.5 and 2, and never returns 0 for tiny windows (200×150);
  - `visibleChunks` on a view covering one chunk returns that chunk plus the margin ring, and is clamped to the grid;
  - `depthOf` orders a tree behind a player standing in front of it.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** `town-render.js`.
- [ ] **Step 4: Run** the test and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with message `Town step 1: PixiJS town renderer with render-on-demand`.

### Task 6: Town page: walk the town, camera follow, preview button

**Files:**
- Modify: `public/town.html`. It loads, in order:
  - `vendor/pixi.min.js`, `role-catalog.js`, `world-path.js`;
  - `world-model.js` and `office-motion.js` (for `faceOf`), `world-player.js`;
  - `office-sprites.js`, `town-map.js`, `town-render.js`;
  - then an inline boot script.
- Modify: `public/world-player.js`. `walkTo(p, target, grid)`: the third parameter is the grid to path on (defaults to `OfficeMotion.grid()`). Update its header comment; existing callers pass nothing or `pathTo`, which is not a grid. Detect with `grid && grid.blocked`.
- Modify: `public/Agent Office.html`. Add a bottom-bar pill "Town (preview)" that navigates to `/town`.
- Test: extend `world-player.test.mjs` (walkTo on a custom grid); live check `perf/town-check.cjs` (Electron, same pattern as the session's drivers; not in `npm test`).

**Interfaces:**
- Consumes: `TownMap.load`, `TownMap.grid` (Task 2); `TownRender.mount` (Task 5); `WorldPlayer.create/step/walkTo/takesKey` and `DIRS`.
- Boot behaviour:
  - load the map, then mount, and spawn the CEO at `map.spawn` with look `OfficeSprites.lookOf({look: 'ceo'})`, which follows the wardrobe through `OfficeSprites.setCostumes(snapshot.looks)` from the first `/api/stream` message;
  - keyboard (WASD and arrows) through `WorldPlayer.takesKey`;
  - click or tap a ground point to walk, inverting `project` for z = 0;
  - the camera follows the player, clamped to the map;
  - `blur` and `visibilitychange` clear held keys;
  - each walking frame runs `step`, then `setPlayer`, then `setCamera`; with no input nothing runs (no rAF loop while idle);
  - errors (map, atlas, WebGL) show one message box with a "Back to the office" link.

- [ ] **Step 1: Write the failing test** in `world-player.test.mjs`. On a 10×10 custom grid with a wall, `walkTo(p, {x, y}, grid)` returns true and the path goes around the wall. With no grid, it still uses `OfficeMotion.grid()` (existing tests stay green).
- [ ] **Step 2: Run** `node --test world-player.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the `walkTo` grid parameter, the town page boot and the bottom-bar pill.
- [ ] **Step 4: Live check** `perf/town-check.cjs` with a temp profile and `AGENT_OFFICE_PORT=4798`, checking:
  - the page loads with no console errors;
  - holding `D` for 1 s moves the player;
  - a click on the plaza walks there;
  - keydown, then blur, then 500 ms leaves the position unchanged;
  - a stubbed `PIXI.Application.prototype.init` that rejects shows the error message;
  - a screenshot is saved to `art/.raw/town-check.png` for the visual review.
- [ ] **Step 5: Run** `npm test` (PASS) and `node perf/town-check.cjs` (prints `ALL PASSED`). **Commit** with message `Town step 1: walkable town page and preview button`.

### Task 7: Perf harness and budgets

**Files:**
- Create: `perf/town-perf.cjs` (Electron; run with `npm run perf:town`)
- Create: `docs/perf/town-step1.md` (results table, filled from the run)
- Modify: `package.json` (`"perf:town": "electron perf/town-perf.cjs"`)

**Interfaces:**
- Consumes: the `/town` page with `window.__town` exposing `frameCount()` and `stats()` from the mounted api (add a two-line hook in the boot script: `window.__town = api`).
- Setup: a visible `BrowserWindow` 1280×800 with `backgroundThrottling: true`, a temp profile, and a server on port 4799.
- Measurements:
  1. **Idle:** after 5 s settle, take renderer `cpu.percentCPUUsage` from `app.getAppMetrics()` averaged over 10 s, plus the frame counter delta (expect 0).
  2. **Walking:** inject keyboard input for 5 s and collect `stats().lastRenderMs` per frame; report p50 and p95.
  3. **Hidden:** `win.hide()` for 5 s; renderer CPU and frame delta.
  4. **Memory:** `webContents.getProcessMemoryInfo()` private bytes for the renderer, the GPU process working set from `getAppMetrics`, and `stats().textureBytes`.
- Budgets (fail with exit code 1 and print which one broke):
  - idle CPU < 3%;
  - hidden CPU < 0.5% with frame delta 0;
  - walking p95 < 8 ms;
  - renderer private < 250 MB;
  - textureBytes < 96 MB.
- It writes `perf/results/town-step1-<date>.json`; that folder is git-ignored apart from a `.gitkeep`.

- [ ] **Step 1: Write the harness.** Run `npm run perf:town`. Expected: a printed table. Any budget miss gives exit 1.
- [ ] **Step 2: If any budget fails,** fix the cause, typical suspects first:
  - a stray ticker or rAF loop while idle;
  - character textures not cached;
  - chunks never hidden;
  - atlases uploaded twice.

  Re-run until all pass. Do not raise a budget.
- [ ] **Step 3: Record** the numbers and machine (CPU, GPU, RAM, OS) in `docs/perf/town-step1.md`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. **Commit** with message `Town step 1: perf harness and recorded budgets`.
