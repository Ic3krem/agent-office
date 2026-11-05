# Department Desks (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Department desks set Tiro's team.
- Placing a department desk in Build mode (IT, QA, Accounting, Marketing, Auditor, Notetaker, or any of the current 8 roles) adds that specialist to the manager's roster.
- Removing a desk retires the role. Its memory folder is kept.
- Tasks still go to Tiro, who assigns them to the desks that exist.

**Architecture:**
- **Display data:** one shared role list in a new classic script, `public/role-catalog.js` (`RoleCatalog`). It holds key, name, role, kind, model, colour, accent and props style. The page uses it, and the server loads it through vm.
- **Server-only role specs** (tools, effort, brief) stay in `company.mjs`, keyed by the same keys. A drift test keeps the two in sync.
- **Desk ownership:** a `dept-desk` instance carries `role` (a role key) and `desk` (a slot id, `desk-N`).
- **Active roster:** the role keys of the desks in the saved layout.
- **Who reads the roster:**
  - `office-motion` rebuilds `TEAM` from it in `useLayout`.
  - On the server, `request_hire`, the hire hook, the SDK `agents` map, `MANAGER_PROMPT`, `/api/roster` and the snapshot all read it.
- **Roster changes:** a change restarts Tiro's session on its next turn, which is the same mechanism as an SOP change.

**Tech Stack:** Node ESM server, Agent SDK (`query`, `agents`), classic browser scripts, `node:test` + vm.

**Spec:** `docs/superpowers/specs/2026-11-05-world-roadmap-design.md` (Phase 3 section)

## Global Constraints
- **Branch `feature/world`**, worktree `AgentOfficeWork/world`. Phases 1–2 are complete.
- **Classic-script pattern** in `public/`. Every new `*.test.mjs` goes in the `npm test` list.
- **The default layout still draws exactly as 1.2.9.** `fixtures/office-golden.json` and `fixtures/office-bake-golden.json` must stay green and are never edited.
- **Hiring safety is unchanged:**
  - `hireGate` approval and prompt hash;
  - breaker switches;
  - subscription guard;
  - Security Guard;
  - the cap on concurrent hires: `MAX_SPECIALISTS` stays **8** and stays separate from desk count.
- **Desk count:** 1 to **12** department desks per layout, with one desk per role.
- **QA desk = the existing `probe` role** (QA and test engineer). New role keys: `it`, `accounting`, `marketing`, `auditor`, `notetaker`.
- **Saved layouts from Phases 1–2** (8 desks with no `role` param) must load. The role is implied from the built-in desk to role map (`desk-1`→`pixel` … `desk-8`→`scribe`).
- **Live checks** use a temp `HOME`/`USERPROFILE`/`APPDATA` and `AGENT_OFFICE_PORT=4790`.
  - Never touch `:4777`, and never launch `desktop/main.mjs`, because it probes `:4777`.
  - Stop only PIDs you started.
