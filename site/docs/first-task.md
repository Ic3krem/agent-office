# First task with Tiro

Open the office and give Tiro its first goal.

(TiroAgents v2.1.0, 2026-11-20)

## Starting

- **Installed app:** open TiroAgents from the desktop shortcut or Start menu. It starts its local server and shows Tiro on your desktop. Double-click Tiro (or use the tray menu, Open office) to open the dashboard.
- **From source:** `npm ci`, then `npm start` (see RESOURCES.md).
- The server listens on `127.0.0.1` only. The desktop app signs its windows in with a private cookie; a standalone `node server.mjs` prints a one-time sign-in link (valid once, for 5 minutes) instead. There is no key in the URL. Pages opened without signing in can load but cannot read or change anything.


## Giving work

1. Type a task in the dispatch box (for example "Review the README and list any wrong claims") and send it. It is added to today's board as a goal and Tiro is told about it.
2. Tiro reads the board, plans, and works. For anything it cannot do itself it asks you to hire a specialist (see Approvals).
3. When a goal produces findings, Tiro files a report and marks the goal done.
4. Tiro keeps going between turns while **Autopilot** is on and goals are open. Switch Autopilot off if you want it to work only when you send something.

You can also message any agent directly from its detail pane, interrupt a running turn, or **Reset** Tiro's conversation (goals and reports stay; Tiro starts a fresh session next time).

