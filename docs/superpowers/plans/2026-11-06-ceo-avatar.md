# CEO Avatar and Nudge (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user walks a CEO character around the office.
- **Controls:** WASD or arrow keys, click or tap to walk, and an on-screen joystick on touch devices.
- **Near Tiro:** a radial menu opens with **Chat / Prioritize / Boost / Speed**.
- **Near a specialist:** the user sees what that specialist is working on.
- **Boost and Speed:** these change the model and effort used for a goal's next hires. Boost is checked against the breaker and the subscription guard.

**Architecture:**
- **Player logic:** pure movement in a new classic script, `public/world-player.js` (`WorldPlayer`). It uses free movement with axis-separated grid collision, follows A* paths for click-to-walk, and finds the nearest interactable.
- **Canvas** (`office-world.js`): draws the CEO as a person item, feeds keyboard and pointer input outside Build mode, and reports `onFollow` and `onNear` to the page.
- **Server:** goals gain `priority` and `pace`. The PreToolUse hire hook applies a goal's pace to the Agent call (`updatedInput.model`/`effort`). The SDK's `AgentInput` supports per-call `model` and `effort`, and the espresso switch already sets them this way.
- **Page:** owns the camera follow, the radial menu, the confirm dialogs and the joystick.

**Tech Stack:** classic browser scripts, the dc-runtime page, Node ESM server, Agent SDK 0.3.301 hooks, `node:test` + vm.

**Spec:** `docs/superpowers/specs/2026-11-05-world-roadmap-design.md` (Phase 4 section)

## Global Constraints
- **Branch `feature/world`**, worktree `AgentOfficeWork/world`. Phases 1–3 are complete.
- **Classic-script pattern in `public/`.** New `*.test.mjs` files go in the `npm test` list. The golden fixtures (`fixtures/office-golden.json`, `fixtures/office-bake-golden.json`) stay green and are never edited.
- **The CEO is never drawn in the golden recording path.** It is added only by `office-world.js` at runtime.
- **Hiring safety is unchanged:**
  - `hireGate` approval and prompt hash;
  - breaker switches;
  - subscription guard;
  - Security Guard;
  - `MAX_SPECIALISTS = 8`;
  - roster/session key checks.
- **Pace never forces a hire through a breaker.**
  - **Boost** (`opus`, effort `high`) is applied only if `sw().hiring && !(sw().guard && overLimit())` and the Opus model window is under 100%. Otherwise the hire proceeds with its own model, and Tiro and the user are told "Boost skipped: <reason>".
  - **Speed** is `haiku`, effort `low`.
- **New spending-relevant routes** go in `DECISIONS` (cookie + `x-nonce`).
- **Player controls run only outside Build mode.** They are ignored while focus is in an input, textarea or select, or while an aria-modal dialog is open.
- **Live checks:**
  - Use a temp `HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` and `AGENT_OFFICE_PORT=4790`.
  - Never touch `:4777` or the user's real vault, and never launch `desktop/main.mjs`.
  - Stop only the PIDs you started.
- **Baseline flaky tests:**
  - 20 s server-start timeouts under parallel load (security, hardening, guard-wiring, bridge-register). These pass when run alone.
  - The B1 real-git test.
  - The world-path and world-edit timing tests.
