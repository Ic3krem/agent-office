# Office world spec (Phase 2)

Status: design for Phase 2. Phase 1 (this change) renamed the manager to Tiro and fixed the roster of eight specialists in `company.mjs` (`ROSTER`, `MANAGER`, `profileOf`). Phase 2 builds the world below in `public/Agent Office.html` and `public/office-objects.js`. No new dependencies; everything stays drawn from pixel art and CSS like the current office, and the office still spends no tokens.

## 1. The team (source of truth: `ROSTER` in company.mjs)

| Desk id | Key | Name | Role | Model | Color / accent | Workspace block |
|---|---|---|---|---|---|---|
| office | tiro | Tiro | Office manager | sonnet | #e8793a / #ffcf6b | Manager's office |
| desk-1 | pixel | Pixel | Frontend engineer | sonnet | #e0679a / #ffb3d1 | Dual monitors, color swatches |
| desk-2 | forge | Forge | Backend engineer | sonnet | #e08a3a / #ffc78a | Server racks |
| desk-3 | warden | Warden | Security reviewer | opus | #5b7fd1 / #a9c1f5 | Lock, cameras |
| desk-4 | probe | Probe | QA and test engineer | sonnet | #4fb286 / #a5e6c6 | Test bench |
| desk-5 | atlas | Atlas | Deep researcher | opus | #8a63c9 / #c9b0f0 | Bookshelf, whiteboard |
| desk-6 | cabalan | Cabalan | Researcher | haiku | #3fb0b8 / #9de4e8 | Reading nook |
| desk-7 | tally | Tally | Task checker and organizer | haiku | #d6b13a / #f5e08f | Kanban wall |
| desk-8 | scribe | Scribe | SOP and document writer | sonnet | #b8785a / #e8b99f | Binders |

