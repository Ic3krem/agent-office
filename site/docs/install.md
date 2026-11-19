# Install and verify

Install Agent Office on Windows and check the download.

(Agent Office v2.1.0, 2026-11-20)


**Requirements:** [Claude Code](https://claude.com/claude-code) installed and logged in (run `claude` once). Agent Office uses your own Claude Code install and plan. Windows 10 or later. macOS and Linux builds are not published yet.

**Download.** Get `TiroAgents-Setup-<version>.exe` from the latest release and run it (a normal setup wizard where you can pick the folder; it adds a Start menu entry and a desktop shortcut). Or build it from source (below).

**Check before installing.** Download the release's `latest.json` and `latest.json.sig` next to the installer, set `AGENT_OFFICE_VERIFY_ONLY` to that folder's path and run `install.ps1` or `install.sh` from this repository. The check verifies the **Ed25519 signature** of the manifest against the release key built into the script (fingerprint in SECURITY.md) and the installer's **SHA-256**, and installs nothing.

**Install scripts.** `install.ps1` and `install.sh` take the release tag from the script itself, download `latest.json` and `latest.json.sig` from that tag's release page, verify the signature and the SHA-256, and only then install. They stop with a plain message if the release page is not reachable (HTTP 401, 403 or 404) or if any check fails.

The builds are **not code-signed**. Windows SmartScreen may ask you to confirm with "More info", then "Run anyway".

