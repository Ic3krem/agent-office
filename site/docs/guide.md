# Full user guide

Every panel, the island, the tray, settings files and the API table.

(TiroAgents v2.1.0, 2026-11-20)

The current release is v2.0.0 (TiroAgents), for Windows, macOS and Linux.

This guide covers every part of the app. For install, update and uninstall see the README. For a link index see RESOURCES.md.

Contents: What it is - Starting - The dashboard - Giving work - Approvals - The team - Goals, Today and Reports - The office - Scheduler - Agent history - Tiro on your desktop - The island - Tray - Settings files - API reference - Keyboard and accessibility - Troubleshooting - FAQ - Security notes

## What it is

TiroAgents is a pixel office for your own Claude Code agents. **Tiro** is the manager. You give Tiro a task, it plans, asks you to approve each specialist it wants to hire, files reports, and remembers things in an Obsidian-style vault of plain Markdown notes. The office itself uses no tokens; models only run while an agent works, through your own Claude Code install and plan.

## Starting

- **Installed app:** open TiroAgents from the desktop shortcut or Start menu. It starts its local server and shows Tiro on your desktop. Double-click Tiro (or use the tray menu, Open office) to open the dashboard.
- **From source:** `npm ci`, then `npm start` (see RESOURCES.md).
- The server listens on `127.0.0.1` only. The desktop app signs its windows in with a private cookie; a standalone `node server.mjs` prints a one-time sign-in link (valid once, for 5 minutes) instead. There is no key in the URL. Pages opened without signing in can load but cannot read or change anything.

## The dashboard

The header is one row of pills: manager auto-approval, usage and plan limits, reports, and the switches menu. Below it is the office, with the Today panel, the Team panel and the detail pane over it.


- **Click a character** to open its detail pane: name, role, task, live log of recent events, the approval it is waiting for, and a box to send it a message.
- **Click an empty desk** to see who sits there and what they do.
- **Team n/8** shows how many specialists are hired. The hire cap is 8 working at once.
- A banner appears when the server is unreachable ("Connecting") and clears when it comes back.

## Giving work

1. Type a task in the dispatch box (for example "Review the README and list any wrong claims") and send it. It is added to today's board as a goal and Tiro is told about it.
2. Tiro reads the board, plans, and works. For anything it cannot do itself it asks you to hire a specialist (see Approvals).
3. When a goal produces findings, Tiro files a report and marks the goal done.
4. Tiro keeps going between turns while **Autopilot** is on and goals are open. Switch Autopilot off if you want it to work only when you send something.

You can also message any agent directly from its detail pane, interrupt a running turn, or **Reset** Tiro's conversation (goals and reports stay; Tiro starts a fresh session next time).

## Approvals

There are two kinds, and both show on the dashboard and in the island.

**Hire approvals (strict hiring gate).** Starting a specialist with the Agent tool needs your approval. Tiro sends a request with the specialist, the goal and a reason; a card appears with Approve and Deny. One approval buys exactly one hire of that type and expires after 10 minutes. Requests are refused automatically if hiring is switched off, the goal is not open, the reason is too short, 8 specialists are already working, or that specialist is already on the team and idle (Tiro is told to reuse it). Pending cards and unused approvals are cleared when Tiro's session ends or resets or when hiring is switched off. Details: agents-and-memory.md.


**Tool approvals.** Tiro and the agents run on your own Claude Code configuration: your allow, deny and ask rules, permission mode, hooks and settings decide what happens. Only a request Claude Code itself would ask you about shows up (in the dashboard detail pane and the island), with the full tool input and Claude Code's own choices: **Yes**, **Yes, and don't ask again** (offered only when Claude Code suggests a rule; it writes that same rule to the same settings file Claude Code would), and **No**, optionally with a note telling Claude what to do instead. Nothing is edited, auto-approved or timed out into an answer; a prompt waits until you answer. Questions Claude asks (the multiple-choice question tool) appear as a question card in the island. Terminal sessions still ask in their own dialog when no tab is open. See permissions.md.

## Security Guard

