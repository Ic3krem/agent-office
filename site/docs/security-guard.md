# Security Guard

An ask-only safety net for secrets, downloaded scripts and untrusted instructions.

(Agent Office v2.1.0, 2026-11-20)

The Security Guard is an extra layer that watches for the things an AI agent should not do quietly: sending your secrets off the computer, running a script someone else wrote, harvesting credentials, or acting on instructions hidden in a web page or an email. It is a **safety net, not a boundary**: it asks you first; it never decides for you.

## What it is, and what it is not

- **ask-only.** A hook (a small check Claude Code runs before and after each tool call) can only answer "ask the user first" or say nothing. It never approves, never denies, never rewrites what a tool will do. Your own Claude Code permissions (allow, deny, ask rules, permission mode) stay in charge: a deny rule still denies, and the Guard cannot turn an ask into an allow.
- **Where it runs.** In every Agent Office session (Tiro and every agent it hires; the hooks fire for sub-agents too) and, through the bridge plugin, in your own Claude Code terminals (`bridge/hooks/guard-hooks.json`, a command hook that runs `node guard/hook.mjs`; it works locally, with no calls to the Agent Office server).
- **Windows, macOS and Linux.** The Guard is plain JavaScript with no native modules and no dependencies. Paths from any system are understood on any other: `C:\Users\<you>\.env`, `/mnt/c/Users/<you>/.env`, `/c/Users/<you>/.env`, `\\?\C:\...`, `\\server\share`, `~/.env`, `%USERPROFILE%\.env` and `$env:USERPROFILE\.env` all mean the same file. Windows-only steps (reading OneDrive registry keys) run only on Windows, inside try/catch.
- **Not a boundary.** It is pattern based. A determined attacker who controls your agent can write a command it does not recognise. Treat each ask as a useful tripwire, and keep your normal protections (permissions, least privilege, no real secrets in the project).

## What it checks

| Cat | Name | Asks about |
|---|---|---|
| **S** | Secrets leaving this computer | A network, publish or upload action whose payload holds a secret file, a secret value, secret environment variables, or an archive of sensitive files: curl, wget, Invoke-RestMethod, scp, rsync, rclone, aws s3, az storage, gsutil, gh gist or release, git push, docker build or push, npm publish, twine, cargo, deploy tools, WebFetch with a token in the URL, a mail or chat MCP tool sending a secret, browser file upload of a credential file, putting a secret on the clipboard, copying a secret to a network share |
| **Y** | Secrets in a cloud-synced folder | Writing or copying a secret into OneDrive, Dropbox, Google Drive, iCloud, Box, Nextcloud, an Obsidian vault, the Agent Office vault or `~/.claude/**` (a sync job pushes it) |
| **I** | Ignore rules overridden | `git add -f` or `git add -A` that would stage a secret, editing `.gitignore`/`.dockerignore`/`.npmignore` so a secret is no longer ignored, `--no-verify`, `core.hooksPath`, copying a secret under a harmless name, archiving a tree that holds secrets |
| **C** | Credential stores and environment | Browser profiles (logins, cookies), Keychain, Credential Manager, `secret-tool`, `pass`, LSASS or SAM dumps, `~/.aws`, `~/.ssh` private keys outside the project, dumping all environment variables |
| **H** | Bulk harvesting | Recursive searches for passwords or key files over your home folder or a drive, and reading very many files or folders outside the project in a short time |
| **X** | Screen, clipboard and input capture | Screenshots, reading the clipboard, keystroke capture, remote-debugging ports |
| **U** | Unwanted script or persistence | `curl | bash`, `iwr | iex`, encoded PowerShell (the decoded text is scanned too), carets or backticks hiding a command, running a file from Downloads or Temp, scheduled tasks, startup entries, cron, launchd, systemd, shell profiles, git hooks, edits to `~/.claude/settings.json`, installs from a URL, `npx` of an unknown package, starting `claude` from a shell |
| **P** | Untrusted instructions in tool output | After a fetched page, search result, file or mail contained text aimed at the AI (see below), the next action that sends, runs, spawns or writes outside the project |

Each category can be set to **ask** (default), **log** (note it in the audit log, do not interrupt) or **off**.

### Secrets are found by name and by content

