# Town step 5: places to wander (design)

Date: 2026-11-08. Status: approved to build (user, 2026-11-08: "lets have the new office ready to test"). Builds on the town spec (`2026-11-06-town-world-design.md`) and step 4 (graphics, terraces).

## Intent

The town has buildings, but nothing to do between them. Step 5 scatters small places around the town that are worth walking to: a park with benches and dogs, a waterfall off a cliff, a big "tree of life", a basketball court, a pasture with cows, and cats lazing around. Agents with nothing to do drift out to them on their own. When you walk your character up to one, a short poetic line about the place appears over your head, like narration in a cozy game. The karinderya also gets more seats.

The point is mood: the town should feel lived in, and a quiet office should look like a team on a break, not a frozen screen. It spends **no tokens**. Every line is canned and every behaviour is local animation.

## Goals

1. **Places around the town (the user's call: "around the world").** These are separate spots, not one big park:
   - **Park:** benches, a loop path and flowerbeds. Two dogs live here.
   - **Waterfall:** water falls from a terrace cliff into a small pool.
   - **Tree of life:** one very large, old tree on the highest terrace, with a ring of roots to sit on.
   - **Court:** a half basketball court with one hoop.
   - **Pasture:** a fenced field with 2–3 cows.
   - **Cats:** 2–3 cats wander the plaza and the karinderya lot and nap in sunny spots.
2. **Idle agents visit them.** Today an idle agent with an empty board walks to the game hall. Now an idle agent may instead go to one of the outdoor spots and do that spot's activity:

   | Spot | What the agent does |
   |---|---|
   | Park | Sit on a bench, or walk a dog around the loop |
   | Waterfall | Stand at the pool's edge |
   | Tree of life | Sit on a root |
   | Court | Shoot hoops (a ball arcs to the hoop, not every shot goes in) |
   | Pasture | Lean on the fence |

   The agent walks back when work arrives, using the existing return-on-work rule.
3. **Scenery bubble.** When the player character enters a spot, a text box appears above the character with one short poetic line for that place. It fades after about 6 s and does not repeat for that spot until the player has left and a cooldown has passed.
   - Lines vary by time of day (day / night).
   - Walking up to an animal shows a one-line reaction instead ("The cow considers you. The cow returns to the grass.").
4. **More karinderya seats.** Go from 6 to 12 seats (a second table), so a full team (8 specialists) plus friends' limited agents fit. If every seat is taken, extra agents stand at the counter as if waiting for take-out, instead of piling onto one seat.

## Non-goals

- **No new rooms or interiors.** Every spot is outdoors in the town.
- **Your agents only.** Friends' agents do not visit spots in a party. Only their limited agents travel, to the karinderya, as today. Spots are drawn locally. Nothing new goes over the party wire, so the privacy boundary is unchanged.
- **No mini-games at the spots.** The court is decoration plus an agent animation; you cannot play basketball.
- **No model calls,** and no generated or dynamic narration.
- **No owning pets:** no feeding, naming or care.

## Anti-goals (failure even if it works)

- **Breaking step 4's performance budgets.** These still hold:
  - town walk frame p95: < 16 ms Low, < 8 ms High;
  - renderer private memory: < 180 MB Low, < 250 MB High;
  - GPU textures: < 48 MB Low, < 96 MB High;
  - shipped art: < 8 MB;
  - idle CPU: < 1% Low, < 3% High;
  - Low with ambient off renders 0 idle frames;
  - the town↔office memory slope: ≤ 0.3 MB per cycle.
- **Agents "on break" while they have work, or agents that never come back.** A visit must never delay picking up a task.
- **Text that nags.** Showing the bubble every time you step a few pixels, or stacking several bubbles, is a failure.
- **Clutter.** A spot must not cover a door, ramp or path, or make any lot unreachable.

## Constraints

- **Rendering:**
  - Art comes through the existing Blender pipeline (`npm run art`, `art/blender/*`).
  - Animation goes through the existing ambient system (`town-ambient.js`), so it obeys `ambientFps`, ambient off, reduced motion, Power saver and hidden-page stop.
  - Spots must draw in both renderers (Pixi `town-render.js` and the Canvas2D `town-render-2d.js`).
- **Travel stays a pure function.** `AgentTravel.trip` positions are computed from status history, so every page agrees after a reload.
  - The choice of destination must be deterministic from what pages already share (agent id, `statusAt`/`emptyAt`). Use a hash, not `Math.random`.
  - Spot capacity (seats, the dog leash, the hoop) must also resolve deterministically.
- **Walkability:**
  - The town grid (`TownMap`, 10-unit cells, A*) must keep every lot door, ramp and spot reachable from spawn.
  - Spot props block cells the way decor does. The existing `town-map` tests are extended to cover spots.
- **Terraces:** `LEVEL_H` = 28, and cliffs face south (all ramps climb north). The waterfall must sit on a south-facing cliff face so it is visible.
- **Data:** spots are data in `public/town/town.json` (a new `spots` array) with:
  - `id`, `kind`, `rect`;
  - agent `seats` / activity points;
  - a `bubble` radius;
  - `lines` (day and night), or a key into a separate lines file.
- **Tests:** new test files are added to the `npm test` list in `package.json`.
- **Repo:** it's public. Keep personal names and absolute paths out of the code and docs.

## Placement (my call; the builder may adjust within the constraints)

The town is 2160×1350. The raised terraces are:
- the west terrace, level 1, at `[0,0,840,460]`;
- on top of it, level 2, at `[0,0,380,200]`;
- the east terrace, level 1, at `[1320,0,2160,440]`.

The river runs along y 1010–1070. Lots in use are home, kain, games and the three friend lots.

| Spot | Where | Notes |
|---|---|---|
| Tree of life | centre of the level-2 terrace, around (190, 90) | The tallest thing in town; its canopy may overhang the cliff. Clear the pines there. |
| Waterfall | south cliff of level 2 (y ≈ 200), x ≈ 110–170, with the pool on level 1 just below | Keep it clear of the ramp at x 290–340. A short stream from the pool may fade into the grass; it does not need to reach the river. |
| Park | west terrace level 1, east of the level-2 block, around x 420–800, y 40–360 | A loop path, 4 benches and flowerbeds. Thin out the existing trees, keep some for shade, and leave the ramp at x 620–680 clear. The dog loop follows the path. |
| Court | east terrace, west part, around x 1380–1600, y 60–300 | A half court, with the hoop on the north side so it reads facing the camera. |
| Pasture | east terrace, east part, around x 1700–2100, y 60–380 | A wooden fence with a gap; the cows stay inside. Leave the ramp at x 1660–1720 clear. |
| Cats | anywhere on the plaza `[900,535,1260,815]` and the kain lot | They prefer sunny spots, benches and the karinderya steps. |

## Scenery lines (the user's request: short and poetic; my drafts)

Two or three lines per spot, chosen deterministically per visit:

**Waterfall**
- Day: "Water lets go of the cliff and never looks back. The mist remembers a little longer."
- Day: "The falls keep talking. No one has ever needed to answer."
- Night: "In the dark it is only sound, a long, soft applause."

**Tree of life**
- Day: "Its roots hold the hill together. Every leaf here has been a different green."
- Day: "Older than the town. It was here first and seems happy to share."
- Night: "The branches hold the stars like fruit no one is allowed to pick."

**Park**
- Day: "Benches warm from the afternoon. Somewhere a dog has found the best stick in the world."
- Day: "Paths that go in a circle, for people with nowhere to be."
- Night: "The lamps hum. The grass keeps the day's warmth a little longer."

**Court**
- Day: "Chalk lines, a tired hoop, the echo of a game that ended at sunset."
- Night: "The ball sleeps by the post. Tomorrow it will be thrown again."

**Pasture**
- Day: "The cows have no deadlines. They chew on that thought slowly."
- Night: "Dark shapes in the field, breathing. The fence keeps nothing in; they just stay."

**Karinderya (entering its lot outdoors)**
- "Rice steam, a radio, someone's tita laughing. The pot never seems to empty."

**Animals (walking up to one)**
- Cow: "The cow considers you. The cow returns to the grass."
- Dog: "A tail goes faster. You have been chosen."
- Cat: "The cat opens one eye, decides you are fine, and closes it."

Lines live in one data file, so they are easy to edit or translate later (a Tagalog set is a natural follow-up, like `chismis-tl.js`).

## Behaviour details

**Visit choice:**
- When an agent goes idle today, `AgentTravel.destOf` returns `'games'`. It now returns one of `games`, `park`, `waterfall`, `tree`, `court` or `pasture`, picked by a stable hash of (agent id, the idle start time).
- Rough weights: games 30%, park 25%, the rest 45% shared.
- There is no "full" fallback; see decision 4 under "Decisions after the builder check".
- The manager (Tiro) still never travels.

**At the spot:**
- The agent walks there along the town grid at the existing `TOWN_SPEED`.
- It takes a free activity point and plays a simple loop (sit, walk with dog, shoot, stand). That loop uses the existing walker poses plus small props (the ball, the leash).
- **Dog walking:** the dog follows the agent around the park loop on a leash line. With no agent, the dogs wander inside the park on their own.

**Return:**
- This is unchanged. When the board has work again (`fullAt`), the agent walks back to the office.
- Agents out at a spot are not shown at their desks. The office already handles "away" for the game hall; spots reuse that.

**Bubble:**
- It is drawn by the town page as an overlay text box anchored to the player.
- It uses the existing pixel font and the existing speech-bubble styling if there is one.
- Only one bubble shows at a time. It does not appear while a modal or Build mode is open.
- Reduced motion turns off the fade only, not the text.

**Karinderya:**
- 12 seats in `KSEATS`, plus 2–4 standing "take-out" spots at the counter as overflow.
- The interior template (`interior-kain.json`) gets a second table.

## Decisions after the builder check (my calls)

1. **A spot is a new kind of trip destination, `spot:<id>`. It is not a fake lot.**
   - The trip still leaves through the office door and walks the town grid. It then ends in a `there` leg in the **town** scene, holding a position (the activity point), with no 5 s "enter" leg.
   - `AgentTravel` must update `valid`, `where`, `nextIn` and `route`. `route` gets a door→point variant.
   - `town.html` draws these agents at their point.
   - Old trip records (`kain`, `games`) must still load unchanged.
   - Every hard-coded scene list must treat a `spot:*` agent as away from the office:
     - Agent Office.html;
     - office-world `setScene` / `sceneSnap`;
     - `TownMap.lotOfScene`;
     - travel-check.
2. **Spots ignore the office playroom.** The user asked that agents "go there sometime if they are not doing something".
   - When the office has its own playroom (`office.play`), idle agents still never go to the game hall.
   - They choose between staying in the office playroom and visiting an outdoor spot.
   - Without a playroom, they choose between the game hall and the outdoor spots, with the weights above.
3. **Karinderya seats: a new seated table piece (`kain-table`, 6 seats with ids `kain:7..12`).** It is placed in `interior-kain.json` only.
   - The `karinderya` piece and its `KSEATS` stay as they are, so existing office layouts don't change.
   - A saved kain interior gets the table added once, but only if it still matches the stock template. Otherwise users can add it from Build mode.
   - The counter take-out spots (`kain:q1..q4`) are the overflow.
4. **Determinism without shared capacity.**
   - The hash input is the agent id plus `statusAt` of the idle status. That comes from server history, so every page sees the same value; `emptyAt` is per origin, so it is not used.
   - There is no "spot is full" check, because `destOf` cannot see the other agents.
   - Instead, every spot has at least 8 activity points. Each agent takes the point at its fixed roster index mod the point count, so two pages always agree.
   - If more agents than points ever meet, they share a point with a small fixed offset.
5. **Return and departure apply to spots too.** `departAt` uses `IDLE_DELAY` for any idle destination (games or `spot:*`). The return on `fullAt` applies to any idle trip, not only `games`.
6. **Parked agents draw through the ambient system.** Agents standing at a spot are drawn on ambient frames, throttled to `ambientFps` and stopped when ambient is off or the page is hidden. Only agents actually walking use the traveller frame loop. This keeps the idle-CPU budget.
7. **Spot data is validated.**
   - `TownMap.validate` checks the `spots` array: kinds, rects, points inside rects, and no overlap with lots, paths, ramps or bridges.
   - Spot props block grid cells through a spot prop list, the same way decor does.

## Left to the builder

- The exact coordinates, prop sizes and how many trees to clear, within the placement table and the walkability rule.
- The art style details of each new sprite: tree of life, waterfall strip, court, fence, cow, dog, cat, hoop and ball. They must match the existing palette and pipeline.
- How the waterfall animates: a frame strip or a scrolling UV/offset. Pick whichever stays inside the GPU-texture and ambient budgets.
- The bubble cooldown value. A suggestion is 60 s per spot after leaving.
- How the agent activity loops are split into code and data.

## Verification

- **`npm test`:** new tests cover:
  - every spot is reachable and no door, ramp or path is blocked;
  - visit choice is deterministic and identical across pages;
  - activity points are assigned by roster index, and old trip records still load;
  - an agent with work never departs, and comes back on `fullAt`;
  - the bubble shows once per entry and respects the cooldown;
  - there are 12 karinderya seats, plus the overflow.
- **Live harnesses:**
  - town-check gets a walk into each spot that checks for a bubble;
  - scene-check, travel-check and office-check must stay ALL PASSED;
  - an idle agent arriving at a spot shows in travel-check.
- **Performance:** town-perf and office-perf must pass twice each with the step 4 budgets, and the shipped art must stay under 8 MB.
- **Screenshots:** each spot by day and by night, on Low (Canvas2D) and High (Pixi).