On top of your Claude Code permissions, the Security Guard asks before something risky happens: secrets leaving this computer (a `curl` that uploads a `.env`, a `git push` whose files include a key, a secret written to OneDrive), downloaded scripts or startup entries, credential stores and environment dumps, screen or clipboard capture, and the first action after a web page or mail contained instructions aimed at the AI. It shows the matched rule, the files (values masked), the destination and whether the payload is exact or estimated, and you answer Yes, No, or No with a note. It can only ask; it never allows or blocks anything. Turn categories to ask, log or off in the **Breaker box** (Security Guard) or the island Settings; turning one down needs a confirmation window only the app can open, and an agent that edits `kiro.json` cannot weaken it. The **Audit log** button lists what was asked or noted. Details, limits and the full list of prompts: security-guard.md.

## The team

Tiro leads eight specialists:

| Name | Role | Model |
|---|---|---|
| Pixel | Frontend engineer | sonnet |
| Forge | Backend engineer | sonnet |
| Warden | Security reviewer | opus |
| Probe | QA and test engineer | sonnet |
| Atlas | Deep researcher | opus |
| Cabalan | Researcher | haiku |
| Tally | Task checker and organizer | haiku |
| Scribe | SOP and document writer | sonnet |

Each specialist is one person with one desk. If a second agent of the same type ever starts, it is drawn as a labelled "helper" of the first.

**Renaming.** In the Team panel you can give Tiro and each specialist a display name of up to 20 characters. A name cannot equal another agent's current or default name. Blank resets to the default. Renames only change what is shown: ids, desks and memory folders stay the same, so history stays with the agent.


**SOPs.** In the filing cabinet, Tiro's brief and each specialist's instructions are editable notes. Edits apply from Tiro's next turn. Each specialist's note can set `description`, `tools` and `model` in its frontmatter.

## Goals, Today and Reports

- **Today panel** lists today's goals (proposed, todo, doing, blocked, done). Tiro may propose follow-ups; they wait for you to accept or dismiss. Use Tidy to clear finished goals and idle desks from view.
- **Reports** (the bookshelf, or the Reports pill) are color-coded by outcome: green done, amber partial, red needs you. Each has a summary, a findings table and next steps. Search them, open one, and export it to **PDF** (print page) or **Excel**. A daily report is written automatically.
- **Memory** (the corkboard) shows the notes in your vault as pins and strings. Read, delete or link notes. The vault is your open Obsidian vault, or `~/Documents/Agent Office Vault`.


## The office

The world is isometric with five zones: Tiro's glass office (top left), the focus area with eight desks, the garden and park (top right, with a gate), the playroom (bottom right) and a utility strip (bottom left). The garage and Scheduler station sit beside the playroom.





- **Working** agents sit at their own desk. Thinking agents walk to the garden or park. When the board is empty, idle agents go to the playroom. A rate-limited agent waits at the water cooler. A finished goal sends its agent to Tiro's office to report, then back.
- **Objects:** Today board, Bookshelf (reports), Corkboard (memory), Filing cabinet (SOPs), Inbox tray, Breaker box, Server rack, Whiteboard (tokens and limits), Coffee machine (espresso: the next hire uses the fast model), Arcade, Jukebox, Server plant, and the Scheduler garage and mailbox.
- **Breaker box switches:** Tiro (manager) on/off, Autopilot, Hiring, Terminal approvals, the Subscription guard, and (desktop app only) the Notch, which stops at the 5-hour or weekly plan limit instead of spending extra-usage credits.
- **Click outlines.** Objects and people are picked by their drawn shape, not a rough box. Hover shows a gold outline that follows the silhouette; where pieces overlap, the smaller one wins. Characters are depth-sorted so none is hidden behind its own desk.


- **Camera.** Mouse wheel zooms about the cursor (1x to 3x), drag pans when zoomed, keys `+`, `-` and `0` zoom and reset, and corner buttons do the same. Bottom-right controls: Team count, Labels (zone names), and Preview, which plays demo scenes (work, think, blocked, report, empty, tour) without touching real data.

## Scheduler station

The Scheduler station is the garage and the mailbox. Click either to open a read-only panel showing the last check time, the count of tasks and needs found, when Tiro was last updated, the next check, a note, and the item list (title, kind, time). The panel reads `~/.claude/agent-office/scheduler.json` through `POST /api/scheduler`. It says "no data yet" until the scheduler job has written the file.



The job, its feed file and its mailbox setting are in scheduler.md. TiroAgents has no mail access built in.

## Agent history

