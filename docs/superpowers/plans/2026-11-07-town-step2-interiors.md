# Town Step 2: Interiors in the New Art, Doors and Scenes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office interior, the karinderya interior and the game hall interior are drawn with Blender-rendered cozy pixel sprites. You walk from the town through a door into a building and back out.

**Architecture:**
- The office view keeps its existing Canvas2D render-on-demand engine (`office-world.js` + `office-furniture.js`), so every feature keeps working: tags, bubbles, radial, build mode, approvals and click masks.
- Each catalog piece's procedural painter is replaced by a sprite painter that draws atlas frames rendered in Blender at the piece's exact anchor. Live details (LEDs, screens, board text, steam, animations) stay as small procedural overlays on top of the sprite.
- Footprints are frozen from today's measured geometry into a fixture, so walk grids and spots do not change.
- Interiors are world-model layouts: `layout.json` (office), plus new `kain.json` and `games.json`. Doors link scenes: town ↔ office page, and the office page can show any interior.

**Tech Stack:** Blender 5.2 + Pillow (dev-only art), Canvas2D in the existing classic-script engine, the Node server, Electron live checks.

**Spec:** `docs/superpowers/specs/2026-11-06-town-world-design.md` (step 2 of section 11; sections 5 and 7). The step 1 plan, `docs/superpowers/plans/2026-11-06-town-step1-pipeline-renderer.md`, documents the art pipeline you extend.

**Rulings (deviations from the spec, decided by the controller):**
1. Interiors stay on the Canvas2D engine in step 2. The GPU (PixiJS) interior path is step 4 (graphics settings), where the spec's Canvas2D fallback already lives.
   - Why: porting about 800 lines of office-world features is the riskiest possible change, and Canvas2D `drawImage` of atlas sprites with render-on-demand already meets the CPU budget.
   - Cost if wrong: one renderer port in step 4.
2. The playroom and garden pieces stay in the office interior in step 2. The spec's migration (playroom → game hall, garden → town) moves to step 3, because agents walk to those spots and cannot cross buildings until step 3.
   - In step 2, `games.json` gets its **own** arcade and lounge pieces (copies of the catalog types), so the game hall is not empty.
   - Cost if wrong: a few duplicate pieces until step 3.

## Global Constraints

- **Look:** cozy pixel isometric matching `docs/superpowers/specs/2026-11-06-town-art-target.png`.
  - Warm sun, cool shadows, 1 px dark outline `#2b1b16`.
  - The office interior is **modern-cozy**: light wood floors, plants, glass partitions, warm lamps, clean desks, white and light-wood furniture with warm accents.
  - The karinderya and game hall interiors are rustic-cozy.
- **Projection is unchanged:** `P(x,y,z) = [OXS + 0.7071*(x-y), OYS + 0.3536*(x+y) - z]`, with OXS=575 and OYS=175. Art renders at 1 px per world unit using the step 1 kit (10 px per Blender unit, kit x/y swap, `ZS = 1/sin60`).
- **Footprints and spots stay exactly as today.** The fixture `fixtures/office-footprints.json` is the source of truth for sprite footprints, so walk grids, spots and `requiredSpots` do not change.
- **Live state stays procedural, drawn over sprites:**
  - desk LEDs, monitors, name plates and team colours;
  - Today/usage boards and their text;
  - printer, coffee steam, jukebox notes, arcade screens;
  - the karinderya fan, fire and food, and anything else that reads `OfficeFurniture.state`.
- **Art:**
  - original only, recorded in `art/MANIFEST.json`;
  - one shared palette of at most 64 colours across town and interiors. If interiors cannot fit, a second interior palette of at most 64 colours is allowed; record a ruling;
  - atlases at most 2048², all shipped art under 8 MB;
  - Blender and Pillow are dev-only.
