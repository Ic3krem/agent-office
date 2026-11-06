# Tiro Workspace: the Town (cozy isometric world) — design

Status: draft for approval · 2026-11-06 · branch `feature/world`
Art target (approved): `2026-11-06-town-art-target.png` (next to this file). Style references: the user's folder of
isometric pixel dioramas and a cozy kitchen cutaway (not in the repo; described below).

## 1. Intent

Agent Office becomes a small cozy town you walk around, in the spirit of farming/life-sim games: warm, rustic,
pixel-art isometric. Today the whole app is one office floor. In the town, each place is its own building on a lot.
You see the buildings from outside, walk up to a door, and go in. Your AI team still works in your office. When agents
hit the plan limit they go to the karinderya. Games live in the game hall. When you party with friends, their offices
appear on the empty lots around the square.

Success, in the user's words: "like stardew", "spacious, utilize the space", "see the houses/buildings when walking",
the whole app matching (interiors too, office interior modern), graphics settings from low to high with shadow
options, and optimized "specially on ram and cpu", using the GPU when there is one.

## 2. Decisions the user made

- **Map: town square.** A central plaza. Your office, the karinderya (cafeteria) and the game hall each sit on their
  own lot facing the square. Friend lots line the remaining side.
- **Like Stardew.** Each lot's building is a separate place you enter through its door. Outside, the town is one map
  you walk across, and you see every building.
- **Look: cozy and rustic pixel isometric.** Same diagonal view as today. Warm sunlight with cool shadows. Plank and
  stone walls, shingle roofs, glowing windows, uneven stone paving, layered trees, pines, flowers, barrels, a stream.
  The town is a floating soil block. The approved draft is the art target above.
- **The whole app matches.** Interiors get the same style. The office interior is modern (still cozy, still pixel).
- **Party.** Party mode adds friends' lots to the town. **At most 4 people**: you and 3 friends.
- **Graphics settings** from low to high, including shadow options.
- **Optimize** RAM and CPU above all. Use the GPU when available.
- **Original art only.** No art, characters or names from any existing game. Our own models and drawings, made with the
  user's Blender and code.

## 3. Goals, non-goals, anti-goals

Goals:
- Build the town exterior with three home lots plus three friend lots.
- Enter and leave buildings with a short fade.
- Restyle the office interior as modern-cozy, and add a karinderya interior and a game hall interior.
- Agents walk between buildings: from the office to the karinderya at the plan limit and back after the reset.
- Build a graphics settings panel with presets and auto-detection.
- Meet the performance budgets in section 8.

Non-goals (for this project):
- No changes to what agents do or how they are run, approved or billed. The backend, Tiro, hiring, the guard and the
  party protocol keep their behaviour.
- No 3D at runtime. Blender runs only when making art, on the developer's machine. Users never need it.
- No more than 4 party members. No farming, crafting or economy.
- No user-uploaded art.

Anti-goals (this would be a failure even if it works):
- The app idling at noticeable CPU or GPU use, or growing its memory over a day of use. Today it is light.
- Losing any current feature: build mode, desk roles, wardrobe, CEO avatar and radial, karinderya chismis, NPCs,
  party visit, chat and games, power saver, reduced motion, approvals.
- Art that drifts into different styles between buildings, or that copies a commercial game.

## 4. The town

- **One exterior map.** Spacious, about 3× the current office floor in area, centred on the plaza.
- **Lots** are fixed slots with a building, a door spot and a path to the plaza:
  - `home`: your office, a modern timber-and-glass house;
  - `kain`: the karinderya (red roof, awning, outdoor tables, plastic stools, string lights);
  - `games`: the game hall (barn arcade, neon sign, cabinets);
  - `friend-1` to `friend-3`: fenced plots with a "for lease" sign until a friend joins. Then the friend's office
    building stands there, with their name on a sign.
- **The square** has a well-fountain, benches, lamps and flower beds. A stream with a bridge, trees and bushes fill
  the edges. NPCs stay zero-token. The sweeper works the square, the cook works the karinderya, and an optional cat
  wanders.
- **Walking.** The CEO avatar walks outside with the same controls as today: keyboard, click-to-walk and joystick.
  At a door, an "Enter" prompt (E, or a tap) fades into the interior. Leaving through the interior door puts you back
  outside that door.
- **Camera.** It follows the avatar and is clamped to the map. Zoom works as today.
- **Your building's look.** Your office lot can use one of a few building variants (my call: 3 at first) so friends'
  offices differ. Friends see the variant you chose.

## 5. Interiors

Each building's interior is a layout in today's world-model format (zones, objects, spots). Build mode keeps working
inside.

