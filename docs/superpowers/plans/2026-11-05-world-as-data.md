# World as Data (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded office into a saved, validated layout (zones, walls, placed furniture, spots) with grid A* walking. The office must look and behave the same as 1.2.9.

**Architecture:**
- Two new classic browser scripts, loadable in a `vm` sandbox like `office-motion.js`:
  - `public/world-path.js`: grid plus A*.
  - `public/world-model.js`: layout schema, validation and `defaultLayout()`.
- `office-furniture.js` registers every piece as a **catalog type**, and draws **instances** listed in the layout. A piece moved by (dx,dy) is drawn with a 2D screen translate of `[K*(dx-dy), K2*(dx+dy)]`, so the existing painters need no rewrite.
- `office-motion.js` builds `SPOTS`/`DESKS`/`OBSTACLES` and the walk grid from the layout. The server stores the layout at `~/.claude/agent-office/world/layout.json`.

**Tech Stack:** Node ≥ the repo's current engine, `node:test`, plain browser JS (no bundler), canvas 2D.

**Spec:** `docs/superpowers/specs/2026-11-05-world-roadmap-design.md` (Phase 1 section)

## Global Constraints
- **Branch `feature/world`**, worktree `AgentOfficeWork/world`, based on release/1.2.9 (`d4fec2f`).
- **Classic-script pattern:** `(function (root) { ... root.X = api; })(globalThis)`. No ES modules in `public/`.
- **World size stays `WX = 1240, WY = 780`.** Projection `P()` unchanged.
- **Grid cell = 10 world units** (124×78).
- **Every new `*.test.mjs` file goes in the explicit `npm test` list in `package.json`.**
- **No visual change:** static scene draw calls must equal the golden fixture (Task 1).
- **Brain state machine is untouched:** `nextState`, `createBrain` and the state names `S`.
- **`PUT /api/world` is in the `DECISIONS` set:** UI cookie plus nonce (`server.mjs:55`).
- **Docs and code stay free of personal paths and names:** `repo.test.mjs` and `share-ready.test.mjs` must pass.

## Review Focus
1. **A corrupt or hand-edited `layout.json`** (bad JSON, unknown type, spot inside a wall). The app must still start on the default layout and log why; it must not show a blank office. Test in Task 6.
2. **A spot that sits inside its own furniture's footprint** (sofa seat, ball pit, Tiro's chair). It must still be reachable, because the path's last step enters the blocked cell. Test in Task 2.
3. **Narrow gaps:** the fence gate (y 383..409), the office door (x 395..445) and the hedge gate (x≈500) must stay open on a 10-unit grid. Test in Task 5.
4. **Agents hugging furniture or cutting across desk blocks** instead of using the corridors, from cost and clearance tuning. A corridor-share test is in Task 5.
5. **A layout with a newer `version` than the app knows:** fall back to the default with a warning, and never overwrite the user's file. Test in Task 6.

---

### Task 1: Golden draw-log fixture of today's office

**Files:**
- Create: `world-golden.mjs` (test helper)
- Create: `world-parity.test.mjs`
- Create: `fixtures/office-golden.json` (generated, committed)

**Interfaces:**
- Produces:
  - `recordOffice(): { items: [{d, fp, log}], objects: [{key, box}], spots: {id: {x,y,face,zone,seat?,desk?,game?}} }`;
  - `hashLog(calls): string` (sha1 of the JSON of rounded calls).

- [ ] **Step 1: Write `world-golden.mjs`.**
  - Load `public/office-motion.js` then `public/office-furniture.js` into one `vm` context, using the same pattern as `office-motion.test.mjs:7-9`.
  - The context gets a `document.createElement('canvas')` stub whose `getContext('2d')` is a recording Proxy:
    - methods push `[name, ...args rounded to 2 dp]`;
    - setters push `['=', prop, value]`;
    - `createRadialGradient`/`createLinearGradient`/`createImageData` return recording stubs.
  - For each `F.items[i]`, call `it.fn(ctx)` on a fresh recorder with `ST.T = 0, night = 0`. Save `{d: it.d, fp: it.fp, log: hashLog(calls)}`, plus `F.objects` keys and boxes and `M.SPOTS`.
