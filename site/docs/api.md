# API reference

The local HTTP API the dashboard and island use.

(Agent Office v2.0.0, 2026-11-17)


The dashboard, island and tools talk to a local HTTP API. Every call to `/api/...` is a **POST** with a JSON body, authenticated by the UI session cookie (there is no key in URLs or headers; the bridge key only opens `/bridge/*`). Decision endpoints (`/api/decide`, `/api/hire/decide`, `/api/switch`, `/api/send`, `/api/task`, `/api/sops/save`, `/api/boss-reset`) also need the per-session nonce in the `x-nonce` header. Not signed in returns 401, a missing nonce 403, a wrong `Host` header 403. `GET /api/stream` is a Server-Sent Events feed of the live snapshot. The bridge plugin also uses `/bridge/ask` and `/bridge/poll`.

| Endpoint | Body | Purpose |
|---|---|---|
| `/api/stream` (GET) | none | Live snapshot (agents, goals, approvals, usage). |
| `/api/send` | `{id, text}` | Message an agent session. |
| `/api/interrupt` | `{id}` | Interrupt a running turn. |
| `/api/decide` | `{askId, decision, always?, message?, answers?}` | Answer a Claude Code permission prompt (`allow`, `deny`, `terminal`); `always` writes Claude Code's suggested rule, `message` tells Claude what to do instead, `answers` answers a question card. |
| `/api/task` | `{text}` | Add a goal and tell Tiro. |
| `/api/goal` | `{id, action}` | `accept`, `dismiss`, `done` or `reopen` a goal. |
| `/api/boss` | none | Nudge Tiro to read the board. |
| `/api/boss-reset` | none | Forget Tiro's conversation (goals and reports stay). |
| `/api/hire/decide` | `{id, approve, note?}` | Approve or deny a hire request. |
| `/api/roster` | none | The eight specialists with names, roles and models. |
| `/api/names`, `/api/names/set`, `/api/names/reset` | `{key, name}` / `{key?}` | Read, set or reset display names. |
| `/api/agents/overview`, `/api/agents/tasks`, `/api/agents/task` | `{key, q?}` / `{key, id}` | Per-agent history browser. |
| `/api/scheduler` | none | Scheduler status (read-only). |
| `/api/reports`, `/api/report`, `/api/daily` | `{file}` for one | List and read reports and the daily summary. |
| `/api/memory/graph`, `/note`, `/delete`, `/link` | by note name | Browse and edit vault notes. |
| `/api/sops`, `/api/sops/save` | `{name, text}` | Read and edit SOPs. |
| `/api/switch` | `{name, on}` | Flip a breaker box switch. |
| `/api/rack`, `/api/limits` | none | Server stats; plan limits. |
| `/api/tidy` | none | Clear finished goals and idle desks. |

Also: `GET /print/report`, `/print/daily`, `/export/report.xlsx` and `/export/daily.xlsx` (key required) produce printable pages and Excel files.

