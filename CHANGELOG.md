# Changelog

Versions 1.1.0 to 1.1.4 are tagged in git (`v1.1.0` to `v1.1.4`). Builds 1.1.5 to 1.2.3 were internal installer builds with no git tag; their changes first reached git in the 1.2.4 branch, so they are grouped below. Where an entry names a version it comes from the project's own specs; otherwise the exact build is not recorded.


## Unreleased (release/1.2.8)

- **Security Guard (new).** An ask-only layer that runs as hooks in every Agent Office session (Tiro and hired agents) and, through the bridge plugin, in terminals. It asks before secrets are sent off the computer (the real payload is checked; ignore files are not trusted), before secrets are written to cloud-synced folders, before ignore rules are overridden, before credential stores or the environment are read, before bulk harvesting, screen or clipboard capture, downloaded scripts and persistence, and after untrusted tool output tried to instruct the AI. Eight categories (S, Y, I, C, H, X, U, P), each ask, log or off; remembered answers only for exact C, H, X and U actions; a private audit log; weaker settings need a confirmation dialog in the desktop app and an HMAC (a weaker value written by an agent is ignored). Pure JavaScript, no dependencies, tested for Windows, macOS and Linux paths on every host. See `docs/security-guard.md`.

- **Security Guard review fixes.** Git pushes are checked from one bounded async `git diff -p` (a committed key in any file is found; a timeout asks instead of passing); credential folders ask even when the working folder is the home folder; remote paths are never opened and slow checks ask instead of passing; interpreter one-liners, relative MCP paths, DNS lookups, `git format-patch`/`bundle`/`request-pull` and globs are covered; remembered answers are signed; weaker key storage needs a typed word; the taint reset is per session; Agent Office sessions no longer run the Guard twice; the bridge plugin passes `claude plugin validate --strict`.

- **Security Guard, second review.** scp/rsync/sftp to host:/path are detected; the terminal Guard is only skipped for sessions the app registered (an environment variable alone no longer disables it); persistent environment changes ask; tunnels that expose a folder holding secrets ask; mapped network drives are treated like UNC paths.

- **Licence.** Agent Office is now proprietary: "Copyright (c) 2026 Ic3krem. All rights reserved." Only the owner may use, copy, modify or distribute it unless permission is given in writing; contributions need a signed written agreement. Versions published under MIT (v1.1.0 to v1.1.4 and v1.2.5) stay available under those terms. `LICENSE` is a draft pending legal review; `package.json` says `SEE LICENSE IN LICENSE`, the package is marked private, and the Windows installer shows the licence on its licence page (`LICENSE.txt`, a copy of `LICENSE`).
- **Lyrics are opt-in** (default off). Turning them on sends the playing track's title, artist, album and duration to lrclib.net; a one-time migration switches an old stored default off. Now playing itself sends nothing off the device.
- **Distribution by invitation.** The README no longer advertises install commands that cannot work on a private repository; the install scripts report HTTP 401, 403 and 404 in plain words; the CodeQL and dependency-review jobs skip on private repositories.
- The hiring wording now says Agent-tool hires require approval, and that the check that blocks launching `claude` from a shell is best-effort, not a sandbox.
- Test data no longer contains company or business names.
## 1.2.7 (2026-11-03)

Small feature and fix release on top of 1.2.6, which carries the security patch (signed updater, Claude Code permission parity, hardened install scripts); see the 1.2.6 entry below, including its upgrade notes.

- **Notch on/off.** New setting `islandSettings.notchEnabled` (default on) switches the notch live, without restarting: tray menu **Show notch** checkbox, a **Notch** switch in the dashboard's Breaker box (desktop app), and **Settings, Notch** in the island. Off closes the island window and stops what serves it; the choice is remembered across restarts. An optional global shortcut (`islandSettings.notchShortcut`, off by default, for example `Ctrl+Alt+N`) toggles it. An older `islandMode: "off"` is converted to `notchEnabled: false` on first start, the tray's Off radio is replaced by the checkbox, and `Ctrl+Alt+K` no longer revives a switched-off notch.
- **Tiro sits behind his desk.** Tiro's desk now has a footprint, so he is drawn behind it instead of on top of it: the desk front covers his lower body, the chair stays behind him and his upper body shows above the desk, with no popping as he moves.

