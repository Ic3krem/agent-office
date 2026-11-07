# Town Step 3: Agents Across Buildings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents leave the office when their state needs another building:
- a plan limit sends them to eat at the karinderya;
- nothing to do sends them to play in the game hall.

They walk across the town to get there and walk back afterwards. Each page shows a traveller only while the traveller is in that page's scene. Chismis, the cook, badges, labels and the desk card all work wherever the agent is.

**Architecture:**
- **No shared simulation between pages.** Each page is a separate full page load, and a hidden page does not tick. Where an agent is at any moment is therefore a pure function of three things: the server snapshot (status plus a new `statusAt` timestamp), wall time, and fixed route lengths.
  - A new pure module, `public/agent-travel.js`, turns those into `{scene, leg, t}`.
  - Every page computes the same answer, so a reload, a hidden tab or two windows never disagree.
- **The brain stays the source of truth for intent.** `nextState` still picks COOLER or PLAY. When the target spot does not exist in the office layout, the agent becomes a traveller instead.
- Inside each building the existing brain and walkers do the walking.
- On the town page a small sprite pool draws travellers along the A* path on the town grid.

**Tech Stack:** classic-script browser modules (UMD style, like `office-motion.js`), Canvas2D office engine, PixiJS town renderer, Node server, node:test, Electron live checks.

**Spec:** `docs/superpowers/specs/2026-11-06-town-world-design.md`: section 6 (agents across buildings), section 5 (layout migration), and step 3 of section 11. Step 2 ruling 2 moved the playroom/garden migration into this step (`docs/superpowers/plans/2026-11-07-town-step2-interiors.md`).

**Rulings (deviations or choices; the controller decided):**
1. **Positions are time-derived, not simulated.** The spec says "scenes you are not in keep agent positions as data only". This plan meets that with a deterministic schedule from `statusAt`, with no background simulation.
   - Why: pages reload on every door, and hidden pages are paused.
   - Cost if wrong: a traveller's town walk follows a fixed path at a fixed speed, so there is no dodging other walkers on the road.
2. **There is no fixed 10 Hz sim today.** The brain ticks inside the draw loop. That stays as it is. Section 8's 10 Hz split belongs to step 4 (graphics) if it is needed at all.
3. **Travel triggers:**
   - COOLER (plan limit) with no `kain:*` seat in the office layout travels to the karinderya.
   - PLAY (empty board) with no play spot in the office layout travels to the game hall.
   - A user who built a karinderya or playroom inside their office keeps today's in-office behaviour, with no travel.
4. **A reset mid-trip:** the agent finishes the leg it is on, then turns back. The return starts at the later of the reset time and the end of that leg. This keeps the schedule a pure function and avoids teleporting.
5. **Friends' agents travel to the karinderya too** (user, 2026-11-07; spec section 12 updated).
   - The party feed already carries `state: 'limited'` (`party/protocol.mjs` STATES), so no protocol change is needed.
   - With no shared timestamp, each viewer stamps the friend's trip at the moment its client first sees the state change. Two friends may see the walk a second or two apart.
     - Cost if wrong: a slightly different road position per viewer, which is invisible in practice.
   - Friend lots are filled in step 5 (party lots), but the model, town drawing and stool sharing are built here (Task 2 routes from any lot; Task 6 wires friends in).
   - Stools: your own agents claim first; friends' agents take the free ones or stand.
   - Friends' other states keep them in their own office. Friends' agents never go to your game hall.

## Global Constraints

- **Projection and art are unchanged.** Town art stays byte-identical to step 1: `git diff --quiet 80015a8 -- public/art/town art/palette.json` exits 0.
- `nextState` stays a pure rule table, and the server snapshot stays the only input to the brain (office-motion.js header rule).
- **Budgets:**
  - Office idle CPU < 3%, with the idle cadence at most 21 frames per 10 s.
  - Town walk p95 frame time < 8 ms with 8 travellers on the road.
  - Renderer memory < 250 MB.
  - Known misses accepted from step 2: office draw p95 is about 11 ms and town↔office memory drift is about 14%. Do not regress them by more than 10%.
- **Privacy:** nothing new goes to the party feed. `statusAt` is local-only and must not be added to `party/protocol.mjs` fields.
- **Migration:** no user data lost. The old layout is kept as `layout.v1.json` before any rewrite.
- **Never touch** :4777, the real profile or the real vault. Live checks use a temp profile and ports 4790–4799, never 4795. The repo is public: no personal names or paths.

