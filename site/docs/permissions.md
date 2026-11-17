# Permissions and Claude Code parity

Agent Office runs on your own Claude Code configuration. What is the same, what differs and what reaches you.

(Agent Office v2.0.0, 2026-11-17)

Agent Office acts like Claude Code with the same configuration. Only the integrations differ: the island and the minimalist dashboard, the configured roster of agents, the hire gate, and the surface where permission prompts are shown.

## What is the same as a plain `claude` run

Tiro and every agent it hires start with the options built in `permissions.mjs` (`claudeSessionOptions`):

| Setting | Value |
|---|---|
| Settings loaded | `user`, `project` and `local` (so `~/.claude/settings.json`, the folder's `.claude/settings.json` and `settings.local.json`) |
| Tools | the full `claude_code` preset (Bash, PowerShell, NotebookEdit, TodoWrite, Skill, AskUserQuestion and the rest) |
| Permission mode | not set by Agent Office: Claude Code picks it from `permissions.defaultMode`, exactly as `claude -p` does. If your settings say `bypassPermissions`, the SDK's explicit opt-in is passed so that is honoured |
| Allow, deny and ask rules, `additionalDirectories` | from your settings, evaluated by Claude Code |
| Hooks, MCP servers, plugins, skills, CLAUDE.md | from your settings (plus our own `office` MCP server and hire-gate hooks) |
| Model and effort | not pinned: inherited from your settings (specialists keep the model their roster entry names, such as sonnet, opus or haiku) |
| Environment | your process environment; `ELECTRON_RUN_AS_NODE` and Agent Office's own variables are removed; the `env` block of your settings is applied by Claude Code itself |
| Working folder | your home folder, or `workDir` in `kiro.json`, so project settings and CLAUDE.md resolve as they would from that folder |

`parity.test.mjs` builds these options and asserts them.

## What reaches you

Only a request that Claude Code itself would ask you about reaches the UI. Allow rules, deny rules, the permission mode and hooks have already been applied. The card shows the full tool input (the whole file for a Write, the edit for an Edit, the JSON for anything else) and Claude Code's reason, and offers:

- **Yes** (allow once)
- **Yes, and don't ask again**, only when Claude Code suggests a rule: it returns Claude Code's suggested permission update unchanged, so it goes to the settings scope Claude Code chose
- **No**, optionally with a note telling Claude what to do instead (sent as the deny message)

Commands are never edited. An unanswered prompt waits (a log line every 10 minutes is only a reminder). Questions Claude asks with its question tool appear as a question card in the island; the dashboard shows the text and points you to the island. A terminal bridged to the office only has its `ask` decisions forwarded; it stands aside for the auto, bypassPermissions and dontAsk modes, and with no dashboard tab open the terminal asks in its own dialog. The bridge also honours your `crossSessionInbound` setting: with `refuse` or `hold`, messages typed in the dashboard are not injected into that terminal.

## What differs from a plain `claude` run

1. **The UI.** Prompts are answered in the dashboard or island, not a terminal dialog. The multiple-choice question card exists only in the island.
2. **The roster.** Tiro's brief and the eight specialists (their prompts and tool lists) come from Agent Office. A SOP note may only narrow a specialist's tool list. Roles called read-only have no Write or Edit tool in their definition; what any agent may run is decided by your permissions, not by the roster.
3. **The hire gate.** Starting an agent requires your one-shot `request_hire` approval for that goal and prompt. The hooks only deny or adjust input, and never approve. A deny-only hook also refuses a Bash or PowerShell command that launches `claude` or the Agent SDK from Tiro's session.
4. **The plan-limit probe** runs isolated (no settings, hooks or MCP servers) because it is a tiny internal query, not an agent.
5. **Our own MCP tools** (`request_hire`, goals, reports, memory, `scheduler_inbox`) are pre-allowed for Tiro.
6. **Cost.** Your hooks and MCP servers load for Tiro and for every hired agent, so each turn carries their extra tokens, as it does in a normal session.

## Consequences you should know

- Agent Office no longer blocks anything on its own. If your settings allow `Read(**)` or Bash broadly, an agent can read `~/.claude/agent-office/bridge.json`. That is now harmless for approvals: the bridge key opens only `/bridge/*` (asking for a terminal decision and polling its own messages), and the key that decides approvals, hires and switches lives only in the Electron process memory and an HttpOnly cookie that agents cannot read. With the bridge key an agent could at most raise a prompt card or read messages queued for a terminal session; it cannot answer prompts, approve hires or flip switches.
- An agent that your own rules let write files can still edit `~/.claude/settings.json`, startup folders or this app's folder. If you want protection there, put it in your own settings, as Claude Code users do. A starting point (deny rules go in `permissions.deny`; adjust the paths):

```json
{
  "permissions": {
    "deny": [
      "Read(~/.ssh/**)",
      "Write(~/.claude/settings*.json)",
      "Edit(~/.claude/settings*.json)",
      "Write(~/.claude/agent-office/**)",
      "Edit(~/.claude/agent-office/**)",
      "Write(~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/**)",
      "Write(~/Documents/WindowsPowerShell/**)"
    ]
  }
}
```

- Agent Office's own files (history, memory notes, reports, daily notes, seeded memory) are redacted for secrets; Claude's transcripts are not.
- SOP notes you edit outside the app are ignored until you save them in the app (a hash pin), and a SOP can only narrow tools.
- Scheduler mail subjects are untrusted text. They stay in `scheduler.json` and reach Tiro only through a fenced tool.

