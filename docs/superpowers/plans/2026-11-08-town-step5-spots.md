# Town Step 5: Places to Wander Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six outdoor spots (park, waterfall, tree of life, court, pasture, plus roaming cats) that idle agents walk out to and use; a poetic scenery bubble over the player; and 12 karinderya seats with take-out overflow.

**Architecture:**
- Spots are data in `public/town/town.json` (a `spots` array), validated and grid-blocked by `TownMap`.
- `AgentTravel` gets a new destination kind, `spot:<id>:<n>`, that ends in a `there` leg in the town scene at activity point `n`. The choice is a pure hash, so every page agrees.
- Two new pure classic-script modules:
  - `public/town-animals.js`: where animals are at time t;
  - `public/town-scenery.js`: bubble state and line choice.
- Both are drawn by the existing renderers. Only ambient frames animate them, so idle CPU budgets hold.
- Art comes from the existing Blender pipeline.

**Tech Stack:** Vanilla JS classic scripts, PixiJS v8 (vendored), Canvas2D, `node:test`, Electron perf harnesses (`perf/*.cjs`), Blender 5.2 + Pillow (`npm run art`).

**Spec:** `docs/superpowers/specs/2026-11-08-town-step5-spots-design.md`. Read its "Decisions after the builder check" section first: it overrides the earlier "Behaviour details" where they differ.

## Global Constraints

- **No tokens:** canned text and local animation only. Nothing new goes on the party wire.
- **Step 4 budgets still hold:**
  - town walk frame p95: < 16 ms Low, < 8 ms High;
  - renderer private memory: < 180 MB Low, < 250 MB High;
  - GPU textures: < 48 MB Low, < 96 MB High;
  - shipped art: < 8 MB;
  - idle CPU: < 1% Low, < 3% High;
  - Low with ambient off renders 0 idle frames;
  - town↔office memory slope: ≤ 0.3 MB per cycle.
- **Rendering paths:**
  - Animation runs only through the ambient path: it obeys `ambientFps`, ambient `off`, reduced motion, Power saver and hidden-page stop.
  - The Canvas2D renderer (Low) draws everything static.
- **Walkability:** every lot door, ramp and spot activity point stays reachable from `spawn`. No spot prop covers a door, ramp, path or bridge.
- **Terraces:** `LEVEL_H` = 28; cliffs face south. The waterfall sits on the level-2 south cliff (y = 200), x 110–170, and stays clear of the ramp at x 290–340.
- **Travel:** the choice is deterministic from the agent id and `statusAt` (no `Math.random`, no `emptyAt`). Old trip records (`kain`, `games`) still load unchanged.
- **Tiro:** the manager never travels.
- **Tests:** every new `*.test.mjs` is added to the `npm test` list in `package.json`.
- **Repo is public:** no personal names or absolute paths (share-ready test).
- **Live checks:**
  - temp USERPROFILE/HOME/APPDATA/LOCALAPPDATA;
  - ports 4790–4799, never 4795; never 127.0.0.1:4777 or the real config dir;
  - each harness calls `perf/tmp-sweep.cjs` `sweep()` at start;
  - stop only the processes you started.
- **Commits** end with the controller's session trailers.

## Decisions this plan makes

- **Spot ids:** `park`, `waterfall`, `tree`, `court`, `pasture`. Cats are not a spot; they are animals in `town-animals.js`.
- **Activity kinds:** `sit`, `stand`, `lean`, `shoot`, `dogwalk`. Each spot has at least 8 points:

  | Spot | Points |
  |---|---|
  | park | 8 `sit` (4 benches × 2) + 2 `dogwalk` |
  | waterfall | 8 `stand` |
  | tree | 8 `sit` (roots) |
  | court | 2 `shoot` + 6 `stand` |
  | pasture | 8 `lean` |

