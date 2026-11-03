# Agent Office

[![Latest release](https://img.shields.io/github/v/release/Ic3krem/agent-office)](https://github.com/Ic3krem/agent-office/releases/latest) [![Downloads](https://img.shields.io/github/downloads/Ic3krem/agent-office/total)](https://github.com/Ic3krem/agent-office/releases) [![License: Proprietary](https://img.shields.io/badge/license-proprietary-red)](LICENSE) ![Windows, macOS, Linux](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-orange)

**A pixel office for your own Claude Code agents.** Tiro, a little orange cube-crab, is the office manager. Give Tiro a task and it plans the work, asks you before it hires any of eight specialist agents, shows you the permission prompts Claude Code would show you, files reports and remembers what it learned in a vault of plain Markdown notes. The office itself spends **no tokens**: every piece of furniture reads files, switches and system data directly, and models only run while an agent works, through your own Claude Code install and plan.

![The Agent Office dashboard: eight specialists at their desks, a hire approval card on the goal board and the status bar on top](docs/images/hero.png)

## Contents

[Features](#features) - [Gallery](#gallery) - [Install](#install) - [Update](#update) - [Uninstall](#uninstall) - [Configuration](#configuration) - [Build from source](#build-from-source) - [Cutting a release](#cutting-a-release) - [Security model](#security-model) - [Documentation](#documentation) - [License](#license)

## Features

New and current in **1.2.5**:

- **Renamable agents.** Give Tiro and each specialist a display name (up to 20 characters). Ids, folders and types never change, and no agent can take another's current or default name.
- **Strict hiring approvals.** Tiro cannot hire on its own: every hire needs your one-shot approval, which expires after 10 minutes and is cleared whenever Tiro's session ends or resets.
- **One person per specialist.** An extra agent of an already-hired type is shown as a labelled "helper", never as another full copy.
- **Per-agent memory and history.** Each agent type has its own `memory/` and `history/` folder under Tiro. Every task starts in a fresh context, and an **Agent history** overlay lets you browse past tasks, summaries and transcript paths.
- **Silhouette click areas.** Furniture and characters are picked by their drawn shape (hover shows an outline), and depth sorting keeps a character from being hidden behind its own desk.
- **Garden, park, garage and Scheduler station.** The office has a fenced park and a garage. The Scheduler station shows the last result of the scheduler job, which classifies a local inbox feed into task, need and info items. Agent Office has no mail access of its own.
- **Dynamic island.** A notch-style overlay with live agent status, approvals, quick actions, now playing with synced lyrics, themes and a settings tab.
- **Your Claude Code, unchanged.** Tiro and every agent it hires load the same settings, permissions, hooks, MCP servers, CLAUDE.md, skills, plugins and environment as a plain `claude` run. Agent Office adds no approval rules of its own. See [docs/permissions.md](docs/permissions.md).
- **Updater.** Checks an https feed or a local folder and refuses any installer it cannot verify with a SHA-256.
- **Security.** Local-only server with a key, strict Content-Security-Policy with vendored React, ReactDOM and Babel, hardened Electron windows, and verified installs. See the [security model](#security-model).

Also in the office: a Today board, report bookshelf with PDF and Excel export, memory corkboard, editable SOPs, a breaker box of hard switches (including a subscription guard that stops at your plan limit instead of spending extra-usage credits), a server rack, coffee machine, arcade, jukebox and more. Tiro lives on your desktop too, and its mood follows the work:

![Tiro's moods: idle, working, needs approval, celebrating, paused](docs/kiro-moods.png)

### The team

Tiro leads a fixed team of eight specialists, at most 8 working at once:

| Name | Role | Model | Tools |
|---|---|---|---|
| Pixel | Frontend engineer | sonnet | read, web, Bash, Edit, Write |
| Forge | Backend engineer | sonnet | read, web, Bash, Edit, Write |
| Warden | Security reviewer | opus | read-only (+ web, Bash) |
| Probe | QA and test engineer | sonnet | read-only (+ web, Bash) |
| Atlas | Deep researcher | opus | read-only (+ web, Bash) |
| Cabalan | Researcher | haiku | read-only (+ web, Bash) |
| Tally | Task checker and organizer | haiku | Read, Grep, Glob, Edit, Write |
| Scribe | SOP and document writer | sonnet | read, web, Edit, Write |

Old type names (researcher, builder, ops, writer, reviewer) still work and map to Cabalan, Forge, Forge, Scribe and Probe. Agent sessions skip your global plugins, hooks and MCP servers and load only the tools they use, which cut measured per-turn context from 48K to 16K tokens for Tiro and from 42K to 8K for specialists. Tiro runs on Sonnet at medium effort and picks Haiku, Sonnet or Opus for each hire.

## Gallery

All screenshots use demo data. The [user guide](docs/GUIDE.md) has the rest.

| The office | Approve each hire |
|---|---|
| ![The whole office with eight specialists at work](docs/images/01-dashboard-overview.png) | ![Tiro asking to hire Warden, with Approve hire and Deny](docs/images/08-hire-approval-card.png) |

| Rename your team | Per-agent history |
|---|---|
| ![The team panel with a rename box per agent](docs/images/07-team-panel-rename.png) | ![Agent history with Forge's past tasks](docs/images/09-agent-history-overlay.png) |

| Scheduler station | Click outlines |
|---|---|
| ![The Scheduler and Garage panel](docs/images/11-scheduler-panel.png) | ![A desk outlined on hover](docs/images/15-click-outline-hover.png) |

## Install

**Requirements:** [Claude Code](https://claude.com/claude-code) installed and logged in (run `claude` once). Agent Office uses your own Claude Code install and plan. Windows 10 or later, macOS, or Linux.

> **Release status:** [v1.2.5](https://github.com/Ic3krem/agent-office/releases/tag/v1.2.5) is the latest release. It currently ships the **Windows installer only**; macOS and Linux builds are not published yet, so `install.sh` finds no asset for them. On those systems build from source for now.

**Windows installer.** Download `Agent-Office-Setup-<version>.exe` from [Releases](https://github.com/Ic3krem/agent-office/releases/latest) and run it. It is a normal setup wizard where you can pick the folder. It adds a Start menu entry and a desktop shortcut.

**One-line install** (downloads the latest release, verifies it, installs it and adds a desktop shortcut):

```powershell
irm https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.sh | bash
```

Both scripts download over https and **verify the asset's SHA-256** against the digest GitHub publishes for that release asset. They stop, and install nothing, if there is no published release, the asset has no digest, or the hash does not match. The Windows script installs silently for the current user. Other downloads are on the Releases page: `.dmg` (macOS Apple Silicon or Intel), `.zip` (macOS), `.AppImage` or `.deb` (Linux).

Piping a script into your shell trusts whatever is on `main`. To review first or pin a release, download the script from a release tag (for example `.../Ic3krem/agent-office/v1.2.5/install.ps1`), read it, then run it from disk.

The builds are **not code-signed**. Windows SmartScreen may ask you to confirm with "More info", then "Run anyway". The macOS script clears Gatekeeper's quarantine flag for you.

## Update

Open the island's Settings tab and use **Updates**. Set the update feed to an `https://` JSON URL (the GitHub API URL `https://api.github.com/repos/Ic3krem/agent-office/releases/latest` works for a public repo and uses the SHA-256 digest GitHub shows on the release asset), or to a local file or a folder holding `latest.json` (`{ "version", "url", "sha256", "notes" }`). Checking on start is on by default but only checks. Installing always needs your click ("Update now"), which downloads, verifies and runs the installer and quits the app. An installer fetched over the network is refused unless the feed supplies its SHA-256 and the download matches. A local feed without one is allowed but shows an "Unverified installer" warning. You can also re-run the install script, which replaces the app in place. Details: [docs/island-spec.md](docs/island-spec.md).

## Uninstall

- **Windows:** Settings, Apps, Installed apps, Agent Office, Uninstall.
- **macOS:** delete `/Applications/Agent Office.app`.
- **Linux:** delete `~/.local/bin/agent-office.AppImage` and the `agent-office.desktop` entries; if you installed the `.deb`, remove it with your package manager.
- Your data stays in place: `~/.claude/agent-office` (state and per-agent folders) and your vault notes. Delete them for a clean slate.

## Configuration

State lives in `~/.claude/agent-office/`. Preferences are in `kiro.json`; the tray menu and the island Settings tab write most of them, and you rarely need to edit it by hand.

| Setting in `kiro.json` | Meaning |
|---|---|
| `agentNames` | Display-name overrides (`tiro` and the eight specialist keys). |
| `islandMode` | `always` (default), `smart` or `off`. |
| `islandMute` | Silence the approval and done chimes. |
| `islandDisplay` | `cursor` (default), `primary` or a display id. |
| `islandSettings` | Island theme, motion, pinned actions, clocks, `nowPlaying`, `lyrics`, `kiroFace`, `animate`. |
| `updateFeed`, `updateAuto` | Update feed (https URL, file or folder) and check on start (default on). |
| `autostart` | Start with Windows (packaged app, default on). |
| `hidden`, `x`, `y` | Whether the desktop Tiro is hidden, and where it sits. |
| `workDir` | Folder Tiro runs in, so Claude Code resolves project settings and CLAUDE.md as it would from there (default: your home folder). |
| `retentionDays` | Delete old history summaries, reports and finished goals after this many days (7 or more; off by default). |
| `schedulerMailbox` | The one mailbox the scheduler job may report on (see below). |

**Environment variables**

| Variable | Effect |
|---|---|
| `AGENT_OFFICE_PORT` | Port for `node server.mjs`. The desktop app always uses 4777, so use this for dev servers on a spare port. |
| `AGENT_OFFICE_TEAM_ONLY=1` | Presentation mode: show only Tiro and its specialists. |
| `AGENT_OFFICE_SHOW_ALL=1` | Show the logs and prompts of your other Claude sessions on their desks (hidden by default). |
| `AGENT_OFFICE_MAILBOX` | The one mailbox the scheduler job reports on (overrides `schedulerMailbox`). |
| `CLAUDE_CODE_PATH` | Where the Claude Code executable is, if it is not found automatically. |

Other files in `~/.claude/agent-office/`: `bridge.json` (port and terminal bridge key, do not share), `switches.json`, `goals.json`, `credits.json`, `scheduler.json`, and `agents/`. Reports, daily notes, memory and SOPs live in your Obsidian vault (or `~/Documents/Agent Office Vault`). Claude Code transcripts stay in `~/.claude/projects`. The full list is in the [guide](docs/GUIDE.md#settings-files).

**Scheduler job.** `node scheduler-job.mjs --dry-run` tries it without writing anything. Agent Office has no mail access built in: you provide a read-only reader that writes `~/.claude/agent-office/inbox-feed.json`. See [docs/scheduler.md](docs/scheduler.md).

**Terminal bridge (optional).** Install the bridge plugin so your own Claude Code terminals can receive messages and send approvals to the office:

```
claude plugin marketplace add Ic3krem/agent-office
claude plugin install agent-office-bridge@agent-office
```

## Build from source

Node 24 is what CI uses.

```
npm ci             # install exactly what package-lock.json lists
npm start          # run the desktop app (electron .)
npm test           # all node:test suites; no network or models needed
npm run dist       # electron-builder: installer for this OS, written to dist/
```

`node --check <file>` syntax-checks any `.mjs` file. To run a server next to an installed copy, set `AGENT_OFFICE_PORT` and a temporary `USERPROFILE` so it does not touch the installed app's key and state.

`npm run dist` on Windows produces `dist/Agent-Office-Setup-<version>.exe` (NSIS), plus `latest.yml`, a `.blockmap` and the unpacked app. macOS builds are `Agent-Office-<version>-<arch>.dmg` and `.zip`; Linux builds are `Agent-Office-<version>-<arch>.AppImage` and `.deb`. Any new root-level `.mjs` file must be added to `build.files` in `package.json`, or the packaged app will not start.

## Cutting a release

1. Branch is clean and `npm test` passes.
2. Bump `version` in `package.json` and add the entry to [CHANGELOG.md](CHANGELOG.md).
3. Build the installer with `npm run dist` (or let CI do it, below), test that exact installer, and keep `dist/Agent-Office-Setup-<version>.exe`, its `.blockmap` and `latest.yml`.
4. Publish it: `gh release create v<version> --target <commit> --latest <the three files>`. This creates the tag and the release with exactly the files you tested. `.github/workflows/release.yml` is **manual-only** (`workflow_dispatch`) for now, so a tag push does not start CI and cannot replace the tested installer. To build all three platforms in CI, run that workflow by hand (it runs `npm ci`, `npm test`, then `npx electron-builder --publish always` on Windows, macOS and Linux runners), or restore the `push: tags: ['v*']` trigger once the CI builds are QA'd.
5. Open the published release and confirm each installer shows a **SHA-256 digest**. The install scripts and the updater need that digest, so an asset without one cannot be installed through them.
6. Install the published build once and confirm the dashboard renders.

More in [docs/RESOURCES.md](docs/RESOURCES.md).

## Security model

- **Local only, two separate credentials.** The server binds `127.0.0.1` and rejects any other `Host` header (DNS rebinding). The terminal bridge key in `bridge.json` opens `/bridge/*` only. The UI key exists only in the Electron process and the server's memory and reaches the windows as an HttpOnly, SameSite=Strict cookie, so an agent that can read `bridge.json` still cannot approve its own requests. Decisions also need a per-session nonce. Keys are compared by hash in constant time and never logged.
- **Strict Content-Security-Policy.** Pages load scripts, styles and fonts only from the app itself (`script-src 'self'`, plus inline and eval, which the page runtime needs). React, ReactDOM, Babel standalone and the fonts are vendored in `public/` (pinned SHA-384 hashes for the scripts, OFL licence texts for the fonts), so nothing loads from a CDN or Google Fonts. Framing, plugins and `<base>` tricks are blocked.
- **Electron hardening.** Windows run with context isolation and sandbox on, `nodeIntegration` off and `webSecurity` on. They cannot navigate away from the local server or open webviews, and external links open in your browser.
- **Verified installs.** The install scripts and the updater check SHA-256 before running anything, and use https only.
- **Hiring and approvals.** Tiro cannot hire without your one-shot approval, tied to the goal and the exact first prompt. Tool permissions are Claude Code's own: what your settings allow runs, what they deny is denied, and what Claude Code would ask about is shown to you with Claude Code's choices. Agent Office does not auto-approve anything.
- **No built-in mail access.** The scheduler only reads a local feed file.
- **Your data.** Office state and notes stay on your machine; model calls go through your Claude Code install to Anthropic, as in the terminal. The server needs the local key for every API call.
- **Unsigned builds.** If in doubt, compare the SHA-256 the install script prints with the one GitHub shows on the release asset.

Report a vulnerability by opening a private security advisory on the GitHub repository.

## Documentation

| Document | What it covers |
|---|---|
| [docs/GUIDE.md](docs/GUIDE.md) | The full user guide: every panel, the island, tray, settings files, API table, troubleshooting, FAQ |
| [docs/RESOURCES.md](docs/RESOURCES.md) | Index of links, architecture notes, dev setup, release checklist |
| [CHANGELOG.md](CHANGELOG.md) | What changed, 1.1.0 to 1.2.5 |
| [docs/permissions.md](docs/permissions.md) | Claude Code parity: what is the same, what differs, what reaches you |
| [docs/agents-and-memory.md](docs/agents-and-memory.md) | Team, hiring gate, per-agent memory and history |
| [docs/scheduler.md](docs/scheduler.md) | Scheduler station, job and feed file |
| [docs/office-spec.md](docs/office-spec.md), [docs/island-spec.md](docs/island-spec.md) | Office world and island design notes |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Dependency licenses |

## License

Proprietary, all rights reserved ([LICENSE](LICENSE)), (c) 2026 the owner. Only the owner may edit or redistribute it. Dependency licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Note that `@anthropic-ai/claude-agent-sdk` is Anthropic's proprietary software under its own terms. Not affiliated with Anthropic: Claude and Claude Code are Anthropic products, and Agent Office runs on your own Claude Code install.