- **Commits end with:**
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_01PNVRsGXe7KFHBeKupfZcRQ`

## Review Focus
1. **Walking into furniture, glass or water:** the CEO slides along the edge and never ends up inside a blocked cell. Covered in Task 1.
2. **Typing in the chat box with WASD or the arrow keys** must not move the CEO. Covered in Task 3.
3. **Boost while over the plan limit or with the hiring switch off:** no Opus is used, and the user sees why. Covered in Task 2.
4. **A goal finished or dismissed while it is boosted:** its pace stops applying, and nothing leaks into other goals' hires. Covered in Task 2.
5. **Touch:** dragging the joystick moves the CEO. A one-finger tap on the floor walks there, and a two-finger gesture still pans or zooms the camera. Covered in Task 4.

---

### Task 1: Player core (`public/world-player.js`)

**Files:**
- Create: `public/world-player.js`
- Create: `world-player.test.mjs`
- Modify: `public/office-motion.js` (export `grid: () => GRID` in the api at about :442)
- Modify: `world-vm.mjs` (`ORDER`: add `world-player.js` after `world-edit.js`)
- Modify: `package.json` (test list)
- Modify: `server.mjs` (STATIC entry)
- Modify: `public/Agent Office.html` (script tag after `world-edit.js`)

**Interfaces:**
- **`root.WorldPlayer`:**
  - `create(x, y) → P`, where `P = {x, y, face, moving, path: [], pi: 0}`.
  - `SPEED = 170` (world units per second).
  - `REACH = 45` (interaction radius in world units).
  - `step(p, dt, input, grid) → P`, mutating `p`. `input` is `{dx, dy}`, each in −1..1, in screen direction.
    - The screen vector is mapped to iso ground: screen right = `(+x, −y)`, screen down = `(+x, +y)`, normalized.
    - Movement is axis-separated. Each axis moves only if the target point's cell is not `grid.blocked`, and the cell is checked with `WorldPath.cellOf`.
    - Points are clamped inside `[5, size − 5]`.
    - Keyboard or joystick input cancels any click path.
    - With no input, the player follows `path` at `SPEED`. There is no time budget and no fade-teleport.
    - `face` comes from the movement direction via `OfficeMotion.faceOf`.
  - `walkTo(p, target, pathTo) → bool` sets `p.path` from `pathTo({x,y}, target)`. It returns false when the path is a straight-line fallback that crosses blocked cells, which means unreachable.
  - `nearest(p, candidates) → {kind, id, d} | null`. `candidates` is `[{kind: 'tiro'|'agent'|'desk', id, x, y}]`; it returns the closest within `REACH`.
  - `unstick(p, grid) → P`: if `p` is in a blocked cell, it moves `p` to the nearest free cell centre by BFS over cells. This is used after a layout change.

- [ ] **Step 1: Write the failing tests** (load with `loadWorld()`, which now includes `world-player.js`):
  - `screen-right moves along +x −y`.
  - `cannot enter a desk`: hold right into a desk rect for 2 s. The final cell is not blocked, and the player slid along the edge (the other axis changed).
  - `never enters water`: the garden pond.
  - `click path reaches a far spot without teleport`: `walkTo` desk-1 → garden:b2, stepping at 1/60 s. It arrives, the maximum per-step jump is under 4, and it takes about the path length divided by `SPEED`.
  - `unreachable target returns false`.
  - `nearest picks Tiro within REACH and nothing beyond`.
  - `unstick moves out of a blocked cell`.
- [ ] **Step 2: Run** `node --test world-player.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test world-player.test.mjs office-motion.test.mjs world-parity.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(ceo): player movement with grid collision and click-to-walk`.

### Task 2: Goal priority and pace on the server

**Files:**
- Modify: `company.mjs` (`goalStore.update` at :32-37 so it accepts `priority` and `pace`; `list_goals` output includes them)
- Modify: `server.mjs`:
  - `/api/goal` near :658;
  - new routes;
  - `DECISIONS` at :62;
  - `hireHook` at :412-429;
  - `tellBoss` notes.
- Create: `goal-pace.test.mjs`
- Modify: `package.json`

**Interfaces:**
- **Goal fields:**
  - `priority: 'high'|'normal'`, default `normal`.
  - `pace: 'boost'|'speed'|null`.
  - Both are cleared when the goal becomes `done` or `dismissed`.
- **Routes** (both in `DECISIONS`):
  - **`POST /api/goal/priority` `{id, priority}`** saves the field. It then calls `tellBoss("The user marked goal <id> as high priority: work on it first.")`, or `"...back to normal priority."` for normal. The call goes through the existing `tellBoss`, so breakers apply.
  - **`POST /api/goal/pace` `{id, pace}`:**
    - `pace` is `'boost'`, `'speed'` or `null`.
    - The goal must be open (`todo`, `doing` or `blocked`); otherwise 409.
    - On success it returns `{ok, pace, warning?}`. `warning` explains when Boost is not possible right now (for example "Over the weekly limit: Boost will apply when limits reset").
    - It tells Tiro: "The user set goal <id> to <Boost: strongest model | Speed: fastest model> for its next hires."
- **`paceFor(goal, sw, limits, overLimit) → {model, effort} | {skip: reason} | null`**, a pure function in `company.mjs`:
  - `boost` gives `{model: 'opus', effort: 'high'}` only when `sw.hiring`, `!(sw.guard && overLimit)`, and no `limits.models` entry whose name matches `/opus/i` has `pct ≥ 100`. Otherwise it gives `{skip}`.
  - `speed` gives `{model: 'haiku', effort: 'low'}`.
  - `null` gives `null`.
- **`hireHook`:** after the existing checks pass and the grant is consumed, look up the grant's `goalId` goal and compute `paceFor`.
  - If it gives a `model`, return `updatedInput: {...input.tool_input, model, effort}`. This combines correctly with the espresso rewrite: the pace wins when it is set.
  - If it gives `skip`, append a one-line note to Tiro's next turn (the existing note mechanism) and do nothing else.
- **`snapshot().goals`** includes `priority` and `pace`.

- [ ] **Step 1: Write the failing tests:**
  - `paceFor boost ok`.
  - `paceFor boost skipped when hiring off / over limit with guard on / opus window ≥100`.
  - `paceFor speed`.
  - `done clears pace and priority`.
  - `pace route rejects a done goal with 409` (call the route handler through the same pattern `roster-live.test.mjs` uses, or a pure helper).
  - `hireHook applies pace to updatedInput for that goal only`: two goals, only the boosted one's hire gets `opus`.
  - `HTTP: /api/goal/pace without nonce → 403` (in `hardening.test.mjs`, run alone).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test goal-pace.test.mjs company.test.mjs roster-live.test.mjs`, then `hardening.test.mjs` on its own. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(ceo): goal priority and Boost/Speed pace applied at hire time`.

### Task 3: CEO on the canvas

**Files:**
- Modify: `public/office-world.js`:
  - render people at :275;
  - `syncWalkers` at :97-116;
  - `isMoving` at :313;
  - `onClick` at :372;
  - `mount` at :575-587;
  - the API at :605-627.
- Modify: `public/office-sprites.js` (a `ceo` look: dark suit, tie and a small crown pin)
- Test: `world-player.test.mjs` (pure helpers only)

**Interfaces:**
- **The CEO** is a person item `{d: x+y+3, x, y, a: CEO_AGENT, w: player}` with `CEO_AGENT = {id: 'ceo', name: 'You', look: 'ceo'}`. It spawns at `M.SPAWN`. After `applyLayout` it is `unstick`'d. It is hidden in Build mode and in demo mode.
- **Keyboard:** WASD and the arrow keys are tracked on `document` keydown and keyup, outside Build mode. Keys are ignored when focus is in INPUT, TEXTAREA, SELECT or a contentEditable element, or when an aria-modal dialog is open. The `+`, `-`, `0`, `Escape` and `y`/`n` keys are left alone.
  - `E` or `Enter` interacts with the nearest thing (Enter only when focus is on the body).
- **Click or tap on empty ground** outside Build mode (after `pick()` returns nothing) does `walkTo` the ground point. An unreachable target gets a toast through `opts.onToast`: "Can't walk there".
- **Each frame:**
  - `WorldPlayer.step` runs with the input vector (keys plus the joystick vector set by `setJoystick(dx, dy)`).
  - `opts.onFollow(stageX, stageY)` is called while the player moves.
  - `opts.onNear(target | null)` is called when the nearest interactable changes. Candidates are Tiro's walker, every agent walker, and every desk seat that has an agent.
  - A floating "E" prompt is drawn above the nearest target, or "Tap" on coarse pointers.
- **API:** `setJoystick(dx, dy)`, `interact()` (same as pressing E), `ceo()` returning `{x, y}` for tests and the page, and `setCeoVisible(bool)`.

- [ ] **Step 1: Write the failing test** `ceo candidates include Tiro and seated agents` using a pure helper `candidatesFrom(walkers, desks)` exported for tests.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: nothing new fails, and the golden tests stay green.
- [ ] **Step 5: Commit.** `feat(ceo): you walk the office as the CEO`.

### Task 4: Page: camera follow, radial menu, desk card, joystick

**Files:**
- Modify: `public/Agent Office.html` (`mountWorld` hooks at about :476, `setView` :509, `camEvents` :511-524, dialogs `askUser` :693, goals `act` :636, toasts)

**Interfaces:**
- **Camera follow:**
  - **When zoomed in** (z > 1): `onFollow` re-centres the view so the CEO stays inside the middle 60% of the screen. Use `origin()` (:512) for the stage-to-screen maths and `clampView`.
  - **At z = 1** the camera does not move.
  - A "Follow me" toggle in the bottom control row is on by default and remembered in `localStorage` (wrapped in try/catch).
- **Radial menu near Tiro** (opened with E, a tap, or by clicking the "E" prompt; anchored at `OfficeWorld.pointOf(tiroId)`). It has four buttons:
  - **Chat** opens Tiro's chat (`setState({selectedId: bossId})`).
  - **Prioritize** opens a goal picker of open goals. Picking one toggles high or normal priority via `/api/goal/priority`. High-priority goals get a ★ badge on the Today board.
  - **Boost** opens the goal picker, then `askUser("Boost <goal>? Tiro will hire on the strongest model (Opus, high effort) for this goal — it uses your plan faster.", [['Boost', fn, true], ['Cancel']])`, then `/api/goal/pace`. The returned `warning` is shown as a toast. A goal that is already boosted shows "Stop boost".
  - **Speed** works the same way with "fastest model (Haiku)". No cost confirm is needed.
  - Goals with a pace show a ⚡ (boost) or ⏩ (speed) badge on the board.
- **Desk card near a specialist:** a small card anchored at the agent shows the name, role, status and current task (`a.task`, trimmed to 140 characters), plus a "Chat" button.
- **Joystick:** on `matchMedia('(pointer: coarse)')` devices, a 96 px virtual stick sits in the bottom-left. Dragging it calls `OfficeWorld.setJoystick`, and it uses pointer capture and `touch-action: none`. Single-finger taps on the canvas still walk, and a two-finger drag still pans the camera (`camEvents`).
- **Escape** closes the radial menu or the card. Only one of the two is open at a time.

- [ ] **Step 1: Extend the headless driver.** It lives outside the repo, in `scratchpad\build-driver\` (`ceo.cjs`), and uses a temp HOME and port 4790. It must:
  1. hold D for 1 s and check the CEO moved;
  2. click a floor point and check the CEO arrives;
  3. walk to Tiro and check the prompt shows;
  4. press E and check the radial menu has 4 buttons;
  5. Prioritize a goal created via `/api/task`, and check the ★ badge and the server goal's `priority: high`;
  6. Boost the goal, confirm the dialog, and check its pace is `boost`;
  7. type "wasd" in the chat box and check the CEO did not move;
  8. emulate touch, drag the joystick, and check the CEO moved;
  9. take screenshots `ceo-*.png`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run the driver and `npm test`.** Expected: all driver steps pass, and nothing new fails.
- [ ] **Step 4: Commit.** `feat(ceo): follow camera, Tiro radial menu, desk card, touch joystick`.

---

## Out of scope
- **Costumes:** the CEO uses one fixed look until Phase 5.
- **Multiplayer avatars:** Phase 7.
