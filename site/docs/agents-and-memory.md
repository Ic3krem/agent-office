# Agents and memory

The team, the hiring gate and per-agent memory and history.

(Agent Office v2.1.0, 2026-11-20)

Everything here describes Agent Office 1.2.8. Source files are named so each claim can be checked.

## The team

Tiro is the manager. It leads eight specialists, defined once in `ROSTER` in `company.mjs`: pixel, forge, warden, probe, atlas, cabalan, tally and scribe. The key (`pixel`, `forge`, ...) is the agent type. It is what Tiro passes as `subagent_type`, and it never changes.

Old type names still work through `ALIASES`: researcher maps to cabalan, builder and ops to forge, writer to scribe, reviewer to probe.

### One person per specialist, and helpers

Each specialist is one person with one desk. If the Agent tool ever starts a second agent of the same type, the earliest one is the specialist and the others are labelled "<Name> helper" (or "<Name> helper 2", "helper 3", and so on). They are never drawn as another full copy. The logic is `assignHelpers` in `company.mjs`. The default prompts also tell Tiro and the specialists not to spawn extra copies.

At most 8 specialists work at once (`MAX_SPECIALISTS`).

### Renamable names

You can give Tiro and each specialist a display name from the Team panel. Names are cosmetic: ids, folders and `subagent_type` do not change, so history stays with the agent after a rename.

Rules (`cleanName`, `sanitizeNames` and `setAgentName` in `company.mjs`):

- At most 20 characters. Control characters and `< > & " \`` are removed, and HTML tags are stripped first, so `<b>Zed</b>` becomes `Zed`.
- A name cannot equal another agent's current name or another agent's default name. For example, Pixel cannot be renamed "Forge", even while Forge is called "Ember".
- A blank name resets that agent to its default.
- Overrides are stored under `agentNames` in `~/.claude/agent-office/kiro.json`. Stored names that break the rules are dropped when read, so two agents can never end up with the same name.

API (all `POST`, key required): `/api/names`, `/api/names/set` (`{key, name}`), `/api/names/reset` (`{key}` for one agent, or no key for all) and `/api/roster`.

## The hiring gate

Starting a specialist with the Agent tool needs your approval. The flow, in `server.mjs` and `company.mjs` (`hireGate`):

1. Tiro calls the `request_hire` tool with the specialist type, the goal id and a reason.
2. The request is refused without reaching you if hiring is switched off in the Breaker box, the goal is not an open goal (`todo` or `doing`), the reason is shorter than 25 characters, 8 specialists are already working, that specialist is already on the team and idle (Tiro is told to reuse it), or an identical request is already waiting.
3. Otherwise an approval card appears for you. Your answer goes through `POST /api/hire/decide` (`{id, approve, note}`).
4. An approval is one-shot. It lets Tiro start exactly one agent of that type, with exactly the first prompt shown on the card (`request_hire` carries the prompt and the grant is bound to its hash and the goal id), and it expires after 10 minutes if unused.
5. A hook on the Agent tool blocks any start that has no approval or a different prompt. It only denies or adjusts input; it never approves anything, so your own permission rules for the Agent tool still apply. A second, deny-only hook on Tiro's Bash and PowerShell calls refuses a command that launches `claude` or the Agent SDK, because that would start an agent without `request_hire`. This is a best-effort check, not a sandbox: a command can be written in ways it does not recognise.
6. All pending cards and unused approvals are cleared when Tiro's session ends, when you reset it (`/api/boss-reset`), when the manager is stopped or switched off, and when the hiring switch is turned off. A stale card cannot create an approval for a later session.

## Per-agent memory and history

Every agent type has its own folder. Tiro is the parent. The root is `~/.claude/agent-office/agents/tiro/`:

```
agents/tiro/memory/          Tiro's own notes
agents/tiro/history/         Tiro's index: every hire
agents/tiro/<key>/memory/    that specialist's notes (MEMORY.md plus note files)
agents/tiro/<key>/history/   index.jsonl plus one <task>.md summary per task
```

The code is `agent-home.mjs`. Folders are keyed by type, never by display name.

- **Fresh context per task.** Each hire starts with an empty context. The only thing that carries over is that agent's own `memory/` folder. Its instructions point at the folder, ask it to read `MEMORY.md` first and, when it is allowed to write files, to add a short note for durable facts before it finishes.
- **Read-only specialists** (warden, probe, atlas, cabalan) have no Write or Edit tool in their roster definition, so they cannot write notes; Agent Office files their final report into their `history/` for them. Whether any agent may run a given command or write a given file is decided by your Claude Code permissions, not by Agent Office.
- **History** is recorded by hooks. When a hire starts, a task entry is written with the goal id, description and brief. When the specialist stops, `<task>.md` holds its final report and its transcript path, and the index entry is closed. Tiro's history lists every hire. Transcripts stay where Claude Code wrote them, under `~/.claude/projects/`.
- **No secrets in our files.** Summaries and briefs (Agent Office's own history, memory, report and daily files; not Claude's transcripts) pass through one shared redaction step (passwords, tokens, API keys, bearer tokens and private key blocks become `[redacted]`). Agents are also told never to store secrets. Redaction is pattern based, so it is a safety net, not a guarantee.
- Nothing is migrated or deleted automatically. Old vault notes and reports are untouched.

### Agent history overlay and API

The **Agent history** button (bottom left of the dashboard, `public/agent-history.js`) opens a three-pane view: agents, tasks with search, and the summary with the transcript path and folder paths.

API (all `POST`, key required): `/api/agents/overview`, `/api/agents/tasks` (`{key, q?}`) and `/api/agents/task` (`{key, id}`).

