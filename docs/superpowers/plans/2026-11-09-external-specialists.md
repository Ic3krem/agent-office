# External specialists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex, Gemini CLI, OpenCode and a Custom command join Tiro's team as external specialists. Tiro (Claude Opus) delegates to them after the same hire approval, and they run headless with their own settings.

**Architecture:**
- **Desk slots.** External desks are fixed catalog slots (`ext-codex-1..3`, `ext-gemini-1..3`, `ext-opencode-1..3`, `ext-custom-1..3`), so the static ROSTER, the layout desks, names, looks and the party keep working unchanged.
- **New modules.** A pure module `external-agents.mjs` detects CLIs, builds argv and parses output. `external-run.mjs` spawns a run without a shell and enforces the timeout and the output cap. `external-delegate.mjs` holds the delegate logic (approval check, counting, report back) with its dependencies injected, so it can be unit-tested without the SDK.
- **Local-only settings.** Per-desk settings live in kiro.json `external`. Anything that weakens safety (Auto mode, extra arguments, a custom command line) applies only with an HMAC confirmation from the desktop app, the same mechanism as the Security Guard's `confirmed.json`.

**Tech Stack:** Node ESM (`node:child_process`, no new dependencies), Claude Agent SDK `tool()` via `createSdkMcpServer`, node:test, Electron live harnesses (`perf/*.cjs`).

**Spec:** `docs/superpowers/specs/2026-11-09-external-specialists-design.md`

## Global Constraints

- No new npm dependencies; no `node-pty`; no interactive TUI.
- Never `spawn(..., { shell: true })`. On Windows, `.cmd`/`.bat` npm shims are resolved to `node <entry.js>`, or the prompt is sent on stdin, so the prompt never passes through `cmd.exe` parsing.
- Claude Opus (Tiro) is the only orchestrator. External specialists never hire and never call office tools.
- **One approval, one run.** Every `delegate` call consumes its own approved `request_hire` grant (same prompt-hash check as Claude hires). Every run starts a fresh CLI session.
- **Auto off (the default) means read-only.** No permission flags are added; Auto on adds exactly:
  - Codex: `-a never -s workspace-write`
  - Gemini: `--approval-mode=yolo`
  - OpenCode: nothing
  - Custom: what the user typed