- **Office (modern-cozy):** today's office layout: desks, department desks, Tiro's office, reports bookshelf, memory
  corkboard, SOP cabinet, breaker box, server rack, printer, coffee bar. It gets new modern art: light wood floors,
  plants, glass partitions, warm lamps.
  - My call: the playroom pieces (arcade, jukebox, sofa, ball pit, darts) move to the game hall interior.
  - My call: the garden and pond pieces move outdoors to the town.
- **Karinderya:** the cozy wood room already built (counter, trays, pugon, long table, bangko, cat) as the interior,
  scaled up to fill the building. Limited agents eat here. Chismis and the cook work as today.
- **Game hall:** the arcade cabinets and lounge pieces. Party games (typing race, trivia, leaderboard) open from the
  cabinets. Today they are buttons in the Party panel; the panel keeps working too.

**Existing saved layouts:**
- Today's `layout.json` becomes the office interior.
- On first load, pieces that moved to other buildings are dropped from the office interior, and their spots move with
  them.
- No user data is lost: role desks, notes and the vault are untouched. The old file is kept as `layout.v1.json`.

## 6. Agents across buildings

- Agents live in the office. Their brain (`office-motion.js` `nextState`) stays the source of truth for what they are
  doing.
- When an agent's state needs a spot in another building (plan limit → karinderya stool), the agent becomes a
  traveller: it walks to the office door, crosses the town on the path, and enters the karinderya. The reverse happens
  after the reset.
- Travellers are only drawn in the scene you are looking at. Scenes you are not in keep agent positions as data only,
  with no drawing.
- Chismis, nudges, labels, approval badges and the desk card behave as today, in whichever scene the agent is in. The
  header still shows every agent's status regardless of scene.

## 7. Art pipeline (developer-time only)

- **Source:** Blender Python scripts in `art/` build each asset from parts. The approved spike (`blender_cozy.py`)
  is the starting point. Assets: buildings (exterior variants), interior furniture (every catalog type), terrain
  pieces, props, NPC props.
- **Render:** an orthographic camera that matches the app projection (2:1 ground, heights 1:1), a warm sun, a cool
  sky, no anti-aliasing. It renders a fixed number of pixels per world unit, with a transparent background.
  - Baked shadows go in a **separate shadow layer** per asset, so shadows can be switched off, kept simple or kept
    soft at runtime.
  - Night variants of glowing windows and lamps go in a separate glow layer.
- **Post-process:** a shared palette (one cozy palette for the whole game), a 1 px dark outline, and quantization. The
  pipeline also packs **texture atlases** (max 2048×2048) with JSON frame data: anchor/pivot, footprint, door and spot
  offsets.
- **Output** is committed under `public/art/` (PNG + JSON) with a provenance manifest. A single
  `npm run art` rebuilds everything. Builds and CI never run Blender; they use the committed atlases.
- **Characters** keep today's procedural sprites, because the wardrobe depends on them. They are restyled to the
  cozy palette and outline, drawn once per look into a cache, and uploaded as textures.
- **Ground:** terrain tiles (grass, paving, path, water edge, soil sides) are an atlas of isometric tiles, with
  variants to break repetition.

## 8. Rendering and performance

**Renderer.** PixiJS v8 (WebGL2, with WebGPU when the device supports it), vendored into `public/vendor/` like React
(no CDN; the app works offline). If no GPU context is available, a Canvas2D fallback draws the same scene from the same
atlases at the Low preset.

**Techniques:**
- One sprite batch per atlas.
- Static ground and buildings are cached in chunks: render textures about 512 px square, rebuilt only when the layout
  changes.
- Only chunks and sprites in the view are drawn.
- Characters and animated bits (water, lamps, fan, fire) form a small dynamic layer.
- **Render on demand.** Keep today's frame pacing and power saver: no frames while nothing changes; animation at the
  preset's fps. A hidden window draws nothing.
- Simulation (agents, NPCs) runs at a fixed 10 Hz, decoupled from drawing.
- Only the current interior and the exterior are resident. Leaving a building releases its textures after 30 s
  (or right away on Low).

**Graphics settings** (stored in `kiro.json` as `graphics`; the panel opens from the bottom bar):

| Setting | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Render scale | 0.5 | 0.75 | 1 | 1 (2× on HiDPI) |
| Animation fps cap | 15 | 30 | 30 | 60 |
| Shadows | off | simple (blob) | baked soft | baked soft + time-of-day tint |
| Ambient animation (water, trees, fire, fan) | off | water only | all | all + particles (leaves, steam) |
| Day/night lighting | off | tint only | tint + window glow | tint + glow + lamp light pools |
| Renderer | Canvas2D | GPU if available | GPU | GPU |

- Each setting can also be set on its own (Custom).
- **Auto-detect on first run.** No GPU context, `deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4` → Low. Integrated
  GPU → Medium. Otherwise → High.
- "Reduced motion" and the power saver override animation.