Old subagent types map through `ALIASES` (researcher to cabalan, builder and ops to forge, writer to scribe, reviewer to probe), so a helper spawned under an old name still gets the right character, color and desk via `profileOf`. The snapshot already carries `profile {key,name,role,color,accent,desk}` on every agent; the world must place a character by `profile.desk`, not by sorted session id (today's `SLOTS[slot++]`). Helpers with no profile (general-purpose, other Claude sessions) are visitors: they use the Playroom spill desks and the existing grey shirt hash.

Desks are reserved even when the specialist has not been hired: an empty desk shows its workspace block dimmed with a name plate, so the room always reads as "eight seats plus the boss".

## 2. World layout

Isometric, same projection and 2:1 tile as today. World about 1000 x 720 px at 1x, 3 wings around a central corridor.

```
+--------------------------------------------------------------+
|  MANAGER'S OFFICE (glass)     |           GARDEN             |
|  desk, 2 chairs, board,       |  pond, 3 benches, trees,     |
|  report tray, door to hall    |  path loop, string lights    |
+-------------------------------+------------------------------+
|                    FOCUS WORK AREA                           |
|  [d1 Pixel] [d2 Forge] [d3 Warden] [d4 Probe]   top row      |
|  --------------------- aisle ----------------------          |
|  [d5 Atlas] [d6 Cabalan] [d7 Tally] [d8 Scribe] bottom row   |
+-------------------------------+------------------------------+
|  UTILITY: filing cabinet,     |          PLAYROOM            |
|  bookshelf (reports),         |  arcade, jukebox, sofa,      |
|  corkboard, breaker, cooler   |  beanbags, ball pit, plants  |
+-------------------------------+------------------------------+
```

- Manager's office: top-left, glass walls and a door facing the Focus area aisle. Contains Tiro's desk, the Inbox tray (approvals) and the Today board on the back wall. Two guest chairs where a reporting agent stands.
- Focus Work area: the middle band. Eight desks in two rows of four, 150 px pitch, partition panels in each agent's accent color so ownership is readable at a glance. Quiet palette, no toys.
- Garden: top-right, open to the corridor. A place to think.
- Playroom: bottom-right, where agents go when the board is empty.
- Utility strip: bottom-left, existing interactive objects (filing cabinet, bookshelf, corkboard, breaker box, server rack, coffee machine, water cooler for the rate-limit state) keep their current behavior and click targets; only their positions change.
- Walk graph: a corridor loop (waypoints) connecting the office door, the aisle between the desk rows, the garden path and the playroom entrance. Agents never cut across desks; they path along waypoints (A* over a small grid or a hand-authored graph is fine at 9 characters).

## 3. Desk blocks (customized workspace)

Every desk shares a base: desk surface, chair, one name plate in the accent color, a mug, a lamp, and a status LED that is green when working, amber when blocked or waiting on approval, grey when away. On top of that base:

| Desk | Distinguishing props |
|---|---|
| Pixel (frontend) | Two monitors (left shows a wireframe, right a code pane), a row of 6 color swatch chips, a tiny pen tablet, a sticker-covered laptop |
| Forge (backend) | A short server rack beside the desk with blinking LEDs (tie blink rate to working state), a rack-mounted terminal, cable tray, a small network switch |
| Warden (security) | Padlock emblem on the partition, two wall cameras that pan slowly, a keycard reader, a monitor with a shield icon, a shredder |
| Probe (QA) | A test bench: a second table with three devices under test, a bug jar, a clipboard checklist whose ticks fill as tests pass, a magnifier |
| Atlas (deep research) | A floor-to-ceiling bookshelf behind the desk, a rolling whiteboard with string-and-pin diagram, a stack of open books, a globe |
| Cabalan (research) | A reading nook: armchair, floor lamp, side table with a book and tea, a small bookcase, a rug in the accent color |
| Tally (organizer) | A kanban wall: three columns (To do, Doing, Done) of sticky notes, mirrored from the real goal board counts; a label maker and a filing tray |
| Scribe (SOP) | Binders in a rack (one per SOP note, count from the vault), a typewriter-style keyboard, a page stack, a quill pen cup |

Blocks may animate only while their owner is `working` (LED blink, screens scroll, cameras pan, ticks fill). All animation is CSS or sprite-frame based; respect `prefers-reduced-motion`.

## 4. Zones

- Focus Work area: any agent whose status is `working` is at its own desk, seated, facing the monitor. A blocked or approval-pending agent stays seated with a raised hand and an amber badge over the head.
- Garden to think: a status of `thinking` (see section 5) walks the character to a garden bench or the pond edge with a thought-bubble. Thinking is a model turn with no tool call in flight for more than a few seconds, or the manager planning before it hires.
- Playroom when no goals or tasks remain: when the Today board has no `todo` or `doing` goal and no helper is working, idle agents go to the Playroom (arcade, sofa, beanbags). Playing is purely visual.
- Manager's office: a goal completing triggers a report walk (section 5). Tiro himself sits here; while working he stays at his desk, while thinking he paces to the window.
- Cooler corner (existing): `limited` (plan limit) agents stand at the cooler.

## 5. Movement state machine

Each character holds `{ state, target, path, since }`. The server snapshot is the only input; the client derives state each render tick, so reloading the page never desyncs.

Inputs per agent: `status` (working, idle, blocked, error, limited), `perm` (approval pending), `task`, `logs` tail (is a tool call in flight, last event age), and the board (`goals`: open count, newly `done` ids with a report).

States and transitions:

```
          working                       no tool call > 6s & turn open
 AT_DESK <----------- (any) ---------------------------> THINKING (garden)
   ^  |                                                        |
   |  | status=idle & board empty -> PLAYROOM                  | tool call resumes -> AT_DESK
   |  v                                                        v
   | IDLE_DESK (board still has open goals: stay seated, idle anim)
   |
   | goal done (report filed for a goal this agent worked)
   v
 WALK_TO_OFFICE -> REPORTING (stand at guest chair, 4s, report icon appears
                    on Tiro's desk) -> WALK_BACK -> AT_DESK or PLAYROOM
```

Rules:

1. working: path to own desk (`profile.desk`) and sit. Always wins over every other state except REPORTING in progress.
2. thinking: working but no tool call in flight for at least 6 s (debounced, 3 s hysteresis back) goes to the Garden. Only while the board is non-empty; a thinking agent that gets a tool call walks back to its desk.
3. idle with open goals on the board: stays at the desk, idle animation (sip, stretch). It does not leave: someone may still hand it work.
4. idle with an empty board (no `todo`/`doing` goals, `boss.running === 0`): after 20 s walks to a free Playroom spot; a rotating subset sits on the sofa, others use the arcade and beanbags. Any new goal or status=working sends everyone back to desks immediately.
5. goal complete: when a goal flips to `done` and its report exists, the agent that did the work (match by the goal id mentioned in its last log lines or by the helper whose `parent` finished last; fall back to the busiest helper of the last minute) walks to the manager's office, stands at a guest chair for about 4 s with a paper icon, Tiro looks up, then it walks back. The target after returning is chosen by rules 1, 3 and 4. Only one reporter in the office at a time; others queue at the door.
6. blocked/approval: stay at desk, amber badge; the Inbox tray in the manager's office pulses. Not a movement trigger.
7. limited: go to the cooler corner (existing behavior). error: stay at desk with a red badge.
8. Absent (not hired / hidden by Tidy): the desk is shown empty and dimmed; the character is not drawn.
9. Tiro: working or planning at the manager's desk; no goals left: stands at the window with a cup, never enters the Playroom.

Movement: speed about 90 px/s along waypoints, a short ease at turns, characters face the direction of travel (4 directions), collide softly by waiting at waypoints, and never take longer than 6 s per transition (teleport fade as a fallback if the path is blocked). Pure functions (`nextState(agent, board, now)`, `pathTo(from, to)`) go in a testable module, for example `public/office-motion.js` mirrored in `desktop/` style with node tests, like `island-logic.mjs`.

## 6. Furniture list

Manager's office: manager desk with two monitors, chair, 2 guest chairs, Today board (wall), Inbox tray, glass wall and door, plant, rug, framed "goals done" counter, small trophy shelf (fills as goals finish).

Focus Work area: 8 desks and chairs, 8 colored partition panels, 8 name plates, overhead pendant lights, a long runner rug in the aisle, a wall clock, a whiteboard with the date.

Garden: pond with koi, 3 benches, 2 trees, flower beds, stepping-stone path loop, lantern string lights, a small bird feeder, the Server plant (existing, grows with finished goals).

Playroom: arcade cabinet (existing Bug Squasher), jukebox (existing), 3-seat sofa, 2 beanbags, low table with snacks, ball pit corner, a dartboard, a small basketball hoop, a toy bin, rug.

Utility strip: filing cabinet (SOPs, existing), bookshelf (reports, existing), corkboard (memory, existing), breaker box (existing), server rack (existing), coffee machine (existing), water cooler (existing), printer that animates when a report is filed, recycling bin.

Shared: ceiling lights, baseboards, wall art per zone, window light that shifts with the real time of day.

## 7. Character design notes

Current characters are small sprites with hair, skin and shirt color hashed from the session id. Improvements:

- Shirt color is now the role color from `profile.color`; accent color for lanyard, name tag and the desk partition. Hair and skin stay hashed per agent so repeated hires differ.
- Role props in hand and on body: Pixel headphones, Forge hard-hat-style cap, Warden visor and badge, Probe goggles, Atlas round glasses, Cabalan scarf, Tally clipboard, Scribe pen behind the ear. Tiro keeps the orange cube-crab look in his window and a tie in the office.
- 4 directions, 3-frame walk cycle, sit, typing, thinking (chin hand), playing, reporting (holds paper), celebrate. Draw at 1x pixel grid and scale by integers only so sprites stay crisp.
- A soft contact shadow, 1 px dark outline, and a 2-tone shirt shade (existing `dk()` helper) for depth.
- Overhead UI: name tag in the accent color, a 6 px status dot, model badge (H, S, O), and one bubble at a time (task text while working, thought dots in the garden, paper icon while reporting).
- Tiro and the desktop overlay mascot remain the same character; keep the mood set in `public/kiro-art.js`.

## 8. UI polish list

1. Roster panel: show the eight cards (name, role, model, tool chips, 3-line brief) from the snapshot, with a hire cap meter `n/8`. Source the briefs from `ROSTER` through a new `/api/roster` read-only route or the snapshot.
2. Click an empty desk to see who sits there and what they do; click a character to open the existing detail pane (already shows `Name · Role`).
3. Zone labels on the floor (Focus, Garden, Playroom) fading after the first view; a legend toggle.
4. Camera: smooth pan and zoom to a clicked zone, minimap with colored dots per agent.
5. Activity feed in the detail pane shows only that agent's last 6 events with icons by tool kind.
6. Consistent accent usage: partitions, name tags and report rows use `profile.accent`; Reports shelf rows get the author chip when known.
7. Keyboard access: every desk and object focusable (existing role=button pattern), visible focus ring, `aria-label` with name, role and status.
8. Reduced motion: honor `prefers-reduced-motion` and the existing animate setting; static poses instead of walking when off.
9. Performance: one rAF loop, sprites on a single canvas or pre-rendered data URLs (existing `sheet()` cache), pause when the tab is hidden.
10. Day and night tint tied to local time; breakroom lights dim when the board is empty.
11. Sound: optional soft chime on report arrival at the manager's office (uses the existing Web Audio jukebox engine, off by default).
12. Copy: all user-visible text says Tiro. Internal ids (`kiro.json`, `kiroDesk`, `kiro:*` IPC, `kiro` breaker switch, `kiroFace`, `/kiro` route, `kiro-brief` SOP note) stay for backward compatibility; any future rename must add an alias that reads the old key first.

## 9. Phase 2 work breakdown and acceptance

1. `public/office-motion.js`: pure state machine and path helper, with `office-motion.test.mjs` covering rules 1 to 9.
2. World drawing: new background and zone geometry, 8 desk blocks, manager's office, garden, playroom (drawn pieces under `public/office-objects.js` conventions).
3. Wire `profile.desk` placement and role colors; empty-desk placeholders.
4. Character sprite upgrade and props.
5. UI polish items 1 to 6 first; the rest as time allows.

Acceptance: with the board empty all hired agents are in the Playroom; adding a goal sends them to their own desks within 3 s; a finished goal produces exactly one walk to the manager's office and back; a reload mid-walk resumes from derived state; `npm test` passes; no new network calls, no new background processes, port and installer behavior unchanged.

## 10. Phase 2 as built (2026-11-03)
Backup before changes: `<home>\...`.
- **Files**: `public/office-motion.js` (pure: layout, walk graph, Dijkstra `pathTo`, `createWalker`/`stepWalker`, `nextState`, `createBrain`, `demoSnapshot`; loaded by the page and, via `vm`, by `office-motion.test.mjs`), `public/office-sprites.js` (procedural 16x24 characters, cached, 3x), `public/office-furniture.js` (iso helpers, baked floor/walls, every furniture painter, desk blocks), `public/office-world.js` (one canvas, one rAF loop at 30 fps, hit testing, tags, bubbles). `Agent Office.html` keeps the DOM chrome only (header, Today board, drawer, Usage/Reports windows) plus one focusable invisible hotspot per desk and object for keyboard access.
- **World**: stage 1310 x 830, ground 1000 x 780 units, same 2:1 projection. Manager's office top-left (glass, door), garden top-right (pond, benches, trees), focus band with eight desks (pitch 230 units, partitions in the accent colour), utility strip bottom-left (existing objects keep their `OfficeObjects` windows and click targets), playroom bottom-right. Corridor rows at y=250 / 396 / 568 and columns in the gaps between desk blocks form the walk graph; garden loop and playroom hubs hang off it.
- **State machine** (`nextState` + brain): AT_DESK, IDLE_DESK, THINKING (working, last log not a tool call, quiet 6 s; 3 s dwell back), PLAYROOM (board empty: no todo/doing goals, `boss.running` 0, no helper working; 20 s after it empties, immediately at load, and stays while it stays empty), COOLER (limited), BLOCKED / ERROR (seated, badge), IDLE_WINDOW (Tiro, never the playroom), and WALK_TO_OFFICE / REPORTING (4 s) / WALK_BACK with a door queue (one reporter in the office). A goal that flips to `done` with a report triggers exactly one report; goals already done and older than 15 s at load are marked reported silently. Reporter = agent whose last 8 log lines mention the goal id, else the most recent work-ender, else the busiest.
- **Movement**: 110 to 260 units/s (long routes jog so a transition stays near 5 s), corner and stop easing, facing by travel direction, sideways lane offset per agent, soft collision (wait, slip past after 1.2 s), 6 s budget then a fade-teleport. First snapshot places everyone directly; later newcomers spawn at the manager's door. Reduced motion (`prefers-reduced-motion` or `data-anim="off"`) places agents instantly and freezes animation clocks.
- **Preview mode**: header-free control cluster bottom right (Team n/8, Labels, Preview). Preview cycles `work, think, blocked, report, empty, tour`; `?demo=<scene>` and `window.__demo('<scene>')` do the same; `OfficeWorld.advance(seconds)` fast-forwards the simulation for smoke tests; `OfficeWorld.setHour(h)` forces the sky.
- **UI polish done**: 1 roster panel (`/api/roster`, read-only POST like the rest), 2 empty desk card, 3 zone labels fading after 14 s with a toggle, 5 last-6-events strip with icons, 6 accent partitions and name tags, 7 hotspot focus and aria labels, 8 reduced motion, 9 one loop, paused when hidden, 10 day/night tint and sky from local time, dim lights and party glow on an empty board, 12 copy says Tiro. Not done: 4 (camera pan/zoom, minimap), 11 (chime), Reports shelf author chips.
- Smoke recipe used: temp `USERPROFILE` server on port 47811, hidden Electron with temp userData, screenshots `<home>\...`, scripts in `Tools\tmp-ops\smoke2\` (`run.sh "name|js|advanceSeconds~..."`; unset `ELECTRON_RUN_AS_NODE`).

## 11. Phase 3 polish (2026-11-03, v1.2.0)
Backup: `Documents\agent-office-bak-20261103-polish`.
- **Chrome**: shared CSS tokens and classes (`.pill`, `.xbtn`, `.sbtn`, `.empty`, `.sect`) in `Agent Office.html`; header fits one row at 1280 (shorter pill copy, counts abbreviated below 1500 px), Today panel docks at y=96 when single row and y=176/210 when the header wraps (drawer open); invalid unitless `font-size` values fixed (they had silently fallen back to 16 px); offline banner, "Connecting…" state, empty states for goals and activity, aria-labels on icon buttons.
- **Camera**: wheel zooms about the cursor (1x to 3x), drag pans when zoomed, keys `+ - 0`, corner buttons (`-`, Fit/%, `+`). Pure maths in `OfficeMotion.zoomAt` / `clampView` (tested). No minimap (would add a second canvas and hit-testing; skipped).
- **Playroom**: 15 spots (was 11); a new claim picks the free spot farthest from everyone playing, so eight agents spread over the room; arcade 1 player stands beside the cabinet.
- **Characters**: seated-from-behind sprites get hips and thighs; typing characters seen from the front sit with thighs forward; Tiro paces along the window while idle (reduced motion: stands).
- **Bubbles**: task bubbles show while 4 or fewer agents are working (was 3).
- Still rough: no minimap, no chime, Reports shelf author chips, desk props only animate while the owner works, canvas text is not scaled with zoom quality caps (res capped at 3x), Reports window text spacing around the middle dot, Google Fonts need network (falls back to system sans offline).

## 12. East park and scheduler garage (2026-11-03)
- World is now 1240 x 780 units (stage 1480 x 920): the garden runs on east into a larger park (second pond, picnic table, benches, trees, lamp posts), fenced from the focus band with a gate at the aisle's east end (walk nodes `k_gate`, `k_hub`; thinking spots `pk:b1`, `pk:b2`, `pk:pond`). The garage stands south-east beside the playroom, with a forecourt.
- Scheduler: the garage (building, half-open bay, status screen) and the mail bench with mailbox are click targets (`garage`, `scheduler`) and a fixed non-agent character stands at `sched:npc`. All open one read-only panel in `office-objects.js`. Status comes from `POST /api/scheduler` (`scheduler.mjs`), which reads `~/.claude/agent-office/scheduler.json` (`lastCheck`, `itemsFound`, `lastUpdateToTiro`, `nextCheck`, `note`, `items[]`); missing or unreadable file shows "No data yet". The page polls it every 30 s while visible.
- Follow-up, not built: the scheduler job itself (mail checks, check-ins, updating Tiro) that writes the file. Nothing here reads mail, uses Graph or sends messages.
