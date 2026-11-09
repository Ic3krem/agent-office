# External specialists

Tiro (Claude) can hand work to coding agents from other companies that are already installed on your PC: **Codex CLI**, **Gemini CLI**, **OpenCode** (and through it any provider or local model it is set up for, such as Ollama), or a **custom command**. They join the team as specialists. Tiro stays the manager: external specialists never hire and never use the office tools.

## Setup

1. Install and sign in to the CLI the usual way, outside TiroAgents (for example `npm install -g @openai/codex`, then run `codex` once to sign in). TiroAgents never installs a CLI and never signs you in.
2. Open **Agents** (the button next to **Team**). Each CLI shows whether it is installed, its version, where it was found and which settings file it uses. TiroAgents looks on your PATH and in the usual install folders (npm's global folder, `~/.local/bin`, `~/.bun/bin`, Scoop shims, Homebrew).
3. In **Build** mode, place an external desk: Codex, Gemini, OpenCode (Ollie) or Custom. Up to three desks per CLI, for example two OpenCode desks on different models.
4. Optional, per desk: a **model** (any name the CLI accepts, such as `ollama/qwen3:8b` for OpenCode), **extra arguments**, and for a Custom desk the **command line**. Put `{prompt}` where the prompt goes, as one argument (`mytool --ask {prompt}`); without `{prompt}` the prompt is sent on standard input.

## How a task runs

- Tiro asks with `request_hire` exactly as for a Claude specialist. You approve the exact prompt on the hire card, which also says: "Runs with <CLI>'s own permissions; TiroAgents' Security Guard does not check its commands."
- Tiro then calls `delegate` once with that prompt. **One approval buys one run**, and every run is a fresh session: the CLI remembers nothing between tasks.
- The CLI runs headless in Tiro's work folder, with no shell in between (the prompt is never parsed by `cmd.exe` or `sh`). Its desk shows it working; the final answer goes back to Tiro, with secrets redacted and at most 20,000 characters, and Tiro checks it before filing a report.
- Each run has a 20-minute limit and counts toward the team cap. **Stop** on the desk card or in the Agents panel ends it with its whole process tree. Quitting TiroAgents stops every run.

## Auto mode

Headless runs have nobody to answer a CLI's permission questions, so with **Auto mode off** (the default) a desk is **read-only**: it reads, researches and proposes changes (OpenCode has no such flag: what `opencode run` may do is set by its own permission config). Turn Auto mode on to let it edit. It adds the CLI's own no-prompt flag, nothing else:

| CLI | Auto mode adds |
|---|---|
| Codex | `-a never -s workspace-write` (Codex's own sandbox stays on) |
| Gemini CLI | `--approval-mode=yolo` |
| OpenCode | nothing; its own permission settings apply |
| Custom | whatever you typed |

Auto mode, extra arguments and a custom command line weaken safety, so they apply only after you confirm them in a native dialog of the TiroAgents desktop app (**Confirm in TiroAgents**). The app signs them; a hand edit of `kiro.json` that turns them on is ignored and the desk says "Settings changed outside the app were ignored". In a browser without the desktop app they cannot be changed.

The **Security Guard does not see** what these CLIs run. They use their own permissions and settings (`~/.codex/config.toml`, `~/.gemini/settings.json`, OpenCode's config).

## Usage and privacy

- Usage is billed to each CLI's own account or provider; the office shows "usage: external" and does not track it.
- Desk settings (model, arguments, command) stay in `kiro.json` on this PC. They are never in a layout, a template, a report or a party: friends only see the desk and generic bubbles such as "Coding…".
