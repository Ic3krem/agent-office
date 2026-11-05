# FAQ

Short answers.

(Agent Office v1.2.8, 2026-11-04)


**Does the office cost tokens?** No. Only agents working cost tokens, and only on your Claude Code plan.

**Can an agent hire without asking me?** No. Every hire needs your one-shot approval.

**Where is my data?** On your machine: `~/.claude/agent-office`, your vault, and Claude Code's own `~/.claude/projects`. Model calls go to Anthropic through Claude Code, as in the terminal.

**Does it read my email?** No. The scheduler reads a local feed file that you must produce yourself.

**Can I rename agents and keep their history?** Yes; history follows the type, not the name.

**Why a vendored React and Babel?** So the dashboard works under a strict security policy and fully offline; the fonts are vendored too.