## Review Focus

1. **A reload or a second window mid-trip** shows the agent at the same place on the road. Test: Task 2 purity test (same inputs give the same output), plus a Task 6 live check that reloads the town mid-walk.
2. **The limit resets while the agent is on the road** (any leg): the agent turns back without teleporting and ends up at its desk. Test: Task 2 table cases for a reset in each leg.
3. **Many agents limited at once** (8 travellers): no two share a karinderya stool, extra eaters stand or queue instead of stacking, and town frame time stays within budget. Test: Task 3 seat-claim test and the Task 6 perf check.
4. **A user who built a karinderya or playroom inside the office** sees no travel at all, exactly as today. Test: Task 3 case using the karinderya.test layout at 1010,370.
5. **An agent whose status flips limited → working → limited quickly** (under one leg) does not create overlapping trips or vanish. Test: Task 2 flapping case. The server's `statusAt` only changes when the status really changes.

---

### Task 1: `statusAt` on the agent snapshot

**Files:**
- Modify: `server.mjs`, where the stream builds `agents` (about lines 528–545).
- Test: `world-store.test.mjs`, or a new `status-at.test.mjs` added to the `npm test` list in `package.json`.

**Interfaces:**
- Produces: each streamed agent gets `statusAt: number`, the epoch ms when the agent's computed status last changed. It is kept in a server-side `Map(id → {status, at})`, set the first time an agent is seen (to that moment) and changed only when `statusOf` returns a different value.

- [ ] Write a failing test. Use a stub agent with the clock injected (export a small pure helper `stampStatus(map, id, status, now)` from a module the test can import).
  - The status stays the same across calls → `at` is unchanged.
  - The status changes → `at = now`.
  - An unknown id → `at = now`.
- [ ] Run it and see it fail.
- [ ] Implement `stampStatus` and use it in the snapshot builder. Prune ids that are no longer in the agent list.
- [ ] Check that `statusAt` is not in `party/protocol.mjs` and not in the party feed. Grep for it in party-feed and the protocol tests.
- [ ] Run `npm test`; it should pass. Commit: `Town step 3: statusAt on agent snapshots`.

### Task 2: `public/agent-travel.js`, the pure travel schedule

**Files:**
- Create: `public/agent-travel.js` (UMD like `office-motion.js`; global `AgentTravel`).
- Test: `agent-travel.test.mjs`, added to `package.json` test list.

**Interfaces:**
- Consumes: `TownMap` doors and grid (`town-map.js`: `ENTER`, `grid`, lot door coordinates), and `WorldPath.findPath`.
- Produces:
  - `AgentTravel.route(townMap, fromLot, toLot) → {pts: [[x,y]...], len}`: the A* path between two lot doors on the town grid, cached per pair.
  - `AgentTravel.where(agent, dest, now, routes) → {scene, leg, t, pos?}`. Parameters:
    - `agent` is `{status, statusAt}`;
    - `dest` is `'kain' | 'games' | null` (null means stay home);
    - `leg` is one of `'home' | 'exit' | 'town' | 'enter' | 'there' | 'back-exit' | 'back-town' | 'back-enter'`;
    - `t` runs 0..1 within the leg;
    - `pos` is set only for town legs.
  - Constants: `EXIT_MS = 6000` (the in-building walk to the door, matching the walker budget), `ENTER_MS = 5000`, `TOWN_SPEED = 80` (world units per second, so the town leg takes `len / 80` s).

Write the test table first. Cases, all with a fixed `now`:
- [ ] Status limited, `statusAt` 0, `now` 3000 → `{scene:'office', leg:'exit'}`.
- [ ] `now = EXIT_MS + 1` → `{scene:'town', leg:'town', t≈0}`, with `pos` at the home door.
- [ ] Halfway along the town leg, `pos` lies on the route polyline at half its length.
- [ ] After `EXIT_MS + town + ENTER_MS` → `{scene:'kain', leg:'there'}`.
- [ ] The limit resets while the agent is `there` → back legs in reverse order, ending at `{scene:'office', leg:'home'}`.
- [ ] The limit resets mid-town (ruling 4): the agent finishes the town leg first, then turns back. `scene` is never undefined.
- [ ] Flapping (limited → working → limited within `EXIT_MS`): one trip, no gap.
  - Model this by making `where` take the agent's last trip record `{dest, departAt, returnAt}`. The page derives it from `statusAt` transitions with a tiny reducer, `AgentTravel.trip(prevTrip, agent, dest, now)`, which is also pure and also tested.