- [ ] **Step 2: Generate the fixture from the current code.** Run `node -e "import('./world-golden.mjs').then(m=>require('fs').writeFileSync('fixtures/office-golden.json', JSON.stringify(m.recordOffice(),null,1)))"`. Expected: the file exists, with `items.length > 100` and more than 40 spots.
- [ ] **Step 3: Write `world-parity.test.mjs`.**
  - Test name: `static office draws exactly as 1.2.9`.
  - Assertions: `recordOffice()` deep-equals the fixture for `items` (as a multiset sorted by `d` then `log`), for `objects`, and for `spots`.
- [ ] **Step 4: Add it to the `npm test` list and run it.** `npm test` → PASS (it is trivially green on unchanged code).
- [ ] **Step 5: Commit.** `test: golden draw-log fixture of the 1.2.9 office`.

### Task 2: Grid and A* (`public/world-path.js`)

**Files:**
- Create: `public/world-path.js`
- Create: `world-path.test.mjs`

**Interfaces:**
- Produces `root.WorldPath`:
  - `buildGrid({w, h, cell, blocks: [[x0,y0,x1,y1]], costs: [{rect:[x0,y0,x1,y1], cost}]}) → Grid`;
  - `Grid = {cols, rows, cell, blocked: Uint8Array, cost: Float32Array}`;
  - `findPath(grid, from:{x,y}, to:{x,y}) → [{x,y}]`. The result starts at `from`, ends exactly at `to`, and is `[]` only if unreachable.
  - `cellOf(grid, p) → index`;
  - `lineClear(grid, a, b) → bool`.
- **Rules:**
  - **Blocking:** a cell is blocked if a block rect, shrunk by 1 unit, overlaps the cell's interior with positive area.
  - **Clearance:** a free cell next to a blocked one (8-neighbour) gets cost ×1.6.
  - **Cost zones:** the lowest `cost` among the zones covering the cell centre applies; the default is 1.
  - **Movement:** 8-connected with no corner cutting past blocked cells. The heuristic is octile × the minimum zone cost.
  - **Blocked endpoints:** a blocked start or goal cell is still allowed. The search enters or leaves it from its cheapest free neighbour.
  - **Smoothing:** string-pull only between points whose `lineClear` is true, and whose sampled cells all have cost ≤ the max cost of the two endpoints' cells. This keeps routes on corridors.

- [ ] **Step 1: Write the failing tests** in `world-path.test.mjs` (load via `vm`):
  - `blocks a cell only on real overlap`: a block `[0,0,10,10]` blocks cell 0 but not cell 1. A block `[9.5,0,20,10]` blocks cell 1 only.
  - `finds a path around a wall`: a 200×100 grid, a wall `[95,0,105,80]`, path from (20,20) to (180,20). Every segment keeps `lineClear`, the path ends at `{x:180,y:20}`, and some point has `y >= 80`.
  - `enters a blocked goal cell`: the goal sits inside block `[140,10,170,40]`. The path is non-empty and ends on the goal.
  - `prefers cheap cost zones`: a cost-0.5 strip `y∈[60,80]` and a straight route at `y=20`. The path from (10,20) to (190,20) has more than 50% of its length inside the strip.
  - `unreachable returns []`: the goal is fully enclosed by walls.
- [ ] **Step 2: Run** `node --test world-path.test.mjs`. Expected: FAIL (`WorldPath` undefined).
- [ ] **Step 3: Implement `public/world-path.js`** per the Interfaces rules. Use a binary-heap open set.
- [ ] **Step 4: Run** `node --test world-path.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(world): grid and A* path finder`.

### Task 3: Furniture catalog and placed instances (`office-furniture.js`)

**Files:**
- Modify: `public/office-furniture.js`. `add()`/`reg()` are at :63-69; every `add(...)` and `reg(...)` call from about :280 to :700 is affected.
- Test: `world-parity.test.mjs`