- **Baseline flaky set:** 20 s server-start timeouts under parallel load (security/hardening/guard-wiring/bridge-register; these pass alone), the B1 real-git test, and the world-path timing test under load.
- **Commits end with:**
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_01PNVRsGXe7KFHBeKupfZcRQ`

## Review Focus
1. **Retiring a role whose specialist is working right now.** The save is refused with "<Name> is working; wait or stop them first". The layout is unchanged. Covered in Task 3.
2. **An old `layout.json` with no `role` params** loads, validates, and gives the same 8-role roster. Covered in Task 2.
3. **A new role's desk is drawn without crashing.** It needs props and a chair colour, and the hotspot label must not throw for an unknown key. Covered in Task 2.
4. **Tiro is asked to hire a role that has no desk.** `request_hire` refuses with the list of available roles, and the SDK `agents` map does not include that role. Covered in Task 3.
5. **Roster change while Tiro is mid-turn.** Nothing crashes. The new roster takes effect on the next turn after the session restarts. Covered in Task 3.

---

### Task 1: Role catalog and dynamic roster helpers

**Files:**
- Create: `public/role-catalog.js`
- Modify: `company.mjs` (ROSTER at about :88-105, `MANAGER_PROMPT` at about :44-79, `sanitizeNames`/`setAgentName`, `def`/`SPECIALISTS`, `teamFromSops`, `profileOf`, `ALIASES`), `agent-home.mjs` (`KEYS` :12, `need` :17), `retention.mjs:40`, `world-vm.mjs` (`ORDER`: put `role-catalog.js` first)
- Test: `company.test.mjs`, `agent-home.test.mjs`, new `role-catalog.test.mjs`

**Interfaces:**
- **`root.RoleCatalog = { ROLES, BUILTIN_DESKS, get(key), keys() }`.**
  - `ROLES` is `[{key, name, role, kind, model, color, accent, props}]` for 13 roles: the 8 current ones (values copied exactly from `ROSTER`), plus `it` (IT support and sysadmin, kind `ops`, model `sonnet`), `accounting` (Accountant, `ops`, `sonnet`), `marketing` (Marketing writer, `writer`, `sonnet`), `auditor` (Auditor and compliance reviewer, `research`, `opus`) and `notetaker` (Meeting notes and minutes, `writer`, `haiku`).
  - Each new role gets a distinct colour and accent, a name (Byte, Ledger, Spark, Vera, Memo) and a `props` style key.
  - `BUILTIN_DESKS = {'desk-1':'pixel', …, 'desk-8':'scribe'}`.
- **`company.mjs`:**
  - `SPECS` holds server-only fields (`tools`, `effort?`, `brief[3]`) for all 13 keys. `ROSTER` stays exported as the merged record of all 13, for compatibility, with `desk` only on the built-ins.
  - `activeKeys(layout) → string[]` gives the role keys of `dept-desk` objects, in desk-id order. It uses `role`, or `BUILTIN_DESKS[desk]` when `role` is absent. With no layout, it returns the built-in 8.
  - `managerPrompt(keys) → string` replaces the hard-coded team sentence. It says "The team is these N specialists: …", lists the coders among the keys, and keeps the rest of today's prompt verbatim. `MANAGER_PROMPT` stays exported as `managerPrompt(the built-in 8)`.
  - `specialists(keys) → {key: def}` replaces the static `SPECIALISTS` (which stays exported for the built-in 8).
  - `teamFromSops(sops, keys)` only applies SOPs whose key is in `keys`.
  - `profileOf(type, deskOf)`: `deskOf(key)` returns the desk id from the active layout.
  - `sanitizeNames` and `setAgentName` accept every catalog key.
- **`agent-home.mjs`:** `KEYS` covers `tiro` plus all 13 catalog keys. `ensureAll` creates folders for all of them, which is harmless and keeps retired memory.
- **`retention.mjs`:** history pruning covers all catalog keys.

- [ ] **Step 1: Write the failing tests.**
  - `catalog matches ROSTER for the built-ins`, a drift test on name, role, model, colour and accent.
  - `13 roles, unique keys, names and colours`.
  - `activeKeys falls back to built-in desks when role is absent`.
  - `activeKeys reads role params in desk order`.
  - `managerPrompt lists exactly the given keys`. For `['pixel','auditor']`, it mentions both and does not mention `forge`.
  - `specialists(keys) has exactly those keys`.
  - `names accept new role keys`.
  - `agent-home KEYS cover every catalog key`.
  - Update the old "exactly 8" assertions so they apply to the built-in set only.
- [ ] **Step 2: Run** `node --test role-catalog.test.mjs company.test.mjs agent-home.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write real three-line `brief`s and least-privilege tool sets for the new roles:
  - `auditor`: read-only, using `READ_ONLY`.
  - `notetaker`: `READ_ONLY` plus Write.
  - `it`, `accounting` and `marketing`: `HANDS_ON` minus Bash for `marketing`.
- [ ] **Step 4: Run** the focused tests plus `security.test.mjs` on its own. Expected: PASS. `security.test.mjs` pins tools per key, so extend it for the new keys.
- [ ] **Step 5: Commit.** `feat(desks): role catalog and roster helpers for any set of desks`.

### Task 2: Layout and drawing support any roster