- [ ] Purity: the same inputs give a deep-equal output, and calling it twice has no side effects.
- [ ] Unknown `dest` or no route → `{scene:'office', leg:'home'}`, never a throw.
- [ ] Implement, run, pass. Commit: `Town step 3: pure travel schedule`.

### Task 3: Office page: departures, arrivals and interiors with agents

**Files:**
- Modify: `public/office-motion.js`: add a TRAVEL handling seam where COOLER and PLAY pick spots (`eatSpots` at about :220 and the PLAY spot pick). Add `office-world.js` `brain.update` feeding (:197), `eaters()`, the `setGuests` guard (:287), the dimming rule (:203), and `isMoving`/`isActive` (:450, :461).
- Modify: `public/Agent Office.html`: load `town-map.js`, `world-path.js` (if not loaded) and `agent-travel.js`, and fetch `/town/town.json` once for route lengths.
- Test: `office-motion.test.mjs` and `karinderya.test.mjs`.

**Interfaces:**
- Consumes: `AgentTravel.where/trip/route`, and `statusAt` from Task 1.
- Produces: `OfficeWorld` feeds the brain a per-scene agent list. The list holds only agents whose `where().scene === SCENE`, each with a hint `arrive: 'door'` (spawn at the scene's `door` spot) or `leave: 'door'` (walk to the door, then drop out of the frame).

Steps:
- [ ] Write tests first:
  - In the office scene with no `kain:*` seats, a limited agent walks to the office exit spot and leaves the frame when its leg is not `exit`.
    - The exit spot is the `door` spot if the layout has one, else `SPAWN`.
  - In the kain scene, an agent at leg `enter` appears at `door` and claims a free `kain:N` stool.
  - Eight eaters claim six stools: the two extra stand at the counter or `cool:*`-style standing spots, with no stacking.
  - With the karinderya.test layout (karinderya built at 1010,370 in the office), limited agents use the in-office stools and `where()` is never consulted (ruling 3).
- [ ] Remove the "agents stay in the office scene" restriction in `office-world.js`:
  - the brain gets the real board, so interiors do not dim;
  - interiors get the scene-filtered agents;
  - canvas hit boxes, and so the desk card, work for agents in any scene.
  - The header counts and the approval pill are already global (`Agent Office.html` `renderVals`); leave them.
- [ ] Count travellers that are leaving or arriving in `isMoving()`, so walks run at the moving cadence.
- [ ] `npm test` passes. Commit: `Town step 3: agents leave and arrive through doors`.

### Task 4: Town page: travellers on the road

**Files:**
- Modify: `public/town-render.js`: a character sprite pool next to the player sprite, with `setTravellers(list)`. Raise `CHAR_CAP` if 8 travellers × frames would thrash the LRU.
- Modify: `public/town.html`: subscribe to the agent stream (the same SSE the office page uses), compute `where()` for each agent, and run the on-demand rAF while any traveller has `scene === 'town'`.
- Test: `town-render.test.mjs`, which covers the pure helpers: pool sizing, sprite reuse, and z-order `x+y`.

**Interfaces:**
- Consumes: `AgentTravel.where/route`, `OfficeSprites.get(look, view, pose, frame, dir)` via `charTexture()`, and agent `look` from the snapshot (`looks`).
- Produces: `TownRender.setTravellers([{id, x, y, face, frame, look, name}])` creates, moves and hides pooled sprites. Name tags use the office tag style, with small pixel text.

Steps:
- [ ] Write tests first, for the pool:
  - n travellers → n visible sprites;
  - n−1 → one hidden, not destroyed;
  - ids keep their sprite across calls.
  - Facing comes from the path segment direction.
- [ ] Implement it. Walking animation frames advance with distance travelled, as for the player.
- [ ] With no travellers on the road the town still renders nothing while idle; the existing idle check in perf/town-check.cjs must still pass.
- [ ] Clicking a traveller in town opens nothing new. Ponytail note: hover shows the name only, and the desk card stays on the office page.
- [ ] `npm test` passes. Commit: `Town step 3: travellers walk the town`.

### Task 5: Layout migration: the playroom moves to the game hall

**Files:**
- Modify: `world-store.mjs` (load path for the office layout) and `world-model.js`, adding a `MIGRATE_V2` list of moved catalog types.
- Modify: `public/world-templates/interior-games.json`, only if it lacks the moved pieces' spots.
- Test: `world-store.test.mjs`.

**Interfaces:**
- Produces: on first load of an office `layout.json` without `migrated: 2`, the store does the following:
  - copies the file to `layout.v1.json` (and never overwrites an existing v1);
  - removes objects whose type is a playroom piece (arcade, jukebox, sofa, ball pit, darts: use the catalog types the step 2 ruling named) or a garden-only outdoor piece (pond, pond-east, garden trees and benches in garden zones);
  - writes `migrated: 2`.
  - Desks, department desks, notes and other pieces are untouched.
  - If `games.json` does not exist yet, it is created from the template. Moved pieces are not copied over, because the game hall template already has its own set.

Steps:
- [ ] Write tests first:
  - migrating a default layout removes the listed types and keeps every desk and `requiredSpots` reachable (`WorldModel.validate` passes);
  - a second load is a no-op;
  - `layout.v1.json` is byte-identical to the pre-migration file;
  - a layout with no playroom pieces gets only `migrated: 2`.
- [ ] Check that PLAY in an office with no play spots now travels to the game hall (ruling 3), using Task 3's seam.
- [ ] `npm test` passes. Commit: `Town step 3: playroom and garden leave the office`.

### Task 6: Friends' agents go to the karinderya

**Files:**
- Modify:
  - `public/town.html` and `public/town-render.js` (travellers from the party view);
  - `public/office-world.js` (kain scene: friend eaters as guests on free stools);
  - the party client view, if it does not already expose each member's agents with `state` and `look`.
- Test: `agent-travel.test.mjs`, plus the party client/view tests that already exist (party-*.test.mjs).

**Interfaces:**
- Consumes: the party view in the snapshot (`party: partyClient.view()` in server.mjs) with members' agents `{id, name, key, state, bubble}`, `AgentTravel.trip/where` with `fromLot` set to that member's lot, and `TownMap` friend lots.
- Produces: friend travellers in town (name tag shows `name · friend's display name`) and in your kain interior. They are seated only on stools your own agents do not hold, else standing; generic bubbles only (the party privacy rule).

Steps:
- [ ] Write tests first:
  - a friend member on lot `friend1` with one `limited` agent → `trip()` leaves from `friend1`'s door, and `where()` reaches `kain`;
  - the trip's start time is the local time the state was first seen (inject the clock);
  - the state goes back to working → the agent returns to `friend1`;
  - a friend agent in any other state never travels;
  - your six eaters plus two friend eaters: friends stand, your agents sit.
- [ ] Map members to friend lots in join order. Step 5 owns the full lot assignment, so use the same order rule (`friend1..3` by join order) through one helper that step 5 will reuse.
- [ ] Leave `party/protocol.mjs` unchanged; the protocol tests must still pass untouched.
- [ ] `npm test` passes. Commit: `Town step 3: friends' agents eat at the karinderya`.

### Task 7: Live checks and budgets

**Files:**
- Create: `perf/travel-check.cjs` (Electron, temp profile, port 4796 or 4798, never 4795).
- Modify: `perf/scene-check.cjs`; line 80 asserts that kain has only the CEO, and it must now allow travellers.
- Modify: `docs/perf/town-step2.md` → add a step 3 section (or a new `docs/perf/town-step3.md`).

Steps:
- [ ] travel-check covers:
  - force one agent limited (through whatever test hook the server already has for perf/office-perf.cjs's limited case, or a stub transcript);
  - the office shows it leaving;
  - the town page shows it on the road; reloading the town mid-walk puts it within 1 grid cell of the same place;
  - the kain page shows it seated with a chismis bubble and the cook talking;
  - clicking it opens the desk card;
  - clear the limit and it walks back to its desk.
  - a scripted party friend (as in the step 1 demo party) with one limited agent walks from its friend lot to the karinderya and stands or sits there.
  - Screenshots go to a dir given as an argument.
- [ ] Measure the town walk p95 with 8 forced travellers (< 8 ms), and check the office idle budget is still met.
- [ ] Write the numbers in the perf doc.
- [ ] The full `npm test` passes, and the scene-check, office-check and travel-check scripts print ALL PASSED. Commit: `Town step 3: travel live checks and budgets`.
