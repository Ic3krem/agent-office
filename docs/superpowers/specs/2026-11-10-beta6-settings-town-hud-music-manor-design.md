# beta.6: sign-ins, town HUD, music, manor themes (design)

Date 2026-11-10. Branch feature/world. Base: d8d6470 (OpenCode exe shim + Gemini stderr error fixed).

## What the user asked
1. "the gemini and openai seems to not work"
2. "create a settings where users can also connect their claude inside the office"
3. Settings while in the world (outside the office): pending/on-work tasks, graphics, build, party (chat outside, a bubble when someone messages), party music (play and stream), background music, customize the manor (office) theme (party can view).

## Answers given (AskUserQuestion, 2026-11-10)
- Claude connection: **both**, account sign-in (default) and an API key.
- Party music: **shared player**, Spotify too.
- Background music: **both**, built-in tracks and the user's own folder.
- Manor: **theme presets + colors**; party guests see it.

## Findings behind 1 (already fixed in d8d6470 unless noted)
| CLI | State on the user's PC | Cause |
|---|---|---|
| Codex | works end to end in the installed beta.5 (test-run route, temp profile): "finished: PONG" | none. No Codex desk had ever been placed (world/layout.json absent), so Tiro had no external key to hand work to |
| Gemini | "could not finish: }" | not signed in (no ~/.gemini/settings.json, exit 41). The JSON error is on stderr and only its last line was reported. **Fixed**: stderr JSON error parsed |
| OpenCode | "unrecognised launcher" | opencode-ai's npm shim starts a native .exe, not node + js. **Fixed**: the shim target may be .exe |

Remaining, in this release: the user must not need Build mode or a terminal to get going (see A).

## A. Agents panel: add a desk, sign-in state, Sign in
- **Add desk** button per detected CLI: places the next free `ext-<cli>-<n>` desk at a free reachable spot (the same validation Build mode uses), saves the layout. Disabled at 3 per CLI or when not installed.
- **Signed in** line per CLI, read-only probes (5 s timeout, cached 60 s, never print tokens):
  - Codex: `codex login status` exit 0 = signed in.
  - Gemini: `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI`/`GOOGLE_GENAI_USE_GCA` set, or `~/.gemini/settings.json` has `security.auth.selectedType` (or the older top-level `selectedAuthType`).
  - OpenCode: `opencode auth list` non-empty; unknown is shown as "uses its own config".
- **Sign in** button (desktop app only, via preload IPC, never a server route): opens a visible terminal window running the CLI's own login (`codex login`, `gemini` interactive first run, `opencode auth login`). Windows: `cmd.exe /c start "" <exe> <args>` built from the resolved launch (no user text in it); macOS: `open -a Terminal` with a temp .command file; Linux: x-terminal-emulator/gnome-terminal/konsole, else show the command to copy.
- Tiro's prompt already lists the roster; check that placed ext desks appear in it with "use delegate".

## B. Settings → Claude (connect your Claude)
- Status from `claude auth status` (JSON): signed in or not, method (claude.ai subscription / Console API), email, expiry. Also "Claude Code not found" with the install line. Show which one TiroAgents is using.
- **Sign in** (subscription) and **Sign in with Console** (API billing): desktop opens a terminal running `claude auth login` / `claude auth login --console` (same opener as A). **Sign out**: confirm dialog, then `claude auth logout`.
- **API key** (alternative): entered only in a desktop-native prompt (not the web page, not a server route), validated as `sk-ant-` shape, stored with Electron safeStorage (`CFG_DIR/claude-key.enc`, 0600). A mode switch "Use: Claude account | API key". When mode=key the desktop passes `ANTHROPIC_API_KEY` in the server child's env (restart the server child); the page only ever sees `key set · ends …abcd`. Remove key = delete the file, mode back to account. Never logged, never in kiro.json, never sent to a party.
- If safeStorage is unavailable (some Linux), the key option is disabled with that reason.

## C. Town HUD (the /town page)
A compact toolbar on town.html (top right, keyboard reachable, ≥44px touch targets), each opening a small panel; one panel open at a time; Esc closes.
- **Tasks**: goals from the stream snapshot, grouped "On it" (in progress/assigned) and "Waiting" (pending/blocked), with the desk/agent name. Read-only; a link "Open in office".
- **Graphics**: the same preset/custom controls the office has (reuse graphics.js; Graphics.onChange already re-renders the town).
- **Build**: goes to the office in Build mode (`/#build` handled by the office page).
- **Party**: join/host/leave, members, presence, and chat (same /api/party routes as the office panel). Chat lines show as a speech bubble over the speaker's avatar in town (yours over you, a member's over their avatar, fading after ~6 s, plain text, max 140 chars shown). Also a small bubble/toast when Tiro sends you a new chat message while you are in town.
- **Music**: background music and party music controls (D).
- **Manor**: theme picker (E).
- The office page gets the same Music and Manor panels (in its existing header/settings), so both places control one setting store.