- **Hash:** FNV-1a 32-bit over the string `id + '|' + statusAt`. The same helper also picks lines.
- **Idle weights:** `games` (or the office playroom, `null`, when `office.play`) 30, `park` 25, `waterfall` / `tree` / `court` / `pasture` 11.25 each. Implemented as integer buckets out of 400: 120 / 100 / 45 / 45 / 45 / 45.
- **Activity point** = the agent's index among the snapshot's non-manager agent ids sorted ascending, mod the spot's point count. Agents beyond the point count share a point with an offset of `(k * 6, k * 4)` world units, where k = floor(index / count).
- **Karinderya:** a new catalog piece `kain-table` with seats `kain:7`…`kain:12`, placed only in `public/world-templates/interior-kain.json`.
  - The counter overflow spots `kain:q1`…`kain:q4` belong to the existing `karinderya` piece, with `seat: false`.
  - Saved (Build-edited) kain interiors are left alone; they get the table from Build mode. This drops the spec's "add once if it matches stock" migration: a missing file already falls back to the template.
- **Bubble:**
  - It shows on entering a spot's `bubble` rect, which is the spot rect grown by 20 when omitted. It lasts 6000 ms and does not show again for that spot until the player has been outside the exit rect (the bubble rect grown by 30, as hysteresis) for 60000 ms.
  - Animal lines show within 40 units of an animal, with a 30000 ms cooldown per animal.
  - Night lines are used when `Graphics` night ≥ 0.5.
  - The line index is a counter of visits to that spot, kept in memory, mod the number of lines.
- **Ambient levels:**
  - The waterfall animates at `water` and above.
  - Animals and visitor activities (dog walk, hoop shot) animate at `all` and above.
  - At `off`, or in Canvas2D, everything shows its rest frame.

## Review Focus

1. **Work arrives during a visit.** The agent must start walking home at `fullAt` (or at the new status time), never later. Test in Task 2.
2. **A spot is removed or renamed** in `town.json` while a stored trip points at it. `where()` gives `office` home with no throw, and the next sync replaces the record. Test in Task 2.
3. **The player stands on the edge of a bubble rect** and jitters a few pixels. Exactly one bubble shows, thanks to the hysteresis exit rect. Test in Task 6.
4. **Reload mid-visit:** the same agent shows at the same point with the same pose on every page, since the inputs are only `statusAt`, the id and the roster. Test in Task 2.
5. **More agents than points** (the 13-role roster) at one spot. Each agent gets a distinct offset, nothing throws, and nothing lands in a blocked cell. Test in Task 2.

---

### Task 1: Spot data, validation and grid blocking

**Files:**
- Modify: `public/town/town.json`
  - Add the `spots` array, using the placement table in the spec.
  - Remove the decor trees and bushes that overlap a spot rect.
  - Add the spot props to the new `props` list on each spot.
- Modify: `public/town-map.js`
  - `validate`, `grid`;
  - a new `spotPoint`;
  - `lotOfScene` (unchanged for `spot:*`, which are always in the town scene: add a comment only);
  - export.
- Test: `town-map.test.mjs`

**Interfaces:**
- Produces:
  - `town.json` `spots: [{ id, kind, rect: [x0,y0,x1,y1], bubble?: [x0,y0,x1,y1], points: [{ x, y, act: 'sit'|'stand'|'lean'|'shoot'|'dogwalk', face: 'n'|'e'|'s'|'w' }], props: [{ type, x, y }] }]`, where `kind` === `id` for the five spots.
  - `TownMap.SPOT_PROPS`: the prop types `tree-of-life`, `waterfall`, `pool`, `court`, `hoop`, `fence`, `cow-trough`, `flowerbed`, plus the existing `bench`/`lamp`/`flowers`.
  - `TownMap.spotPoint(map, dest) -> { spot, point, x, y, act, face } | null`. `dest` is `'spot:<id>:<n>'`, with n taken mod `points.length`.
  - `TownMap.spotsOf(map) -> [{ id, n }]`, where n is the point count.

