# Tiro Island: spec

Clean-room: behavior only, taken from the two reference apps' README, UPDATES/SETTINGS docs and described UI. No code, assets or wording copied. All code here is original.

## Observed behavior

TwoCode (Dynamic Island + Robo):
- Top-center island on Windows that follows Claude Code / Codex sessions: which file is read, edited, which command runs.
- Glow in busy / done / error colours; chime and "what changed" on completion; click for the full answer and history.
- Allow / Deny prompts for permissions inside the island.
- Hotkey (Ctrl+Alt+T) opens it; per-app jump hotkeys; tray icon with start-with-Windows and Quit; settings in a separate app.
- Local-only status reading; no account.

Nectar (notch + dock):
- Spring-physics animated notch with panels (music, control center, status, calendar, shelf); scroll to switch panel.
- Visibility modes Fixed / Smart / Peek; hides over fullscreen apps.
- Dock of quick actions; per-monitor options; settings in a plain JSON file applied live.
- Pauses expensive work when nothing needs it.

## Adopt / improve

| Behavior | Tiro island |
| --- | --- |
| Top-center notch that grows on activity | `public/island.html`, separate transparent click-through window, always on top. Collapsed pill shows live task + counts; expands on hover, click, hotkey, or a pending approval. |
| Live sessions | Fed by the existing `/api/stream` SSE (agents, goals, perms, reportsN, boss.paused). No new server API. |
| Approve / deny | Buttons call existing `/api/decide` (allow / deny / terminal). Improvement: a third "Terminal" choice hands the ask back to the CLI; Y / N keys answer the first pending ask; Esc waves it away without answering. Auto-expands for approvals (amber glow, pulsing dot). |
| Done notifications | Toast in the pill (green glow) on goal done, blocked, new report, manager paused. A short synthesized chime (WebAudio oscillators, no asset files) plays on a new approval (rising pair) and on goal done (falling pair); not on the first snapshot, never when muted or Off. Tray: Island > Chime on approval / done. |
| Hotkey | Ctrl+Alt+K toggles pin/expand and focuses the island so keys work; it does nothing while the notch is switched off. Tray: checkbox **Show notch** (on/off, see below). |
| Dock of quick actions | Today, Reports (with count), Usage, Chat. Today/Reports/Usage deep-link the office window via `#today`, `#reports`, `#usage` (office handles the hash, including when already open). Chat is an inline composer posting to `/api/send` or `/api/task`. |
| Spring animation | Own damped-oscillator in JS drives width, height and corner radius (slight overshoot, settles; reduced-motion jumps straight). Dock buttons bounce on hover. |
| Click-through | Only the island rectangle takes the mouse; the rest of the 620x470 window passes clicks through. |
| Multi-monitor | Tray Island > Display: follow cursor (default), primary, or a specific display. A 200 ms timer moves the window to the cursor's display; display-added / removed / metrics-changed re-place it (setBounds twice for mixed-DPI). A saved display that is unplugged falls back to primary. Pure logic in `desktop/island-logic.mjs`. |
| Visibility modes | Tray Island: Always (default), Smart, Off. Smart hides the island (fade + slide) when idle (nothing working / asking / toast, and online) or when Windows reports a fullscreen app (resident PowerShell polling SHQueryUserNotificationState every 1.5 s; states 2/3/4). It peeks back when the cursor touches the top edge near the centre (3 px zone, widens to 60 px while peeking), on hover, pin (hotkey) or chat. Fullscreen detection is Windows only; elsewhere Smart is idle-only. Ctrl+Alt+K from Off switches to Always. |
| Media panels | Not in the first version. Added later as a now-playing chip and card with lyrics; see "Now playing" and "Compact notch" below. |
| Settings file | `~/.claude/agent-office/kiro.json`: `islandMode` (`always|smart|off`; legacy `islandOff` still read and kept in sync), `islandMute` (bool), `islandDisplay` (`cursor|primary|<display id>`). Tray changes apply live and are pushed to the page over IPC `island:state`. |

## Safety
- Island page is served by the existing localhost + key-protected server; it only calls existing endpoints.
- The island preload (`desktop/island-preload.cjs`) exposes a fixed set of IPC calls (interactive, focus, office, mute, settings, media, update get/check/install/set, and listeners for state, toggle, now playing, lyrics and update). It started with five (interactive, focus, office, onToggle, onState); main validates the sender and whitelists office views (`today|reports|usage`).
- Manager auto-approval and bridge flow untouched; the island is just another client of `/api/decide`.