**Files:**
- Modify: `public/office-motion.js` (`TEAM` :9-18, `DESKS` :22/:32, `useLayout` :93-103)
- Modify: `public/office-furniture.js` (`teamOf` :98, rug :128, `PROPS` :359-457 and `drawDesk` :461, `deskOf`/`dept-desk` :465-472)
- Modify: `public/office-world.js` (:78, :84)
- Modify: `public/world-model.js` (`requiredSpots` :107, desk check :124, param list)
- Modify: `public/world-edit.js` (`NOT_ADDABLE` :24, `deletable` :38, `remove` :139, `add` params)
- Test: `office-motion.test.mjs`, `world-model.test.mjs`, `world-edit.test.mjs`, `world-parity.test.mjs`

**Interfaces:**
- **`dept-desk` params:** `{desk, role?}`.
- **`OfficeMotion.TEAM`** is rebuilt in place by `useLayout` from the layout's desks via `RoleCatalog`, each entry with `{key, name, role, model, color, accent, desk}`. `TIRO` is unchanged, and the default layout gives today's 8 entries in today's order.
- **`validate` additions:**
  - `role` must be a catalog key. Otherwise the error is `'unknown role <r>'`.
  - The effective role (explicit, or implied by a built-in desk) is unique. Otherwise `'two desks for <role>'`.
  - Desk ids are unique and match `/^desk-\d{1,2}$/`.
  - There are 1–12 desks. Otherwise `'too many desks'` or `'no desks'`.
  - The required spots become: the desk spots of the desks present, plus every non-desk id the brain reads today.
- **`WorldEdit`:**
  - `add('dept-desk', x, y, {role})`. The new desk id is `desk-<smallest unused N>`. The add fails with `'pick a role'`, `'<Name> already has a desk'` or `'12 desks is the limit'`.
  - `dept-desk` is now addable and deletable. Removing the last desk fails with `'keep at least one desk'`.
  - `catalog()` adds `{type:'dept-desk', group:'desk', roles: RoleCatalog.ROLES}`.
  - `availableRoles(layout)` lists the roles that have no desk yet.
- **Drawing:**
  - `PROPS` gains painters for `it` (a second monitor and a cable tidy), `accounting` (an adding machine and a ledger), `marketing` (a mood board and a megaphone), `auditor` (a magnifier and binders) and `notetaker` (a notepad and a mic).
  - Unknown keys fall back to a generic laptop prop.
  - The aisle rug accents draw only for the first 8 TEAM entries, at today's positions.
  - The hotspot label and `deskAgent` work for any TEAM entry, and fall back to "Desk" when none is found.

- [ ] **Step 1: Write the failing tests.**
  - `old layouts without role still validate and give the 8 built-in TEAM` (use `fixtures/office-golden.json` spots plus `defaultLayout()` with `role` removed).
  - `a layout with an auditor desk at a free spot validates; TEAM includes Vera at that desk`.
  - `unknown role, duplicate role, 13 desks, zero desks are rejected` (each matched by its error string).
  - `removing desk-3 is allowed; desk-3's spot is no longer required`.
  - `drawing a desk for every new role does not throw`: record `place()` with one desk per new role, then call every painter.
  - `WorldEdit.add('dept-desk', …, {role:'it'})` gives `desk-9`, with the duplicate-role and limit refusals.
  - The golden tests stay green.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the default-layout draw output byte-identical. Built-in desks keep their implicit role, and `defaultInstances()` does not add a `role` param to them.
- [ ] **Step 4: Run** `node --test world-*.test.mjs office-motion.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(desks): layouts, drawing and editing work with any set of department desks`.

### Task 3: Server uses the active roster

**Files:**
- Modify: `server.mjs`
  - `DESKS` (:40);
  - the SOP seeding (:97);
  - `request_hire` (:330-352);
  - `nameNote` (:369);
  - `bossOptions` (:399-430);
  - the restart check (:442);
  - `snapshot()` (:461-483);
  - `/api/roster` (:640);
  - `/api/agents/*` (:683-685);
  - `POST /api/world` (:603-607).
- Test: new `roster-live.test.mjs`, `hardening.test.mjs`

