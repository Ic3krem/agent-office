# Agent Office "Big One": buildable world, department desks, CEO avatar, party server

## Context
Agent Office (release/1.2.9, public, Apache-2.0) is a single-player canvas office over Claude Code sessions. The user wants it to feel like a game:
- a Gather.town-style office you can build;
- department desks that add specialists the manager (Tiro) assigns work to;
- free NPCs that cost no tokens;
- a karinderya where agents go when the plan limit is hit;
- costumes;
- a CEO avatar the user controls;
- later, an online party server where friends' offices meet.

Order (user's choice): **solo first, then multiplayer.**

**Main blocker found:** the world is hardcoded. These are all fixed coordinates in code today:
- desk blocks: `COLX`/`ROWY` in `public/office-motion.js:22-31`;
- obstacles and spots: `OBSTACLES`, `SPOTS`;
- the hand-built walk graph: `NODES`/`EDGES` at `office-motion.js:88-134`;
- the furniture painters registered via `add()`/`reg()` in `office-furniture.js:63-69`.

The roster is a fixed 8 in `company.mjs:88-105`. Everything below depends on turning the world into data first.

## Decisions (user's)
- **Build feel:** Gather.town, so zones carry meaning (desks, karinderya, lounge, quiet) more than decoration.
- **Teams:** drop a department desk (IT, QA, Accounting, Marketing, Auditor, Notetaker, ...). Tasks still go to Tiro, who assigns them to the matching desk.
- **Nudge:** walk up to Tiro to open a radial menu: **Chat / Prioritize / Boost (stronger model) / Speed (faster model)**.
- **Karinderya:** at the plan limit, agents pause, walk there, eat, and resume when the limit resets. While there they make zero-token **Tagalog chismis** small talk.
- **Costumes:** wardrobe presets (hair, skin, outfit, colours, accessories) for agents and the avatar. No uploads.
- **Party server:**
  - Docker on the host. Default access is a built-in **Cloudflare quick-tunnel link plus an invite code**; **IP:port** is an alternative.
  - Guests use their own installed app to bring their office. Browser visitors are lounge-only spectators.
  - Others see generic bubbles only, never prompts, commands or scripts.
- **Mini games:** all four (leaderboard, typing race, trivia, lounge games).

## My calls (check these)
- Work happens on a new branch `feature/world` in worktree `AgentOfficeWork\world`, off release/1.2.9.
- **One release per phase.** Each phase gets its own detailed plan (superpowers:writing-plans) when it starts. This file is the roadmap and design.
- **Walkability:** a grid of 10-unit cells over the existing 1240×780 plane (124×78; 20-unit cells close the 26-unit fence gate), with A* pathfinding. It replaces `NODES`/`EDGES` and keeps the isometric look and the `P()` projection.
- **Layout storage:** `~/.claude/agent-office/world/layout.json`.
  - The **default layout is generated from today's hardcoded positions**, so existing users see no change.
  - Workspace templates live in `world/templates/*.json` (shipped ones in `public/world-templates/`).
- **Specialist cap:** becomes a setting (default 8). Hire-gate, breaker and subscription-guard checks stay exactly as they are.

---

## Phase 1: World as data (no visible change)
- New `public/world-model.js` covers the layout schema `{version, zones[], objects[], grid}`, validation, and `defaultLayout()` built from the current constants. Zones are rectangles with a type (`desk`, `dept`, `karinderya`, `lounge`, `quiet`, `garden`, `spawn`).
- **Furniture:** turn the painters in `office-furniture.js` into a catalog keyed by type (`{type, w, h, rotations, paint(ctx,x,y,rot), blocks}`). Instances come from layout objects, not hardcoded `add()` calls.
- **Movement (`office-motion.js`):**
  - Derive `SPOTS`/`OBSTACLES`/desks from the layout.
  - Replace the Dijkstra node graph with grid A* in a new `public/world-path.js`.
  - The brain state machine (`nextState`) is unchanged.
- **Server:** `GET/PUT /api/world` (PUT behind the existing nonce/DECISIONS auth in `server.mjs:55`), saved atomically in the world dir.
- **Tests:**
  - `world-model.test.mjs` checks that the schema validates and that every zone and spot is reachable.
  - A parity test checks that the default layout reproduces today's spots, using the vm sandbox pattern from `office-motion.test.mjs:7-9`.
  - Add both to the `npm test` list in `package.json`.

## Phase 2: Build mode (Gather-style editor)
- A header **Build** toggle pauses agent motion and shows grid and zones.
- **Catalog drawer:** furniture, department desks, zone brushes, decor.
- **Interactions:** drag-place, rotate (R), delete, and paint or resize zones. Undo/redo stack.
- **Save checks reachability** (every desk and zone can be reached from spawn) and rejects layouts that fail.
- **Workspace templates:** save as / load / reset to default. Ship 3: Startup Loft, Agency Floor, Hotel Back-Office.
- **Room expansion:** the plane can grow in chunks (map size is part of the layout). The camera pans and zooms (mouse wheel, pinch).
- **Files:** new `public/world-editor.js`. Hook into `public/office-world.js` (input and draw loop) and `Agent Office.html`.

## Phase 3: Department desks become specialists
- **Role templates:** one JSON file per role in `public/role-templates/` (`it`, `qa`, `accounting`, `marketing`, `auditor`, `notetaker`, plus the current 8). Each file holds:
  - `{key, name, role, model, effort, tools, brief, look}`.
- **Placing a dept desk** creates a desk object with a `role` and adds that specialist to the roster. Removing the desk retires the role; its memory folder is kept.
- **`company.mjs`:**
  - `ROSTER` becomes `builtIns + layout dept desks`.
  - `def()` (:196) and `teamFromSops` (:235) work over the dynamic list.
  - `MANAGER_PROMPT` (:59) gets the live roster.
  - `MAX_SPECIALISTS` comes from settings.
- **Other consumers to update:**
  - `agent-home.mjs` (`KEYS` becomes dynamic);
  - `office-motion.js` (`TEAM`/`TIRO`);
  - the drift test.
- **Tiro's session:** a roster change takes effect on Tiro's next session. `bossOptions` (`server.mjs:394`) rebuilds `agents:`.

## Phase 4: CEO avatar + nudge
- **Player entity** spawns at the `spawn` zone. Controls:
  - WASD/arrows;
  - click or tap to walk there (A*);
  - touch: an on-screen joystick.
  It collides with the grid. The camera follows when zoomed in.
- **Proximity:** when within about 2 cells of Tiro or any agent, a prompt shows (E or tap). For Tiro, it opens the radial menu:
  - **Chat** opens the existing chat panel.
  - **Prioritize** picks a goal and sets its new `priority` field in `goals.json`. Tiro is told on its next turn.
  - **Boost / Speed** sets a per-goal model override (e.g. opus+high / haiku). It is applied when Tiro next hires for that goal, and checked against the breaker and subscription guard. Boost shows a "costs more" confirm.
- Talking to a specialist's desk shows their current task (local only).
- **Files:** new `public/world-player.js`; changes in `company.mjs` (goal priority and override fields) and `server.mjs` (routes).

## Phase 5: Wardrobe
- Turn the prop if-chain in `public/office-sprites.js:113-138` into a table.
- `lookOf()` (:16) reads an optional saved costume `{hair, skin, outfit, top, bottom, accent, accessory}`. The costume goes into `look.sig` so the sprite cache stays correct.
- Wardrobe window (click a character, or the avatar's own menu) with a live preview. Saved in `kiro.json` under `looks`.

## Phase 6: Zero-token NPCs + karinderya
- **`public/world-npc.js`** is an NPC runner generalised from the Scheduler NPC (`office-world.js:57-67`). Behaviours:
  - Sweeper: wanders and leaves a dust puff.
  - Cook: stands behind the karinderya counter.
  - Plant-waterer.
  - Cat.
  NPCs are placed from the catalog. Canned lines only.
- **Karinderya zone object pack:** counter, turo-turo trays, plastic stools, electric fan.
- **Limit hit** (status `limited`, or the subscription guard trips):
  - Agents' brains route to karinderya seats.
  - Running sessions pause through the existing guard path.
  - When the limit resets, agents walk back and resume.
  - Paused-at-karinderya state is stored so it survives a restart.
- **Chismis:** `public/chismis-tl.js` holds 100+ canned Tagalog lines plus reply pairs, so two agents seated together have short exchanges. It uses `CHATTER` (`office-world.js:139`).

---

## Phase 7: Party server (multiplayer)
**New package `party/`** (Node, `ws`):
- `party/server.mjs` handles rooms, presence and relay. The server is authoritative for the lounge and games.
- `party/Dockerfile` and `party/compose.yml` set up `party` plus an optional `cloudflared` service that prints the quick-tunnel URL.
- `PARTY_PORT` (default 4790) is for plain IP:port hosting.

**Join flow:**
- The host runs `docker compose up`, and the server prints `link + invite code`.
- The app's **Party** window takes the link and code and returns a session token. Guests use the same window.

**Privacy boundary, enforced on the client before anything leaves the machine.** A new `party-feed.mjs` publishes only:
- the layout, wardrobe, and avatar position;
- per-agent `{id, displayName, look, state}`, where `state` is one of `working|idle|blocked|limited|eating`;
- a **generic bubble** from a fixed vocabulary (`"Coding…"`, `"Researching…"`, `"Running a command"`, `"Writing a report"`, `"On break"`).

It never sends task text, prompts, tool input, file paths or report contents. The server also validates against a strict schema and drops unknown fields. Tests check both sides.

**World:**
- A shared **Lounge** map (template), and each member's office as a separate room you can walk into (view only).
- Presence bubble: Available / Busy / Working / Away.
- Text chat in the lounge (not in offices), rate-limited.

**Security:**
- Invite code plus a token per member. The host can kick or ban.
- Message size and rate limits; no file transfer.
- IP:port mode warns that it exposes the host IP.

## Phase 8: Mini games (server-side in `party/games/`)
- **Agent leaderboard:** weekly goals done, reports filed, and tokens saved (counts only, from each app's feed). Badges.
- **Typing race:** at the arcade machine. Up to 8 players; server-timed.
- **Trivia:** host starts rounds on the lounge screen from canned JSON packs (general, tech, Filipino culture). No tokens.
- **Lounge games:** ping-pong table (2p, server-tick physics), darts, and an office race (checkpoint lap).

---

## Verification (each phase)
- `npm test`, with new test files added to the `package.json` list.
- `start.ps1`, then open `http://127.0.0.1:4777`:
  - **Phase 1:** visually identical to 1.2.9.
  - **Phase 2:** build, save, reload, layout persists, unreachable layout is rejected.
  - **Phase 3:** place a QA desk, give Tiro a QA task, and the QA specialist is hired at that desk.
  - **Phase 4:** walk with keyboard, mouse and touch (DevTools device mode), then nudge Boost and see the override on the hire.
  - **Phase 6:** force the `limited` status, check agents walk to the karinderya and the session pauses, then clear it and check they resume.
- **Phases 7–8:** `docker compose up` in `party/`. Two app instances (second one with a separate home dir pointing at a temp dir) join with the invite. Check:
  - each sees the other's office and avatar;
  - wire capture (`ws` frame log) shows no task or prompt text;
  - a typing race completes;
  - the tunnel link works from a phone.
- **Release:** the existing `release.yml` tag flow per phase. Keep the `cwd = process.resourcesPath` packaged fix from 1.2.8.
