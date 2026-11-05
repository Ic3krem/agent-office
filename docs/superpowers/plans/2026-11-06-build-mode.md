# Build Mode (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Gather-style **Build mode** that lets the user rearrange the office and save it as `layout.json`. The user can move, add, duplicate and delete furniture, paint, resize and retype zones, undo and redo, and save or load workspace templates. It works with mouse and touch.

**Architecture:**
- **Edit logic** lives in a new pure classic script, `public/world-edit.js` (`WorldEdit`). It covers the inverse projection, snapping, layout operations, history and a cheap legality check, and is unit-tested in the vm.
- **The canvas side** (`office-world.js`) draws the build overlay and turns pointer input into WorldEdit ops.
- **The page** (`Agent Office.html`, dc-runtime template) adds the Build toggle, the catalog drawer, the edit bar and the templates menu.
- **Floors** are painted from `layout.zones` whenever they differ from the default zones. The default office keeps its hand-painted floor, so the golden test still holds.
- **The server** gains template storage and a `worldVersion` in the snapshot, so open pages pick up a saved layout.

**Tech Stack:** plain browser JS (classic scripts), dc-runtime template (`public/support.js`), Node `node:test` + vm (`world-vm.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-05-world-roadmap-design.md` (Phase 2 section)

## Global Constraints
- **Branch `feature/world`**, worktree `AgentOfficeWork/world`. Phase 1 is complete (layout.json, grid A*, `applyLayout`).
- **Classic-script pattern** `(function (root) { ... root.X = api; })(globalThis)`; no ES modules in `public/`.
- **The default layout must still draw exactly as 1.2.9:** `world-parity.test.mjs` golden test stays green, and the fixture is never edited.
- **Every new `*.test.mjs` is added to the `npm test` list in `package.json`.**
- **`POST /api/world` remains the only layout write path.** Template writes are new `DECISIONS` routes (cookie + `x-nonce`).
- **Saved layouts must pass `WorldModel.validate`.** The editor never sends a layout it knows is invalid. It shows the validator's errors instead.
- **Grid snap = 10 world units.** World size stays 1240×780 in this phase.
- **Docs and code stay free of personal paths and names.**
- **Commits end with:**
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_01PNVRsGXe7KFHBeKupfZcRQ`

## Scope rulings (made on the user's behalf; recorded so they can be reversed)
- **Rotation is out of scope for this phase.** No painter supports another orientation, and isometric rotation needs per-type art. The `R` key shows the toast "Rotation is coming in a later update".
- **Map growth (bigger world) is out of scope for this phase.** The stage size (1480×920), `WX`/`WY`, and the camera are hard-coded in five places. It becomes its own follow-up.
- **Department desks (`dept-desk`) can be moved but not added or deleted.** Adding desks is Phase 3.
- **Pieces that own required spots cannot be deleted.** Required spots are the ones the agent brain reads (`world-model.js` required list); for example, the sofa owns `play:sofa1-3`. The editor explains why and offers moving the piece instead.
- **Fixtures (`fixture-*`) are not shown in the catalog and cannot be selected.**
- **Shipped templates** rearrange the default set of pieces (same pieces, different positions), so they always satisfy the required-spot rule.

## Review Focus
1. **A drag released over water, another piece, or outside the world:** the piece snaps back to its last legal position and shows a red ghost while illegal. It must never leave an invalid layout in the editor state. Covered in Task 1.
2. **Touch:** dragging with one finger moves a piece. Two-finger pinch or pan must not move pieces, and a drag must not also fire a click. Covered in Task 4.
3. **Leaving Build mode with unsaved changes:** the user is asked to Save or Discard. Discard restores the last saved layout exactly. Covered in Task 5.
4. **Save rejected by the server** (validate errors): the errors are shown, the edit is kept, and nothing is lost. Covered in Task 5.
5. **Duplicated pieces that own spots get unique spot ids:** the brain still reads only the required ids, and validate does not report 'duplicate id'. Covered in Task 1.

---

### Task 1: Edit core (`public/world-edit.js`)

**Files:**
- Create: `public/world-edit.js`
- Create: `world-edit.test.mjs`
- Modify: `world-vm.mjs` (add `world-edit.js` to `ORDER` after `world-model.js`)
- Modify: `public/office-furniture.js`, but only if `spotsOf` needs the duplicate-id suffix rule below.

**Interfaces:**
- **Consumes:**
  - `WorldModel` (`defaultLayout`, `validate`, `spotsOf`, `gridOf`, `VERSION`);
  - `OfficeFurniture` (`CATALOG`, `footprints`, `spotsOf`);
  - `WorldPath.cellOf`;
  - `OfficeFurniture.K`, `K2`, `OXS`, `OYS`.
- **Produces `root.WorldEdit`:**
  - `toGround(sx, sy) → {x, y}`: inverse of `P` at z=0, where `a=(sx-OXS)/K`, `b=(sy-OYS)/K2`, `x=(a+b)/2` and `y=(b-a)/2`.
  - `snap(v) → number`: rounds to 10.
  - `catalog() → [{type, label, group: 'furniture'|'decor'|'nature'|'desk', addable: bool, deletable: bool}]`. Fixtures are excluded. `dept-desk` has `addable: false` and `deletable: false`.
  - `createSession(layout) → Session`. The session holds a deep copy of `layout` and is never shared with callers. Its methods are:
    - `layout() → Layout`, a deep copy;
    - `dirty() → bool`, which is true when the layout differs from the session's base;
    - `markSaved()`, which makes the current layout the new base;
    - `canUndo()` and `canRedo()`;
    - `undo()` and `redo()`;
    - `move(id, x, y) → Result`;
    - `add(type, x, y) → Result & {id}`;
    - `duplicate(id) → Result & {id}`;
    - `remove(id) → Result`;
    - `addZone(type, rect) → Result & {id}`;
    - `setZone(id, {rect?, type?}) → Result`;
    - `removeZone(id) → Result`;
    - `check(op) → Result`, which runs the legality check without applying the op.
  - `Result = {ok: bool, reason?: string}`. A failed op changes nothing and pushes no history.
- **Legality (cheap, per op).** These checks stay well under 5 ms on the default layout:
  1. The moved or added piece's `footprints([inst])` stays inside `size`.
  2. Those footprints do not overlap the footprints of any other non-walkable piece (cache them per session state) or any `water` zone.
  3. None of the piece's spots lands in a blocked cell of the cached grid, which is built without that piece.
  4. `remove` fails with reason `'needed by agents: <spot ids>'` when the piece owns required spots. It fails with `'cannot delete department desks yet'` for `dept-desk`.
  5. Zones must lie inside `size` and need `w, h ≥ 20`. Their type must be in the validator's known set.

  Full reachability is not checked per op; the save path does that.
- **Ids:**
  - A new object's id is `<type>-<n>`, with the smallest unused `n`.
  - Spots owned by an added or duplicated piece get the suffix `@<objectId>` (for example `garden:b1@bench-3`) when the base id is already taken. The `spotsOf` resolver applies this suffix, so ids stay unique and validate passes.
- **History:** snapshots of the layout, capped at 100 entries. `undo` and `redo` move between them, and a new op after an undo clears the redo stack.

- [ ] **Step 1: Write the failing tests** in `world-edit.test.mjs`. Load with `loadWorld()`, which now includes `world-edit.js`. Compare across realms with a JSON round-trip.
  - `toGround inverts P`: for 20 random ground points, `toGround(...P(x,y,0))` is within 0.01 of the point.
  - `move snaps and is undoable`: `move('bench-1', 703, 27)` places it at `(700,30)`. After `undo`, the original position is back. After `redo`, it is at the moved position again.
  - `illegal move changes nothing`: move a bench onto the garden pond centre `(790,105)`. The result is `ok:false`, the layout is unchanged, and `canUndo()` is false.
  - `cannot delete pieces agents need`: `remove` of the sofa gives `ok:false` with a reason that matches `/play:sofa1/`. `remove` of a desk gives `ok:false` with the reason `'cannot delete department desks yet'`.
  - `duplicate gets fresh ids and stays valid`: duplicate a bench, move the copy to a free spot, and `WorldModel.validate(session.layout()).ok === true`.
  - `zones`: `addZone('lounge', [100,600,140,640])` is ok. `setZone` to a rect smaller than 20 gives `ok:false`.
  - `dirty and markSaved`: a new session is not dirty, it is dirty after a move, and it is clean again after `markSaved()`.
  - `ops are fast`: 50 random legal moves take under 250 ms in total.
- [ ] **Step 2: Run** `node --test world-edit.test.mjs`. Expected: FAIL (`WorldEdit` undefined).
- [ ] **Step 3: Implement** `public/world-edit.js`, the `ORDER` change in `world-vm.mjs`, and the spot suffix rule. Add `'lounge'` to the validator's zone types if it is missing.
- [ ] **Step 4: Run** `node --test world-edit.test.mjs world-model.test.mjs world-parity.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(build): edit core: inverse projection, ops, legality, history`.

### Task 2: Floors painted from zones

**Files:**
- Modify: `public/office-furniture.js` (`bake()` at about :102-200)
- Modify: `public/world-model.js` (export `DEFAULT_ZONES` or `isDefaultZones(zones)`)
- Test: `world-parity.test.mjs`

**Interfaces:**
- **Produces:**
  - `OfficeFurniture.setZones(zones)`. The baked floor uses the hand-painted 1.2.9 floor when `WorldModel.isDefaultZones(zones)`. Otherwise it paints one floor per zone, in this order:
    1. base `flat` fill;
    2. the texture for its type, clipped to the zone rect (planks for `office`, stripes for `garden`, tiles for `focus`, checker for `utility`, confetti for `play`, plain for `garage`, a light runner for `path`, a warm tile for `lounge`);
    3. a 2-unit trim on its edges.

    `water` zones paint nothing, since the pond pieces draw the water.
  - `OfficeWorld.applyLayout` calls `F.setZones(layout.zones)` before invalidating the background. Walls, windows and wall prints stay as they are.

- [ ] **Step 1: Write the failing tests:**
  - `bake with default zones is unchanged`: recording `bake()` after `setZones(defaultLayout().zones)` gives a log hash equal to recording it before. Record via the `world-golden` recorder.
  - `bake paints custom zones`: with zones `[{type:'focus', rect:[0,0,400,400]}]`, the recorded log contains a `fill` after a path whose four points equal `P` of that rect's corners. It also no longer contains the 1.2.9 office plank stroke count.
- [ ] **Step 2: Run.** Expected: FAIL (`setZones` undefined).
- [ ] **Step 3: Implement** `setZones`, `isDefaultZones` (a deep compare of id, type and rect against `defaultLayout().zones`), the generic painters, and the `applyLayout` call.
- [ ] **Step 4: Run** `node --test world-parity.test.mjs world-model.test.mjs`. Expected: PASS, golden included.
- [ ] **Step 5: Commit.** `feat(build): floors follow layout zones; default floor unchanged`.

### Task 3: Server: templates and live layout version

**Files:**
- Modify: `world-store.mjs`, `server.mjs` (routes near `/api/world`, plus `DECISIONS` and `snapshot()`)
- Create: `public/world-templates/startup-loft.json`, `public/world-templates/agency-floor.json`, `public/world-templates/hotel-back-office.json`
- Create: `world-templates.test.mjs`
- Modify: `package.json` (test list)

**Interfaces:**
- **Produces in `createWorldStore(dir)`:**
  - `listTemplates() → [{id, name, builtIn}]`, which merges `public/world-templates/*.json` (built in) with `<dir>/templates/*.json`;
  - `getTemplate(id) → {layout}|null`;
  - `saveTemplate(name, layout) → {ok, id?, errors?}`. It validates the layout; the id is a slug of the name matching `[a-z0-9-]{1,40}`, and a name that collides with a built-in id gets the suffix `-mine`. The write is atomic and fsynced, as in `save`.
  - `deleteTemplate(id) → {ok}`, which works on user templates only.
  - `version()`, a counter that goes up on every successful `save`.
- **Routes:**
  - `GET /api/world/templates` → list.
  - `GET /api/world/template?id=` → `{layout}`. The id must match the slug regex, otherwise 400.
  - `POST /api/world/templates` with `{name, layout}`.
  - `POST /api/world/template/delete` with `{id}`.
  - All four are in `DECISIONS`.
  - `snapshot()` includes `worldVersion: worldStore.version()`.
- **Template files:** each is a full Layout. It uses the default object set with different positions, and must pass `validate`.

- [ ] **Step 1: Write the failing tests** (temp dir for the store):
  - `built-in templates validate`: each of the 3 files passes `WorldModel.validate`, and each differs from `defaultLayout()` in at least 10 object positions.
  - `save, list, get, delete user template`.
  - `template id is a safe slug`: the name `'../../x'` gives an id matching `/^[a-z0-9-]{1,40}$/`, and the file stays inside `<dir>/templates`.
  - `invalid template rejected`.
  - `version increments on save only`.
  - An HTTP test in `hardening.test.mjs`: `GET /api/world/templates` without the nonce gives 403; with the nonce it lists 3 built-ins.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the store methods, routes, `snapshot` field, and the 3 template files. Generate the templates with a small script that moves pieces of the default layout and keeps only legal moves, checked with `WorldEdit.createSession(...).move`; keep that script out of the commit.
- [ ] **Step 4: Run** `node --test world-templates.test.mjs world-store.test.mjs`, and `node --test hardening.test.mjs` on its own. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(build): workspace templates and live layout version`.

### Task 4: Canvas build overlay and pointer editing (`office-world.js`)

**Files:**
- Modify: `public/office-world.js` (input around `mount()` :377-385, `pick()` :346, `render()` :261-302, `applyLayout` :396)
- Test: `world-edit.test.mjs` (pure helpers only)

**Interfaces:**
- **Consumes:** `WorldEdit` (Task 1); `toStage(e)` (:345) for event to stage px.
- **Produces:**
  - **`OfficeWorld.setBuild(session | null, hooks)`.** `hooks = {onChange(state), onSelect(id|null), onToast(text)}`. When a session is set:
    - Agents freeze in place: the motion step is skipped and tags are hidden.
    - The overlay draws a 10-unit ground grid (faint), and zone rects in their type colour at 25% fill with a label.
    - The selected piece gets a gold outline and its footprint rect.
    - During a drag, a ghost footprint shows, green when legal and red when illegal.
  - **Pointer events** (`pointerdown`, `pointermove`, `pointerup` with `setPointerCapture`):
    - A press on a piece's mask selects it.
    - A drag of at least 4 px moves it. The position is snapped and checked with `session.check` on each move, and committed with `session.move` on release. If the move is illegal, the piece snaps back.
    - A press on empty ground clears the selection.
    - A second simultaneous pointer cancels the drag, so pinch and pan stay with the camera.
    - A completed drag suppresses the following `click`.
    - Zones: when the zone tool is active (`setTool('zone:<type>')`), dragging on empty ground draws a new rect with `addZone`. Dragging the bottom-right handle of a selected zone resizes it with `setZone`.
  - **Keys in Build mode:**
    - `Delete`/`Backspace` removes the selection; a refusal shows the reason as a toast.
    - `Ctrl+Z` undoes; `Ctrl+Y` and `Ctrl+Shift+Z` redo.
    - `Ctrl+D` duplicates.
    - `R` shows the rotation toast.
    - `Escape` clears the selection.
  - **After every op:** `applyLayout(session.layout())`, then `hooks.onChange({dirty, canUndo, canRedo, selected})`. Re-measuring is skipped during the drag and runs once on release (call `F.place` only while dragging).
  - **`OfficeWorld.dropAt(type, clientX, clientY) → Result`** adds a catalog piece at the snapped ground point. The drawer in Task 5 calls it, including on touch.

- [ ] **Step 1: Write the failing test** `screen point under a placed piece hits it`: with `toGround` and `F.footprints`, the ground point from the centre of the bench's footprint lies inside that footprint. This test is a guard for the inverse used by `pick`.
- [ ] **Step 2: Run.** Expected: FAIL until it is wired.
- [ ] **Step 3: Implement** the overlay, the pointer state machine, the keys, `setBuild`, `setTool` and `dropAt`.
- [ ] **Step 4: Run** `npm test`. Expected: no new failures; the golden test stays green because the overlay draws only in Build mode.
- [ ] **Step 5: Commit.** `feat(build): canvas overlay, pointer and touch editing`.

### Task 5: Page UI: Build toggle, catalog drawer, edit bar, templates

**Files:**
- Modify: `public/Agent Office.html` (control row :164-171, state :378, `renderVals` :559, boot :380-391, SSE `onmessage` :401)

**Interfaces:**
- **Consumes:**
  - `WorldEdit.catalog()`, `createSession`;
  - `OfficeWorld.setBuild`, `setTool`, `dropAt`;
  - `api()` (:364);
  - the template routes from Task 3;
  - `showToast`.
- **Produces these UI pieces:**
  - **"Build" pill** in the bottom-right control row. It shows as active in Build mode, and is hidden in demo mode.
  - **Entering Build mode** creates a session from the current layout (cached from the last `/api/world` GET or save).
  - **Catalog drawer.** On wide screens it is a left panel; on narrow screens (<700 px) it is a bottom sheet. It has these groups:
    - Furniture, Decor, Nature (only `addable` types). Each item is a button with its label. Clicking an item and then clicking the floor places it; on desktop, dragging it onto the canvas places it. Both paths call `dropAt`.
    - Zones: brush buttons per zone type call `setTool('zone:<type>')`.
  - **Edit bar** (top centre, shown in Build mode): Undo, Redo, Delete, Duplicate, **Save**, **Done**.
    - **Save** posts `/api/world`. On 400 it shows the errors (first 3, plus "+N more") in a dismissible panel and keeps the session. On 200 it calls `markSaved()` and shows a toast.
    - **Done**: if the session is dirty, a confirm dialog offers Save / Discard / Cancel. Discard re-applies the last saved layout.
  - **Templates menu** in the edit bar:
    - The list comes from `GET /api/world/templates`.
    - **Load** replaces the session's layout and stays dirty until saved. If the session is dirty, it asks first.
    - **Save as template** prompts for a name.
    - **Reset to default** loads `WorldModel.defaultLayout()` into the session.
    - User templates can be deleted.
  - **Live update:** when an SSE snapshot's `worldVersion` changes and the page is not in Build mode, re-fetch `/api/world` and `applyLayout`. In Build mode, show a toast "Layout changed in another window" and leave the session alone.

- [ ] **Step 1: Manual-check script.** Write a headless Electron driver like the one used for Phase 1 Task 7 (temp HOME, `AGENT_OFFICE_PORT=4790`; never touch the installed app or :4777). It must:
  1. enter Build mode;
  2. move bench-1 by +40 x;
  3. try to move it into the pond and expect a snap-back;
  4. add a plant from the drawer;
  5. Undo, then Redo;
  6. Save;
  7. reload, and confirm the bench is at its new position and the plant is present;
  8. Done with no prompt;
  9. load the "Startup Loft" template, then choose Discard and confirm the layout is restored;
  10. emulate touch (`Emulation.setTouchEmulationEnabled`) and drag a piece with a single touch.

  Store screenshots in the scratchpad.
- [ ] **Step 2: Implement the UI.**
- [ ] **Step 3: Run the driver.** Expected: every step passes, with screenshots captured. Also run `npm test` and expect no new failures.
- [ ] **Step 4: Commit.** `feat(build): Build mode UI: catalog, edit bar, templates`.

---

## Out of scope (later phases)
- **Rotation** (per-type art).
- **Map growth** (stage and camera rework).
- **Adding or deleting department desks** (Phase 3).
- **Moving fixtures.**