**Interfaces:**
- **`currentKeys()`** returns `activeKeys(worldStore.load().layout)`. It is cached and refreshed on a successful save.
- **`request_hire`:**
  - The zod description lists the current roles.
  - An unknown or retired key gets `deny('No desk for <key>. Available: …')`.
  - The cap check is unchanged.
- **`bossOptions`:**
  - `agents` = `withAliases(teamFromSops(trustedSops(), currentKeys()))`.
  - The system prompt uses `managerPrompt(currentKeys())`.
  - The hook resolves only current keys.
- **Restart:** a roster change sets `boss.rosterAt`. The next turn sees that it differs from the session's value and restarts the session, using the same path as `sopStamp`.
- **Snapshot:**
  - The desk cap becomes `currentKeys().length` (at most 12).
  - It adds `roster: [{key, name, role, desk}]` for the page.
  - `boss.max` stays `MAX_SPECIALISTS`.
- **SOP seeding:** a `specialist-<key>.md` is created on demand the first time a role becomes active, using the existing pin and trust path.
- **`POST /api/world` refusal:** if the new layout retires a role whose specialist is currently running (its `subagent` is active per the existing helper tracking), return 409 `{error:'<Name> is working; wait or stop them first'}` and do not save.
- **`/api/roster`:** returns the active roster plus `available` (catalog roles with no desk) and `max: MAX_SPECIALISTS`.
- **`/api/agents/*`:** accept any catalog key.

- [ ] **Step 1: Write the failing tests** in `roster-live.test.mjs`. Unit-test the pure helpers and a fake store; reserve the HTTP part for `hardening.test.mjs`.
  - `request_hire refuses a retired role and lists available`.
  - `bossOptions agents follow the saved layout`: with an auditor desk added, `agents.auditor` exists. With desk-3 removed, `agents.warden` is absent.
  - `roster change marks the boss for restart`.
  - `retiring a busy role is refused with 409 and the file is unchanged`.
  - `snapshot desk cap equals the desk count`.
  - The HTTP test: `GET /api/roster` lists `available`, and `POST /api/world` adding an `it` desk returns 200, after which the roster includes `it`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, `node --test company.test.mjs`, and `hardening.test.mjs` on its own. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(desks): Tiro hires from the desks in the office`.

### Task 4: UI: desk picker, retire confirm, dynamic team counts

**Files:**
- Modify: `public/Agent Office.html` (catalog drawer tabs, Team pill :172, roster panel :181/:187/:572/:601/:605, `deskInfo`)

**Interfaces:**
- **Drawer:** a new **Desks** tab, first in the drawer. It lists `availableRoles()` as cards showing role name, character name and a colour swatch. Placing one calls `dropAt('dept-desk', x, y, {role})`; extend `dropAt` and `add` to pass params. Roles that already have a desk are greyed out with "On the floor".
- **Deleting a desk in Build mode:** a confirm dialog asks "Retire <Name> (<role>)? Their memory is kept and they come back if you place their desk again." A 409 from Save shows the server's message.
- **Team pill:** `Team {{hired}}/{{deskCount}}`. The roster panel lists the active roster from the snapshot `roster`. The "8" literals go.
- **Built-in desk properties:** the panel shows the role, and the desk character's name follows the existing rename feature.

- [ ] **Step 1: Extend the headless driver** from Phase 2. Keep it outside the repo, in `scratchpad\build-driver\`. Use a temp `HOME` and port 4790, and do not launch `desktop/main.mjs`. The driver:
  1. enters Build mode;
  2. opens the Desks tab;
  3. places an Auditor desk;
  4. saves;
  5. checks that `GET /api/roster` includes `auditor` and that the Team pill shows `/9`;
  6. deletes desk-3 (Warden), confirms, and saves;
  7. checks that the roster lacks `warden` and the pill shows `/8`;
  8. reloads and checks that the layout persisted;
  9. takes screenshots.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run the driver and `npm test`.** Expected: all driver steps pass, and nothing new fails.
- [ ] **Step 4: Commit.** `feat(desks): place and retire department desks from Build mode`.

---

## Out of scope
- **Several desks for one role.**
- **Custom roles typed in by the user.**
- **More than 12 desks.**