- [ ] **Step 1: Write failing tests** in `town-map.test.mjs`:
  - `spots validate`: the shipped map passes. A spot with an unknown kind fails. A point outside its rect fails. A spot rect overlapping any lot footprint, path, ramp or bridge fails. A spot with fewer than 8 points fails.
  - `spot props block cells`: `TownMap.grid(map)` blocks the cell under the `tree-of-life` prop and under a `fence` run, using `decorFootprint`-style footprints for the new types.
  - `every point reachable`: an A* path from `spawn` exists to every lot door, every ramp end and every spot point.
  - `spotPoint`: `spotPoint(map, 'spot:park:3')` returns park's point 3. `'spot:park:13'` returns point 13 % n. `'spot:gone:0'` and `'spot:park:x'` return null.
- [ ] **Step 2:** Run `node --test town-map.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the validation, blocking and `spotPoint` in `public/town-map.js`, and author the `spots` data in `town.json`, following the spec's placement table:
  - **tree:** around (190, 90) on level 2;
  - **waterfall:** pool on level 1 just below y 200, x 110–170;
  - **park:** x 420–800, y 40–360, keeping the ramp x 620–680 clear;
  - **court:** x 1380–1600, y 60–300;
  - **pasture:** x 1700–2100, y 60–380, keeping the ramp x 1660–1720 clear.

  The `terrain.json` `levelsHash` guard must still pass; levels are unchanged.
- [ ] **Step 4:** Run `node --test town-map.test.mjs town-static.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit: `Town step 5: spots in town.json, validated and blocked on the grid`.

### Task 2: Travel to spots

**Files:**
- Modify: `public/agent-travel.js`: `route`, `valid`, `plan`, `timeline` (via `plan`), `where`, `destOf`, `departAt`, `store().sync`.
- Modify: `public/town.html`: pass the spot context to `trips_.sync` (one line).
- Modify: `public/Agent Office.html` (or wherever the office page calls `store().sync`): pass the same spot context.
- Test: `agent-travel.test.mjs`

**Interfaces:**
- Consumes: `TownMap.spotPoint`, `TownMap.spotsOf` (Task 1).
- Produces:
  - `AgentTravel.hash(str) -> uint32` (FNV-1a).
  - `AgentTravel.pickIdle(agentId, statusAt, spots, play) -> null | 'games' | 'spot:<id>:<n>'`. Here `spots = [{ id, n }]` and n is filled in by the caller via the point rule.
  - `AgentTravel.destOf(agent, office, empty, ctx?)`. `ctx = { spots: [{ id, n }], ids: [sorted non-manager ids] }`. Without `ctx` it keeps today's behaviour exactly.
  - `AgentTravel.route(town, fromLot, dest)` accepts `dest` = `'spot:<id>:<n>'` and returns `{ pts, len }` from the lot door to the point.
  - `where()` for a spot `there` leg returns `{ scene: 'town', leg: 'there', t: 0, pos: {x, y}, spot, point, act, face }`.
  - `store().sync(agents, office, empty, now, routes, ctx?)`.

