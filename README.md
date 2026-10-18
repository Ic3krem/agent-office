# Agent Office

[![Latest release](https://img.shields.io/github/v/release/Ic3krem/agent-office)](https://github.com/Ic3krem/agent-office/releases/latest) [![Downloads](https://img.shields.io/github/downloads/Ic3krem/agent-office/total)](https://github.com/Ic3krem/agent-office/releases) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE) ![Windows · macOS · Linux](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-orange)

A pixel office for your Claude Code agents. **Kiro**, a little orange cube-crab, manages the office. Give Kiro a task and it plans the work, hires specialist agents, routes risky actions to you for approval, files reports and remembers what it learned in an Obsidian vault. The office itself spends **no tokens**. Every piece of furniture reads files, switches and system data directly, and models only run when an agent works.

![The office at work: Kiro at the center desk, two specialists waiting for approval, finished agents relaxing in the breakroom](docs/screenshot-office.png)

## See it

| Approvals come to you | Reports you can actually read |
|---|---|
| ![The inbox tray asking to approve an rm -rf cleanup command](docs/screenshot-approval.png) | ![A report with a summary, a findings table and next steps, exportable to PDF or Excel](docs/screenshot-report.png) |

| Kiro on your desktop | Kiro's moods |
|---|---|
| ![Kiro on the desktop celebrating a finished goal with a speech bubble](docs/kiro-desktop.png) | ![Kiro's moods: idle, every goal finished, agents working, building, planning, needs your approval, celebrating a goal, paused at the plan limit](docs/kiro-moods.png) |

These screenshots come from a real test run: four low-effort tasks (a research lookup, a checklist draft, a README review and a cleanup drill), all run on Haiku specialists.

## Install

You need [Claude Code](https://claude.com/claude-code) installed and logged in (run `claude` once). Agent Office uses your own Claude Code install and plan.

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.sh | bash
```

Both download the latest release, install it and put a shortcut on your desktop. You can also download an installer directly from [Releases](https://github.com/Ic3krem/agent-office/releases): `.exe` (Windows), `.dmg` (macOS Apple Silicon / Intel) or `.AppImage` / `.deb` (Linux). The builds aren't code-signed, so Windows SmartScreen may ask you to confirm with "More info → Run anyway". The macOS script clears Gatekeeper's quarantine flag for you.

## What's in the office

| Object | What it does (no tokens) |
|---|---|
| **Kiro** (desktop overlay) | Lives on your desktop. Click to chat, give tasks and approve requests; double-click to open the office. Its mood follows the work: typing, waving a flag when you're needed, confetti when a goal is done, asleep when paused. |
| **Today board** | Today's goals. Kiro works through them, marks them done or blocked, and suggests follow-ups that wait for your OK. |
| **Bookshelf** | Reports, color-coded by outcome (green done, amber partial, red needs you), plus an automatic daily report. Search them, or export to **PDF** or **Excel**. |
| **Corkboard** | Agent memory: notes in your Obsidian vault (`Agent Office/Memory`), drawn as pins and strings. Read, delete or link notes. |
| **Filing cabinet** | SOPs: Kiro's brief and each specialist's instructions, editable as vault notes. |
| **Inbox tray** (Kiro's desk) | Requests waiting for your approval. |
| **Breaker box** | Hard switches: Kiro on/off, autopilot, hiring, auto-approve, terminal approvals, and the **subscription guard**, which stops at your plan's 5-hour or weekly limit instead of spending extra-usage credits. |
| **Server rack** | CPU, memory, Docker containers and the office server log. Its LEDs go amber or red when something is wrong. |
| **Whiteboard** | Tokens per day, plan limits and extra-usage credits. |
| **Coffee machine** | Brew an espresso so Kiro's next hire uses the fast, cheap model. |
| **Arcade · Jukebox · Server plant** | A Bug Squasher game, generated lo-fi and rain sounds, and a plant that grows with every successful report. |

Agents behave like people. They type at their desk with a live token counter, go to the couch, arcade or jukebox when idle, wait at the water cooler with a countdown when rate-limited, and pace beside a smoking monitor when something fails.

## How it saves tokens

- Agent sessions skip your global plugins, hooks and MCP servers, and load only the tools they use. Measured per-turn context drops from 48K to 16K tokens for Kiro and from 42K to 8K for specialists.
- Kiro runs on Sonnet at medium effort and picks Haiku, Sonnet or Opus for each hire. Kiro is only nudged to continue when no specialist is out working, since their reports wake it anyway.
- Reports, memory search, the daily summary, exports and every office object are plain code.

## Your data

Office state and notes stay on your machine; model calls go through your Claude Code install to Anthropic, as they do in the terminal. Transcripts are in `~/.claude`, office state in `~/.claude/agent-office`, and reports, daily notes, memory and SOPs in your Obsidian vault (or `~/Documents/Agent Office Vault` if you don't have one). The server listens on `127.0.0.1` only and needs a random key that is stored locally.

## Optional: reply and approve from terminals

Install the bridge plugin so your own Claude Code terminals can receive messages and send approvals to the office:

```
claude plugin marketplace add Ic3krem/agent-office
claude plugin install agent-office-bridge@agent-office
```

## Presentation mode

Set `AGENT_OFFICE_TEAM_ONLY=1` before starting the app to show only Kiro and its specialists (handy for screenshots and demos).

## Build from source

```
npm install
npm start          # run the desktop app
npm test
npm run dist       # build an installer for this OS
```

Pushing a tag like `v1.1.0` runs `.github/workflows/release.yml`, which builds Windows, macOS (arm64 and x64) and Linux installers and publishes them as a GitHub release.

## License

[MIT](LICENSE). Not affiliated with Anthropic. Claude and Claude Code are Anthropic products; Agent Office runs on your own Claude Code install.