**Interfaces:**
- Produces on `root.OfficeFurniture`:
  - `CATALOG: { [type]: { type, anchor:[x,y], label?, blocks?:bool, walkable?:bool, spots?:[{id, dx, dy, face, zone, seat?, desk?, game?}], parts:[{d, fn, o}], regs:[{key,label,box,o}] } }`;
  - `defaultInstances(): [{id, type, x, y}]`, one per piece in today's scene at its anchor;
  - `place(instances)`, which clears and rebuilds `items` and `objects` from the instances;
  - `footprints(instances) → [[x0,y0,x1,y1]]`, the measured per-box ground footprints (the existing `REC` mechanism), used for blocking.
- **Conversion rule:**
  - Wrap each existing group of `add`/`reg` calls that belongs to one physical piece in `def(type, anchor, build)`. Types include the 8 desks, `tiro-desk`, `bench`, `tree`, `plant`, `sofa3`, `arcade`, `jukebox`, `glass-x`, `glass-y`, `hedge`, `fence`, `gate`, `pond`, and so on. The `build` function calls `add`/`reg` exactly as today.
  - Desks are one type, `dept-desk`, whose instance has `{desk: 'desk-N'}`. Its painter reads `M.DESKS` by that id.
  - Pieces that cannot move stay type `fixture-<name>`: wall decor in `walls[]`, the string lights, `bake()`.
  - **Relocation:** `place()` replays `build` with a `g.translate(K*(dx-dy), K2*(dx+dy))` wrapper. It adds `dx+dy` to `d`, shifts `fp` and `reg` boxes by (dx,dy), and shifts `spots` by `anchor + d*` plus `(dx,dy)`.
  - **Spots:** every id in the golden `spots` comes from exactly one catalog type's `spots` (desk seat, sofa seats, benches, arcade, etc.), or from the layout's free `spots` (Task 4: queue, cooler, hot desks, overflow, `office:report`, `tiro:window`, `sched:npc`, the garden path points).

- [ ] **Step 1: Write the failing test** in `world-parity.test.mjs`, named `a piece placed 40 units east draws translated and shifts its footprint`:
  - Take `place([{id:'b', type:'bench', x: anchor.x+40, y: anchor.y}])`.
  - Assert the single item's `d` is 40 more than at its anchor.
  - Assert `fp` is shifted by 40 in x.
  - Assert the recorded log begins with `['translate', 28.28, 14.14]`.
- [ ] **Step 2: Run.** Expected: FAIL (`place` undefined).
- [ ] **Step 3: Implement** `def`, `CATALOG`, `defaultInstances`, `place` and `footprints`, and convert the painters per the rule. At load, call `place(defaultInstances())` so behaviour is unchanged until Task 7.
- [ ] **Step 4: Run** `npm test`. Expected: the golden test and the new test PASS. If the golden test fails, the conversion changed a draw; fix the conversion, never the fixture.
- [ ] **Step 5: Commit.** `refactor(furniture): catalog types and placed instances, draw output unchanged`.

### Task 4: Layout model (`public/world-model.js`)

**Files:**
- Create: `public/world-model.js`
- Create: `world-model.test.mjs`

**Interfaces:**
- Consumes `OfficeFurniture.CATALOG`, `defaultInstances()` and `footprints()`, plus `WorldPath.buildGrid` and `findPath`.
- Produces `root.WorldModel`:
  - `VERSION = 1`;
  - `defaultLayout() → Layout`;
  - `validate(layout) → {ok, errors: string[]}`;
  - `spotsOf(layout) → {id: spot}`;
  - `gridOf(layout) → Grid`.
- `Layout` is:
  - `{ version: 1, size:{w:1240,h:780}, spawn:{x:420,y:250} }`;
  - `zones: [{id, type, rect:[x0,y0,x1,y1]}]`;
  - `objects: [{id, type, x, y, desk?}]`;
  - `spots: [{id, x, y, face, zone, seat?, desk?, game?}]`.