- **No new runtime dependencies.** `npm test` stays green with `--test-concurrency=4`.
- **Budgets on the office page,** measured like step 1:
  - idle renderer CPU < 3% with 0 frames;
  - renderer private memory < 250 MB;
  - an idle frame draw of the office view < 8 ms p95 while agents walk.
- **Never touch** the user's installed app on :4777, the real profile or the real vault. The repo is public: no personal names or paths.

## Review Focus

1. **A saved custom office layout** (moved desks, added department desks, build-mode edits) must render with the new sprites exactly where the pieces sit, and the walk grid must be identical to before. Test: Task 1 fixture test plus a Task 7 live check with a modified layout.
2. **The atlas fails to load** (404 or corrupt): the office page must still work, either by drawing the old procedural pieces or by showing a clear message. It must never be blank with agents floating in space. Test: Task 1 live check with the atlas URL blocked.
3. **Build mode drag of a sprite piece** must follow the cursor with the sprite (the `place()` offset path) and drop where released. Test: Task 7 live check with a drag in build mode.
4. **Entering and leaving buildings repeatedly** must not leak memory (textures and listeners). Test: the Task 7 perf check runs 20 enter/leave cycles and asserts renderer private memory within ±10%.
5. **Dark and night hours and zone repaints** (the bake path) must keep the floor textures and walls consistent. Test: Task 5 live check at `setHour(22)` and after painting a zone in build mode.

---

### Task 1: Frozen footprints and the sprite-painter path

**Files:**
- Create: `fixtures/office-footprints.json`. Generated by `scripts/freeze-footprints.mjs` (new; it loads the world vm, places the default instances, and records each item's `fp`, depth `d`, `floor` and `nofp` per catalog type and part index, in world units relative to the piece's home anchor).
- Modify: `public/office-furniture.js`. Add:
  - an atlas registry: `OfficeFurniture.useAtlas({image, frames})`, where `frames` is `{name: {x, y, w, h, ax, ay}}`;
  - `sprite(g, name, x, y)`, which draws the frame with `(ax, ay)` on `P(x, y, 0)`, rounding once at the end;
  - a helper `spriteOr(name, procedural)`. It returns a painter that draws the sprite when the frame exists and the atlas is loaded, and otherwise calls the old procedural painter. This lets later tasks convert pieces one by one.
  - Sprite painters must pass an explicit `fp` from the fixture, so `measure()` and the walk grid stay identical.
- Modify: `public/office-world.js` / `public/Agent Office.html`. Load `/art/office/atlas.json` and its image at boot, call `useAtlas`, then `wake()`. If the load fails, keep the procedural painters and log once.
- Modify: `server.mjs`. The `/art/` route from step 1 already serves `public/art/**`; add a test that `/art/office/atlas.json` returns 404 cleanly before any art exists.
- Test: `office-sprites-path.test.mjs` (new). Load the world vm with a fake atlas containing a frame for one piece (for example `plant`), place the default layout, and assert:
  - the grid's `blocked` array is identical with and without the atlas;
  - the item depth order is unchanged;
  - the fake atlas frame is drawn through `drawImage` with the expected destination (anchor math).
  - Also add a test that `office-footprints.json` equals what `freeze-footprints.mjs` produces today (it guards the fixture against drift).

**Interfaces produced:**
- `OfficeFurniture.useAtlas({image, frames, glow?})`, `OfficeFurniture.sprite(g, name, x, y, alpha?)` and `OfficeFurniture.spriteOr(name, fn)`.
- Fixture rows: `{type, part, fp: [x0,y0,x1,y1] | null, d, floor, nofp}`, relative to the anchor.
- Frame names: `<type>` for single-part pieces, `<type>.<part>` for multi-part pieces (part = the add() index in the def), for example `dept-desk.0` (desk) and `dept-desk.1` (chair).

- [ ] Steps:
  1. Write the failing tests.
  2. Run them and see them fail.
  3. Implement.
  4. Run the tests, `npm test` and a live check: the office page still renders identically with no office atlas present. Take a screenshot and compare it with step 1's office to the eye.
  5. Commit `Town step 2: frozen footprints and sprite-painter path`.