## Files
- `public/island.html`, `desktop/island-preload.cjs`, `desktop/main.mjs` (window, hotkey, tray, IPC, display + fullscreen watch), `desktop/island-logic.mjs` + `island.test.mjs` (pure helpers and tests), `server.mjs` (`/island` route), `public/Agent Office.html` (hash deep links).

## Nectar-inspired upgrade (2026-11-02)
Nectar's README, SETTINGS.md and source layout were read as a feature reference only (internal use). All code is original (Electron, vanilla JS); no Nectar code was copied, so no GPL-3 obligation attaches to distribution. If any is reused later, record it here: it would make distribution GPL-3.

| Nectar feature | Tiro island |
| --- | --- |
| Settings window | Inline Settings tab in the expanded island (Home / Calendar / Settings tabs, or the pinned gear). Page sends a patch over IPC `island:settings`; main validates with `normalizeSettings`, saves `islandSettings` in kiro.json and echoes it back in `island:state`. |
| Themes (dark / light / custom colour) | Ember (default), Midnight, Forest, Light, Custom accent. CSS variables drive every surface. |
| Physics tuning | Motion presets Soft / Default / Snappy / Bouncy (spring stiffness and damping). |
| Dock of pinned apps | Pinned quick actions: Today, Reports, Usage, Office, Chat, Calendar, Chime toggle, Settings. Click to pin or unpin in Settings; order = order pinned; max 8. Fixed whitelist, no arbitrary app launching. |
| Clock / dual clock | Time in the collapsed pill (optional), big clock and optional second clock (IANA zone + label, validated) in the Calendar tab; 12h or 24h. |
| Calendar widget | Month grid with today highlighted, prev / next month, week starts Mon or Sun. Local only, no calendar sync. |
| Edge delay (smart/peek) | Smart mode needs the cursor to rest on the top edge for 0 / 200 / 500 ms before peeking. |
| Remember / leave behaviour | Close-after-leave delay 0.4 / 0.9 / 2 s. |

Skipped: music/media, control centre, shelf, weather, timer / stopwatch, CalDAV / ICS sync, volume and brightness HUDs, taskbar-replacement dock, per-monitor mode map, panel scrolling. Not relevant to an ops island or too heavy.

Settings keys (`islandSettings`): theme, accent, physics, pinned[], hour12, clockInPill, zone2, zone2Label, weekStart, edgeDelay, leaveDelay. Pure logic and tests: `desktop/island-logic.mjs`, `island.test.mjs`. Note: `public/island.html` keeps a small display copy of the theme/physics tables; keep it in sync with island-logic.mjs.

## Now playing + Tiro character (2026-11-03)

**Now playing (Windows SMTC).** `desktop/nowplaying.ps1` is a resident PowerShell poller (700 ms) over `GlobalSystemMediaTransportControlsSessionManager`, so Spotify, Apple Music, browsers (YouTube) and any SMTC player show up with no per-app code. It prints one JSON line on change (`id, status, title, artist, album, canPlayPause/Next/Prev`) and reads commands from stdin (`playpause|next|prev <session id>`). Pick order: a Playing session first (the system "current" one wins ties), then current, then any session that has a title; sessions with no title/artist (idle apps) are skipped. `desktop/nowplaying.mjs` (no electron import) parses and validates lines (length caps, status whitelist, friendly app name), supervises the process (exponential back-off restart, stops when island is Off or pref off) and exposes `control(verb)` which only accepts the three verbs and only targets the session currently shown. main.mjs pushes `island:nowplaying` (null when pref is off) and handles `island:media`. Preload adds `media(verb)` and `onNowPlaying(fn)`.
- UI: while Playing, a compact chip (equalizer bars + title - artist) slides into the pill; paused or playing, the expanded island's Home tab shows a Now playing card with prev / play-pause / next (buttons disabled when SMTC says the app cannot). Hidden when nothing is playing (a paused track only appears in the expanded card). All of it is inside `#isle[data-hit]`, so click-through behaviour is unchanged.
- Prefs (`islandSettings` in kiro.json, Settings tab): `nowPlaying` (default on), `kiroFace` (on), `animate` (on). Validated in `normalizeSettings`.
- Not done: album art thumbnail (SMTC thumbnail needs a stream read + base64; skipped to keep the poller light), `/api/nowplaying` endpoint (the poller lives in the desktop main process while server.mjs may run standalone; add a push from main to server if needed). Smart mode does not un-hide the island just because music plays.
- Tested: `node --test island.test.mjs nowplaying.test.mjs` (parser, supervisor with fake process, control whitelist, settings); poller run live against the machine (Spotify, Paused -> reported title/artist/app/controls correctly). Playback was not toggled during testing.

