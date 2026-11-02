# Resources and index

Quick links for Agent Office 1.2.5. The latest release is v1.2.5 (Windows installer only for now). The install scripts and the updater read the latest published release.

## Read

| What | Where |
|---|---|
| Overview and install | [README.md](../README.md) |
| Full user guide | [GUIDE.md](GUIDE.md) |
| What changed in each version | [CHANGELOG.md](../CHANGELOG.md) |
| Team, hiring gate, per-agent memory and history | [agents-and-memory.md](agents-and-memory.md) |
| Scheduler station, job and feed file | [scheduler.md](scheduler.md) |
| Office world design and 1.2.x changes | [office-spec.md](office-spec.md) |
| Island, now playing, lyrics, updates | [island-spec.md](island-spec.md) |
| Dependency licenses | [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) |
| Project license (MIT, Ic3krem) | [LICENSE](../LICENSE) |

## Architecture in one page

- `desktop/main.mjs`: Electron shell. Starts the server, shows the Tiro window, the island and the tray, and runs the update check. `desktop/updater.mjs`, `island-logic.mjs`, `nowplaying.mjs`, `lyrics.mjs` hold the pure logic.
- `server.mjs`: local HTTP server (`127.0.0.1`, key auth, CSP). Tracks Claude Code transcripts, runs Tiro through the Agent SDK, serves `public/`, and exposes the `/api/*` endpoints listed in the guide.
- `company.mjs`: the roster, names, hire gate, goals and prompts. `agent-home.mjs`: per-agent memory and history. `vault.mjs`: the Markdown memory vault. `reports.mjs`: reports and exports. `scheduler.mjs` and `scheduler-job.mjs`: scheduler reader and job. `manager.mjs`: auto-approval rules. `usage.mjs`: tokens, plan limits, credits. `office.mjs`: breaker switches and system stats. `transcript.mjs`: transcript parsing.
- `public/`: the dashboard (`Agent Office.html`), office world scripts, the island page, the Tiro window, and `vendor/` (React, ReactDOM, Babel).
- `bridge/`: the optional Claude Code plugin that lets terminals receive messages and send approvals.

## Install, update, uninstall

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Ic3krem/agent-office/v1.2.5/install.ps1 | iex
```

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/v1.2.5/install.sh | bash
```

Both are pinned to a release tag (the tag is in the URL), verify the Ed25519 signature of that release's manifest against the key built into the script, then check the SHA-256 of the download, and stop if anything is missing or wrong. Update with the island's Settings > Updates or by running the script again. Uninstall from Windows Settings > Apps, delete the macOS app, or remove the Linux AppImage; your data in `~/.claude/agent-office` stays until you delete it. More in the [README](../README.md#install).

## Develop

```
npm ci                         # exactly what package-lock.json lists
npm start                      # run the desktop app
npm test                       # all test suites
node --check server.mjs        # syntax check one file
npm run dist                   # build an installer for this OS
```

- Run a dev server on a spare port next to an installed copy: set `AGENT_OFFICE_PORT` and a temporary `USERPROFILE` so it does not touch the installed app's key and state. Never reuse port 4777 while the installed app runs.
- `AGENT_OFFICE_TEAM_ONLY=1` shows only Tiro and its team.
- Test files sit next to the code (`*.test.mjs`). `repo.test.mjs` guards repository hygiene: license consistency, the ignore list, install scripts, Electron and CSP settings, and that no personal paths or secrets are committed.

## Scripts in the repo

| Script | Purpose |
|---|---|
| `install.ps1`, `install.sh` | Download, verify and install the latest release. |
| `start.ps1` | Start the server (if not running) and open the dashboard on Windows. |
| `scheduler-job.mjs` | One scheduler check (`--dry-run` to try). |
| `.github/workflows/release.yml` | Tag push builds Windows, macOS and Linux installers and publishes a release. |

## Release checklist

1. Branch is clean and `npm test` passes; run `node --check` on changed `.mjs` files.
2. Bump `version` in `package.json` (and the lockfile) and add the entry, with its date, to [CHANGELOG.md](../CHANGELOG.md). The bridge plugin has its own version in `bridge/.claude-plugin/plugin.json`; it changes only when the plugin does.
3. Check `THIRD_PARTY_NOTICES.md` if dependencies changed.
4. Check that `package.json` `build.files` lists any new root-level `.mjs` file, or the packaged app will fail to start.
5. Confirm nothing personal or secret is committed (`repo.test.mjs` covers the common cases) and `public/vendor/` is untouched.
6. Publish the release. The workflow in `.github/workflows/release.yml` is manual-only (`workflow_dispatch`): a tag push does not trigger it, so that CI cannot replace a QA'd installer. For 1.2.5 the QA'd Windows installer, its `.blockmap` and `latest.yml` were uploaded with `gh release create v1.2.5 --latest <files>`. To use CI instead, restore the `push: tags: ['v*']` trigger once its builds are QA'd, or run the workflow by hand.
7. **SHA-256 digest requirement.** The install scripts and the updater need the SHA-256 digest that GitHub shows on each release asset. After the release is published, open it and confirm every installer has a digest. An asset without one cannot be installed through the scripts or the updater.
8. Install the published `.exe` on a clean machine or user, open the dashboard, and confirm it renders (the strict CSP blocks anything not shipped with the app).
9. The builds are unsigned; keep the SmartScreen note in the release text.
