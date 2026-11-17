# Security model

How the local server, the windows, installs and approvals are protected.

(Agent Office v2.0.0, 2026-11-17)

## Security model

- **Local only, two separate credentials.** The server binds `127.0.0.1` and rejects any other `Host` header (DNS rebinding). The terminal bridge key in `bridge.json` opens `/bridge/*` only. The UI key exists only in the Electron process and the server's memory and reaches the windows as an HttpOnly, SameSite=Strict cookie, so an agent that can read `bridge.json` still cannot approve its own requests. Decisions also need a per-session nonce. Keys are compared by hash in constant time and never logged.
- **Strict Content-Security-Policy.** Pages load scripts, styles and fonts only from the app itself (`script-src 'self'`, plus inline and eval, which the page runtime needs). React, ReactDOM, Babel standalone and the fonts are vendored in `public/` (pinned SHA-384 hashes for the scripts, OFL licence texts for the fonts), so nothing loads from a CDN or Google Fonts. Framing, plugins and `<base>` tricks are blocked.
- **Electron hardening.** Windows run with context isolation and sandbox on, `nodeIntegration` off and `webSecurity` on. They cannot navigate away from the local server or open webviews, and external links open in your browser.
- **Verified installs.** The install scripts and the updater check SHA-256 before running anything, and use https only.
- **Hiring and approvals.** Agent-tool hires require your one-shot approval, tied to the goal and the exact first prompt (a best-effort check also blocks launching `claude` from Bash; it is not a sandbox). Tool permissions are Claude Code's own: what your settings allow runs, what they deny is denied, and what Claude Code would ask about is shown to you with Claude Code's choices. Agent Office does not auto-approve anything.
- **No built-in mail access.** The scheduler only reads a local feed file.
- **Your data.** Office state and notes stay on your machine; model calls go through your Claude Code install to Anthropic, as in the terminal. The server needs the local key for every API call.
- **Unsigned builds.** If in doubt, compare the SHA-256 the install script prints with the one GitHub shows on the release asset.

Report a vulnerability by opening a private security advisory on the GitHub repository.


## Security notes

The server is local only, requires a random key, checks the `Host` header and sends a strict Content-Security-Policy. Electron windows are sandboxed with context isolation and no Node integration. Installs and updates are https only and SHA-256 verified. Windows and macOS builds are unsigned. Full list in the README.


### Background work and memory

Agent Office keeps its background work small. Two settings in `kiro.json` tune it:

- `tiroIdleMinutes` (default 15, `0` = never): Tiro's own `claude` process holds a few hundred MB while idle, so it is closed after this many idle minutes and resumed with the same session id when the next goal arrives. It is never closed while an approval is pending, a specialist is running, a goal is being worked on or Tiro is working.
- `limitsProbeMinutes` (default 15, at least 5): how often the plan limits are checked. The check starts a `claude` process, so it only runs while a window is visible or Tiro is working.

What you may notice: an old Claude Code session that you resume can take up to a minute to show up on a desk; the live view updates once every 3 seconds while all windows are hidden; the first message after a long break starts Tiro a moment later because its session is resumed. To re-measure on your own machine see `tools/perf/README.md`.