- **Zone types:** `office`, `garden`, `focus`, `utility`, `play`, `garage`, `path`.
  - The non-path zones are the bake rects at `office-furniture.js:84-91`.
  - The `path` zones (cost 0.55) are 30-unit strips along `ROWY.n/a/s` across x 0..1000, the `COLX` columns between rows, the garden loop's bounding ring, the utility row y≈668, the playroom rows y≈655 and 755, and the office path from the door `(420,250)` to `(325,36)`.
- `gridOf` blocks `footprints()` of every object whose type is not `walkable`, plus the world border.
- **`validate` errors:**
  - unknown object type;
  - duplicate ids;
  - spot outside `size`;
  - spawn blocked;
  - any spot unreachable from spawn (`findPath` returns `[]`);
  - `version > VERSION`.

- [ ] **Step 1: Write the failing tests:**
  - `default layout validates` (`ok === true`).
  - `default layout reproduces every 1.2.9 spot`: `spotsOf(defaultLayout())` deep-equals the golden `spots`.
  - `validate rejects bad layouts`, with one case per error above. Each asserts the matching error substring: `'unknown type'`, `'duplicate id'`, `'outside'`, `'spawn'`, `'unreachable'`, `'newer version'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `public/world-model.js`.** The free spots are copied from today's `spot(...)` calls (`office-motion.js:41-84`) that are not owned by a catalog type.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(world): layout schema, default layout, validation`.

### Task 5: Motion reads the layout (`office-motion.js`)

**Files:**
- Modify: `public/office-motion.js`. Layout and graph code is at :21-176; exports are at :310-312.
- Modify: `office-motion.test.mjs`. The context also loads `world-path.js`, `office-furniture.js` and `world-model.js`; tests that target graph nodes (`'a270'`) target points instead.
- Modify: `public/office-world.js:96` (`M.NODES.spawn` → `M.SPAWN`).

**Interfaces:**
- Consumes `WorldModel.defaultLayout/spotsOf/gridOf` and `WorldPath.findPath`.
- Produces `OfficeMotion.useLayout(layout)`. It rebuilds `SPOTS`, `DESKS` (from `dept-desk` instances, keeping `{id, key, col, top, cx, block, rect, seat}`), `OBSTACLES`, `SPAWN` and the grid, all in place so existing references stay valid.
- `pathTo(from, to)` keeps its signature and return shape. It resolves spot ids or points, uses `findPath`, and falls back to `[from, to]` when no path exists.
- **Remove:** `NODES`, `EDGES`, `attach`, `projectOnEdge`. `COLX`/`ROWY`/`CX` stay only as inputs to `defaultLayout`.
- `useLayout(WorldModel.defaultLayout())` runs at load.

- [ ] **Step 1: Write the failing tests** in `office-motion.test.mjs`:
  - `narrow gaps stay open`: `pathTo('desk-4','pk:pond')` passes x≈1000 with 383<y<409; `pathTo('desk-1','tiro:seat')` crosses y=230 with 395<x<445; `pathTo('desk-1','garden:b1')` crosses y=230 near x 500.
  - `agents keep to corridors`: for `desk-1→desk-8`, `desk-2→play:pit` and `hot:1→garden:b2`, at least 70% of the path length lies inside `path` zones.
  - `useLayout keeps SPOTS identity`: `const s = M.SPOTS; M.useLayout(W.defaultLayout()); assert.equal(M.SPOTS, s)`.
- [ ] **Step 2: Run** `node --test office-motion.test.mjs`. Expected: the new tests FAIL (no `useLayout`).
- [ ] **Step 3: Implement `useLayout` and the new `pathTo`, and delete the graph code.** Existing tests that must still pass unchanged:
  - `every spot is reachable and a path never cuts across a desk`;
  - `walker reaches ... within the 6 s budget`;
  - the fade fallback;
  - the blocked walker.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS. If the corridor share fails, tune only the path-zone cost (0.4–0.7) and the clearance multiplier, and note the final values in the commit message.
