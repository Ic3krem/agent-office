# Troubleshooting

Windows warnings and common problems.

(TiroAgents v2.1.0, 2026-11-20)

## SmartScreen and Smart App Control

The installer is not code-signed. Compare its SHA-256 with the one on the download page before you run it.

- **SmartScreen** may show "Windows protected your PC". If the SHA-256 matches, choose **More info**, then **Run anyway**.
- **Smart App Control (Windows 11)** can block an unsigned installer and offer no Run anyway option. It is a Windows setting under Windows Security, App and browser control, Smart App Control settings. Turning it off can be permanent on some Windows 11 versions, so decide deliberately. If you cannot accept that, do not install the unsigned build.


## Troubleshooting

| Problem | What to try |
|---|---|
| Dashboard is blank | Reload. If it persists, check the app is up to date (older builds before 1.2.5 could not load their scripts under the security policy). |
| "Connecting" banner stays | The server is not running. Restart TiroAgents. If another copy holds the port, quit it first. |
| 401 "not signed in" from a script | The API needs the UI session cookie, which only the desktop app (or the one-time sign-in link of a standalone run) has. The bridge key in `bridge.json` opens `/bridge/*` only. |
| Tiro does nothing | Check the Breaker box (Tiro on, plan guard not paused) and that Claude Code is installed and logged in. |
| Far more (or fewer) prompts than before | Prompts now follow your Claude Code permission rules and mode; edit your allow, deny and ask rules or `permissions.defaultMode` (permissions.md). |
| Hire card never appears | Hiring switch may be off, or Tiro asked for a goal that is not open. |
| Scheduler says "no data yet" or "No mail feed file yet" | The job has not run, or nothing writes `inbox-feed.json`. See scheduler.md. |
| SmartScreen warns on install | The build is not code-signed. Compare the SHA-256 with the one on the GitHub release. |
| Update refused | The feed has no SHA-256, or the hash did not match. |

