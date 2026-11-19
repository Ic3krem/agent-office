# The notch, rebuilt as a wide glass notch with tabs (design)

Date: 2026-11-19. Branch: feature/world. Built before the side rail (`2026-11-19-side-rail-design.md`); the two do not depend on each other.
Research this design rests on: `docs/superpowers/specs/2026-11-19-notch-research.md` (today's island with file:line, open-source notch apps and licences, feasibility).
Mockups the owner approved: https://claude.ai/artifact/LP2fUYGRAn6fKAtoh26smd, board "Notch concept" (opened on Home, plus closed / needs-you / game states) and board "Decisions to approve" (N1–N7, all accepted as picked).
Reference the owner pointed at: NotchX – Dynamic Notch on the Microsoft Store (wide shallow notch against the top edge, a row of icon tabs, a Home page of cards, frosted dark glass). Its layout pattern is followed; its look and code are not copied.

## Intent

The owner wants the notch to be an everyday quick-access tool, not only an agent status pill: "calendar and such, other trackers, notes, timers, approvals, then when gaming it becomes fps monitoring", and "glassy or modern". When asked about shape: "the notch should be simple top notch on desktop", then pointed at NotchX and said "yeap, let's build this".

## Goals

1. **Shape.** A notch fixed to the top centre of the screen: flat against the top edge, rounded bottom corners. Small when closed, a wide shallow panel when open.
2. **Glass.** Real blur of what is behind it on Windows 11 and macOS; a drawn (CSS) glass look elsewhere or when the system blur is unavailable.
3. **Tabs and Home.** Opened, it shows a row of icon tabs and a Home page of cards. Each tab is the full version of one card.
4. **New everyday tools.** Calendar with real events, timers, notes, trackers.
5. **Game mode.** When a game is in front, the closed notch shows frame rate and system load, and opening it lands on Performance.
6. **Everything the island does today keeps working**: approvals (all decision types and keys), now playing and lyrics, sessions, goals, chat, visibility modes, multi-monitor, notch on/off, shortcut, themes, updates and Guard settings.

## Non-goals

- NotchX's other tools: clipboard history, file shelf, launcher, virtual desktops, document conversion, weather, volume/brightness indicators, app notifications. Not in this version.
- An overlay inside exclusive-fullscreen games. The notch shows over borderless-window games only; nothing is injected into any game.
- Calendar sign-in (Microsoft 365 / Google). This version reads a private calendar link only.
- Editing calendar events. Read-only.
- Syncing notes, timers or trackers anywhere. They stay on this PC.
- Game FPS on macOS or Linux.

## Anti-goals

- An approval that is harder to see or answer than today. Approvals still open the notch by themselves, still glow, and Y/N still act only on the focused card.
- A notch that steals focus or blocks clicks on the desktop outside its visible shape.
- Anything that needs admin rights to run the app normally. The one admin step (FPS) is optional, explained, and skippable.
- A background process that keeps polling while the notch is hidden or off.
- Copying code from GPL projects (Nectar, Atoll, boring.notch and others listed in the research). Ideas only.

## Constraints

- No new npm dependency. No paid service, account or API key.
- Electron 43; the page stays a single local page served by the app's key-protected server, with a fixed, sender-checked IPC surface (as today).
- Reduced motion, Power saver: no animation, as today.
- Existing tests keep passing (`island.test.mjs`, `notch.test.mjs`, `nowplaying.test.mjs`, `lyrics.test.mjs`); settings in `kiro.json` migrate without loss.
- Memory: the notch window is always open, so its idle cost must not grow over time; pollers stop when hidden.
- Test runs that launch the app use `--mute-audio` and temp profiles, and must not register the global shortcut or tray of the installed app.
- Secrets: the calendar link is a secret (anyone with it can read the calendar). It is stored like the Claude API key (OS-encrypted via `safeStorage`), never logged, never sent anywhere but its own host, never put in the page's snapshot.

## Approaches considered

- **A. Wide notch with tabs and a Home page of cards (chosen).** The NotchX pattern. Scales to many tools, each with a full tab, while Home gives the glance. Cost: the island page is largely rewritten, and the window must resize with the notch for the blur to work.
- **B. One short drop-down list** (one row per thing). Drawn first; the owner rejected it as not what "simple top notch" meant.
- **C. Floating glass capsule with a large tabbed window.** Drawn first; rejected in favour of a notch attached to the top edge.

Six content mixes were also shown (agents first, day planner, mixed, trackers, system/game, quiet). The owner did not pick one; Home's default cards below are the writer's choice and the cards are rearrangeable.

## The design

### Sizes and states

| State | Size (defaults) | Shows |
|---|---|---|
| Closed | about 180 × 32 | Tiro's eyes (mood as today) and the time |
| Closed, something needs you | up to about 400 × 36, one line | Left: what is next (meeting within 15 minutes, running timer, or the song). Right: an amber approvals count when any are waiting |
| Closed, game in front | about 360 × 36 | FPS (when available), GPU load, GPU temperature, CPU load; approvals count still appears |
| Open | about 1100 × 370 (never wider than the display minus 80; shrinks on small displays) | Tab row and the selected tab |

Open/close triggers are today's: hover (with the existing edge and leave delays), click to pin, the global shortcut, and any pending approval or hire. Esc closes. The spring animation and its presets are kept.

### Tabs (left to right)

Home · Approvals · Agents · Calendar · Timer · Notes · Music · Trackers · Performance. On the right of the tab row: the date and time, a pin button, and a settings button (settings is today's Settings tab, now a panel reached from this button).

- **Home.** Cards, in this default order: Approvals (top waiting item with Allow/Deny), Agents (who is working on what, goals done, cost today), Calendar (next three events, Join when the event has a meeting link), Timer (running timer), Notes (latest two, quick add). Cards can be reordered and hidden in settings. Trackers, Music and Performance cards exist and are hidden by default.
- **Approvals.** Today's approval and hire cards, all decisions and keys unchanged.
- **Agents.** Today's Sessions and Today lists, the chat form, and the pinned quick actions (dock).
- **Calendar.** Today and tomorrow's events from the calendar link, plus today's month grid and second clock. Without a link: the month grid and a "paste your calendar link" field with a one-paragraph explanation of where to find it in Outlook and Google Calendar.
- **Timer.** Countdown timers (several at once, named), a stopwatch, and a Pomodoro cycle (25/5, four rounds, lengths adjustable). A finished timer chimes (respecting mute) and shows in the closed notch.
- **Notes.** A plain list of short text notes: add, edit, delete, reorder. No formatting.
- **Music.** Today's now-playing card and lyrics, larger.
- **Trackers.** Gauges from data the app already has: Claude plan limit used (session and weekly), cost today and this week, agent turns today. Plus one user tracker type: a named counter with a daily goal (for example glasses of water), reset at local midnight. (The owner asked for "other trackers" without naming any; this set is the writer's choice.)
- **Performance.** FPS now, 1% low, average, a frame-time strip, GPU load and temperature, CPU load, memory. Outside a game: the same without FPS.

### Glass

- Windows 11: the window uses the system backdrop material (acrylic), frameless, with the window itself sized and positioned to the notch's current rectangle, so the blur fills exactly the notch. The window's top edge sits slightly above the screen top so only the bottom corners are rounded.
- macOS: the equivalent vibrancy material, same window-hugs-the-notch approach.
- Linux, Windows 10, or when the material fails: a transparent window with a CSS glass look (tinted, translucent, no real blur), as today's transparent window works.
- A setting chooses Glass / Solid; Solid is today's opaque look and is the fallback if glass misbehaves.
- **This is the riskiest part and is proven first**, on the owner's PC, before anything else is built: does the material stay blurred while the window is not focused, does resizing the window every animation frame stay smooth, and does the bottom-corners-only shape hold. If resizing per frame is not smooth, the window jumps to the final size and the content animates inside it. If the material cannot be made to work, the CSS look ships for Windows too and the design is otherwise unchanged.

### Game mode

- **Is a game in front?** Windows only. True when the foreground window covers its whole monitor and its process is not on a short ignore list (browsers, video players, the app itself), or its process name is on a known-games list the user can add to. The existing fullscreen detection is kept for Smart visibility; game mode is a separate signal. A manual switch (Auto / Always / Never) is in settings.
- **FPS.** From PresentMon (Intel, MIT licence), run as a child process only while game mode is on and the notch is visible, watching only the foreground game's process. PresentMon needs the user to be in the Windows "Performance Log Users" group. Settings has a "Turn on FPS" button that explains this, asks for admin once to add the user to that group, and says a sign-out is needed. Without it, Performance shows load and temperature and says how to turn FPS on. The PresentMon executable ships with the app with its licence notice.
- **Load and temperature.** GPU and CPU load and memory from Windows performance counters; GPU temperature from `nvidia-smi` when present. Missing values are left out, not shown as zero.
- macOS and Linux: no game mode; Performance shows CPU load and memory only.

### Calendar link

- The user pastes one private calendar (ICS) link. The desktop process fetches it (https only) every 15 minutes while the notch is on, parses events for today and tomorrow (including simple repeating events), and passes only those events to the page.
- A meeting link in the event (Teams, Zoom, Meet) becomes a Join button that opens the default browser.
- Fetch errors show a plain message on the Calendar tab and never clear the last good events for the day.

### Data and storage

- Notes, timers, trackers and the Home layout are stored in the app's config folder next to `kiro.json`, in their own file, validated on read like the existing settings. Timers survive an app restart (end times are stored, not remaining time).
- Existing island settings carry over. New settings are added to the existing validated settings object.

## Staging (each stage leaves a working notch)

1. Glass proof on the owner's PC (window material, hug-the-notch resizing, corners), with the Glass / Solid setting.
2. New shell: closed states, wide open state, tab row, Home with the cards that already have data (Approvals, Agents, Music), today's Settings behind the settings button. Everything the island does today works here.
3. Notes and Timer.
4. Calendar link.
5. Trackers.
6. Game mode: detection, load and temperature, then PresentMon FPS and its one-time setup.
7. Docs (island spec, site doc, changelog), settings migration check, live check.

## Decisions added after the builder check (the writer's calls)

1. **Window per look.** Transparency is fixed when a window is created, and the system material needs a non-transparent frameless window. So the notch window is created in one of two forms: *material* (Windows 11 / macOS glass) or *transparent* (CSS glass and Solid). Switching Glass / Solid, or a material failure at runtime, destroys and recreates the window. The corner radius of a material window is whatever the OS gives (fixed); the spring-animated radius applies only to the transparent form.
2. **No per-frame window resizing.** The window jumps to the final rectangle of the next state and the content animates inside it (grow: resize first, then animate; shrink: animate, then resize). This is the default and only mode; it also avoids the mixed-DPI `setBounds` problem.
3. **Stage 1 pass/fail** (the implementer measures and reports; the controller decides, no owner stop): the material is visibly blurred with another app focused for 60 s; open and close 20 times shows no white or black flash and no frame where the window rectangle is visible outside the notch; only the bottom corners are rounded. Any failure → Windows ships the CSS glass look in the transparent form, and the rest of the design is unchanged.
4. **Hit area.** The window is exactly the notch's visible rectangle and is interactive (no click-through forwarding needed in the material form). Hover-open and leave are decided in the main process from the cursor position against the closed and open rectangles with the existing edge and leave delays, so a resize under a still cursor cannot flicker.
5. **Game mode and Smart visibility.** When game mode is on (Auto and a game is in front, or Always), the closed game notch is shown even where Smart would hide for fullscreen. Game mode Never restores today's behaviour exactly. Now playing stays paused behind a fullscreen app as today.
6. **Trackers data.** "Agent turns today" is dropped (no data source). The built-in gauges are: plan limit used (session and weekly), cost today, cost this week, output tokens today, all from the usage data the page already receives. When plan limits are unavailable the gauge reads "Not available" with the reason, never 0%.
7. **PresentMon is a spike with an exit, before any FPS UI is built.** Use the standalone console build (1.x, single executable) from the project's GitHub releases, vendored into the repository under `vendor/presentmon/` with its licence file and its SHA-256 recorded; the app never downloads it. Exit test on the owner's PC: with the user in "Performance Log Users" and no elevation, it reports frame times for a running borderless game or a 3D test window. If it does not, FPS is dropped from this version, Performance shows load and temperature only, and the setup button is not built.
8. **Calendar link rules.** `webcal://` is rewritten to `https://`. Only https is fetched; up to three redirects are followed, https only; the response is capped at 2 MB and 10 s. Tests and the live check use a fixture `.ics` served locally; a real link is the owner's to paste in. The link is stored in its own encrypted file in the config folder (reusing the existing save/load helpers with URL validation) and "Remove link" deletes that file and the cached events.

## Left to the builder

- Exact sizes, spacing, icon drawings, card proportions, and how Home lays out at narrower widths.
- File layout (the island page may be split into modules) and the IPC message names.
- The ICS parser's depth beyond: single events, all-day events, time zones, and RRULE daily/weekly/monthly with EXDATE; anything rarer may be skipped and listed in the docs.
- The known-games and ignore lists' initial contents.
- How the live check drives the notch window without registering the installed app's shortcut or tray.

## Decided by the writer, not discussed with the owner

- Notch first, side rail second.
- The nine tabs, Home's default cards, and what Trackers contains.
- Calendar refresh every 15 minutes; today and tomorrow only.
- Glass / Solid setting, with Solid as the fallback.
- NotchX's extra tools are out of this version.
