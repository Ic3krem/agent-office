# External specialists: other coding agents and LLMs on Tiro's team (design)

Date: 2026-11-09. Status: draft; the safety question is answered (2026-11-09).

## Intent

TiroAgents' team today is Claude only: Tiro (Claude Opus) orchestrates and hires Claude specialists. The user wants the other agents people already have to join that team: OpenAI Codex, Gemini CLI, OpenCode (and through it local models via Ollama, OpenRouter, DeepSeek and others), and more later. They join **as specialists**; **Claude Opus stays the orchestrator** (user's call, 2026-11-09). Each external agent uses its own login and settings on this PC by default, the way Dev-Labs (MIT, github.com/jeffreycayao/Dev-Labs) does: no keys pasted into TiroAgents unless the user wants to.

## Goals

1. **Detect** the agent CLIs installed on this PC (same PATH resolution as Dev-Labs `shellEnv.ts`: the login shell's PATH plus the usual install folders) and show them in a new **Agents** panel: installed or not, signed in or not when the CLI can tell, and its default model from its own config.
2. **External department desks.** Placing a desk for an external agent (Build mode, like today's department desks) adds a specialist backed by that CLI, with a name, a look and a role brief like any other specialist.
3. **Tiro delegates to them** through the same hire approval as Claude specialists: Tiro asks with `request_hire` (you approve the exact prompt), then calls a new office tool `delegate(key, prompt)` instead of the Agent tool. The external CLI runs headless in Tiro's work folder; its progress shows on its desk (typing, status bubble); the final answer goes back to Tiro, who checks it and files the report.
4. **Its own config by default.** The CLI reads its own settings (`~/.codex/config.toml`, `~/.gemini/settings.json`, OpenCode's config, Ollama's models). Optional per-desk overrides: model, and extra arguments.
5. **Office life works the same.** External specialists walk, take breaks, travel to the game hall and appear in parties (generic bubbles only, as today).

## Non-goals

- No terminal emulator (Dev-Labs runs each CLI's interactive TUI in a PTY; TiroAgents runs them headless, one task at a time, so no native `node-pty` dependency).
- External agents never orchestrate; they never hire.
- No new LLM API client in v1 (raw chat with an API key): OpenCode already covers API-key and local models with its own provider setup.
- No billing or plan-limit tracking for external agents (their usage is on their own accounts; the office shows "usage: external").

## Anti-goals

- An external agent changing files or running commands the user did not expect, outside the approval and Security Guard the user relies on for Claude. (See the open question.)
- Secrets from a CLI's config crossing into TiroAgents, the party, or a report.
- A hung CLI blocking Tiro: every run has a timeout and can be stopped from its desk.

## First CLIs (my call)

| Agent | Headless run | Reads by default |
|---|---|---|
| Codex | `codex exec --json "<prompt>"` | `~/.codex/config.toml`, its login |
| Gemini CLI | `gemini -p "<prompt>" --output-format json` | `~/.gemini/settings.json`, its login |
| OpenCode | `opencode run "<prompt>"` (`--model provider/model` when set) | its config: any provider, incl. Ollama |
| Custom | a command line with `{prompt}` | whatever that command reads |

Flags are checked against each CLI's `--help` at build time; Dev-Labs `src/shared/agentProvider.ts` is the reference table (MIT; credit it in THIRD_PARTY_NOTICES.md if code is reused).

## Safety mode (the user's answer: same as Dev-Labs)

Each external desk runs with **that CLI's own settings**, exactly as configured on this PC; TiroAgents adds no permission flags. Like Dev-Labs, each desk has an optional **Auto mode** switch (off by default) that adds the CLI's own no-prompt flag, using Dev-Labs' table:

| Agent | Auto mode adds |
|---|---|
| Codex | `-a never -s workspace-write` (no prompts, Codex's sandbox stays on) |
| Gemini CLI | `--approval-mode=yolo` |
| OpenCode | none needed in `opencode run`; its own permission config applies |
| Custom | whatever the user types |

Because TiroAgents' Security Guard and approval cards do not see what these CLIs run, the desk's settings and the hire card say so in one line ("runs with Codex's own permissions; TiroAgents' Security Guard does not check its commands"). The hire approval of the exact prompt still applies.

## Left to the builder

PATH resolution details, output parsing per CLI (JSON event streams where offered, plain text otherwise), timeouts, the Agents panel layout, role templates for external desks, and the art for their desks (a small brand-neutral badge per provider, no logos).
