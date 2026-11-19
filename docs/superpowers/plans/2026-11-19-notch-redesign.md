# Notch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the notch as a wide glass notch fixed to the top centre of the desktop, with icon tabs, a Home page of cards, new everyday tools (calendar link, timers, notes, trackers) and a game mode showing load and frame rate.

**Architecture:** The notch stays one always-on-top Electron window showing one local page. The window is created in one of two forms (system *material* glass, or *transparent* for CSS glass / solid) and always equals the notch's visible rectangle; it jumps between a closed and an open rectangle and the content animates inside. The main process owns hover/open decisions, the calendar fetch, the notes/timers/trackers store, game detection and the performance pollers; the page renders tabs and cards from pushed state. Pure logic lives in Node-testable modules.

**Tech Stack:** Electron 43.8.7, Node 24 ESM (`desktop/*.mjs`), one HTML page with classic scripts (`public/`), resident PowerShell helpers on Windows, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-notch-redesign-design.md` (read it first, including "Decisions added after the builder check"). Research with file:line for today's island: `docs/superpowers/specs/2026-11-19-notch-research.md`, Part 1.

## Global Constraints

- No new npm dependency. No paid service, account or API key.
- Everything the island does today keeps working: approvals (all decision types; Y/N act only on the focused card), hires, now playing and lyrics, sessions, goals, chat, visibility modes Always/Smart, multi-monitor, notch on/off, shortcut, themes, updates and Guard settings.
- An approval or hire request still opens the notch by itself.
- The notch never steals focus (`showInactive`) and its window is exactly its visible rectangle.
- IPC stays a fixed, sender-checked surface (`fromIsland(e)` on every handler); the page gets no Node access; the preload exposes named functions only.
- Reduced motion or Power saver: no animation.
- No per-frame window resizing: grow = resize first, then animate content; shrink = animate, then resize.
- Pollers and child processes run only while the notch is on and visible; all are stopped by `destroyIsland`.
- The calendar link is a secret: stored encrypted in its own file, never logged, never in a page snapshot, fetched over https only (up to 3 https redirects, 2 MB, 10 s).
- No code from GPL projects. PresentMon (MIT) may be vendored with its licence file and recorded SHA-256; the app never downloads executables.
- New test files are added to the `test` script in `package.json` (it lists every file).
- Any test or check that launches Electron uses `--mute-audio`, temp `USERPROFILE`/`APPDATA`, a non-default port, and must not register the global shortcut or tray. Never touch `~/.claude/agent-office` or the installed app.
- Commits use the configured author. No push, tag, installer build or publish.
- Existing `kiro.json` settings load unchanged; new settings get defaults.

## Review Focus

1. A second monitor with a different scale, or the display being unplugged while the notch is open: the notch lands on a valid display at the right size, never off-screen. (Tasks 1, 2)
2. The calendar link returns a login page, a 404, a 10 MB body, or times out: the Calendar tab shows a plain error, keeps the last good events, and the link never appears in a log or error text. (Task 6)
3. A timer set before the PC sleeps or the app restarts: on wake/start it shows the right remaining time or fires once as finished, not twice. (Task 5)
4. An approval arrives while a game is in front, or while the user is typing a note: the notch shows it (count in game mode; opens otherwise) and Y/N typed into the note field never answers it. (Tasks 3, 8)
5. `notes.json` / the store file is corrupt or hand-edited with huge values: the notch starts with defaults for the bad parts and does not crash or grow without bound. (Task 5)

## File Structure

| File | Responsibility |
|---|---|
| `desktop/notch-window.mjs` (create) | pure: which window form, its BrowserWindow options, closed/open rectangles for a display |
| `desktop/notch-hover.mjs` (create) | pure: open/close decision from cursor, pin, forced-open, delays |
| `desktop/island-logic.mjs` (modify) | settings additions (`look`, `gameMode`, `homeCards`, `pomodoro`), kept helpers |
| `desktop/notch-store.mjs` (create) | notes / timers / counters file: read, validate, write |
| `desktop/ics.mjs` (create) | pure ICS parsing and expansion |
| `desktop/calendar-link.mjs` (create) | link validation, encrypted storage, capped fetch, refresh loop |
| `desktop/game-detect.mjs` (create) | pure game decision + line parsers for the helper |
| `desktop/perf.ps1`, `desktop/perf-monitor.mjs` (create) | resident Windows helper (foreground window, counters, nvidia-smi) and its supervisor |
| `desktop/presentmon.mjs`, `vendor/presentmon/` (create) | PresentMon child process, CSV parsing, FPS stats |
| `desktop/main.mjs`, `desktop/island-preload.cjs` (modify) | wiring only |
| `public/notch-core.js` (create) | pure page logic (UMD-style): tabs, closed line, home cards, timers, gauges |
| `public/island.html` (rewrite), `public/notch-*.js` (create as needed) | the page |
| `perf/notch-glass-check.cjs`, `perf/notch-check.cjs` (create) | glass proof; live check |

---

### Task 1: Window forms and the glass proof

**Files:** Create `desktop/notch-window.mjs`, `notch-window.test.mjs`, `perf/notch-glass-check.cjs`. Modify `desktop/island-logic.mjs` (setting `look`), `island.test.mjs`.

**Interfaces — Produces:**
- `DEFAULT_SETTINGS.look = 'glass'`; `normalizeSettings` accepts `'glass' | 'solid'`.
- `windowForm({ platform, release, look, materialOk }) -> 'material' | 'transparent'` — `'material'` only when `look === 'glass'`, `materialOk !== false`, and (`platform === 'darwin'`, or `platform === 'win32'` with build number ≥ 22621 parsed from `release`).
- `windowOptions(form, platform) -> object` — common: `frame:false, resizable:false, movable:false, skipTaskbar:true, alwaysOnTop:true, hasShadow:false, focusable:true, show:false`; transparent form adds `transparent:true`; material form adds `transparent:false` and `backgroundMaterial:'acrylic'` (win32) or `vibrancy:'hud', visualEffectState:'active'` (darwin). Confirm each option name against `node_modules/electron/electron.d.ts` before writing it.
- `SIZES = { closed: { w: 180, h: 32 }, line: { w: 400, h: 36 }, game: { w: 360, h: 36 }, open: { w: 1100, h: 370 } }`.
- `rectFor(displayBounds, state, { overhang = 0 } = {}) -> { x, y, width, height }` — centred on the display's top edge; `open` width is `min(1100, displayBounds.width - 80)`; `y = displayBounds.y - overhang`, height grows by `overhang` (material form uses an overhang so the OS-rounded top corners sit off-screen).

- [ ] **Step 1: Failing tests** `notch-window.test.mjs`:

```js
test('windowForm: material only for glass on Windows 11 22H2+ or macOS', () => {
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'glass' }), 'material');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.19045', look: 'glass' }), 'transparent');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'solid' }), 'transparent');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'glass', materialOk: false }), 'transparent');
  assert.equal(windowForm({ platform: 'darwin', release: '24.0.0', look: 'glass' }), 'material');
  assert.equal(windowForm({ platform: 'linux', release: '6.8', look: 'glass' }), 'transparent');
});
test('rectFor: centred on the top edge, open never wider than the display minus 80', () => {
  const d = { x: 1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(rectFor(d, 'closed'), { x: 1920 + 870, y: 0, width: 180, height: 32 });
  assert.deepEqual(rectFor(d, 'open'), { x: 1920 + 410, y: 0, width: 1100, height: 370 });
  assert.equal(rectFor({ x: 0, y: 0, width: 1024, height: 768 }, 'open').width, 944);
  assert.deepEqual(rectFor(d, 'closed', { overhang: 12 }), { x: 1920 + 870, y: -12, width: 180, height: 44 });
});
test('windowOptions: forms differ only in transparency and material', () => { /* transparent form has transparent:true and no backgroundMaterial; material form on win32 has transparent:false and backgroundMaterial 'acrylic'; both frame:false, show:false, resizable:false */ });
```
Add an `island.test.mjs` row: `normalizeSettings({ look: 'neon' }).look === 'glass'`, `'solid'` kept.

- [ ] **Step 2:** `node --test notch-window.test.mjs island.test.mjs` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; add `notch-window.test.mjs` to the `test` script.
- [ ] **Step 5: Glass proof.** Write `perf/notch-glass-check.cjs` (model the launch on `perf/hud-check.cjs`; no app server needed, load a `data:` page with white text on a transparent body). It creates the material-form window on the primary display, shown with `showInactive`, and for each of 20 cycles sets bounds closed → open → closed 600 ms apart, then holds open for 60 s while another window is focused (open and focus a small ordinary BrowserWindow elsewhere). After each state change and at 5 s, 30 s and 60 s it captures the real screen region of the notch rectangle plus 40 px around it (use `desktopCapturer` screen capture cropped to that rectangle, saved as PNG into the scratch folder passed as argv; capture nothing outside that region) and records: mean colour inside vs. just outside the rectangle, whether any capture is uniformly white or black inside, whether the pixels at the top-left/top-right corners of the rectangle are square. It prints a result table and exits 0 only if: blur present (inside differs from an unblurred capture of the same region taken with the window hidden, and is not a flat colour) at all three hold times; no all-white/all-black frame; top corners square. Run it. Read at least four of the PNGs yourself and describe them.
- [ ] **Step 6:** Report the table and your reading of the captures. Do not change the design based on the result; the controller decides (spec decision 3).
- [ ] **Step 7:** Commit `Notch: window forms, sizes and the glass proof`.

### Task 2: Hover logic and the two-form window in main

**Files:** Create `desktop/notch-hover.mjs`, `notch-hover.test.mjs`. Modify `desktop/main.mjs` (island section: `showIsland`, `placeIsland`, `destroyIsland`, `cursorLoop`, `island:interactive`), `desktop/island-preload.cjs`, `notch.test.mjs`.

**Interfaces — Consumes:** Task 1 exports. The controller's ruling on glass (carried in the dispatch) sets `materialOk`.
**Produces:**
- `hoverStep(state, input) -> state` where `state = { open: boolean, enterAt: number|null, leaveAt: number|null }` and `input = { now, cursor: {x,y}|null, closedRect, openRect, edgeDelay, leaveDelay, pinned: boolean, forced: boolean }`. Open when `pinned || forced`; else open once the cursor has rested inside `closedRect` for `edgeDelay` ms; once open, stays open while the cursor is inside `openRect`, and closes `leaveDelay` ms after it leaves.
- Main keeps `isle.view = 'closed' | 'line' | 'game' | 'open'` and sends it in `island:state` as `view`. The page reports what the closed view should be with a new preload call `islandDesk.closedView(kind)` (`'closed' | 'line' | 'game'`), and pin/forced with `islandDesk.hold({ pinned, forced })`. `island:interactive` is removed (the window is never click-through); its handler and preload entry go.
- Window ordering on change: to a larger rect → `setBounds` then send `view`; to a smaller rect → send `view`, wait 220 ms (0 under reduced motion / power saver), then `setBounds`.
- Changing `look`, or `materialOk` turning false, destroys and recreates the window through the existing `notchStep` effects.
- Smart mode keeps its hide/peek behaviour using the same cursor loop.

- [ ] **Step 1: Failing tests** `notch-hover.test.mjs`: rests 0 ms with `edgeDelay: 0` → opens; `edgeDelay: 500` → not open at 499, open at 500; leaving `closedRect` before the delay resets `enterAt`; open + cursor inside `openRect` but outside `closedRect` → stays open; leaves `openRect` → still open at `leaveDelay - 1`, closed at `leaveDelay`; re-entering during the leave delay cancels it; `pinned` or `forced` keeps it open with `cursor: null`; `forced` turning false with the cursor away closes after `leaveDelay`. `notch.test.mjs`: main no longer contains `setIgnoreMouseEvents`; every `ipcMain.on('island:` handler still checks `fromIsland`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep `placeIsland`'s double `setBounds` for mixed-DPI displays. On `display-removed`/`display-metrics-changed` recompute rects for the current view.
- [ ] **Step 4:** `node --test notch-hover.test.mjs notch.test.mjs island.test.mjs notch-window.test.mjs` → PASS; add the new file to the `test` script; `npm test` → all pass.
- [ ] **Step 5:** Commit `Notch: main-process hover, view sizes and window forms`.

### Task 3: Page core and the new shell

**Files:** Create `public/notch-core.js`, `notch-core.test.mjs`. Rewrite `public/island.html` (split scripts into `public/notch-*.js` if a file would pass about 400 lines; add each to the server's `STATIC` list the way `/meet-room.js` is, and to `town-static.test.mjs` if island files are listed there). Modify `desktop/island-logic.mjs` (`homeCards` setting), `island.test.mjs`.

**Interfaces — Consumes:** `island:state.view`, `islandDesk.closedView`, `islandDesk.hold`.
**Produces** (`root.NotchCore`, loaded in Node tests the way `meet-voice.test.mjs` loads its script):
- `TABS = ['home','approvals','agents','calendar','timer','notes','music','trackers','performance']`.
- `CARDS = ['approvals','agents','calendar','timer','notes','music','trackers','performance']`; `DEFAULT_SETTINGS.homeCards = ['approvals','agents','calendar','timer','notes']` (order = display order; absent = hidden); `normalizeSettings` keeps known ids, de-duplicated, max 8.
- `closedView({ asks, hires, game, nextEvent, timer, np, now }) -> { kind: 'closed'|'line'|'game', left: string, right: string }` — `game` truthy → kind `'game'`; else `'line'` when there is an event starting within 15 minutes, a running timer, a song, or anything waiting; `right` is `'<n> approvals'` (singular `'1 approval'`) when `asks + hires > 0`; `left` priority: event (`'<title> in <n> min'`), timer (`'<name> <mm:ss>'`), song (`'<title> · <artist>'`), else `''`.
- `forcedOpen({ asks, hires, chatOn, game }) -> boolean` — true when anything is waiting or chat is open, except in game mode, where only the count shows.
- Page: tab row with the nine tabs (inline stroke SVG icons, `role="tablist"`, arrow-key navigation), date/time, pin and settings buttons; Home renders the `homeCards` in order; Approvals/Agents/Music tabs and cards carry over today's markup and handlers unchanged in behaviour (`/api/decide`, `/api/hire/decide`, chat, dock, now playing, lyrics); Calendar tab shows today's month grid and second clock; Timer, Notes, Trackers, Performance tabs render an empty-state line until their tasks land; today's Settings content opens from the settings button and gains Look (Glass/Solid) and Home cards (reorder/hide). Transparent form draws its own background (CSS glass or solid by `look`) and rounded bottom corners; material form draws no background. Y/N are ignored while focus is in an `input`, `textarea` or `[contenteditable]`.

- [ ] **Step 1: Failing tests** `notch-core.test.mjs`: `closedView` table (nothing → `closed`; event in 12 min → `line`, left `'Stand-up in 12 min'`; event in 16 min → not shown; timer beats song; `asks: 2` → right `'2 approvals'`, `asks: 1` → `'1 approval'`; game → kind `'game'` and right still set); `forcedOpen` table (ask → true; ask + game → false; chat → true). `island.test.mjs`: `normalizeSettings({ homeCards: ['notes','bogus','notes','timer'] }).homeCards` deep-equals `['notes','timer']`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the core, then the page.
- [ ] **Step 4:** `node --test notch-core.test.mjs island.test.mjs notch.test.mjs nowplaying.test.mjs lyrics.test.mjs` → PASS; add the file to the `test` script; `npm test` → all pass.
- [ ] **Step 5:** Run the app with a temp profile (see Global Constraints) and check by eye and by `capturePage`: closed, line, open on Home, each tab, an approval answered with the button and with Y on a focused card, settings changes persisting. Report what you saw.
- [ ] **Step 6:** Commit `Notch: wide notch with tabs and a Home page of cards`.

### Task 4: Store for notes, timers and counters

**Files:** Create `desktop/notch-store.mjs`, `notch-store.test.mjs`. Modify `desktop/main.mjs`, `desktop/island-preload.cjs`.

**Interfaces — Produces:**
- File `notch-store.json` in the app config dir (the dir that holds `kiro.json`).
- `normalizeStore(raw) -> { notes: [{ id, text }], timers: [{ id, name, kind: 'countdown'|'stopwatch'|'pomodoro', endsAt: number|null, startedAt: number|null, pausedLeft: number|null, round: number, phase: 'focus'|'break' }], counters: [{ id, name, goal, count, day: 'YYYY-MM-DD' }], pomodoro: { focus: 25, rest: 5, rounds: 4 } }` — caps: 100 notes of ≤ 500 chars, 10 timers with names ≤ 40 chars, 12 counters with `goal` 1–999; ids match `/^[a-z0-9]{6,12}$/`; anything else dropped.
- `readStore(dir) -> store` (corrupt or missing → `normalizeStore({})`), `writeStore(dir, store)` (atomic: write temp then rename).
- IPC: `notch:store:get` (invoke) → store; `notch:store:set` (invoke, whole store) → normalized store; both `fromIsland`-checked. Preload: `islandDesk.store.get()`, `islandDesk.store.set(store)`.

- [ ] **Step 1: Failing tests:** round-trip through a temp dir; a file containing `{"notes": "x", "timers": [{"id":"../x"}], "counters":[{"id":"abc123","name":"Water","goal":5000,"count":2,"day":"2026-11-19"}]}` normalizes to empty notes, no timers, and no counter (goal out of range); 150 notes → 100; a 600-char note is cut to 500; a truncated JSON file reads as defaults.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Tests PASS; add to the `test` script.
- [ ] **Step 5:** Commit `Notch: store for notes, timers and counters`.

### Task 5: Notes and Timer tabs

**Files:** Modify `public/notch-core.js`, `notch-core.test.mjs`, the page.

**Interfaces — Consumes:** `islandDesk.store`. **Produces** in `NotchCore`:
- `timerView(t, now) -> { left: number, done: boolean, label: 'mm:ss' | 'h:mm:ss' }` — countdown/pomodoro: `left = max(0, endsAt - now)` when running, `pausedLeft` when paused; stopwatch: elapsed.
- `pomodoroNext(t, cfg, now) -> t` — focus → break → focus…, `round` increments after each break, stops after `cfg.rounds` focus phases.
- `dueTimers(timers, lastChecked, now) -> ids` — timers whose `endsAt` is in `(lastChecked, now]`; each id fires exactly once however long the gap.
- Notes tab: add, edit in place, delete, move up/down. Timer tab: new countdown (minutes + name), stopwatch, Pomodoro start; pause/resume/delete. A finished timer chimes once (respects mute) and shows in the closed line; Home cards for both.

- [ ] **Step 1: Failing tests:** `timerView` running/paused/finished and the `h:mm:ss` switch at 3600 s; `pomodoroNext` through a full 4-round cycle with `{focus:25,rest:5,rounds:4}` ending stopped; `dueTimers` with a 3-hour gap (sleep) returns the id once and not again on the next call with the new `lastChecked`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `node --test notch-core.test.mjs` PASS; `npm test` passes.
- [ ] **Step 5:** Commit `Notch: notes and timers`.

### Task 6: Calendar link

**Files:** Create `desktop/ics.mjs`, `ics.test.mjs`, `desktop/calendar-link.mjs`, `calendar-link.test.mjs`, `fixtures/calendar.ics`. Modify `desktop/main.mjs`, `desktop/island-preload.cjs`, the page.

**Interfaces — Produces:**
- `parseIcs(text) -> [{ uid, title, start: Date, end: Date, allDay: boolean, where: string, text: string, rrule: object|null, exdates: Date[] }]` — handles line folding, `TZID=` with `Intl` zones, UTC `Z`, floating times as local, `DTSTART;VALUE=DATE`.
- `occurrences(events, from: Date, to: Date) -> [{ title, start, end, allDay, where, join: string|null }]` sorted by start — expands `RRULE` `FREQ=DAILY|WEEKLY|MONTHLY` with `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (weekly), honours `EXDATE`; other rules yield only the first instance.
- `joinLink(text) -> string|null` — first `https://` URL whose host ends with `teams.microsoft.com`, `teams.live.com`, `zoom.us`, `meet.google.com` or `webex.com`.
- `normalizeLink(s) -> string|null` — trims; `webcal://` → `https://`; accepts only `https:` URLs ≤ 2000 chars with a hostname.
- `fetchCalendar(link, { fetchImpl = fetch } = {}) -> { ok: true, text } | { ok: false, error: 'bad-link'|'network'|'http'|'too-big'|'not-calendar'|'timeout' }` — manual redirects, at most 3, https only; 10 s abort; stops reading past 2 MB; `not-calendar` unless the body starts with `BEGIN:VCALENDAR` after whitespace. Error values never contain the link.
- Storage: `calendar-link.bin` in the config dir via the generic `saveKey`/`loadKey`/`removeKey` helpers in `claude-key.mjs` with `safeStorage`; removing the link deletes the file and the cache.
- Main: refresh every 15 minutes while the notch is on, and on link change; pushes `island:calendar` `{ linked: boolean, error: string|null, fetchedAt: number|null, events: [...] }` with occurrences from local midnight today to the end of tomorrow. IPC `calendar:set` (invoke, link or `''`), `fromIsland`-checked. Preload: `islandDesk.calendar.set(link)`, `islandDesk.onCalendar(fn)`. Opening a join link goes through the app's existing external-open path with an https and host check.
- Page: Calendar tab lists today and tomorrow, Join buttons, the month grid; without a link, the paste field with a short explanation; error line with "last updated" time.

- [ ] **Step 1: Failing tests** with `fixtures/calendar.ics` (one single event, one all-day, one weekly `BYDAY=MO,WE,FR` with an `EXDATE`, one `TZID=America/New_York` event with a Teams link in the description): parse counts and fields; `occurrences` over a fixed two-day window returns the expected instances in order and skips the excluded date; `joinLink` picks the Teams URL and ignores `https://example.com`; `normalizeLink` table (`webcal://x.test/a.ics` → `https://x.test/a.ics`; `http://…`, `file:///…`, `'  '` → null); `fetchCalendar` with a fake `fetchImpl`: 302 to `http://` → `bad-link`, four redirects → `network`, 404 → `http`, HTML body → `not-calendar`, 3 MB stream → `too-big`, never-resolving → `timeout` (inject a short timeout option), and `JSON.stringify(result)` never includes the link.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `node --test ics.test.mjs calendar-link.test.mjs` PASS; add both to the `test` script; `npm test` passes.
- [ ] **Step 5:** Commit `Notch: calendar from a private link`.

### Task 7: Trackers

**Files:** Modify `public/notch-core.js`, `notch-core.test.mjs`, the page.

**Interfaces — Consumes:** the snapshot's `usage` and `limits` fields (read `usage.mjs` and where `server.mjs` puts them in the stream snapshot to learn their exact shape; do not change them), `islandDesk.store`.
**Produces:** `gauges({ usage, limits, now }) -> [{ id: 'session'|'weekly'|'costToday'|'costWeek'|'tokensToday', label, value: string, pct: number|null, note: string }]` — a limit that is null or errored gives `value: 'Not available'`, `pct: null` and a `note` with the reason, never 0%. `counterToday(c, day) -> c` resets `count` to 0 when `c.day !== day`. Trackers tab: the gauges, and counters (add with name and daily goal, +1 / −1, delete); a Trackers Home card.

- [ ] **Step 1: Failing tests:** `gauges` with a full fixture; with `limits: null`; with a limits error object; cost week sums the last 7 day buckets; `counterToday` across midnight.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test` passes.
- [ ] **Step 5:** Commit `Notch: trackers`.

### Task 8: Game mode, load and temperature

**Files:** Create `desktop/game-detect.mjs`, `game-detect.test.mjs`, `desktop/perf.ps1`, `desktop/perf-monitor.mjs`. Modify `desktop/island-logic.mjs` (`gameMode`, `games`), `desktop/main.mjs`, `desktop/island-preload.cjs`, the page, `package.json` (ship `perf.ps1` the way `nowplaying.ps1` is shipped).

**Interfaces — Produces:**
- Settings: `gameMode: 'auto' | 'always' | 'never'` (default `'auto'`), `games: string[]` (user-added process names, lower-case `[a-z0-9._-]{1,40}`, max 50).
- `IGNORE` (browsers, video players, the app itself, explorer, `applicationframehost`) and `KNOWN_GAMES` (a short starter list) in `game-detect.mjs`.
- `isGame({ proc, fg: {x,y,w,h}, monitor: {x,y,w,h} }, { games = [] } = {}) -> boolean` — true when `proc` is in `KNOWN_GAMES` or `games`; or when `fg` covers the whole monitor and `proc` is not in `IGNORE`.
- `parsePerfLine(line) -> { proc, pid, fg, monitor, cpu, mem, gpu, gpuTemp } | null` — one JSON line per sample from `perf.ps1`; missing values are `null`, never 0.
- `perf.ps1`: resident, prints one JSON line every 1500 ms: foreground window process name, pid and rectangle, its monitor rectangle, total CPU %, memory in use (GB), GPU utilisation (max over `GPU Engine` 3D counters), and GPU temperature from `nvidia-smi` when it is on PATH. `perf-monitor.mjs` supervises it exactly as `nowplaying.mjs` supervises `nowplaying.ps1` (restart with backoff, stop on demand). Windows only; elsewhere a Node fallback gives CPU and memory from `os`.
- Main: runs the monitor while the notch is on and (`gameMode !== 'never'` or the Performance tab is open); `isle.game` = `gameMode === 'always'`, or `auto` and `isGame`; sends `island:perf` `{ game, proc, cpu, mem, gpu, gpuTemp, fps: null }`; while `isle.game`, Smart mode's fullscreen hide is overridden and the closed view is `'game'`.
- Page: closed game line (`<gpu>% GPU · <temp>°C · <cpu>% CPU`, FPS first when present); Performance tab; settings rows for game mode and the user's game list.

- [ ] **Step 1: Failing tests:** `isGame` table (known game windowed → true; unknown process covering the monitor → true; `chrome` covering the monitor → false; unknown process in a window → false; a user-added name → true); `parsePerfLine` with a full line, a line with `null` GPU values, and garbage; settings validation rows.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Tests PASS; add the file to the `test` script; `npm test` passes.
- [ ] **Step 5:** Run `perf.ps1` by itself for 10 s and paste three sample lines into the report; run the app (temp profile) with `gameMode: 'always'` and confirm the closed game line and the Performance tab show live values.
- [ ] **Step 6:** Commit `Notch: game mode with load and temperature`.

### Task 9: PresentMon spike, then FPS

**Files:** Create `vendor/presentmon/` (executable, `LICENSE`, `SHA256.txt`), `desktop/presentmon.mjs`, `presentmon.test.mjs`. Modify `desktop/main.mjs`, `package.json` (ship the vendor folder as an unpacked resource), `THIRD_PARTY_NOTICES.md`, the page.

- [ ] **Step 1: Spike, with an exit.** Download the standalone console PresentMon 1.x executable from the GameTechDev/PresentMon GitHub releases page; record its SHA-256 and check its Authenticode signature (`Get-AuthenticodeSignature`); report both. Without elevation, run it for 5 s against a 3D window you create (an Electron window drawing WebGL at vsync is enough) with CSV to stdout. Report exactly what happens: frames reported, or the access error. Check whether the current user is in "Performance Log Users" (`whoami /groups`); do NOT add the user to any group and do NOT elevate. **Exit:** if it cannot report frames without elevation and the user is not in the group, stop here and report `BLOCKED: needs the group step` with the evidence; the controller decides whether the owner is asked to do the one-time step. If the signature is invalid or the download cannot be verified, stop and report.
- [ ] **Step 2 (only after the controller says FPS is go): Failing tests** `presentmon.test.mjs`: `parseCsvHeader(line) -> { msBetweenPresents: index, processId: index }`; `parseCsvRow(cols, header) -> { pid, ms } | null`; `fpsStats(msList) -> { now, avg, low1 }` where `now` is from the mean of the last 30 frames, `avg` over the list, `low1` from the mean of the slowest 1% of frames (list capped at 3000); empty list → all `null`.
- [ ] **Step 3:** Implement `presentmon.mjs`: supervisor that starts the vendored exe for one pid (`isle.game` and visible only), parses rows, emits stats every 500 ms, stops on demand and when the pid changes. Main fills `fps` in `island:perf`. Page shows FPS, 1% low, average and a frame-time strip (last 120 values).
- [ ] **Step 4:** Settings row "Frame rate": shows On when frames arrive; otherwise explains the one-time step and offers **Turn on FPS**, which runs an elevated `Add-LocalGroupMember -Group 'Performance Log Users' -Member <current user>` via `Start-Process -Verb RunAs` (the OS prompt is the user's consent), then says a sign-out is needed. The button exists only on Windows. No test and no check ever presses it.
- [ ] **Step 5:** Tests PASS; add the file to the `test` script; `npm test` passes.
- [ ] **Step 6:** Commit `Notch: frame rate through PresentMon`.

### Task 10: Live check, docs and migration

**Files:** Create `perf/notch-check.cjs`; modify `package.json` (`"check:notch": "electron perf/notch-check.cjs"`), `docs/island-spec.md`, the island page under `docs/` and the site doc source, `CHANGELOG.md` (an `## Unreleased` entry), then `node site/tools/gen-docs.mjs`.

- [ ] **Step 1:** `perf/notch-check.cjs` (model on `perf/hud-check.cjs`; temp profile; no tray, no global shortcut; `--mute-audio`): starts the app server and the notch window in the transparent form with a fixture calendar served locally and a seeded store. Asserts: closed view at start; a posted ask opens it and shows the Approvals card; clicking Allow posts `/api/decide` with `allow`; typing `y` in the Notes input does not answer a second ask; every tab renders without a console error; a 2-second countdown fires once and shows in the closed line; the Calendar tab lists the fixture's events and a Join button; Trackers shows "Not available" when limits are absent; `gameMode: 'always'` gives the game closed view; switching Look to Solid recreates the window and the settings survive; an existing `kiro.json` fixture from 2.1 loads with its theme, pinned actions and shortcut intact. Exit non-zero on any failure.
- [ ] **Step 2:** `npm run check:notch` → all pass. `npm run check:hud` and `npm run check:meet` → still pass.
- [ ] **Step 3:** Docs: what the notch is now, each tab, the calendar link (where to find it, that it is a secret, read-only, refreshed every 15 minutes), game mode and its limits (borderless only, Windows only for FPS, the one-time step), Glass / Solid, what was not included. Changelog entry.
- [ ] **Step 4:** `npm test` → all pass; `node --test site/site.test.mjs` → pass; office-perf harness within budgets (the notch window is not part of it, but the server changed).
- [ ] **Step 5:** Commit `Notch: live check and docs`.