A file counts as a secret by its name (`.env`, `.env.*`, `*.pem`, `id_rsa*`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.aws/`, `.azure/`, `gcloud`, `.kube/`, `*.tfstate`, `*.tfvars`, `*.pfx`, `*.p12`, `*.kdbx`, `.docker/config.json`, and more) or, for a renamed file, by its content (key formats, `NAME=value` secrets, high-entropy tokens). Templates such as `.env.example` pass when their content holds only placeholders. The first 256 KB of a file named in an S, Y or I operation is scanned; values are never shown or logged, only `NAME=•••• (len N)`.

### ignore files are not trusted

`.gitignore`, `.npmignore`, `.vercelignore` and similar files, and any text that says "X is ignored", change nothing: the Guard works out what would really be sent (the files a `git push` would send, the `npm pack` list, the deploy folder, the source of an `rsync`). The one exception is `.dockerignore`, because Docker itself honours it; it is applied with Docker's own matching rules. When the payload cannot be listed exactly (for example a path with a variable the Guard cannot expand), the card says **estimated**.

### Untrusted instructions (P)

After a tool result (a fetched page, a search, a file, a mail or document from an MCP tool, the output of `curl` or `gh issue view`) is scored for text aimed at the AI ("ignore previous instructions", fake system tags, hidden characters, instructions to send secrets, markdown images that would leak data), a high score taints the session for 60 minutes. A banner appears, the model is told the text is untrusted data, and the next action that sends data, runs a script, spawns an agent or writes outside the project asks first. Allowing the asked action, or typing a new message yourself, ends the warning. A page that merely mentions the word "deny" does not trigger it.

## Prompts you will newly see

Ordinary work does not trigger the Guard: `git push` asks only if what would be pushed holds a secret, `npm install` of a normal package is silent, `curl` to localhost is silent, and a plain download is only logged. You will see a Security Guard ask, in the same card as other permission requests, showing the category, the matched rule ids with a plain sentence, the command with secrets masked, the files and why each matched, the destination, and whether the payload is exact or estimated:

- sending anything that includes a `.env`, key file, token or secret variable to another computer or service;
- `git push` or `npm publish` or `docker build` when the real file set includes a secret;
- writing a secret into a cloud-synced folder, or force-adding a secret to git;
- `curl ... | bash`, `iwr ... | iex`, encoded commands, running a downloaded program, adding a scheduled task, startup entry or shell-profile line, editing `~/.claude/settings.json` or a git hook, installing a package from a URL;
- reading browser data, the OS credential store, `~/.aws/credentials`, or dumping the environment;
- a screenshot, clipboard read or keystroke capture;
- the first side-effect action after a web page or mail contained instructions aimed at the AI.

Your choices: **Yes** (once), **No**, **No, and tell Claude what to do instead**, and, only where it is safe, **Yes, and remember this exact action** (24 hours for C, H and X; for U as long as the script's hash is unchanged). S, Y, I and P are never remembered. A remembered action is exact: a different command, file, content or destination asks again, and nothing is remembered in a session that read untrusted instructions.

## Settings, and why an agent cannot switch the Guard off

Settings live in `kiro.json` under `guard`: `{ S, Y, I, C, H, X, U, P: 'ask' | 'log' | 'off', syncRoots: [], trustedNpx: [], trustedHosts: [], hooksInTerminals: true }`. Open them in the dashboard (Breaker box, Security Guard) or the island (Settings).

A stricter change applies at once. A **weaker** change (ask to log or off, a trusted host or package, terminals off) takes effect only after a confirmation dialog that only the desktop app can open. The app then saves the confirmed settings in `guard/confirmed.json` with an HMAC keyed by a secret that is encrypted with the operating system (Electron safeStorage). A weaker value written into `kiro.json` by anything else (an agent, a script, a hand edit) is **ignored**: the last confirmed value stays, the change is noted in the audit log, and the dashboard shows "Guard setting changed outside the app; kept ...". A terminal started outside the app cannot verify the HMAC and uses the strictest settings. There is no HTTP route that changes the Guard settings.

## Audit log

`guard/audit.jsonl` (private to you, rotated at 5 MB, three files, entries older than 90 days dropped) records time, session, agent, tool, category, rule ids, decision (ask or log), your answer, destination host, paths (home shown as `~`), a short file hash, exact or estimated, and the command with secrets masked, cut to 300 characters. It never records file contents, environment values, clipboard or screenshots. View it in the dashboard (Breaker box, Audit log).

## Limits you should know

- **bypassPermissions.** Whether a hook's ask still prompts when Claude Code runs with `--dangerously-skip-permissions` is an open check (**M-1**). It could not be tested without a real session; the test is in `guard.test.mjs` and skipped with the instructions. If asks do not prompt in bypass mode, treat the Guard as inactive there.
- **Bypass mode is unverified.** In bypass mode (`--dangerously-skip-permissions`) the Guard may not prompt: this is unverified (see M-1 above), so do not rely on the Guard when you run Claude Code that way.
- **Session registration.** The terminal hook skips a session only when the app registered that exact session id (`guard/sdk-sessions/<sha256 of the id>`, written when an Agent Office session starts, removed when it ends, cleared at app start). The `AGENT_OFFICE_SDK_SESSION` variable is only a hint and is never trusted on its own, so setting it permanently (`setx`, registry) does not switch the terminal Guard off.
- **Persistent environment changes.** `setx`, `SetEnvironmentVariable(..., User|Machine)`, `reg add ...\Environment`, `launchctl setenv`, `environment.d`, `/etc/environment` and `~/.pam_environment` ask (U); if they touch `AGENT_OFFICE_*`, `CLAUDE_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE` or `PATH` they also ask under S.
- **Tunnels.** `cloudflared tunnel`, `ngrok (http|tcp|tls|start)`, `lt`/`localtunnel`, `ssh -R`, `tailscale (funnel|serve)`, `bore local`, `serveo` and `loophole` ask under S ("exposes the folder to the internet") when the served folder (the working folder, or `--directory`) contains secrets, and are only logged otherwise.
- **Network drives.** On Windows the app looks up mapped network drives at start (and every 10 minutes) and treats those drive letters like UNC paths: nothing on them is opened, they are judged from the path text. Terminals read the cached answer (`guard/drives.json`); if it is missing or older than 24 hours the terminal hook runs the bounded detection itself, and if that fails a secret copied to any drive other than the system drive asks (estimated).
- **Wrapped commands.** `xargs`, `find -exec/-execdir/-ok/-okdir`, `parallel`, `watch`, `sudo`, `doas`, `timeout`, `nice`, `nohup`, `time`, `env` are unwrapped and the command inside is checked on its own. For `{}` the Guard substitutes real candidates (the files `find` would match or the `-name` pattern, the `:::` and `::::` arguments, `xargs -a` files, the names listed by a piped `ls`/`find`/`echo`/`cat`, at most 12 secret-named plus 3 ordinary ones per command). If the input cannot be worked out (for example `git ls-files | xargs ...`) the payload is "estimated" and a send asks.
- **Cluster and container copies.** `kubectl cp` / `oc cp` with a pod on either side always asks (S). `docker cp` / `podman cp` ask only when the daemon is remote (`DOCKER_HOST`, `DOCKER_CONTEXT` or the current docker context points at tcp or ssh, or cannot be read) and the local files hold secrets; otherwise they are only logged.
- **Upload scripts.** `ftp -s:file`, `sftp -b file`, `lftp -f file`, scripts on stdin, here-documents, here-strings and `echo "put .env" | sftp -b -` are read and every `put`, `send`, `mput` and `append` target is checked. `openssl s_client` with a secret on stdin asks.
- **Copies that keep their name.** Copying a secret to a folder, or under the same file name, to a local non-synced place is only logged. A changed name (a disguise), a synced folder (Y) or a network location (S) still asks.
- **dontAsk and headless `claude -p`.** In these modes an ask becomes a deny, because nobody can answer.
- **Failures.** The checks are written so that nothing slow runs inside the decision: the git payload check is one bounded asynchronous `git diff -p` (up to 1.5 s for the upstream lookup and 2.5 s for the diff, 3.8 s overall, inside the 5 s hook limit), and remote (UNC or network share) paths are judged from their text and never opened. If a request that may send files or secrets off the computer cannot be checked in time, or the check fails, the Guard **asks** (marked "estimated") instead of letting it through. Harmless requests that hit an error still go on under your normal permissions. Every error and slow check is written to the audit log (`guard_error`, `slow`).
- **Terminals.** The command hook needs `node` on the PATH; if it cannot run, it does nothing and the terminal behaves as before. Weakening cannot be verified there, so terminals always use the strictest settings.
- **Terminals not started by the app** use the strictest settings. They have no way to prove a setting was confirmed in the app, so a weaker saved setting is ignored there, and entries you chose to remember are ignored too (they are signed with the app key). Agent Office sessions skip the terminal hook (`AGENT_OFFICE_SDK_SESSION=1`) so the Guard never runs twice.
- **Guard inactive in terminals.** The terminal hook is `node guard/hook.mjs`. If Node.js is not on the PATH the terminal hook cannot start; the app checks for this and shows "Guard inactive in terminals" in the Breaker box and the island settings.
- **Weaker protection on this system.** On Linux without a keyring (no Electron `safeStorage`) the key that signs your settings is a private 0600 file, which a process running as you could read. The app says so, and turning any protection down then also needs a typed confirmation word ("turn down") in addition to the confirmation window.
- **Plugin check.** Run `claude plugin validate --strict ./bridge` after changing `bridge/hooks/register.ts` or the plugin files (it needs the Claude Code CLI, so it is a manual step; `guard-review.test.mjs` runs it when the CLI is installed and also forbids passing `$` to helpers, the pattern the validator rejects).
- **Pattern based.** New obfuscations, unusual interpreters and tools that were not listed can slip through. Report false positives and misses so the lists can improve.
- **Not verified here.** A real Claude Code session (hook firing for sub-agents, the card text, the M-1 behaviour), the Windows registry reads, and the desktop dialog and `safeStorage` could not be exercised in this repository's tests; the logic around them is covered by tests with fakes.