**Budgets.** Measured in the packaged Electron app on the developer's machine, recorded in a perf test that fails on
regression:
- Idle (nothing moving, window visible): renderer process CPU < 1% on Low, < 3% on High. Hidden window: about 0%.
- Walking the town: frame time < 8 ms (High), < 16 ms (Low, Canvas2D).
- Memory:
  - renderer process < 250 MB on High and < 180 MB on Low;
  - GPU textures < 96 MB on High and < 48 MB on Low;
  - no growth over a 1-hour soak of entering and leaving buildings (heap within ±10%).
- Shipped art under 8 MB total.

## 9. Party (max 4)

- `LIMITS.members` becomes 4 everywhere: server, client and UI. "The party is full" is shown at the 5th join.
- Friend lots fill in join order. A friend's lot shows their chosen building variant and their name sign.
- **Entering a friend's building** is today's view-only visit, now with their interior art. Their agents show generic
  bubbles only. The privacy boundary in `party/protocol.mjs` is unchanged: no new fields beyond the building variant
  (a small integer).
- Friends' avatars walk the town and their interiors as today's guests.

## 10. Constraints

- Desktop app first (Electron). The browser page keeps working.
- The repo is public (Apache-2.0):
  - only original or CC0 assets, with provenance recorded;
  - no personal names or paths in the repo (the share-ready test).
- Existing tests keep passing. Golden draw-log tests for the old office painters are retired when those painters are
  replaced, with new visual and perf checks in their place.
- No new runtime dependencies besides vendored PixiJS. Python, Pillow and Blender are developer-only, for `npm run art`.

## 11. Delivery order

1. **Pipeline and renderer spike.** `art/` pipeline producing atlases for the town exterior; PixiJS renderer with
   chunk caching and render-on-demand; town exterior walkable; perf harness with budgets. *(The approval point for the
   look in the app.)*
2. **Interiors.** Modern office art for every catalog piece; karinderya and game hall interiors; doors and scene
   transitions; layout migration.
3. **Agents across buildings.** Travellers, karinderya trips, chismis, NPCs in the new art.
4. **Graphics settings.** Presets, auto-detect, Canvas2D fallback, shadows and day/night layers.
5. **Party lots.** Max 4, building variants, friends' buildings, games in the game hall.

Each step ships behind the existing app until step 2 is complete. My call: the town only becomes the default view once
the office interior has all of today's features.

## 12. Answers to the builder check (my calls unless marked)

- **Art volume:**
  - Pieces don't rotate in build mode today (a Phase 2 ruling), and that stays. So each catalog piece is one facing:
    one colour layer, a shadow layer, and a glow layer only where it lights up.
  - Seats and desks that people sit at or behind are rendered split into back and front parts at the seat line, with
    anchors for their sit and stand spots, so characters sort between them.
  - Every piece comes from Blender; none stay procedural. The pipeline makes this a script per piece, not hand-drawing.
- **Party:**
  - `room` gains one value, `town`, using the town map's coordinates. Friends on the plaza are shown in real time as
    guests, like today.
  - Friends' agents never travel in your town. They stay inside their own office and are seen only when visiting.
  - The shared layout is still the office interior only, under the 300 KB cap, plus the building variant (an integer
    0–2).
  - The share-ready, protocol and party tests are updated with the change.
- **"Idle" in the budgets** means no characters moving, with the preset's ambient animation running.
  - Ambient animation redraws only small dirty areas, at its own low rate (water and fire at 8 fps). It never forces a
    full-scene redraw.
  - The budgets are absolute numbers, measured on the developer's machine, not relative to today.
- **Spike and tooling:** the approved spike scripts (`blender_cozy.py`, the post-process) are committed into `art/` in
  step 1. The art machine has Blender 5.2, run headless (`blender -b -P`).
- **Storage:**
  - `world/layout.json` stays the office interior.
  - New files in the same folder: `kain.json` and `games.json` (interiors, editable in build mode, same schema and
    caps) and `town.json` (fixed lots).
  - Town decor is not editable at first.
  - Interiors share the schema version, so no schema bump is needed. Migration only moves the playroom and garden
    pieces out of `layout.json`.
- **Art target image:** style only, not layout. The lots, building roles and counts in this document win.
- **Low preset (Canvas2D):** keeps the chunked static ground and buildings, and drops water, tree sway, particles and
  light pools.

## 13. Left to the builder

- Exact palette values, tile sizes and pixels per world unit, within the art target.
- Atlas packing details, the chunk size, and the PixiJS version (pinned v8).
- How the Canvas2D fallback shares code with the GPU path.
- Lot coordinates and the exact town layout, within "spacious, plaza-centred, three home lots and three friend lots".
- How the perf numbers are measured (Electron `process.getProcessMemoryInfo`, `performance.memory`, the trace).
