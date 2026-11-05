# Configuration

Preferences, environment variables, settings files, the scheduler job and the terminal bridge.

(Agent Office v1.2.8, 2026-11-04)


State lives in `~/.claude/agent-office/`. Preferences are in `kiro.json`; the tray menu and the island Settings tab write most of them, and you rarely need to edit it by hand.

| Setting in `kiro.json` | Meaning |
|---|---|
| `agentNames` | Display-name overrides (`tiro` and the eight specialist keys). |
| `islandMode` | `always` (default) or `smart`. (`off` is an older spelling of "no notch" and is converted to `notchEnabled: false` on first start.) |
| `islandSettings.notchEnabled` | The notch exists: `true` (default) or `false` (the window is closed and nothing runs for it). |
| `islandSettings.notchShortcut` | Optional global shortcut that toggles the notch, for example `Ctrl+Alt+N` (empty = none, the default; 2 or 3 modifiers plus a letter, digit or F-key; `Ctrl+Alt+K` is reserved). |
| `islandMute` | Silence the approval and done chimes. |
| `islandDisplay` | `cursor` (default), `primary` or a display id. |
| `islandSettings` | Island theme, motion, pinned actions, clocks, `nowPlaying`, `lyrics` (off by default: turning it on looks songs up at lrclib.net, see the guide), `kiroFace`, `animate`, `powerSaver` (default on: caps redraw rates and pauses idle animations to save GPU; see the guide). |
| `updateAuto` | Check for updates on start (default on). The update feed itself is fixed in the app and cannot be set here. |
| `tiroIdleMinutes` | Close Tiro's idle `claude` session after this many minutes and resume it with the next goal (default 15, `0` = never). |
| `limitsProbeMinutes` | Minimum minutes between plan-limit checks (default 15, at least 5). The check only runs while a window is visible or Tiro is working. |
| `autostart` | Start with Windows (packaged app, default on). |
| `hidden`, `x`, `y` | Whether the desktop Tiro is hidden, and where it sits. |
| `workDir` | Folder Tiro runs in, so Claude Code resolves project settings and CLAUDE.md as it would from there (default: your home folder). |
| `retentionDays` | Delete old history summaries, reports and finished goals after this many days (7 or more; off by default). |
| `schedulerMailbox` | The one mailbox the scheduler job may report on (see below). |

**Environment variables**

| Variable | Effect |
|---|---|
| `AGENT_OFFICE_PORT` | Pins the server to one port (dev servers next to an installed copy). Unset, the server uses 4777, or the next free port up to 4796 when another program holds it, and writes the port it bound to `bridge.json`; the desktop app and the terminal bridge follow it. |
| `AGENT_OFFICE_TEAM_ONLY=1` | Presentation mode: show only Tiro and its specialists. |
| `AGENT_OFFICE_SHOW_ALL=1` | Show the logs and prompts of your other Claude sessions on their desks (hidden by default). |
| `AGENT_OFFICE_MAILBOX` | The one mailbox the scheduler job reports on (overrides `schedulerMailbox`). |
| `CLAUDE_CODE_PATH` | Where the Claude Code executable is, if it is not found automatically. |

Other files in `~/.claude/agent-office/`: `bridge.json` (port and terminal bridge key, do not share), `switches.json`, `goals.json`, `credits.json`, `scheduler.json`, and `agents/`. Reports, daily notes, memory and SOPs live in your Obsidian vault (or `~/Documents/Agent Office Vault`). Claude Code transcripts stay in `~/.claude/projects`. The full list is in the guide.

**Scheduler job.** `node scheduler-job.mjs --dry-run` tries it without writing anything. Agent Office has no mail access built in: you provide a read-only reader that writes `~/.claude/agent-office/inbox-feed.json`. See docs/scheduler.md.

**Terminal bridge (optional).** Install the bridge plugin so your own Claude Code terminals can receive messages and send approvals to the office:

```
claude plugin marketplace add Ic3krem/agent-office
claude plugin install agent-office-bridge@agent-office
```


## Settings files

All state is under `~/.claude/agent-office/` (your home folder). Nothing here needs editing by hand, but it is plain JSON and safe to inspect.

| File or folder | What it holds |
|---|---|
| `bridge.json` | Server port and the terminal bridge key (opens `/bridge/*` only). The UI key is never stored. |
| `kiro.json` | Desktop and island preferences: `agentNames`, `islandMode`, `islandMute`, `islandDisplay`, `islandSettings` (including `notchEnabled` and `notchShortcut`), `updateAuto`, `tiroIdleMinutes`, `limitsProbeMinutes`, `hidden`, optional `schedulerMailbox`. |
| `switches.json` | Breaker box switches. |
| `manager.json` | Tiro auto-approval on or off. |
| `manager-session.json` | Id of Tiro's current session (one per day). |
| `goals.json` | Today's board. |
| `credits.json` | Extra-usage credit log. |
| `scheduler.json`, `scheduler-seen.json`, `inbox-feed.json` | Scheduler status, its dedupe list, and its input feed. |
| `agents/tiro/...` | Per-agent memory and history. |

Reports, daily notes, memory and SOPs live in your vault (`Agent Office/` folder). Claude Code transcripts stay in `~/.claude/projects`. Environment variables: `AGENT_OFFICE_PORT` (server port), `AGENT_OFFICE_TEAM_ONLY=1` (show only Tiro and its team), `AGENT_OFFICE_MAILBOX` (scheduler mailbox) and `CLAUDE_CODE_PATH` (where Claude Code is).

