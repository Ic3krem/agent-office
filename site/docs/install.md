# Install and verify

Install Agent Office on Windows and check the download.

(Agent Office v1.2.8, 2026-11-04)


**Requirements:** [Claude Code](https://claude.com/claude-code) installed and logged in (run `claude` once). Agent Office uses your own Claude Code install and plan. Windows 10 or later. macOS and Linux builds are not published yet.

> **Distribution status:** this repository is private and there is no public download host yet, so Agent Office is **installed and updated by invitation**: build it from source (below) or use the installer the owner sends you. The install scripts and the in-app updater expect release files at a public URL, so they cannot reach a private repository and will say so. The notes below describe how a published release is installed once a public host exists.

**With an installer you were given.** Run `Agent-Office-Setup-<version>.exe` (a normal setup wizard where you can pick the folder; it adds a Start menu entry and a desktop shortcut). If you also received the release folder (`latest.json`, `latest.json.sig` and the installer), you can check it before installing: set `AGENT_OFFICE_VERIFY_ONLY` to the folder's path and run `install.ps1` or `install.sh` from this repository. The check verifies the **Ed25519 signature** of the manifest against the release key built into the script (fingerprint in SECURITY.md) and the installer's **SHA-256**, and installs nothing.

**Install scripts (for a published release).** `install.ps1` and `install.sh` take the release tag from the script itself, download `latest.json` and `latest.json.sig` from that tag's release page, verify the signature and the SHA-256, and only then install. They stop with a plain message if the release page is not reachable (for example HTTP 401, 403 or 404 because the repository is private) or if any check fails.

The builds are **not code-signed**. Windows SmartScreen may ask you to confirm with "More info", then "Run anyway".