## D. Music
### Background music
- **Built-in**: original generative lo-fi/ambient made with WebAudio at runtime (chords, soft drums, vinyl noise), seeded per place: office, town, karinderya, game hall. No audio files, no licensing. Volume, on/off, place-aware (switches with a short crossfade on scene change).
- **My music folder**: desktop folder picker (native dialog). The server lists audio files in that folder only (mp3, ogg, m4a, wav, flac; no recursion beyond 2 levels, max 2000 files) and serves them by index through `GET /api/music/file?i=` (UI cookie, path resolved and checked inside the folder, range requests for seeking). Shuffle/next/prev.
- Settings in kiro.json `music: {bg: 'builtin'|'folder'|'off', volume, folder}` (folder path set only through the desktop dialog route).
- Background music ducks (−12 dB) while party music plays and pauses when the window is hidden (power saver).

### Party shared player
- New party message `music`: `{src: 'youtube'|'spotify'|'stream', ref, title?, startedAt, paused, pos}`, server-stamped time. Cleaners on both sides (protocol.mjs):
  - youtube: video id `/^[\w-]{11}$/` (parsed from youtube.com/watch, youtu.be, music.youtube.com links);
  - spotify: `track|album|playlist|episode` + id `/^[A-Za-z0-9]{22}$/` (from open.spotify.com links or spotify: URIs);
  - stream: an `https://` audio URL (internet radio), ≤ 300 chars, no credentials in it.
- Who controls: the host, plus "anyone can DJ" (host switch, default on). Rate limit like chat.
- Playback in each guest's app: YouTube IFrame API, Spotify Embed iFrame API (`loadUri`, `play`, `togglePlay`, `seek`), `<audio>` for streams. Late joiners seek to `now − startedAt + pos`; resync when drift > 2 s (YouTube/audio; Spotify embed seeks on join/play only).
- Spotify note in the UI: full songs need each listener signed in to Spotify inside TiroAgents ("Sign in to Spotify" opens open.spotify.com in an app window on the same session); otherwise Spotify plays 30 s previews. No audio is captured or re-streamed.
- CSP: add `frame-src https://www.youtube-nocookie.com https://open.spotify.com` and `media-src` for https streams, page-only; nothing else widened.
- Shown in the town HUD and the office Party panel: now playing, play/pause/skip for the DJ, a link box.

## E. Manor themes
- kiro.json `manor: {theme, colors: {wall, floor, roof, accent}}`. Presets: Modern, Country, Japanese (the existing building styles), plus Beach (modern + sand/teal), Cyber (modern + night/neon), Cottage (country + cream/green). Each preset = a base building style + a palette; colors are optional overrides (validated `#rrggbb`).
- Applies to: the office interior (floor/wall/accent palette in the office renderer), and your building in the town (base style + tint on roof/walls).
- Party: the feed carries `manor` (theme enum + 4 hex colors only); friends' lots draw your style and tint, and visiting your office uses your palette. The server cleaner drops anything else.

## Not in scope
- Re-streaming Spotify audio or PC audio capture (against Spotify's terms; "Live PC audio" was not chosen).
- Uploading music files to a party.
- Signing in to Gemini/Codex inside the app's own UI (their own login runs in a terminal).

## Safety
- No `shell: true`; the terminal opener builds argv from resolved paths and fixed args only.
- The API key and folder path are only set through desktop IPC, never by the page or an agent; the party feed never carries file names, paths or keys.
- The standing live-test rules hold: temp profiles, ports 4790–4799 (not 4795), AGENT_OFFICE_NO_TUNNEL=1, no public tunnels.

## Verification
- npm test (new unit tests: probes, link parsers/cleaners, music folder path checks, manor validation, Add-desk placement).
- Live checks (Electron, temp profile): Agents panel Add desk + signed-in lines; Claude panel status; town HUD panels open, tasks list matches the board; a local party (two app servers + local party server, no tunnel): chat bubble over the member's avatar in town, a `music` message reaches the other app and a stream URL plays in sync (±2 s), manor theme visible on the friend lot; BG music starts/stops/ducks; office-perf and town perf budgets still pass.
- Real Codex run from the packaged app after install.
