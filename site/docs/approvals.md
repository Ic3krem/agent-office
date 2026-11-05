# Hiring and approvals

The strict hiring gate and Claude Code tool approvals.

(Agent Office v1.2.8, 2026-11-04)


There are two kinds, and both show on the dashboard and in the island.

**Hire approvals (strict hiring gate).** Starting a specialist with the Agent tool needs your approval. Tiro sends a request with the specialist, the goal and a reason; a card appears with Approve and Deny. One approval buys exactly one hire of that type and expires after 10 minutes. Requests are refused automatically if hiring is switched off, the goal is not open, the reason is too short, 8 specialists are already working, or that specialist is already on the team and idle (Tiro is told to reuse it). Pending cards and unused approvals are cleared when Tiro's session ends or resets or when hiring is switched off. Details: agents-and-memory.md.


**Tool approvals.** Tiro and the agents run on your own Claude Code configuration: your allow, deny and ask rules, permission mode, hooks and settings decide what happens. Only a request Claude Code itself would ask you about shows up (in the dashboard detail pane and the island), with the full tool input and Claude Code's own choices: **Yes**, **Yes, and don't ask again** (offered only when Claude Code suggests a rule; it writes that same rule to the same settings file Claude Code would), and **No**, optionally with a note telling Claude what to do instead. Nothing is edited, auto-approved or timed out into an answer; a prompt waits until you answer. Questions Claude asks (the multiple-choice question tool) appear as a question card in the island. Terminal sessions still ask in their own dialog when no tab is open. See permissions.md.