- Custom command lines and extra arguments are local-only (kiro.json `external`), never in a layout, template, party payload or report. Auto on, extra arguments or a custom command apply only when confirmed in the desktop app (HMAC). Unsigned values are ignored.
- **Work folder:** `workDir()` (Tiro's). Default timeout 20 minutes per run, stoppable from the desk. External runs count toward `MAX_SPECIALISTS` (`boss.running`).
- **Fixed copy:**
  - Warning line: "Runs with <CLI>'s own permissions; TiroAgents' Security Guard does not check its commands."
  - Read-only line: "Read-only: turn on Auto mode to let it edit."
  - Usage label: "usage: external".
- The CLI's final answer goes through `redact.mjs` before it reaches Tiro, a report or the party. The party sees generic bubbles only, as today.
- The repo is public: no personal names or paths in code, tests or fixtures. Credit Dev-Labs (MIT, github.com/jeffreycayao/Dev-Labs) in `THIRD_PARTY_NOTICES.md` for the provider table and the shell-PATH approach.
- Every new test file is added to the `npm test` list in `package.json`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PNVRsGpaL8ajqgKm3RZjXP
  ```
- **Live tests:**
  - Temp USERPROFILE/HOME/APPDATA/LOCALAPPDATA, ports 4790–4799 (never 4795). Never touch 127.0.0.1:4777 or the real `~/.claude/agent-office`.
  - Never run the real Codex, Gemini or OpenCode, and never sign in to them. Tests use the fake CLI fixture.

## Review Focus

1. **Shell characters in a prompt.** A prompt with `" & | % ^ < > !`, newlines and non-ASCII text must reach the CLI byte for byte on Windows and must never run anything. Test in Task 3.
2. **A failing CLI.** When the CLI is missing, not signed in, exits non-zero or prints nothing, Tiro gets a clear one-line failure, the desk goes idle and `boss.running` is released. Test in Task 4.
3. **Quitting or stopping mid-run.** Quitting the app, stopping Tiro's session or clicking Stop kills the CLI and its whole process tree: no orphan processes, and the count is released. Test in Task 3 (tree kill) and Task 4 (count).
4. **Huge output.** Megabytes of output are capped: the last 200 KB are kept for parsing, the answer to Tiro is at most 20,000 characters with a "(truncated)" note, and memory stays flat. Test in Task 3.
5. **Hand edits of kiro.json.** A hand or agent edit that turns on `auto`, `args` or `command` without the HMAC is ignored and reported as "changed outside the app". Test in Task 5.

---

### Task 1: External desk slots in the catalog and Tiro's brief

**Files:**
- Modify: `public/role-catalog.js` (ROLES, LOOK_KEYS stays derived)
- Modify: `company.mjs` (`teamLine`, manager brief hire lines, `teamFromSops` caller in `server.mjs:478`)
- Test: `role-catalog.test.mjs`, `company.test.mjs`

**Interfaces:**
- Produces:
  - Twelve roles with `{ key: 'ext-<cli>-<n>', name, role, kind: 'external', external: '<cli>', model: null, color, accent, props: 'external' }`, where `<cli>` is one of `codex|gemini|opencode|custom` and `n` is 1..3.
  - `RoleCatalog.isExternal(key) -> boolean` and `RoleCatalog.externalOf(key) -> '<cli>'|null`.
  - `company.mjs` exports `externalKeys(keys) -> string[]`.
- Default names:
  - Codex desks: Codex, Codex 2, Codex 3.
  - Gemini desks: Gemini, Gemini 2, Gemini 3.
  - OpenCode desks: Ollie, Ollie 2, Ollie 3.
  - Custom desks: Custom, Custom 2, Custom 3.
- Role text: "External coding agent (Codex CLI)", "External coding agent (Gemini CLI)", "External agent (OpenCode: any provider or local model)" and "External agent (custom command)".

- [ ] **Step 1: Write the failing tests**
  - `role-catalog.test.mjs` › "external slots": 12 keys matching `/^ext-(codex|gemini|opencode|custom)-[123]$/`; `isExternal('ext-codex-1') === true`; `isExternal('forge') === false`; `externalOf('ext-gemini-2') === 'gemini'`; every external role has `kind === 'external'`.
  - `company.test.mjs` › "team line marks external desks": with keys `['forge', 'ext-codex-1']`, the manager prompt contains `ext-codex-1 (Codex CLI, external: use mcp__office__delegate, not the Agent tool)`.
  - `company.test.mjs` › "SDK agents exclude external desks": `teamFromSops(sops, ['forge', 'ext-codex-1'])` has no `ext-codex-1` entry.
- [ ] **Step 2: Run** `node --test role-catalog.test.mjs company.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Add the roles and helpers. In the manager brief, add one hire line after the request_hire line:

  > "- External specialists (keys starting ext-) are other companies' coding agents. Ask with request_hire exactly as for others; once approved, call mcp__office__delegate(specialist, prompt) once with the approved prompt. Their answer arrives later as a message; check it before you file a report. Every task needs its own approval; they remember nothing between tasks."

  `teamFromSops` skips external keys, so the SDK never sees them as subagents.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Existing roster, wardrobe and drift tests still pass; regenerate fixtures only if a test documents that need.
- [ ] **Step 5: Commit** "External specialists: desk slots in the catalog and Tiro's brief".

### Task 2: Detecting CLIs and building commands (`external-agents.mjs`)

**Files:**
- Create: `external-agents.mjs`
- Test: `external-agents.test.mjs`

**Interfaces:**
- Produces:
  - `PROVIDERS`, an object keyed by `codex|gemini|opencode` with `{ bin, label, autoArgs: string[], modelFlag: '--model', promptVia: 'stdin'|'arg', baseArgs: string[], parse: 'codex-jsonl'|'gemini-json'|'text', configHint }`.
    - Codex: bin `codex`, baseArgs `['exec', '--json', '--skip-git-repo-check']`, prompt on stdin with `-` as the argument (`codex exec` reads stdin for `-`), config `~/.codex/config.toml`.
    - Gemini: bin `gemini`, baseArgs `['--output-format', 'json']`, prompt on stdin plus `-p ''` if `--help` shows that is needed, config `~/.gemini/settings.json`.
    - OpenCode: bin `opencode`, baseArgs `['run']`, prompt as a single argv element (no shell, so it is safe), config `~/.config/opencode/`.
    - Check every flag against the CLI's `--help` text recorded in the fixture comments. Where a flag differs, use the CLI's real flag and note it in the commit.
  - `shellPath(env = process.env, platform = process.platform) -> string`: the login shell's PATH on macOS/Linux (as Dev-Labs `shellEnv`), plus the usual install folders. On Windows that is `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs`, `%USERPROFILE%\.bun\bin`, `%USERPROFILE%\.local\bin` and `%USERPROFILE%\scoop\shims`.
  - `which(bin, pathStr, platform) -> string|null`. On Windows it tries PATHEXT (`.exe`, `.cmd`, `.bat`, `.ps1` ignored).
  - `resolveLaunch(file, platform, readFile = fs.readFileSync) -> { cmd, pre: string[] }`.
    - A `.cmd`/`.bat` npm shim becomes `{ cmd: <node.exe next to the shim, else 'node' found on PATH>, pre: [<absolute entry .js from the shim's %dp0% line>] }`.
    - An `.exe` or a POSIX file stays `{ cmd: file, pre: [] }`.
    - A shim it cannot parse returns `null`, and the desk shows "Cannot run this CLI safely from TiroAgents (unrecognised launcher)".
  - `buildCommand(cli, { prompt, model, auto, extraArgs, command }, launch) -> { cmd, args, stdin }`.
    - Custom: `command` is tokenized by `splitArgs`. `{prompt}` is replaced as one whole argv element; with no `{prompt}`, the prompt goes on stdin.
    - Argument order: `pre`, `baseArgs`, `model` (when set), `autoArgs` (when auto), then `extraArgs`.
  - `splitArgs(str) -> string[]`: double and single quotes, backslash only before a quote, and throws on an unbalanced quote.
  - `parseOutput(kind, stdoutTail) -> { text, error }`:
    - `codex-jsonl`: the last `agent_message` item's text.
    - `gemini-json`: `.response`, or `.error.message`.
    - `text`: the trimmed whole output.
  - `detect({ pathStr, platform, run }) -> Promise<Array<{ cli, label, path|null, installed, version|null, configHint }>>`. It runs `<bin> --version` with a 5 s timeout through `external-run.mjs` (Task 3) with an injected `run`.

- [ ] **Step 1: Write the failing tests** in `external-agents.test.mjs`:
  - "codex argv, auto off": `buildCommand('codex', { prompt: 'hi', auto: false }, { cmd: 'codex', pre: [] })` deep-equals `{ cmd: 'codex', args: ['exec', '--json', '--skip-git-repo-check', '-'], stdin: 'hi' }`.
  - "codex auto on adds exactly -a never -s workspace-write".
  - "gemini auto on adds --approval-mode=yolo"; "opencode auto adds nothing".
  - "model flag": `model: 'gpt-5'` adds `['--model', 'gpt-5']`. A model with spaces or a leading `-` throws "Invalid model name".
  - "custom {prompt} is one argv element": `command: 'mytool --ask "{prompt}"'` with a prompt of `a & b "c"` gives `args` ending `['--ask', 'a & b "c"']`.
  - "splitArgs": `splitArgs('a "b c" \'d e\'')` deep-equals `['a', 'b c', 'd e']`; `splitArgs('"open')` throws.
  - "npm shim resolution": a fixture `.cmd` text with `"%dp0%\node_modules\@openai\codex\bin\codex.js"` resolves `pre` to that absolute path.
  - "parse codex jsonl": a fixture of three JSONL lines whose last item is `{"type":"item.completed","item":{"type":"agent_message","text":"done"}}` gives `{ text: 'done' }`.
  - "parse gemini json error": `{"error":{"message":"not signed in"}}` gives `{ error: 'not signed in' }`.
  - "which on win32 honours PATHEXT", using a temp dir with `codex.cmd`.
- [ ] **Step 2: Run** `node --test external-agents.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `external-agents.mjs` to the interfaces above. Port only the PATH logic from Dev-Labs `shellEnv` (credited in Task 7).
- [ ] **Step 4: Run** `node --test external-agents.test.mjs`. Expected: PASS. Add the file to `package.json` `test`.
- [ ] **Step 5: Commit** "External specialists: CLI detection and command building".

### Task 3: Running a CLI safely (`external-run.mjs`)

**Files:**
- Create: `external-run.mjs`
- Create: `fixtures/fake-cli/fake-cli.mjs`, plus `fake-cli.cmd` (an npm-style shim) for the Windows tests
- Test: `external-run.test.mjs`

**Interfaces:**
- Consumes: `buildCommand` output `{ cmd, args, stdin }` (Task 2).
- Produces: `runExternal({ cmd, args, stdin, cwd, env, timeoutMs = 1_200_000, signal, onLine }) -> Promise<{ ok, code, stdoutTail, stderrTail, timedOut, stopped }>`.
  - `stdio: ['pipe', 'pipe', 'pipe']`, `windowsHide: true`, never `shell: true`.
  - stdin is written and then closed.
  - stdout and stderr each keep the last 200 KB.
  - `onLine(line)` fires per stdout line, for desk progress.
  - Timeout or `signal` abort kills the whole tree: `taskkill /pid <pid> /T /F` on win32, and `process.kill(-pid)` for a detached process group on POSIX.
  - Every live child is registered so `killAll()` (exported) can stop them on process exit.
- The fake CLI echoes its argv and stdin as JSON, can sleep (`--sleep ms`), exit with a code (`--exit n`), spew N MB (`--spew n`), print a JSONL `agent_message`, and spawn a grandchild that sleeps (`--grandchild`).

- [ ] **Step 1: Write the failing tests:**
  - "prompt with shell characters arrives intact": `runExternal` with the prompt `` `a & b | c > d % e ^ f "g" !h\nline2 ünï` `` on stdin, and the same prompt as one argv element through the `.cmd` shim resolved by `resolveLaunch`. The fake CLI's echoed stdin and argv equal the input exactly, and no file `d` is created in cwd.
  - "timeout kills the tree": `--sleep 60000 --grandchild` with `timeoutMs: 1500` gives `timedOut: true`. Within 3 s, neither the child's pid nor the grandchild's pid (the fake CLI writes it to a temp file) is alive.
  - "abort stops": aborting `signal` after 500 ms gives `stopped: true`.
  - "spew is capped": `--spew 20` gives `stdoutTail.length <= 200 * 1024`, and the heap grows less than 30 MB.
  - "non-zero exit": `--exit 3` gives `ok: false, code: 3`.
- [ ] **Step 2: Run** `node --test external-run.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `runExternal` and `killAll`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Add the file to `npm test`.
- [ ] **Step 5: Commit** "External specialists: headless runner with tree kill, cap and timeout".

### Task 4: Delegating (`external-delegate.mjs`) and the office tools

**Files:**
- Create: `external-delegate.mjs`
- Modify: `server.mjs`:
  - `request_hire` around lines 360–383: an external key's approval text changes.
  - `officeTools()`: new `delegate` tool, and `allowedTools` around line 481.
  - The agent record for a run.
  - Process exit calls `killAll`.
  - `stopBoss` does **not** kill runs, because a run outlives Tiro's turn.
  - The quit path does kill runs.
- Test: `external-delegate.test.mjs`

**Interfaces:**
- Consumes: `hires.check(type, prompt)` and `hires.consume(type, prompt)` (existing); `buildCommand`, `resolveLaunch`, `which`, `shellPath`, `parseOutput` (Task 2); `runExternal` (Task 3); `effectiveExternal` (Task 5; until Task 5 lands, inject a stub returning `{ auto: false }`).
- Produces `createDelegator({ hires, settings: key -> desk settings, launch: cli -> { cmd, pre }|null, run = runExternal, redact, tell: text -> void, onStart: (key, goalId, prompt) -> agentId, onLine: (agentId, line) -> void, onEnd: (agentId, { ok, summary }) -> void, max: () -> number, running: () -> number, inc, dec, cwd: () -> string })` returning:
  - `delegate(key, prompt) -> { ok: true, text: 'started' } | { ok: false, error }`. It returns at once; the run continues in the background.
  - `stop(key) -> boolean`.
  - `active() -> string[]`.
- **Rules:**
  - Unknown or non-external key → error.
  - No approved grant, or a different prompt → the same wording as the Agent gate: "Hiring needs user approval first: call mcp__office__request_hire (specialist, goal_id, why, prompt) and wait for \"approved\"." or "The prompt must be exactly the prompt approved in request_hire…".
  - The grant is consumed before spawning.
  - Team full → `N specialists are already working. Wait for a report first.`
  - The desk is already running → "<name> is already working on a task."
  - CLI not found → "<label> is not installed on this PC (see the Agents panel)."
  - A Custom desk without a confirmed command → "This desk has no confirmed command; set it in the Agents panel."
- **When the run ends:**
  - `dec()` always runs, in a `finally`.
  - On success: `tell('<name> (<label>) finished: ' + redact(text).slice(0, 20000) + (truncated ? ' (truncated)' : ''))`.
  - On failure: `tell('<name> (<label>) could not finish: ' + one line from the error, stderr's last line, or "timed out after 20 minutes" or "stopped by the user")`.
- **server.mjs wiring:**
  - `request_hire` with an external key skips the "idle, reuse with SendMessage" check. Its approved text is "approved. Call mcp__office__delegate once with specialist <key> and exactly the prompt you submitted."
  - The `delegate` tool (schema `{ specialist: z.string(), prompt: z.string() }`) calls `delegator.delegate`.
  - `onStart` creates an agent record with `agents.set(id, { ...newAgent(id, extra), born })`, using the same shape as `subExtra` (line 249): `parent: boss.id`, `profile: profileOf(key, roster.deskOf)`, `role: 'External · ' + label`. It also calls `AH.start(key, …)`.
  - `onLine` sets the record's working status and a generic bubble ("Coding…").
  - `onEnd` sets it idle and calls `AH.end`.
  - `POST /api/external/stop { key }` (nonce-protected like other writes) calls `delegator.stop`.

- [ ] **Step 1: Write the failing tests** in `external-delegate.test.mjs`. Use fakes for `hires` and `run`, and a `tell` spy.
  - "needs an approved grant": no grant gives the approval error, and `run` is never called.
  - "prompt must match": a grant for prompt A with `delegate(key, B)` gives the "exactly the prompt" error.
  - "one approval, one run": after a successful delegate, a second `delegate` with the same prompt gives the approval error.
  - "team full": `running() === max()` gives the full error, and the grant is **not** consumed.
  - "failure releases the count": `run` resolves `{ ok: false, code: 1, stderrTail: 'Error: not logged in\n' }`. Expect `dec` called once, `tell` called with `could not finish: Error: not logged in`, and `onEnd` with `ok: false`.
  - "run throws (spawn ENOENT)": expect `dec` once, `tell` with "not installed", and no unhandled rejection.
  - "answer is redacted and capped": the answer contains `sk-ant-api03-…` and is 50,000 characters long. Expect a `tell` text without the key, at most `20000 + header` characters, ending "(truncated)".
  - "stop": `stop(key)` aborts the signal, and `tell` says "stopped by the user".
- [ ] **Step 2: Run** `node --test external-delegate.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `external-delegate.mjs` and the `server.mjs` wiring.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, including the existing hire-gate and guard-wiring tests. Add the new file to `npm test`.
- [ ] **Step 5: Commit** "External specialists: delegate tool, background runs and report back to Tiro".

### Task 5: Local settings with desktop confirmation (`external-settings.mjs`)

**Files:**
- Create: `external-settings.mjs`
- Modify:
  - `server.mjs`: `GET /api/external` → `{ detected, desks: [{ key, cli, settings, confirmed, warning }] }`; `POST /api/external/settings` saves the model only.
  - `desktop/main.mjs`: new IPC `external:confirm`, next to the guard confirmation at lines 262–289.
- Test: `external-settings.test.mjs`

**Interfaces:**
- Produces:
  - `cleanExternal(obj) -> { [key]: { model?, auto?, args?, command? } }`. External keys only; `model` matches `/^[\w.:\/@-]{1,80}$/`; `args` and `command` are strings of at most 500 characters; `auto` is a boolean.
  - `signExternal(cfg, secret)`, an HMAC over the canonical JSON as `guard/config.mjs` `signConfig` does (reuse `canonicalJson`).
  - `effectiveExternal(kiroExternal, confirmed, secret) -> { [key]: settings, changedOutside: string[] }`. `model` always applies. `auto`, `args` and `command` apply only when they equal the signed confirmed values; otherwise they fall back to `auto: false, args: '', command: ''` and the key is listed in `changedOutside`.
  - Confirmed file: `CFG_DIR/external/confirmed.json` `{ config, hmac }`, mode 0600.
  - Desktop: `external:confirm(key, { auto, args, command })` shows a native dialog with the warning line and the exact command or arguments, then writes kiro.json `external` and `confirmed.json` with `GUARD_KEY`.
  - With no desktop app (browser-only, no `GUARD_KEY`), weaker settings never apply, and the panel says "Open TiroAgents to change this."
- [ ] **Step 1: Write the failing tests:**
  - "model applies unsigned".
  - "auto without hmac is ignored": `effectiveExternal({ 'ext-codex-1': { auto: true } }, null, 'k')['ext-codex-1'].auto === false`, and `changedOutside` includes the key.
  - "signed auto applies".
  - "tampered command is ignored": signed `{ command: 'a' }`, kiro says `'b'`, so the command is `''`.
  - "non-external keys and bad models dropped".
  - "layout never carries settings": `world-store` save of a layout whose dept-desk carries `{ role: 'ext-codex-1', command: 'x' }` stores no `command`. Assert this in `world-store.test.mjs` or `world-model.test.mjs`, wherever the dept-desk params are cleaned.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, then swap the Task 4 stub for `effectiveExternal`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** "External specialists: local desk settings, desktop-confirmed Auto mode and commands".

### Task 6: Agents panel, Build catalog and desk UI

**Files:**
- Modify:
  - `public/Agent Office.html`: an **Agents** panel next to the existing panels; external desk types in the Build catalog drawer; the desk card's Stop button.
  - `public/office-sprites.js` / `office-furniture.js`: an external desk variant with a small brand-neutral badge per CLI (a letter mark C, G, O or ⌘; no logos).
- Create: `perf/external-check.cjs`, a live harness.

**Interfaces:**
- Consumes: `GET /api/external`, `POST /api/external/settings`, `POST /api/external/stop`, the desktop `external:confirm` bridge (exposed like the guard confirm in the preload), and `RoleCatalog.isExternal`.

**The Agents panel:**
- **Detected CLIs:** one row per CLI with installed or not, version, path, and "uses its own settings in <configHint>". When a CLI is not installed, it shows its install command as text (from Dev-Labs' table) and never runs it.
- **External desks:** a section per external desk with its name, CLI, model (text box), and an Auto mode switch plus extra arguments (both through the desktop confirm). For Custom desks, a command line with a `{prompt}` hint.
- **Warning lines:** each desk shows the warning line; with Auto off it also shows the read-only line.
- **Usage:** the label is "usage: external".

**The desk card** for a working external specialist shows its generic status and a **Stop** button.

**Party:** the existing party feed sends external desks as ordinary agents with generic bubbles. `party/protocol.mjs` accepts `ext-*` keys, which must be confirmed.

- [ ] **Step 1: Write `perf/external-check.cjs`.** It follows the `party-town-check.cjs` pattern: a temp profile, port 4793, `AGENT_OFFICE_NO_TUNNEL=1`, and PATH prepended with a temp dir holding a `codex.cmd` shim around `fixtures/fake-cli/fake-cli.mjs`. Checks:
  - (a) The Agents panel lists Codex as installed with the fake version.
  - (b) Placing an `ext-codex-1` desk in Build mode and saving puts it in `liveRoster` keys.
  - (c) The desk shows the warning line and the read-only line.
  - (d) Calling the delegator through a test-only route `POST /api/external/test-run`, enabled only when `AGENT_OFFICE_TEST_HOOKS=1` and absent otherwise (also assert it 404s without the flag), runs the fake CLI. The desk turns working, then idle, and the message to Tiro is recorded (test hook: last `tell` text).
  - (e) Stop during a `--sleep` run ends it, with "stopped by the user".
  - (f) No console errors.
- [ ] **Step 2: Run** `node_modules/.bin/electron perf/external-check.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the UI and the test hook.
- [ ] **Step 4: Run** the harness. Expected: `ALL PASSED`. Then run `scene-check`, `office-check`, `party-town-check` and `town-check`. Expected: `ALL PASSED` each.
- [ ] **Step 5: Commit** "External specialists: Agents panel, external desks and Stop".

### Task 7: Docs, notices and the full check

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md` (Dev-Labs, MIT: the provider flag table and the shell-PATH approach), `CHANGELOG.md` (an Unreleased bullet "External specialists"), `docs/` (a short `docs/external-specialists.md` covering setup, Auto mode, the warning, and that usage is billed to each CLI's own account).

- [ ] **Step 1:** Write the docs and the notice.
- [ ] **Step 2: Run** `npm test`, then `perf/external-check.cjs`, `office-perf.cjs` (heap and private-memory budgets unchanged) and `party-town-check.cjs`. Expected: all pass.
- [ ] **Step 3: Commit** "External specialists: docs, notices and changelog".
- [ ] **Step 4: Report.** Write `.superpowers/sdd/2026-11-09-external-specialists/report.md` with the commits, test counts, each harness result, any CLI flag that differed from this plan (with the `--help` evidence), and open risks. Do not bump the version, package, push, tag or release.