### Task 2: Interior art pipeline and batch A (office work furniture)

**Files:**
- Create: `art/blender/office_assets.py`. It reuses `art/blender/kit.py`.
  - It reads `fixtures/office-footprints.json` and each catalog type's home anchor (read the anchors with a small node export script, `scripts/export-catalog.mjs` → `art/.raw/catalog.json`).
  - It renders one frame per part, sized to that part's footprint, with the camera aimed at the piece's anchor.
  - It writes colour, ground-shadow and glow PNGs (glow only for pieces with lights), using the step 1 `.ground` / `.noshadow` convention.
- Modify: `art/post.py` to also pack `public/art/office/atlas.png`, `atlas-shadow.png`, `atlas-glow.png` and `atlas.json`. Modify `art/build.mjs` to run the office renders. Extend `art-output.test.mjs` so every frame named by a converted painter exists and the manifest holds.
- Batch A pieces (modern-cozy):
  - `dept-desk` (desk + chair parts), `tiro-desk`, `tiro-chair`, `guest-chair`, `hot-desk`, `hot-chair`;
  - `inbox`, `side-table`, `filing-cabinet`, `bookshelf`, `server-rack`, `printer`, `recycling-bin`;
  - `water-cooler`, `coffee-counter`, `trophy-shelf`, `plant`, `server-plant`.
- Modify: `public/office-furniture.js`. Switch these painters to `spriteOr(...)`, keeping their live overlays procedural:
  - LEDs and team colour on chairs (tint via a small procedural accent);
  - monitors and screens, name plates, printer paper, coffee steam.
- Test: extend `office-sprites-path.test.mjs`. With the real atlas JSON, every batch A frame exists, the grid is unchanged, and depth order is unchanged.

- [ ] Steps:
  1. Write the failing tests.
  2. Implement the pipeline and the batch A models. Run `npm run art`.
  3. Visual check: compose a preview of the default office with the batch A sprites at 2× (`python art/post.py --office-preview …`). Compare it with the art target's feel, and check that the desks read as modern-cozy.
  4. Run the tests, `npm test` and the live office check.
  5. Commit `Town step 2: interior art pipeline, office work furniture`.

### Task 3: Batch B (play, lounge and break pieces)

`arcade`, `arcade-race`, `jukebox`, `sofa3`, `snack-table`, `beanbag`, `ball-pit`, `hoop`, `dartboard`, `toy-bin`, `karinderya` (all of its parts), `broom-corner`. Same steps as Task 2. Live overlays (arcade screens, jukebox notes, the karinderya fan, fire and food) stay procedural. Commit `Town step 2: play and break pieces`.

### Task 4: Batch C (garden, utility, glass and doors)

`pond`, `pond-east`, `bench`, `bench-side`, `tree`, `bird-feeder`, `hedge`, `fence`, `gate`, `lamp-post`, `garage`, `mail-bench`, `mailbox`, `tires`, `picnic-table`, `glass-x`, `glass-y`, `office-door`.
- Glass stays translucent: render it with the alpha preserved, and do not binarise its alpha in post.
- The water in ponds keeps its procedural shimmer overlay.

Same steps as Task 2. Commit `Town step 2: garden, utility, glass and door pieces`.

### Task 5: Room shell: floors, walls and wall fixtures

**Files:** `art/blender/office_shell.py` (new), `art/post.py`, `public/office-furniture.js` (`bake`, `bakeDefaultFloor`, `bakeZoneFloor`, the wall fixtures).

- Floor textures per zone type are rendered as small seamless isometric tile textures (32×16 diamond tiles at 1×):
  - focus and office: light wood;
  - play: soft carpet;
  - garden: grass;
  - utility: concrete;
  - garage: asphalt;
  - path: pavers;
  - water: water;
  - lounge: rug;
  - kain: terracotta tile.
