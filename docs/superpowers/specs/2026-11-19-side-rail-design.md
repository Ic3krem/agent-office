# One side rail on every screen (design)

Date: 2026-11-19. Branch: feature/world. Ships after 2.1.0 (version to be set at release; assume 2.2.0).
Audit this design answers: `docs/superpowers/specs/2026-11-19-ui-audit.md` (every control with file:line, 13 findings).
Mockups the owner approved: https://claude.ai/artifact/LP2fUYGRAn6fKAtoh26smd (four boards: office with the Work panel, town with the place switcher, meeting room with the Party panel on Voice, and the "where everything goes" table).

## Intent

Each update since 2.0 added its buttons, tabs and panels wherever there was room. The owner's words: "due to updates buttons are not placed properly, or the navigation, the tabs." The office and the town now behave like two different apps, the settings button is in a different corner on each, panels open on top of each other, and several tools have no button at all. This is a structure cleanup: every screen gets the same navigation, each function gets one obvious home, and panels behave the same way everywhere. It is not a restyle.

## Goals

1. One navigation rail on the left edge of every page and scene: office, karinderya, game hall, meeting room, town. Same buttons, same order, same position.
2. One panel slot beside the rail. Opening a panel closes the one that was open. Panels never overlap each other.
3. Every function reachable from exactly one rail button (furniture stays as a second, shortcut entry).
4. Office and town show the same panel for the same thing (Party, Music, Settings, Work, Build).
5. Works at 1000×700 without wrapping or covering the world by more than the panel's own width.
6. Keyboard and screen-reader use is at least as good as today and consistent: every panel closes with Esc, focus moves into a panel when it opens and back to its rail button when it closes.

## Non-goals

- No new look. Colours, pixel fonts and the dark amber theme stay; panel chrome is unified to the existing HUD style, not redesigned.
- No feature is removed except the dead controls listed below.
- No change to the island/notch window, the Tiro mascot window, the tray menu or the key/sign-in windows. (The notch is a separate project.)
- No change to what any panel does internally (Party hosting, music sources, build tools, graphics options), beyond moving it and merging office/town duplicates.
- No change to the party protocol, the local API, or the voice engine.

## Anti-goals

- A rail that exists on some screens and not others, or differs between them.
- Two panels visible at once.
- A control that used to be visible becoming keyboard-only or furniture-only.
- The microphone consent, mute and leave behaviour of the meeting room changing in any way other than where its controls are drawn.

## Constraints

- No new npm dependency. No framework change: the office page stays the single-file DCLogic component (`public/Agent Office.html`), the town stays `public/town.html` + `hud.js`.
- Performance budgets still pass: `npm run perf:town`, office-perf (memory slope is already 0.274 against 0.3 MB per cycle, so the rail must not add per-frame work or retained DOM per open/close).
- Reduced motion, Power saver and the Low preset: panel open/close has no animation under any of them.
- All existing live checks keep passing, updated only where they click a control that moved: `check:hud`, `check:meet` (both modes), scene-check.
- Touch targets at least 44 px; text contrast 4.5:1.
- Test runs that launch the app use `--mute-audio` and temp profiles.

## Approaches considered

- **A. Side rail (chosen).** A slim icon rail on the left edge with one panel slot beside it, identical on every screen. Only one panel can be open, so overlap is impossible by construction; it costs a fixed 64 px at any window size. Cost: the biggest change, since both pages move onto one shared shell.
- **B. One top bar with tabs.** Closest to today's office header, but it is the layout that already wraps to two rows at 1000×700, and it takes vertical space the isometric view needs.
- **C. Tidy in place.** Fix the overlaps and the town menu bug, group the hamburger menu, remove dead controls. Cheapest, but office and town stay different and the navigation does not really change.

The owner picked A.

## The design

### The rail

64 px wide, full height, left edge, above the world and below modal dialogs. Buttons are 48 px icon buttons with an `aria-label` and a hover/focus tooltip showing the name. The open panel's button is highlighted. Top to bottom:

| Button | Panel contents (tabs) | Replaces today |
|---|---|---|
| **Place** (icon and short label of the current place) | A "Go to" menu: Office, Town, Karinderya, Game hall, Meeting room. The current place is marked. | "Back to town", "Town", "Back to the office" |
| **Work** | Today (goal list, add goal, **Give Tiro a task**, Ask Tiro to check in / Start the workday, Tidy office, Fresh Tiro) · Reports · History | Today board, header task button and dispatch popover, Reports pill, "Agent history" button |
| **Approvals** (count badge) | Everything waiting for a yes or no, each with its full prompt and Allow / Deny | The "Awaiting permission" pill and the other approval entry points; Y/N keys keep working and are shown as hints on the buttons |
| **People** | Team · Desks and sign-ins (today's Agents panel) · Claude account · Wardrobe | Team, Agents and Claude menu rows |
| **Party** | Chat · People (guests, visit, presence) · Voice · Games | Office Party panel, town Party panel, the meeting-room box |
| **Music** | Background music · Party music · Jukebox | Music panel, the party-music blocks mounted elsewhere, jukebox window |
| **Build** | Build mode (toolbar, palette, zones) · Templates · Manor themes | Build pill, town "Build" row, Manor row |
| **Office tools** | Memory · SOPs · Scheduler · Server rack · Breaker box · Usage | Furniture-only windows, the usage pill |
| *(spacer)* | | |
| **Settings** (bottom) | Graphics · Power saver · Labels · Follow me · Notch on/off · Updates and Guard (desktop only) · Voice relay | Office hamburger, town hamburger, graphics modal/side panel |

Rules:
- Clicking a rail button opens its panel; clicking it again, the panel's close button, or Esc closes it. Opening another closes the first.
- A panel remembers its last tab for the session.
- The rail is present in every scene. Tabs that make no sense in a place are still listed but explain themselves (for example Voice outside the meeting room says "Voice works in the meeting room" with a **Go to the meeting room** button; Build in the town opens the office in build mode, as today, after saying so).
- Furniture keeps working as a shortcut: clicking the bookshelf opens Work › Reports, the breaker box opens Office tools › Breaker box, and so on. The separate floating object windows go away; their content renders in the panel.
- The agent drawer (selecting a desk/agent) opens in the same panel slot as an untabbed "Agent" panel, replacing the right-hand drawer and the bottom sheet.

### The panel slot

340 px wide, full height, directly right of the rail, pushing nothing: it overlays the world, and the world's "Fit" centres on the remaining area. One title, one close button (44 px), optional tab row, scrolling body. All panels use this one chrome: one title style (the pixel font), one close button size, one button family. Below 900 px window width the panel is 300 px.

### What stays on the world

- **Status strip**, top right: working count, free count, cost today. Plain text, not buttons. Clicking the strip opens Office tools › Usage.
- **Zoom** (−, Fit, +), bottom right.
- Scene-specific in-world prompts (door hints, "Enter the meeting room").
- The meeting-room **consent card** stays a centred modal exactly as it is. After a choice, voice controls (mute, raise hand, reactions, leave) live in Party › Voice; the panel opens to that tab automatically on entering the room once a choice exists. The persistent "In the meeting room · mic on|muted|listen only" indicator moves to the status strip so it is visible with the panel closed, and M / H / 1–6 keep working with the panel closed.

### Removed

- The "Claude Code permissions" pill (it only shows a toast).
- The developer "Preview" menu item (kept reachable by its URL parameter / `window.__demo` only).
- Working / Free pills as button-styled elements (their numbers move to the status strip).
- The office header inside the karinderya, game hall and meeting room.
- Build `R` "coming later" toast.

### Bugs fixed on the way

- Town menu list always visible (`.hud-menu{display:flex}` beating `[hidden]`): the menu is replaced by the rail, and the rule goes.
- "null" text in the HUD when the desktop preload is absent.
- Esc closing only some panels; Party not closing Agents.

## How it gets built (decided)

- One shared shell module, loaded by both pages, owns the rail, the panel slot, open/close/Esc/focus, tabs and tooltips. `hud.js` already plays this role for the town and is loaded by the office; it grows into the shell rather than a second system being added.
- Panel bodies are registered with the shell by id. Town-side panels that exist only in `hud.js` and office-side panels that exist only in the DCLogic component are merged so each id has one implementation used by both pages. Where the office version has more (Party presence, Visit, Games; the Today board), the office version is the base.
- The work is staged so the app is usable after every stage: (1) shell + rail + panel slot with Settings and Place, on both pages; (2) Party and Music merged; (3) Work, Approvals, People; (4) Build and Office tools, furniture shortcuts; (5) meeting-room controls into Party › Voice, removal of the old header/hamburgers/dead controls, small-window pass.
- Pure decisions (which panel is open, tab memory, what a furniture click maps to, what a tab shows in a place where it does not apply) are functions testable in Node, in the style of `MeetRoom.entryAction`.

## Decisions added after the builder check (the writer's calls, not discussed with the owner)

1. **Place changes are page loads** (scenes reload the office page; the town is a separate page). The rail is drawn first on every load, before the world, and is not part of the fade. The open panel and each panel's last tab are kept in `sessionStorage` and restored after a place change. Entering the meeting room with a join choice already made opens Party › Voice regardless of what was open.
2. **The shell is a DOM island outside the DCLogic component**, as the HUD panels already are. Pages push data in (`setSnapshot`-style) and pass action callbacks; panel bodies re-render from that. A closed panel keeps no DOM; opening and closing must not grow memory (office-perf slope budget).
3. **World inset.** The world is inset by the rail's 64 px at all times. Opening or closing a panel does not recentre or move the world. Pressing Fit centres on the area not covered by the rail and the open panel. The town gets no new zoom controls in this project (it has none today); the zoom cluster shows only where zoom exists.
4. **Build mode.** The Build panel holds Start building, Templates and Manor themes. While building, the existing palette and toolbar are kept as they are, the palette sitting immediately right of the rail where the panel slot is; other panels can still be opened and cover the palette until closed. The palette is not rewritten.
5. **Meeting room.** `MeetRoom.mount` splits into three parts: the consent card (unchanged), the indicator (status strip), and a body rendered in Party › Voice. Voice does not need the Party panel open: the keys and the indicator work with it closed. When there is no party, an old host, no slot, or all eight taken, the Voice tab shows the same messages the room shows today.
6. **Approvals includes hires.** Everything that needs a yes or no (agent permission prompts, the inbox, hire requests, build's waiting items) is listed in Approvals and counted in its badge. Work › Today shows a one-line link ("1 hire waiting") instead of the card.
7. **Desktop-only rows** (notch, updates, Guard, sign-ins, music folder) are hidden when the desktop preload is absent, not shown disabled.
8. **Esc.** One handler in the shell replaces the three existing ones. Order: an open modal dialog (consent card, unsaved-layout box) first, then the open panel, then build mode's own Esc behaviour.
9. **Interiors.** Work, Approvals, People, Music and Settings show their normal contents in every scene; they are app-wide, not tied to the office floor.

## Left to the builder

- Icon drawings (inline stroke SVG, consistent weight), exact spacing, and the tooltip delay.
- File layout inside `public/` for the shell and panel registrations.
- How the office DCLogic component hands its panel bodies to the shell.
- Order of work inside each stage, and how existing tests and live checks are updated for moved controls.
- Whether the Approvals list reuses the existing approval card markup or the island's.

## Open, owner to confirm when reading

- The nine buttons and their groupings are the proposal the owner said "yup" to on the mockups; no individual grouping was discussed.
- The agent drawer moving into the panel slot (left) instead of the right-hand drawer was not shown on a mockup.