**Tiro character + animation (clean-room, CSS only).** A persistent `#face` element (two eyes on a tile) is re-attached into the pill after every innerHTML render, so its blink/look timers and animations are never reset. Moods follow the pill tone: idle (slow breathing, random blink incl. double blink, random look-around, eyes follow the cursor when within 260 px), working (eyes scan left-right), approval (wider amber eyes, small side nudge), done (happy arch eyes, green), music (face bobs and eyes sway at 120 bpm; not real beat detection), offline (half-closed). The old dot is hidden while the face is on. Notch: spring size animation unchanged, plus body fade/slide on expand, chip slide-in (`.enter` classes added once on the state change, not on re-renders), and a slow idle breathing of the edge glow. Reduced motion: honours the OS setting live and the `animate` pref (`html[data-anim=off]` kills every animation/transition and the springs jump); `kiroFace` off restores the dot.
- Verified by loading island.html in a separate hidden Electron instance (temp userData, no port 4777, installed app untouched) and driving state: chip, face mood `music`, controls, settings rows, enter class, chip removal all correct.

## Updates (Settings tab)

- Code: `desktop/updater.mjs` (versions, signature check, manifest parsing, download, pre-launch check), `desktop/update-key.mjs` (the pinned public key), wiring in `desktop/main.mjs` ("updates" block), UI in `public/island.html` (`updatesHTML`), tests in `updater.test.mjs` and `updater-signed.test.mjs`.
- Trust model: a release is described by `latest.json` with a detached Ed25519 signature `latest.json.sig` (base64 over the exact manifest bytes). The app verifies it against the public key pinned in `update-key.mjs`; anything else (missing, malformed, wrong key, altered by one byte) is rejected, whatever the transport (https, file or share). The manifest carries each installer's SHA-256 and a `url` that must be on `https://github.com/Ic3krem/agent-office/releases/download/` (or next to a local mirror manifest). Schema: `{ "schema": 1, "version", "publishedAt", "notes", "assets": [ { "platform", "arch"?, "name", "url", "sha256", "size" } ] }`.
- The feed is a constant in `main.mjs` (`DEFAULT_FEED`). Only the main-process environment variable `AGENT_OFFICE_UPDATE_FEED` can override it. The island page can only send `{ auto: boolean }` to `update:set`; a `feed` field is ignored, and `kiro.json` `updateFeed` is no longer read. `updateAuto` (check on start, default on) is the only pref.
- "Update now" (`update:install`): the main process shows a confirmation dialog (default button is Cancel), downloads into `~/.claude/agent-office/updates/u-<32 random hex>` (Windows: ACL reduced to the current user), checks the SHA-256, then hashes the file again right before launching it and re-checks that the version is still newer. No downgrade is ever offered or launched.
- Owner setup: see `docs/RELEASING.md` (offline signing with `scripts/sign-release.mjs`).


## Local release feed (enterprise mirror)
- A mirror or share is configured only through the `AGENT_OFFICE_UPDATE_FEED` environment variable of the app process (never from the page or `kiro.json`). It must hold `latest.json` and `latest.json.sig` signed with the release key; the asset `url` is a bare file name next to the manifest. An unsigned or tampered local feed is rejected exactly like an https one.
- UI smoke: run server.mjs with a temp `USERPROFILE` and `AGENT_OFFICE_PORT` (so bridge.json of the real install is untouched), load /island and / in a separate Electron with temp userData. A fully hidden window does not paint for `capturePage`: use `show:false` then `showInactive()` at x=-4000 with `backgroundThrottling:false`, and force `step()` for the island springs.