- [ ] **Step 5: Commit.** `feat(world): motion derives spots, desks and grid A* from the layout`.

### Task 6: Server storage and `/api/world`

**Files:**
- Create: `world-store.mjs`
- Create: `world-store.test.mjs`
- Modify: `server.mjs`:
  - `lockDown` list at :45;
  - `DECISIONS` at :55;
  - GET routes near the `/export/*` switch (~:550);
  - POST switch at :571.

**Interfaces:**
- Consumes `public/world-model.js`, loaded into a `vm` context inside `world-store.mjs` (same file the page uses, so validation can't drift).
- Produces `createWorldStore(dir) → { load(): {layout, source: 'file'|'default', warning?}, save(layout): {ok, errors?} }`.
- **`load`:**
  - A missing file gives the default.
  - Bad JSON, `validate` errors, or a newer version give the default with `warning`, and the file is not touched.
- **`save`:** validates first, then writes `layout.json.tmp` and renames it over `layout.json`.
- **Routes:**
  - `GET /api/world` → `{layout, source, warning}`.
  - `POST /api/world` → `save(b.layout)`. It returns 400 with `errors` when invalid and calls `bump()` on success.

- [ ] **Step 1: Write the failing tests** in `world-store.test.mjs` (use a temp dir):
  - `missing file loads default`.
  - `corrupt json loads default with warning and leaves the file`: the file bytes are unchanged afterwards.
  - `newer version loads default and is not overwritten by load`.
  - `save rejects invalid layout and keeps the old file`.
  - `save is atomic`: after a save, there is no `.tmp` file and the reload deep-equals what was saved.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `world-store.mjs` and wire the routes.** Add `'/api/world'` to `DECISIONS`, and add the `world` dir to `lockDown`. The GET route needs the UI cookie, like the other `/api/*` GETs.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, including `security.test.mjs`/`hardening.test.mjs`. If they enumerate routes, add `/api/world` there with the same expectations as `/api/task`.
- [ ] **Step 5: Commit.** `feat(world): layout store and /api/world`.

### Task 7: Page boots from the stored layout

**Files:**
- Modify: `public/Agent Office.html`. Script tags: add `world-path.js` and `world-model.js` before `office-motion.js`, and fetch the layout before the world starts.
- Modify: `public/office-world.js`. `OBJ` is built once at :33; make it rebuildable via `rebuildObjects()`.
- Test: `world-parity.test.mjs`

**Interfaces:**
- Consumes `GET /api/world`, `OfficeMotion.useLayout`, `OfficeFurniture.place` and `WorldModel.spotsOf`.
- Produces `OfficeWorld.applyLayout(layout)`, which calls `useLayout`, then `place(layout.objects)`, then `rebuildObjects()`, invalidates the baked background and marks the scene dirty. This is the hook Phase 2's editor calls.
- **On boot:** fetch `/api/world`, call `applyLayout`, then start the loop. If `warning` is set, show a one-line toast. If the fetch fails, keep the default and do not block the start.

- [ ] **Step 1: Write the failing test** `applyLayout(defaultLayout()) keeps the golden scene`: in the vm, after `applyLayout`, the `recordOffice()` items equal the fixture.
- [ ] **Step 2: Run.** Expected: FAIL (`applyLayout` undefined).
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Manual check.**
  - Run `./start.ps1` and open `http://127.0.0.1:4777` beside an installed 1.2.9. Use the demo scenes (`?demo=1` if present) to compare: same scene, agents walk to desks, garden, park and playroom on corridors, nothing walks through glass, fence or desks.
  - Corrupt `~/.claude/agent-office/world/layout.json` by hand, then reload: you should see the default office and a toast.
- [ ] **Step 6: Commit.** `feat(world): page boots from the saved layout`.

---

## Out of scope for Phase 1 (handled later)
- **Editable floors and bake:** the floors stay baked from the hardcoded rects (Phase 2).
- **Rotation of pieces:** Phase 2, per type.
- **Dynamic roster:** Phase 3. Desks stay the 8 `dept-desk` instances keyed `desk-1..8`.