## 1.2.6 (2026-11-03)

Security patch release. Read the upgrade notes first.

**Upgrade notes**

- **One manual reinstall is needed from 1.2.5 or earlier.** Those versions contain the old, unsigned updater and cannot verify this release's signature. Install 1.2.6 once from the [Releases](https://github.com/Ic3krem/agent-office/releases) page (or with the pinned `install.ps1` / `install.sh`, which verify the signature); from then on in-app updates are signed.
- **Keys rotate and terminal sessions need a restart.** The bridge key used by Claude Code terminal sessions is separate from the dashboard key and is generated fresh, so terminals that were open before the update must be restarted to reconnect to the bridge.
- **More tokens per turn.** Tiro and the agents it hires now load your Claude Code settings, hooks, MCP servers, CLAUDE.md, skills and plugins, so every turn carries their extra tokens (the earlier lean setup measured about 30K tokens per turn that way).

**Permissions and agents (Claude Code parity)**

- Tiro and the agents it hires load your user, project and local Claude Code settings with the full `claude_code` tool preset, your MCP servers, hooks, CLAUDE.md, skills, plugins and environment, and inherit your model, effort and permission mode. Tool permissions are Claude Code's own; the custom auto-approval rules ("Tiro auto-approve", the manager) are removed. Prompts show Claude Code's choices (Yes, Yes and don't ask again, No with an instruction) and question cards. Commands are never edited and prompts never time out into an answer. See `docs/permissions.md`.
- Hire grants are bound to the goal and the exact first prompt; a deny-only hook stops `claude` launches that skip `request_hire`.
- Bridge key and UI key are separate. The UI key is a cookie and `?key=` is gone; decisions need a nonce; keys are never logged.
- One shared redactor for Agent Office's own history, memory, reports and daily notes; seeded memory is scrubbed; scheduler subjects are untrusted, fenced, and no longer written to Tiro memory.
- Fonts are vendored and the CSP has no remote host. Optional retention (`retentionDays`). Crash fixes (guarded request handler, process-level error logging).

**Updater, installers and supply chain**

- Updates are authenticated, not just checked for integrity: releases carry an Ed25519-signed manifest (`latest.json` + `latest.json.sig`) verified against a public key pinned in the app, plus the installer's SHA-256, which is checked again right before launch. The update feed is fixed to this project's GitHub releases; the island page can no longer change it, `kiro.json` `updateFeed` is ignored, and an enterprise mirror can only be set with the `AGENT_OFFICE_UPDATE_FEED` environment variable of the app process. Installing needs a confirmation dialog shown by the app. Downloads go to a random folder only the current user can access. Downgrades are never offered. The Updates panel no longer has a feed field.
- `install.ps1` and `install.sh` are pinned to a release tag, verify the manifest signature and the installer hash, need no execution-policy bypass, and give clear errors.
- The office server process restarts with backoff if it crashes (up to 5 tries), logging only event data to `~/.claude/agent-office/desktop.log`.
- GitHub Actions are pinned to full commit SHAs with least-privilege permissions; added CI tests, dependency review, `npm audit`, CodeQL and Dependabot. `release.yml` stays manual-only.
- Direct dependencies and Electron are pinned to exact versions; `npm audit fix` applied to the lockfile (no high-severity advisories left in production dependencies). The app is packaged in an asar archive with Electron fuses for asar integrity and asar-only loading.
- Added SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue and pull request templates and docs/RELEASING.md.
- Windows and macOS builds are still not Authenticode or Apple signed (no certificate yet); the manifest signature authenticates updates.


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
