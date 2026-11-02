# Changelog

Versions 1.1.0 to 1.1.4 are tagged in git (`v1.1.0` to `v1.1.4`). Builds 1.1.5 to 1.2.3 were internal installer builds with no git tag; their changes first reached git in the 1.2.4 branch, so they are grouped below. Where an entry names a version it comes from the project's own specs; otherwise the exact build is not recorded.

## Unreleased (security/core)

- **Claude Code parity.** Tiro and the agents it hires now load your user, project and local Claude Code settings with the full `claude_code` tool preset, your MCP servers, hooks, CLAUDE.md, skills, plugins and environment, and inherit your model, effort and permission mode. Tool permissions are Claude Code's own; the custom auto-approval rules ("Tiro auto-approve", the manager) are removed. Prompts show Claude Code's choices (Yes, Yes and don't ask again, No with an instruction) and question cards. Commands are never edited and prompts never time out into an answer. See `docs/permissions.md`.
- Bridge key and UI key are separate; the UI key is a cookie, `?key=` is gone, decisions need a nonce; keys are never logged.
- Hire grants are bound to the goal and the exact first prompt; a deny-only hook stops `claude` launches that skip `request_hire`.
- One shared redactor for Agent Office's own history, memory, reports and daily notes; seeded memory is scrubbed; scheduler subjects are untrusted and fenced and no longer written to Tiro memory.
- Fonts are vendored; the CSP has no remote host. Optional retention (`retentionDays`). Crash fixes (guarded request handler, process-level error logging).
- Known cost: because your hooks and MCP servers now load for Tiro and each hired agent, every turn carries their extra tokens (the earlier lean setup measured about 30K tokens per turn that way).

## 1.2.5 (2026-11-03)

Published as [v1.2.5](https://github.com/Ic3krem/agent-office/releases/tag/v1.2.5) with the Windows installer only (macOS and Linux builds are not published yet). The release workflow is manual-only for now so a tag push cannot replace the tested installer.

- The dashboard works under the strict Content-Security-Policy. React, ReactDOM and Babel standalone (same versions as before: 18.3.1, 18.3.1 and 7.29.0) are now shipped in `public/vendor/` and loaded from there with their SRI hashes unchanged, instead of from unpkg. `public/vendor/*` is marked binary so line-ending conversion cannot break the hashes.
- A test checks that every external host the pages reference is allowed by the CSP, that no script is remote, and that the vendored files match their hashes.
- The Kiro claw SVG no longer produces a double minus (`q--2 6 --7 7`) in its path data when mirrored.
- The plugin marketplace owner is now "Ic3krem".
- Documentation: README rewritten as the front page, new `docs/GUIDE.md` user guide with 17 demo screenshots, `docs/RESOURCES.md`, `docs/agents-and-memory.md`, `docs/scheduler.md`, refreshed office and island specs, and this changelog.

## 1.2.4

Security, cleanup and documentation.

- `install.ps1` and `install.sh` download over https and verify the SHA-256 that GitHub publishes for the release asset. They stop if the digest is missing or does not match.
- The updater refuses to run an installer downloaded over https unless the feed supplies its SHA-256.
- Electron windows run with `nodeIntegration` off, `webSecurity` on, context isolation and sandbox on, navigation locked to the local server, and webviews blocked.
- The server sends a Content-Security-Policy and related headers (`nosniff`, no referrer, no framing). It already bound to `127.0.0.1`, checked the `Host` header and compared the key in constant time.
- `.gitignore` excludes backups, the local release feed, local state and secrets. Local `*.bak-*` files were removed.
- The scheduler mailbox is configured (`AGENT_OFFICE_MAILBOX` or `schedulerMailbox`), not hardcoded.
- `THIRD_PARTY_NOTICES.md` added. `LICENSE` and the notices ship in the installer.
- New tests: `repo.test.mjs` (license consistency, ignore list, install scripts, Electron and CSP settings, no personal paths or secrets).

## 1.1.5 to 1.2.3 (internal builds)

Team and manager
- **Renamable team.** Tiro and each specialist can have a display name. Names are unique, never equal another agent's default name, and strip HTML tags. Ids, folders and `subagent_type` never change.
- **Strict hiring gate.** Tiro must ask with `request_hire`; one approval buys one hire and expires after 10 minutes. Pending cards and unused approvals are cleared when the manager session ends, resets or stops, and when hiring is switched off.
- **One person per specialist.** An extra agent of an already-hired type is shown as a labelled "helper".
- **Per-agent memory and history.** Folders under `~/.claude/agent-office/agents/tiro/<key>/{memory,history}`, each task starts with a fresh context, summaries are redacted, and an **Agent history** overlay with `/api/agents/*` endpoints lets you browse it.
- **Scheduler.** `scheduler-job.mjs` classifies a local inbox feed into task, need and info items, writes `scheduler.json` and a subject-only note for Tiro. It is read-only and has no mail access of its own.

Office
- New office world (Phase 2, 1.2.0 polish): isometric rooms, eight desk blocks, a walk graph, a movement state machine, procedural characters and furniture, preview mode, zoom and pan, day and night tint, reduced-motion support.
- East park and the scheduler garage with a read-only Scheduler panel.
- Furniture and characters are picked by their drawn silhouette, with outline highlighting, and drawn in footprint depth order.

Desktop island and updates
- Dynamic island: Always, Smart and Off modes, multi-monitor placement, hotkey `Ctrl+Alt+K`, approvals and quick actions, themes, motion presets, clock and calendar, pinned actions.
- Now playing (Windows media controls) and synced lyrics from LRCLIB (optional, off with the `lyrics` setting); compact notch shows the Tiro eyes (1.1.9).
- Update checker in Settings > Updates with SHA-256 verification (feed is an https URL, a local file or a folder with `latest.json`), and a warning when a feed has no SHA-256 (1.1.7).

## 1.1.4

- SOP notes now define the team and apply from Tiro's next turn.

## 1.1.3

- Credits today now count late-posted charges on the last over-limit day.

## 1.1.2

- README screenshots from a real test run, review fixes and presentation mode (`AGENT_OFFICE_TEAM_ONLY=1`).
- MIT license and README badges added in the commits just before this tag.

## 1.1.1

- Both macOS architectures are built on one runner.

## 1.1.0

- First release: the pixel office, the desktop manager, vault memory, reports with PDF and Excel export, office objects, and installers for Windows, macOS and Linux.