## Compact notch = Tiro eyes + lyrics (1.1.9)
- **Compact notch** shows only the Tiro eyes (bigger, `.face.big`), animated by state: idle (breathe, blink, look), working (scan), waiting for approval (wide amber eyes, nudge), done (green arches), offline (half closed). The pill text, counters, clock and chips only appear in the expanded island. The status text stays in a visually hidden `.sr` span for screen readers. With `kiroFace` off the old dot is the compact indicator.
- **Music**: while a track is Playing the compact notch becomes a fixed 440 px block (no wobble): eyes, title (bold) with artist (subtle) and, when lyrics exist, a synced lyric line (13 px, one line, ellipsis, 180 ms fade between lines; jumps when motion is reduced). No lyrics = no extra row (36 px). Paused/stopped = eyes only. The expanded Now playing card also shows the current lyric line.
- **Timeline**: `desktop/nowplaying.ps1` now emits `pos` (ms), `dur` (ms) and `ts` (epoch ms of SMTC LastUpdatedTime; 0 while paused) or nulls when a player gives no timeline. The page extrapolates `pos + (now - ts)` while playing (`positionNow`).
- **Lyrics** (`desktop/lyrics.mjs`, tests `lyrics.test.mjs`): `parseLrc` (multi-stamp, fractions, `[offset:]`, word stamps, caps), `lineAt` (binary search), LRCLIB client `GET https://lrclib.net/api/get?track_name&artist_name[&album_name]&duration` with a 3 s `AbortSignal.timeout`, only synced lyrics used, fail silent. Only title, artist, album, duration (s) leave the machine, plus a User-Agent `Agent Office v<version>` (LRCLIB asks apps to identify themselves). Disk cache `~/.claude/agent-office/lyrics-cache/<sha1>.json`: hits are permanent, "no lyrics" (404, instrumental, plain-only) lasts 3 days, network failures/5xx are never cached and back off 5 min per track. Requests happen in main only while a track is Playing and the `lyrics` pref is on (IPC `island:lyrics`, keyed by `trackKey` so a stale result never shows on another track).
- **Pref** `lyrics` (default on) in Settings > Appearance with a note that it looks up lyrics online. `nowPlaying`, `kiroFace`, `animate` and reduced-motion handling are unchanged.
- Page keeps display copies of `lineAt` / `positionNow` (keep in sync with `lyrics.mjs`). Click-through unchanged (everything is inside `#isle[data-hit]`).
- Smoke: hidden Electron (temp userData, own server on a spare port with a temp USERPROFILE, preload stub exposing `window.__onState/__onNP/__onLyr`).

## Security notes (1.2.4 onward)
- The island and office windows run with context isolation and sandbox on, `nodeIntegration` off and `webSecurity` on. They cannot navigate away from the local server, cannot open popups or webviews, and external links open in your browser.
- The only outside requests the desktop app makes on its own are the optional update check (https feed you configured), the update download (https, SHA-256 checked) and, if lyrics are on, a lookup to `https://lrclib.net` carrying only title, artist, album and duration.
- The Windows installer is not code-signed, so SmartScreen may ask you to confirm.

## Notch on/off (feature/notch-toggle)
- **Setting.** `islandSettings.notchEnabled` in `~/.claude/agent-office/kiro.json`, validated by `normalizeSettings` (boolean, default `true`: the notch is on, as before). `islandSettings.notchShortcut` (default empty) is an optional global shortcut: 2 or 3 of Ctrl/Alt/Shift/Super plus one letter, digit or F1-F24, canonicalised (`ctrl+alt+n` becomes `Ctrl+Alt+N`); `Ctrl+Alt+K` is reserved; anything else is dropped to empty.
- **Migration.** Before this setting existed, `islandMode: "off"` (or the older `islandOff`) meant no island. `migrateNotchPrefs` makes that explicit (`notchEnabled: false`) once at start, because settings patches write every field and would otherwise turn it back on. The tray no longer has an Off radio; the Always and Smart radios are enabled only while the notch is on.
- **Behaviour.** One setter in `desktop/main.mjs`, `setNotch(on)`, is used by the tray checkbox, the dashboard, the island's Settings and the shortcut. Off destroys the island window (not just hides it), stops the now-playing poller and the fullscreen watcher; on creates the window again (multi-display placement, click-through and the peek timer are unchanged). A window that disappears on its own does not change the setting; the next apply re-creates it. The pure transition table is `notchStep` in `desktop/island-logic.mjs`.
- **Controls.** Tray: **Show notch** checkbox. Dashboard: a **Notch** switch in the Breaker box, shown only inside the desktop app. Island: Settings, Notch (On/Off) and Toggle shortcut.
- **IPC.** The dashboard window has its own preload (`desktop/office-preload.cjs`) exposing only `notch.get()` and `notch.set(boolean)`; `ipcMain` handlers `notch:get` and `notch:set` check that the sender is the office window and that the payload is a boolean. The island uses its existing sender-checked `island:settings` channel. There is no HTTP route for the notch.
- **Launch at login.** `--hidden` starts still skip the dashboard and create the notch only if it is enabled; the single-instance lock is unchanged.