- `bakeZoneFloor` fills each zone with its texture through a Canvas pattern clipped to the zone polygon. It keeps zone borders and build-mode zone colours as today.
- The back walls and windows of the office become one Blender-rendered wall strip per wall: the modern-cozy style, with large warm windows, plants on sills and a light trim.
- The wall fixtures (corkboard, breaker box, Today board, usage board, scheduler board) become sprite bases, with their text and numbers still drawn procedurally on top.
- Night: windows use the glow layer, and `F.state.night` tints as today.
- Test: the bake still produces identical zone polygons, so the bake-golden fixture keeps its zone geometry part. The golden draw-log of the procedural floor is retired and replaced by a test that `bake()` draws one pattern fill per zone and the wall sprites.

Steps as above, with a live check at `setHour(13)` and `setHour(22)` and after painting a zone in build mode. Commit `Town step 2: room shell, floors and walls`.

### Task 6: Karinderya and game hall interiors, doors and scene switching

**Files:**
- Create: `public/world-templates/interior-kain.json` and `public/world-templates/interior-games.json`. These are default interior layouts in the world-model format, validated by `WorldModel.validate`.
  - **kain:** the karinderya piece plus a few lounge pieces, about 600×400 world units, with a `door` spot.
  - **games:** arcade, arcade-race, jukebox, sofa3, snack-table, beanbag, dartboard, hoop and toy-bin, with a `door` spot.
  - Each has a `spawn` at its door.
- Modify: `world-store.mjs`. Add interior files `kain.json` and `games.json` beside `layout.json`, loaded and saved like `layout.json` (atomic writes, validation, the same caps), with `GET/PUT /api/world?scene=kain|games`. A missing file means the template.
- Modify: `public/town.html`. At a lot's door, show an "Enter" prompt (key E, or a tap on the prompt). With a fade, navigate:
  - home → `/#scene=office`;
  - kain → `/#scene=kain`;
  - games → `/#scene=games`;
  - friend lots → no-op in step 2 (the prompt reads "Friend lots open in party mode").
- Modify: `public/Agent Office.html` and `office-world.js`. `#scene=` picks the interior:
  - **office** is today's view;
  - **kain / games** applies that interior layout and shows only the CEO (agents stay in the office until step 3).
  - The header shows the scene name with a "Back to town" button.
  - Each interior has an exit door: walking onto the door spot shows "Leave" (E or tap), which fades to `/town#from=<lot>`.
  - The town spawns the CEO at that lot's door when `#from` is set.
  - Build mode works inside each interior and saves to that scene's file.
- Tests:
  - `world-store.test.mjs`: per-scene load/save, plus scene names outside `office|kain|games` → 400.
  - `town-map.test.mjs`: every lot door has an enter target.
  - Live check `perf/scene-check.cjs`: town → office door → office page; office exit → town at the home door; town → kain → back; town → games → back; with a fade each time and no console errors.

Commit `Town step 2: interiors, doors and scene switching`.

### Task 7: Retire procedural painters, budgets and the regression sweep

- Delete the procedural painter bodies that every converted type no longer uses, and keep `spriteOr`'s fallback only as the atlas-missing path (a plain placeholder box, not the old art).
- Retire the golden draw-log tests that compared procedural draw calls. Keep their geometry assertions (spots, footprints, zones) against `office-footprints.json`.
- Extend `perf/town-perf.cjs` (or add `perf/office-perf.cjs`) with:
  - office page idle CPU and frames;
  - draw time while agents walk (preview `work` scene);
  - renderer memory;
  - 20 enter/leave cycles town ↔ office with memory within ±10%.
- Live checks:
  - a custom saved office layout with moved and added desks renders correctly;
  - a build-mode drag of a sprite piece follows the cursor;
  - with the atlas URL blocked, the office still renders (fallback boxes) with a console note.
- Record the numbers in `docs/perf/town-step2.md`.

Commit `Town step 2: retire procedural painters, budgets and checks`.