- [ ] **Step 1: Write failing tests** in `agent-travel.test.mjs`. Use the shipped `town.json`, loaded the way the existing tests load it.
  - `pickIdle is deterministic`: the same inputs give the same result. Over 4000 synthetic (id, statusAt) pairs, each bucket gets within ±3 percentage points of 30/25/11.25×4 %.
  - `play keeps agents out of the game hall`: with `play` true, the result is never `'games'`; it is `null` or a spot.
  - `spot trip legs`: a trip to `spot:park:2` gives the legs exit (office) → town (dir 1) → there (scene `town`, `pos` = the point, `act` = the point's act).
  - `return on work`:
    - A spot trip with `returnAt` set walks back-town, then back-enter, then home office.
    - `departAt(agent, 'spot:park:2', { emptyAt: 1000 })` equals `max(statusAt, 1000 + IDLE_DELAY)`.
    - `departAt(agent, null, { fullAt: 5000 }, prevSpotTrip)` equals `max(statusAt, 5000)`.
  - `old records load`: stored `{ dest: 'games' }` and `{ dest: 'kain' }` records give the same `where()` as before this task (keep a copy of one pre-change fixture).
  - `unknown spot`: a record with `dest: 'spot:gone:1'` gives `where()` === `{ scene: 'office', leg: 'home', t: 0 }` with no throw. `nextIn` returns Infinity.
  - `reload agrees`: two `store()` instances (fresh memory, the same localStorage stub) syncing the same snapshot produce identical records and `where()` for every agent.
  - `crowded spot`: 13 agents all picked into `tree` (force it via a ctx with `spots: [{id: 'tree', n: 8}]`) get 13 distinct positions, each in a walkable cell.
- [ ] **Step 2:** Run `node --test agent-travel.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `valid` accepts `DESTS` or `/^spot:[a-z-]+:\d+$/`.
  - `plan` for a spot: `fwd = [exit, town]`, `back = [back-town, back-enter]`. The `there` leg scene is `'town'`. This keeps the existing `back.slice(back.length - i)` turn rule correct, because fwd and back have equal length.
  - `where` adds `pos`, `spot`, `point`, `act` and `face` on the spot `there` leg, from `TownMap.spotPoint` plus the crowding offset.
  - `departAt` treats `'games'` and any `spot:` the same, in both branches.
  - `destOf` calls `pickIdle` only where today's code returns `'games'`/`null` for an idle agent on an empty board.
- [ ] **Step 4:** Run `node --test agent-travel.test.mjs office-motion.test.mjs`. Expected: PASS.
- [ ] **Step 5: Wire it.** The town page and the office page build `ctx` from `TownMap.spotsOf(map)` and the snapshot ids, and pass it to `sync`. Run `npm test`. Expected: 0 fail.
- [ ] **Step 6:** Commit: `Town step 5: idle agents walk out to spots (deterministic choice, return on work)`.

### Task 3: Spot art (Blender)

**Files:**
- Modify: `art/blender/town_assets.py`: new `ASSETS` entries for `tree-of-life`, `pool`, `court`, `hoop`, `fence` (reuse `fence_run`), `cow-trough` and `flowerbed`. Animated frames:
  - `waterfall.0`…`waterfall.3`;
  - `cow.rest`, `cow.walk0`, `cow.walk1`;
  - `dog.rest`, `dog.walk0`, `dog.walk1`;
  - `cat.rest`, `cat.walk0`, `cat.walk1`, `cat.sleep`;
  - `ball`.

  Animals face right; the renderer mirrors them for left.
- Modify: `art/build.mjs`, but only if the new frames need registering beyond `ASSETS`.
- Output: `public/art/town/atlas*.png|json`, `art/MANIFEST.json`.
- Test: `art-output.test.mjs`

**Interfaces:**
- Produces: atlas frames with exactly the names above, each with `ax`/`ay` anchors like the existing decor. `tree-of-life` has a `footprint`, so it gets a contact blob.

- [ ] **Step 1: Write a failing test** in `art-output.test.mjs`: every frame name listed above exists in `public/art/town/atlas.json`; the total shipped art stays < 8 MB; the colour atlas stays ≤ the GPU-texture headroom. Assert the atlas page count and size don't exceed the step 4 values plus one 2048² page.
- [ ] **Step 2:** Run `node --test art-output.test.mjs`. Expected: FAIL (frames missing).
- [ ] **Step 3:** Model the assets in the existing palette (`art/palette.json`) and style. Then run `npm run art`.
  - The tree of life must be the tallest sprite in town (taller than `office-modern`).
  - The waterfall frames must cover the 28-unit cliff drop plus the pool lip.
- [ ] **Step 4:** Run `node --test art-output.test.mjs town-static.test.mjs`. Expected: PASS. Then look at `art/.raw` previews to check the style matches.
- [ ] **Step 5:** Commit: `Town step 5: art for spots and animals`.

### Task 4: Drawing spots and visitors (both renderers, ambient-driven)

**Files:**
- Modify: `public/town-render.js`:
  - place the spot props, the same way as `map.decor`;
  - an animated waterfall sprite;
  - visitor poses;
  - `setTravellers` entries gain `pose` and `prop`.
- Modify: `public/town-render-2d.js`: the same props and rest-frame poses (static).
- Modify: `public/town-ambient.js`: `plan()` gains `falls: [{x, y}]` (at `water` and above) and `visitors: true` (at `all` and above).
- Modify: `public/town.html`:
  - the traveller loop rAFs only while some traveller is on a walking leg;
  - parked visitors are pushed to the renderer once on arrival, and then animated by the ambient loop.
- Test: `town-ambient.test.mjs`, `town-render.test.mjs`, `town-render-2d.test.mjs`

**Interfaces:**
- Consumes: the `where()` spot fields (Task 2); the atlas frames (Task 3).
- Produces: renderer `setTravellers([{ id, x, y, face, frame, look, name, accent, pose?: 'walk'|'sit'|'stand'|'lean'|'shoot'|'dogwalk' }])`. `pose` defaults to `'walk'`. The renderer owns the ball and leash props of `shoot` and `dogwalk`.

- [ ] **Step 1: Write failing tests:**
  - `town-ambient.test.mjs`:
    - `plan(map, 'off')` has no falls and `visitors` false;
    - `'water'` has falls only;
    - `'all'` has falls and `visitors` true.
  - `town-render-2d.test.mjs`: the 2D renderer draws the `tree-of-life` frame and a `sit` visitor without throwing, using the existing fake-canvas harness.
  - `town-render.test.mjs`: `shoot` visitors with `visitors` true advance the ball each ambient frame; with ambient `off` the ball stays at rest.
- [ ] **Step 2:** Run `node --test town-ambient.test.mjs town-render.test.mjs town-render-2d.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **Shot:** the ball arcs to the hoop over 1200 ms. Whether a shot goes in is decided by `AgentTravel.hash(id + shotIndex) % 3 !== 0`.
  - **Dog walk:** the agent walks the park loop (the path of the two `dogwalk` points' spot, as a closed polyline in the spot's `points` order) with the dog trailing by 14 units and a 1-px leash line.
  - **Sit:** uses the existing seated walker frame.
- [ ] **Step 4:** Run the tests from Step 2 again, then `npm test`. Expected: PASS, 0 fail.
- [ ] **Step 5:** Commit: `Town step 5: draw spots and visitors on ambient frames`.

### Task 5: Animals

**Files:**
- Create: `public/town-animals.js` (classic script, `root.TownAnimals`, loadable in node).
- Modify: `public/town.html` (script tag; feed positions to the renderer on ambient frames), `public/town-render.js`, `public/town-render-2d.js` (rest frames).
- Create: `town-animals.test.mjs`, and add it to `package.json` `test`.

**Interfaces:**
- Produces:
  - `TownAnimals.herd(map) -> [{ id, kind: 'cow'|'dog'|'cat', home: [x0,y0,x1,y1] }]`. There are 3 cows (pasture rect), 2 dogs (park rect) and 3 cats (plaza and the kain lot rect).
  - `TownAnimals.at(animal, tMs, grid) -> { x, y, face: 'l'|'r', frame: 'rest'|'walk0'|'walk1'|'sleep' }`. It is pure:
    - waypoints come from `hash(id + epoch)`, where `epoch = floor(tMs / 20000)`;
    - each waypoint is in `home` and on a walkable cell;
    - walking speed is 12 units/s for cows, 30 for dogs, 20 for cats;
    - cats sleep in the second half of each epoch when the night value is < 0.5 (`sleep` frame).
  - `TownAnimals.leashed(dogId, visitors) -> visitorId | null`: a leashed dog follows its visitor (Task 4) instead of wandering.

- [ ] **Step 1: Write failing tests:**
  - `at` is deterministic and continuous: the jump between t and t + 50 ms is ≤ the animal's speed × 0.05 + 1.
  - Positions always stay inside `home` and on walkable cells, sampled every 500 ms over 10 minutes.
  - `herd` returns 3 cows, 2 dogs and 3 cats for the shipped map.
  - A leashed dog returns the visitor's id.
- [ ] **Step 2:** Run `node --test town-animals.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it.
  - Animals animate only when the ambient plan has `visitors`.
  - Otherwise they are drawn once, at `at(animal, 0)`, with the `rest` frame.
- [ ] **Step 4:** Run `node --test town-animals.test.mjs` and `npm test`. Expected: PASS, 0 fail.
- [ ] **Step 5:** Commit: `Town step 5: cows, dogs and cats`.

### Task 6: Scenery bubble

**Files:**
- Create: `public/town/scenery-lines.json` with the spec's lines, exactly as written in the spec's "Scenery lines" section. Shape:
  ```
  { spots: { <id>: { day: [..], night: [..] } },
    kain:  { day: [..], night: [..] },   // night reuses day
    animals: { cow: [..], dog: [..], cat: [..] } }
  ```
- Create: `public/town-scenery.js` (classic script, `root.TownScenery`, loadable in node).
- Modify: `public/town.html`:
  - a `#say` overlay element, styled like `#tag` but larger, with a 220 px max width, anchored above the player;
  - call `step()` from the player tick and on arrival;
  - the fade is skipped under reduced motion.
- Create: `town-scenery.test.mjs`, and add it to `package.json` `test`.

**Interfaces:**
- Produces:
  - `TownScenery.create(lines, map) -> { step(player: {x, y}, nowMs, night: number, animals: [{id, kind, x, y}]) -> null | { text, until } }`.
  - Areas are the spot `bubble` rects (or the spot rect grown by 20) and the kain lot rect. The exit rect is the area grown by 30.
  - Constants: `SHOW_MS = 6000`, `COOLDOWN_MS = 60000`, `ANIMAL_R = 40`, `ANIMAL_COOLDOWN_MS = 30000`.

- [ ] **Step 1: Write failing tests:**
  - Entering the park returns the first park day line. Staying inside returns nothing new.
  - Leaving and re-entering within 60 s returns nothing. After 60 s outside the exit rect, the second line shows.
  - **Edge jitter:** the player oscillates ±3 units across the bubble-rect edge for 30 s. Exactly 1 bubble shows.
  - With `night` 0.6, a night line shows.
  - Within 40 units of a cow, the cow line shows, and the cow is on a 30 s cooldown.
  - Only one bubble shows at a time. An animal line does not replace a spot line inside its `SHOW_MS`.
- [ ] **Step 2:** Run `node --test town-scenery.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it. The bubble text is plain text (`textContent`); it is never rendered as HTML.
- [ ] **Step 4:** Run `node --test town-scenery.test.mjs` and `npm test`. Expected: PASS, 0 fail.
- [ ] **Step 5:** Commit: `Town step 5: scenery lines over the player`.

### Task 7: Karinderya: 12 seats and take-out overflow

**Files:**
- Modify: `public/office-furniture.js`:
  - a new catalog piece `kain-table` with 6 seats, `kain:7`…`kain:12` (`seat: true`, faces n/s like `KSEATS`);
  - add `kain:q1`…`kain:q4` (`seat: false`, facing the counter) to the `karinderya` piece's spots.
- Modify: `public/office-motion.js`: the eat-spot picker (`eatSpots`, the stool choice near line 264) prefers free `seat: true` `kain:*` spots, then `kain:q*`.
- Modify: `public/world-templates/interior-kain.json`: place one `kain-table`, reachable and not overlapping.
- Modify: `scripts/export-catalog.mjs` and the office art, only if a new piece needs a sprite. Otherwise draw it with the existing `picnic-table` style painter.
- Test: `karinderya.test.mjs`, `world-templates.test.mjs`

**Interfaces:**
- Produces: spot ids `kain:1`…`kain:12` (seats) and `kain:q1`…`kain:q4` (overflow) in the kain interior.

- [ ] **Step 1: Write failing tests:**
  - The kain template has 12 `seat: true` `kain:*` spots and 4 `kain:q*` spots, all reachable.
  - 12 limited agents get 12 distinct seats. The 13th–16th get `kain:q1`–`kain:q4`.
  - An office layout holding only the old `karinderya` piece still has exactly its 6 seats (plus the 4 q spots). Existing layouts keep their seats.
- [ ] **Step 2:** Run `node --test karinderya.test.mjs world-templates.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same tests, then `npm test`. Expected: PASS, 0 fail.
- [ ] **Step 5:** Commit: `Town step 5: karinderya seats for twelve and a take-out line`.

### Task 7b: Plaza fountain (added 2026-11-09, user request)

**Files:**
- Modify: `public/town/town.json` (replace the plaza `well` decor at (1080, 655) with a `fountain`)
- Modify: `public/town-map.js` (`DECOR` gains `fountain`, with a footprint like the well's but 1.5x)
- Modify: `art/blender/town_assets.py` (`fountain` and `fountain.0`..`fountain.3` water frames: a round stone basin, a centre column, and water arcs)
- Modify: `public/town-ambient.js` (`plan().fountains` at `water` and above)
- Modify: `public/town-render.js` (animated water; the 2D renderer shows the rest frame)
- Modify: `public/town/scenery-lines.json` (a `fountain` area: the plaza centre, radius 60)

- [ ] **Step 1: Write failing tests:**
  - `town-map.test.mjs`: the plaza has a `fountain` and no `well`; the plaza centre stays walkable around it; spawn can reach every door.
  - `town-ambient.test.mjs`: `plan(map, 'water').fountains` has the fountain; `'off'` has none.
  - `town-scenery.test.mjs`: walking up to the fountain shows a fountain line.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The fountain lines:
  - Day: "Coins at the bottom, each one somebody's small hope. The water keeps all of them."
  - Night: "The fountain talks to itself in the dark, the same soft sentence over and over."
- [ ] **Step 4:** Run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: `Town step 5: plaza fountain`.

### Task 8: Live checks, perf and screenshots

**Files:**
- Modify: `perf/town-check.cjs`. Add three checks:
  - walk the player into each spot: a bubble appears, and it does not repeat on a second walk-in within 60 s;
  - a stored spot trip draws the agent at its point;
  - with Low and ambient off, there are 0 frames while visitors and animals are present.
- Modify: `perf/travel-check.cjs`: an idle agent on an empty board, forced by a `statusAt` that hashes to a spot, walks out, arrives at its point, and walks home when a task is added.
- Modify: `perf/town-perf.cjs`: the walk route also passes the park and the court, with visitors present, for the p95.
- Modify: `docs/perf/town-step5.md`: tables in the step 4 format.

- [ ] **Step 1:** Add the checks. Run each harness against the code before the step 5 tasks (`git stash` is not allowed; use `git worktree add` of the commit before Task 1) to confirm the new checks FAIL there. Then run them on the branch HEAD.
- [ ] **Step 2:** Run `town-check`, `scene-check`, `travel-check` and `office-check`. Expected: ALL PASSED each.
- [ ] **Step 3:** Run `town-perf` and `office-perf` twice each, with nothing else heavy running. Expected: ALL PASSED both times, within the step 4 budgets.
- [ ] **Step 4:** Take screenshots of each spot by day and by night, on Low and High, into `art/.raw/step5/`, then read them back and check them.
- [ ] **Step 5:** Commit: `Town step 5: live checks, perf budgets and results`.

---

## Final (controller)

- Run `npm test` and every `perf/*.cjs` check, then a whole-branch review.
- Add a CHANGELOG bullet: "Places to wander".
- Bump the version to `2.0.0-beta.2`.
- `npx electron-builder --win --publish never`, then a packaged smoke run on a temp profile.
- Push `feature/world`, tag `v2.0.0-beta.2` and create a GitHub **pre-release** with `TiroAgents-Setup-2.0.0-beta.2.exe` and the same install notes. The `latest` release stays v1.2.8.