The **Agent history** button (bottom left) opens a three-pane browser: agents on the left, that agent's tasks (with search) in the middle, and the task summary on the right with the transcript path and the agent's folder paths. Every hire starts in a fresh context; the only thing carried over is that agent's own memory folder. Folders are under `~/.claude/agent-office/agents/tiro/<type>/{memory,history}`. Summaries are redacted for secrets. See agents-and-memory.md.



## Power saver

The animated parts of TiroAgents (the office canvas, Tiro's window, the island) can use a surprising share of a GPU if they redraw at full speed all day. **Power saver** (on by default) keeps them calm: the office redraws about 30 times a second only while characters move or you interact with it, about 8 times a second for seated animations, about twice a second when nothing is happening, and not at all while the window is hidden or minimised. Tiro holds still after a few idle seconds and blinks now and then; the island stops its idle breathing while collapsed. Anything that changes (new data, a hover, a click) shows immediately.

Turn it off with the **Power saver** button next to Labels in the office, or in the island's Settings, to get the old constant motion. `prefers-reduced-motion` is always honoured. The setting is stored as `islandSettings.powerSaver` in `kiro.json` and mirrored in the browser as `ao.powerSaver`.

## Tiro on your desktop

Tiro lives as a small always-on-top character on your desktop. Click to chat, give tasks and approve requests; double-click to open the office. Its mood follows the work: idle, typing, waving a flag when you are needed, confetti when a goal is done, asleep when paused. Hide or show it from the tray.


## The island

The island is the **notch**: a small panel fixed to the top centre of the screen, flat against the top edge with rounded bottom corners. It is small when closed and opens into a wide, shallow panel with tabs.

- **Closed:** Tiro's eyes (idle, working, waiting for approval, done, offline) and the time. When something is next it widens to one line: a meeting starting within 15 minutes, a running or finished timer, or the playing song, with an amber approvals count on the right.
- **Open** (hover, click to pin, `Ctrl+Alt+K`, or by itself when an approval or hire arrives; `Esc` closes): a row of tabs, the date and time, a pin button and a settings button. The window is exactly the notch's rectangle, so the desktop around it takes clicks as usual, and the notch does not take the keyboard focus unless you pin it.
- **Modes:** Always and Smart (hides when idle or when a fullscreen app is running and peeks back when the cursor touches the top edge). Choose from the tray.

**Tabs.** Each tab is the full version of a card on Home.

- **Home:** cards. By default Approvals (the top waiting request with Allow and Deny), Agents, Calendar (the next events, with Join), Timer and Notes. Trackers, Music and Performance cards exist too. Choose and order the cards in Settings.
- **Approvals:** every waiting request and hire with all its choices (Yes, Yes and don't ask again, No with a message, Terminal). `Y` and `N` answer only the request card you have focused (click it or Tab to it); typing in a text field never answers one.
- **Agents:** live sessions, today's goals, the chat box to Tiro and your pinned quick actions.
- **Calendar:** today's and tomorrow's events from your calendar link, the month grid and an optional second clock. See below.
- **Timer:** named countdowns (several at once), a stopwatch and a Pomodoro cycle (25 minutes of focus and 5 of break, four rounds; all adjustable). A finished timer chimes once (unless the chime is muted) and shows in the closed notch until you open it. Timers keep running across a restart of the app.
- **Notes:** a plain list of short notes: add, edit, move up or down, delete.
- **Music:** the now-playing card with previous, play-pause and next, and the synced lyric line when lyrics are on.
- **Trackers:** your Claude plan use (5-hour session and weekly), the API value of today's and the last 7 days' tokens (list prices, not a bill) and today's output tokens, plus your own daily counters (for example glasses of water) that start again at 0 each day. When the plan limits cannot be read (an API key login, or not read yet) the gauge says **Not available** and why, never 0%.
- **Performance:** frame rate (now, 1% low, average and a frame-time strip), GPU load and temperature, CPU load and memory. Outside a game it shows the same without the frame rate.

Notes, timers and counters are kept on this PC only, in `notch-store.json`.

**Calendar link.** The Calendar tab reads one private calendar link (an ICS address). It is read only: nothing is ever written to your calendar.

- *Where to find it.* Outlook: Settings, Calendar, Shared calendars, Publish a calendar; choose "Can view all details" and copy the ICS link. Google Calendar: Settings, your calendar, Integrate calendar, then copy "Secret address in iCal format". A `webcal://` link is accepted and read over https.
- *It is a secret.* Anyone with the link can read your calendar. The app stores it encrypted with your operating system's key storage (`calendar-link.bin`), never shows it again, never writes it to a log, and sends it only to its own host. Without OS key storage it is refused. **Remove link** deletes the file and the events.
- *Refresh.* The events are read again every 15 minutes while the notch is on, and when you click **Refresh** (at most once every 30 seconds). Only https links to public hosts are read, up to 2 MB and 10 seconds; if a read fails the tab says so and keeps the last events it had.
- *Join.* An event with a Teams, Zoom, Google Meet or Webex link gets a **Join** button that opens it in your browser.
- *What is read.* Single and all-day events, time zones, and daily, weekly and monthly repeats with exceptions, moved and cancelled instances. Yearly repeats and rules such as "the first Tuesday" or "the 15th of each month" show only their first date. A feed with more than 5,000 events is cut to 5,000 and the tab says so.

**Game mode (Windows).** When a game is in front, the closed notch shows `<fps> FPS · <gpu>% GPU · <temp>°C · <cpu>% CPU` (a value that cannot be read is left out, never shown as 0), and opening it lands on Performance. A waiting approval then only adds its count to that line instead of opening the notch over your game; open the notch to answer it.

- *When it turns on.* **Auto** (default): the window in front covers its whole monitor and is not a browser, video player or this app, or its program is on a built-in list of known games or on your own **My games** list in Settings (add it by its program name, for example `MyGame.exe`). **Always** and **Never** force it. Never restores the notch's normal behaviour exactly.
- *Limits.* The notch shows over **borderless windowed** games only; nothing is drawn inside an exclusive-fullscreen game and nothing is injected into any game. A maximized window does not count as covering the monitor. GPU temperature needs an NVIDIA card (`nvidia-smi`). macOS and Linux have no game mode; Performance there shows CPU load and memory.
- *Frame rate.* Windows only. The app ships Intel's **PresentMon 2.6.0** (MIT licence, signed by Intel; see `THIRD_PARTY_NOTICES.md`). It checks the file's SHA-256 before every start and never downloads anything. It runs only while game mode is on and the notch is shown, and watches only the program in front. A game that draws from a separate child process shows no frame rate.
- *The one-time step.* PresentMon needs your Windows account in the **Performance Log Users** group. **Settings, Turn on FPS** explains this, asks for administrator rights once (a Windows prompt) to add you, and then you need to **sign out and back in**. You can skip it: without it Performance shows load and temperature and says how to turn the frame rate on. Running the app never needs administrator rights.

**Settings** (the gear on the right of the tab row):

- **Look: Glass or Solid.** Glass uses the system's real blur where it exists (Windows 11 22H2 or later, macOS) and a drawn glass look elsewhere; Solid is opaque. Switching creates the notch window again; your settings, notes and timers stay.
- Theme (Ember, Midnight, Forest, Light, Custom accent), motion preset, Home cards, pinned actions (up to 8), 12 or 24 hour clock, second clock, week start, edge and leave delays, game mode and My games, Turn on FPS, now playing, Tiro face, animation, lyrics, Security Guard and updates. Lyrics are **off by default**. If you turn them on, the title, artist, album and duration of the playing track are sent to lrclib.net to find synced lyrics (cached on this PC); nothing else is sent, and now-playing itself never leaves your PC.
- **Notch on or off.** The notch is on by default. To remove it, use any of: the tray menu item **Show notch** (a checkbox), the **Notch** switch at the bottom of the dashboard's **Breaker box** (desktop app only), or **Settings, Notch** inside the island itself. Off closes the notch window and stops every helper that serves it (now playing, fullscreen watch, load and frame-rate readers, calendar refresh); on creates it again on the display you chose. The choice is remembered across restarts and launches at login. An optional global shortcut (field **Toggle shortcut**, empty by default, for example `Ctrl+Alt+N`) toggles it; `Ctrl+Alt+K` only expands or pins a notch that exists, and does nothing while the notch is off.
- **Updates:** see the README. Check, and install with one click. An installer must come with a SHA-256 that matches the signed release manifest; otherwise it is refused.

**Not in this version:** calendar sign-in (Microsoft 365 or Google accounts), editing events, syncing notes, timers or counters to other devices, a clipboard history, file shelf, launcher, weather, volume or brightness indicators, app notifications, an overlay inside exclusive-fullscreen games, and frame rate on macOS or Linux.

## Tray

The tray menu has: Open office, Show notch (checkbox), Island (mode, chime on approval or done, display choice), Show Tiro, Start with Windows (packaged app only) and Quit TiroAgents.

## Settings files

All state is under `~/.claude/agent-office/` (your home folder). Nothing here needs editing by hand, but it is plain JSON and safe to inspect.

| File or folder | What it holds |
|---|---|
| `bridge.json` | Server port and the terminal bridge key (opens `/bridge/*` only). The UI key is never stored. |
| `kiro.json` | Desktop and island preferences: `agentNames`, `islandMode`, `islandMute`, `islandDisplay`, `islandSettings` (including `notchEnabled`, `notchShortcut`, `look`, `homeCards`, `gameMode` and `games`), `updateAuto`, `tiroIdleMinutes`, `limitsProbeMinutes`, `hidden`, optional `schedulerMailbox`. |
| `notch-store.json` | The notch's notes, timers, counters and Pomodoro lengths. |
| `calendar-link.bin` | The private calendar link, encrypted with the OS key storage (only when you added one). |
| `switches.json` | Breaker box switches. |
| `manager.json` | Tiro auto-approval on or off. |
| `manager-session.json` | Id of Tiro's current session (one per day). |
| `goals.json` | Today's board. |
| `credits.json` | Extra-usage credit log. |
| `scheduler.json`, `scheduler-seen.json`, `inbox-feed.json` | Scheduler status, its dedupe list, and its input feed. |
| `agents/tiro/...` | Per-agent memory and history. |

Reports, daily notes, memory and SOPs live in your vault (`Agent Office/` folder). Claude Code transcripts stay in `~/.claude/projects`. Environment variables: `AGENT_OFFICE_PORT` (server port), `AGENT_OFFICE_TEAM_ONLY=1` (show only Tiro and its team), `AGENT_OFFICE_MAILBOX` (scheduler mailbox) and `CLAUDE_CODE_PATH` (where Claude Code is).

## API reference

The dashboard, island and tools talk to a local HTTP API. Every call to `/api/...` is a **POST** with a JSON body, authenticated by the UI session cookie (there is no key in URLs or headers; the bridge key only opens `/bridge/*`). Decision endpoints (`/api/decide`, `/api/hire/decide`, `/api/switch`, `/api/send`, `/api/task`, `/api/sops/save`, `/api/boss-reset`) also need the per-session nonce in the `x-nonce` header. Not signed in returns 401, a missing nonce 403, a wrong `Host` header 403. `GET /api/stream` is a Server-Sent Events feed of the live snapshot. The bridge plugin also uses `/bridge/ask` and `/bridge/poll`.

| Endpoint | Body | Purpose |
|---|---|---|
| `/api/stream` (GET) | none | Live snapshot (agents, goals, approvals, usage). |
| `/api/send` | `{id, text}` | Message an agent session. |
| `/api/interrupt` | `{id}` | Interrupt a running turn. |
| `/api/decide` | `{askId, decision, always?, message?, answers?}` | Answer a Claude Code permission prompt (`allow`, `deny`, `terminal`); `always` writes Claude Code's suggested rule, `message` tells Claude what to do instead, `answers` answers a question card. |
| `/api/task` | `{text}` | Add a goal and tell Tiro. |
| `/api/goal` | `{id, action}` | `accept`, `dismiss`, `done` or `reopen` a goal. |
| `/api/boss` | none | Nudge Tiro to read the board. |
| `/api/boss-reset` | none | Forget Tiro's conversation (goals and reports stay). |
| `/api/hire/decide` | `{id, approve, note?}` | Approve or deny a hire request. |
| `/api/roster` | none | The eight specialists with names, roles and models. |
| `/api/names`, `/api/names/set`, `/api/names/reset` | `{key, name}` / `{key?}` | Read, set or reset display names. |
| `/api/agents/overview`, `/api/agents/tasks`, `/api/agents/task` | `{key, q?}` / `{key, id}` | Per-agent history browser. |
| `/api/scheduler` | none | Scheduler status (read-only). |
| `/api/reports`, `/api/report`, `/api/daily` | `{file}` for one | List and read reports and the daily summary. |
| `/api/memory/graph`, `/note`, `/delete`, `/link` | by note name | Browse and edit vault notes. |
| `/api/sops`, `/api/sops/save` | `{name, text}` | Read and edit SOPs. |
| `/api/switch` | `{name, on}` | Flip a breaker box switch. |
| `/api/rack`, `/api/limits` | none | Server stats; plan limits. |
| `/api/tidy` | none | Clear finished goals and idle desks. |

Also: `GET /print/report`, `/print/daily`, `/export/report.xlsx` and `/export/daily.xlsx` (key required) produce printable pages and Excel files.

## Keyboard and accessibility

- Office objects and desks are focusable with the keyboard and have labels (name, role, status).
- Camera: `+`, `-`, `0`, mouse wheel, drag.
- Island: `Ctrl+Alt+K` expands or pins it (not while the notch is off); an optional shortcut you set turns the notch on or off; `Y` and `N` answer the request card you have focused (never while you type in a field), `Esc` closes the notch; arrow keys, Home and End move along the tabs.
- Reduced motion: the office and island follow the system "reduce motion" setting and the animation preference; characters then appear in place instead of walking.

## Troubleshooting

| Problem | What to try |
|---|---|
| Dashboard is blank | Reload. If it persists, check the app is up to date (older builds before 1.2.5 could not load their scripts under the security policy). |
| "Connecting" banner stays | The server is not running. Restart TiroAgents. If another copy holds the port, quit it first. |
| 401 "not signed in" from a script | The API needs the UI session cookie, which only the desktop app (or the one-time sign-in link of a standalone run) has. The bridge key in `bridge.json` opens `/bridge/*` only. |
| Tiro does nothing | Check the Breaker box (Tiro on, plan guard not paused) and that Claude Code is installed and logged in. |
| Far more (or fewer) prompts than before | Prompts now follow your Claude Code permission rules and mode; edit your allow, deny and ask rules or `permissions.defaultMode` (permissions.md). |
| Hire card never appears | Hiring switch may be off, or Tiro asked for a goal that is not open. |
| Scheduler says "no data yet" or "No mail feed file yet" | The job has not run, or nothing writes `inbox-feed.json`. See scheduler.md. |
| SmartScreen warns on install | The build is not code-signed. Compare the SHA-256 with the one on the GitHub release. |
| Update refused | The feed has no SHA-256, or the hash did not match. |

## FAQ

**Does the office cost tokens?** No. Only agents working cost tokens, and only on your Claude Code plan.

**Can an agent hire without asking me?** No. Every hire needs your one-shot approval.

**Where is my data?** On your machine: `~/.claude/agent-office`, your vault, and Claude Code's own `~/.claude/projects`. Model calls go to Anthropic through Claude Code, as in the terminal.

**Does it read my email?** No. The scheduler reads a local feed file that you must produce yourself.

**Can I rename agents and keep their history?** Yes; history follows the type, not the name.

**Why a vendored React and Babel?** So the dashboard works under a strict security policy and fully offline; the fonts are vendored too.

## Security notes

The server is local only, requires a random key, checks the `Host` header and sends a strict Content-Security-Policy. Electron windows are sandboxed with context isolation and no Node integration. Installs and updates are https only and SHA-256 verified. Windows and macOS builds are unsigned. Full list in the README.


### Background work and memory

TiroAgents keeps its background work small. Two settings in `kiro.json` tune it:

- `tiroIdleMinutes` (default 15, `0` = never): Tiro's own `claude` process holds a few hundred MB while idle, so it is closed after this many idle minutes and resumed with the same session id when the next goal arrives. It is never closed while an approval is pending, a specialist is running, a goal is being worked on or Tiro is working.
- `limitsProbeMinutes` (default 15, at least 5): how often the plan limits are checked. The check starts a `claude` process, so it only runs while a window is visible or Tiro is working.

What you may notice: an old Claude Code session that you resume can take up to a minute to show up on a desk; the live view updates once every 3 seconds while all windows are hidden; the first message after a long break starts Tiro a moment later because its session is resumed. To re-measure on your own machine see `tools/perf/README.md`.
