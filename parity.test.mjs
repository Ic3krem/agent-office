import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeSessionOptions, readDefaultMode, describeRequest, makeCanUseTool, cleanEnv, launchesClaude, SETTING_SOURCES } from './permissions.mjs';

// Agent Office must behave like a plain `claude` run from the same folder. Allow, deny and ask rules, the permission mode,
// hooks, MCP servers, CLAUDE.md, skills, plugins and env are evaluated by Claude Code itself because the session loads the same
// settings. These tests pin that: nothing of ours narrows, widens or pre-answers tool permissions.
const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-par-'));
const put = (dir, rel, obj) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); };

test('session options: user/project/local settings, claude_code tool preset, no MCP isolation, no model or mode pinned, env cleaned', () => {
  const o = claudeSessionOptions({ cwd: 'C:/work', home: 'C:/Users/x', claudeExe: 'C:/claude.exe',
    env: { PATH: 'p', ANTHROPIC_BASE_URL: 'https://gw', ELECTRON_RUN_AS_NODE: '1', AGENT_OFFICE_UI_KEY: 'k'.repeat(48), AGENT_OFFICE_BOOT: 'b' } });
  assert.deepEqual(o.settingSources, ['user', 'project', 'local']);
  assert.deepEqual(SETTING_SOURCES, ['user', 'project', 'local']);
  assert.deepEqual(o.tools, { type: 'preset', preset: 'claude_code' }, 'the full Claude Code tool set (Bash, PowerShell, NotebookEdit, TodoWrite, Skill, AskUserQuestion ...)');
  assert.equal(o.cwd, 'C:/work');
  assert.equal(o.pathToClaudeCodeExecutable, 'C:/claude.exe');
  for (const k of ['permissionMode', 'allowedTools', 'disallowedTools', 'model', 'effort', 'strictMcpConfig', 'mcpServers', 'plugins', 'settings', 'systemPrompt', 'canUseTool']) assert.ok(!(k in o), k + ' is not set by the base options');
  assert.equal(o.env.PATH, 'p'); assert.equal(o.env.ANTHROPIC_BASE_URL, 'https://gw');
  assert.ok(!('ELECTRON_RUN_AS_NODE' in o.env) && !('AGENT_OFFICE_UI_KEY' in o.env) && !('AGENT_OFFICE_BOOT' in o.env), 'Electron and our own variables are not handed to claude');
  assert.ok(!('allowDangerouslySkipPermissions' in o));
  assert.deepEqual(Object.keys(cleanEnv({ A: '1' })), ['A']);
});

test('permission mode comes from settings: local over project over user; bypass is honoured only when the config says so', () => {
  const home = tmp(), cwd = tmp();
  assert.equal(readDefaultMode({ cwd, home }), undefined, 'nothing configured: Claude Code default');
  put(home, '.claude/settings.json', { permissions: { defaultMode: 'acceptEdits' } });
  assert.equal(readDefaultMode({ cwd, home }), 'acceptEdits');
  put(cwd, '.claude/settings.json', { permissions: { defaultMode: 'plan' } });
  assert.equal(readDefaultMode({ cwd, home }), 'plan', 'project settings are honoured over user settings');
  put(cwd, '.claude/settings.local.json', { permissions: { defaultMode: 'default' } });
  assert.equal(readDefaultMode({ cwd, home }), 'default', 'local settings win');
  assert.ok(!('allowDangerouslySkipPermissions' in claudeSessionOptions({ cwd, home })));
  put(cwd, '.claude/settings.local.json', { permissions: { defaultMode: 'bypassPermissions' } });
  const b = claudeSessionOptions({ cwd, home });
  assert.equal(b.allowDangerouslySkipPermissions, true, 'bypass mode is honoured when the user configured it');
  assert.ok(!('permissionMode' in b), 'the mode itself is still resolved by Claude Code from settings');
  fs.rmSync(path.join(cwd, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.claude')); fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), '{not json');
  assert.doesNotThrow(() => readDefaultMode({ cwd, home }));
});

test('an ask reaches the UI with the full tool input, Claude Code\'s reason, and only the choices Claude Code offers', () => {
  const bash = describeRequest('Bash', { command: 'npm run build -- --flag' }, { decisionReason: 'not in your allow list' });
  assert.equal(bash.cmd, 'npm run build -- --flag'); assert.equal(bash.why, 'not in your allow list'); assert.ok(!('canModify' in bash), 'no command editing');
  const write = describeRequest('Write', { file_path: 'C:/a/b.md', content: 'x'.repeat(15000) + 'END' }, { title: 'Claude wants to write b.md' });
  assert.equal(write.preview.length, 15003, 'the whole file content is shown (up to 20000 characters)');
  assert.equal(write.title, 'Claude wants to write b.md');
  const edit = describeRequest('Edit', { file_path: 'C:/a/b.md', old_string: 'one', new_string: 'two' }, {});
  assert.match(edit.preview, /one/); assert.match(edit.preview, /two/);
  const mcp = describeRequest('mcp__srv__do_thing', { a: 1, b: ['x'] }, { description: 'does a thing' });
  assert.match(mcp.preview, /"b"/); assert.equal(mcp.description, 'does a thing');
  assert.equal(describeRequest('Bash', { command: 'x' }, { suggestions: [{ type: 'addRules' }] }).canAlways, true, '"Yes, and don\'t ask again" is offered when Claude Code suggests a rule');
  assert.equal(describeRequest('Bash', { command: 'x' }, {}).canAlways, false, 'no suggestion, no such choice');
  assert.equal(describeRequest('Bash', { command: 'x' }, { suggestions: [{ type: 'addRules' }], suppressAlwaysAllowRule: true }).canAlways, false);
  assert.equal(describeRequest('Bash', { command: 'x' }, { defaultToNo: true }).defaultToNo, true);
});

test('AskUserQuestion is shown as a question card with its options and returns the answers', async () => {
  const input = { questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'relational' }, { label: 'SQLite', description: 'file' }] }] };
  const d = describeRequest('AskUserQuestion', input, { suggestions: [{ type: 'addRules' }] });
  assert.equal(d.questions.length, 1); assert.deepEqual(d.questions[0].options.map(o => o.label), ['Postgres', 'SQLite']); assert.equal(d.canAlways, false);
  const mk = a => makeCanUseTool({ ask: () => Promise.resolve(a), agentOf: () => 'boss' });
  const ok = await mk({ decision: 'allow', answers: { 'Which database?': 'SQLite' } })('AskUserQuestion', input, {});
  assert.equal(ok.behavior, 'allow'); assert.deepEqual(ok.updatedInput.answers, { 'Which database?': 'SQLite' }); assert.equal(ok.updatedInput.questions.length, 1);
  assert.equal((await mk({ decision: 'allow' })('AskUserQuestion', input, {})).behavior, 'deny', 'no answers is not an approval');
  assert.equal((await mk({ decision: 'deny' })('AskUserQuestion', input, {})).behavior, 'deny');
});

test('the permission callback never answers by itself; Yes, Yes-and-don\'t-ask-again and No map to Claude Code results', async () => {
  const calls = [];
  const mk = answer => makeCanUseTool({ ask: (id, tool, input, d) => { calls.push({ id, tool, input, d }); const p = Promise.resolve(answer); p.cancel = () => {}; return p; }, agentOf: a => (a ? 'agent-' + a : 'boss') });
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run build:*' }], behavior: 'allow', destination: 'localSettings' }];

  const once = await mk({ decision: 'allow' })('Bash', { command: 'npm run build' }, { suggestions, toolUseID: 't1' });
  assert.equal(once.behavior, 'allow'); assert.equal(once.updatedPermissions, undefined, 'yes once writes nothing');
  assert.deepEqual(once.updatedInput, { command: 'npm run build' });

  const always = await mk({ decision: 'allow', always: true })('Bash', { command: 'npm run build' }, { suggestions, toolUseID: 't2' });
  assert.deepEqual(always.updatedPermissions, suggestions, 'the same update, to the same scope, that Claude Code suggested');
  assert.equal(always.updatedPermissions[0].destination, 'localSettings');
  assert.equal((await mk({ decision: 'allow', always: true })('Bash', { command: 'x' }, { suggestions, suppressAlwaysAllowRule: true })).updatedPermissions, undefined, 'a suppressed rule is not written');
  assert.equal((await mk({ decision: 'allow', always: true })('Bash', { command: 'x' }, {})).updatedPermissions, undefined);

  const noEdit = await mk({ decision: 'allow', command: 'rm -rf /' })('Bash', { command: 'npm run build' }, {});
  assert.deepEqual(noEdit.updatedInput, { command: 'npm run build' }, 'the command is never edited after Claude Code checked its rules');

  const deny = await mk({ decision: 'deny', message: 'use the test script instead' })('Bash', { command: 'rm x' }, {});
  assert.deepEqual([deny.behavior, deny.message], ['deny', 'use the test script instead']);
  assert.match((await mk({ decision: 'deny' })('Bash', { command: 'rm x' }, {})).message, /denied/i);
  assert.equal((await mk({ decision: 'terminal' })('Bash', { command: 'x' }, {})).behavior, 'deny', 'an unanswered prompt is a denial, never an approval');

  assert.equal(calls.length, 8, 'every request that reached the callback was put to the user');
  await mk({ decision: 'deny' })('Read', { file_path: 'a' }, { agentID: 'abc' });
  assert.equal(calls.at(-1).id, 'agent-abc', 'a specialist\'s request shows on its own desk');
});

test('aborting a tool call withdraws only its own prompt', async () => {
  let cancelled = 0, release;
  const ask = () => { const p = new Promise(r => { release = r; }); p.cancel = () => { cancelled++; release({ decision: 'deny' }); }; return p; };
  const ctl = new AbortController();
  const pending = makeCanUseTool({ ask, agentOf: () => 'boss' })('Bash', { command: 'x' }, { signal: ctl.signal });
  ctl.abort();
  assert.equal((await pending).behavior, 'deny'); assert.equal(cancelled, 1);
});

test('hire gate, command side: a command that launches Claude is denied (deny-only), ordinary commands are untouched', () => {
  for (const c of ['claude -p "do it"', 'claude.exe --x', 'npx @anthropic-ai/claude-code -p x', 'node node_modules/@anthropic-ai/claude-agent-sdk/cli.js', 'echo hi && claude -p x', 'C:\\Users\\a\\.local\\bin\\claude.exe -p hi']) assert.ok(launchesClaude(c), c);
  for (const c of ['npm test', 'git status', 'ls claude-notes', 'echo "ask claude later"', 'cat docs/claude.md', 'node server.mjs']) assert.ok(!launchesClaude(c), c);
  assert.equal(launchesClaude(undefined), false);
});

test('server wiring: no home-made approval rules, Claude Code settings for Tiro, isolated probe only for plan limits', () => {
  const s = read('./server.mjs');
  assert.ok(!fs.existsSync(new URL('./manager.mjs', import.meta.url)), 'the custom auto-approval module is gone');
  assert.doesNotMatch(s, /from '\.\/manager\.mjs'|\breview\(|trustedDirs|reviewCtx|protectedDirs|manager\.on/);
  assert.match(s, /claudeSessionOptions\(\{ cwd: workDir\(\)/);
  assert.match(s, /canUseTool: makeCanUseTool/);
  const boss = s.slice(s.indexOf('const bossOptions = () =>'), s.indexOf('function tellBoss'));
  assert.doesNotMatch(boss, /^\s{4}(settingSources|strictMcpConfig|tools|model|effort|permissionMode):/m, 'Tiro does not override settings, tools, model, effort or mode');
  assert.match(boss, /allowedTools: \['request_hire'.*\]\.map\(t => 'mcp__office__' \+ t\)/, 'only our own office tools are pre-allowed');
  assert.doesNotMatch(boss, /permissionMode/);
  assert.match(s, /LIMITS_OPTS = \{ settingSources: \[\]/);
  assert.equal((s.match(/LIMITS_OPTS/g) || []).length, 2, 'the isolated options are used for the plan-limit probe and nothing else');
  assert.doesNotMatch(s, /ASK_WAIT_MS/, 'no timeout that decides for the user');
  assert.match(s, /case '\/api\/manager': return json\(res, 400/);
  assert.doesNotMatch(s, /permissionDecision: 'allow'/, 'our hooks never approve anything (the hire gate only denies or adjusts input)');
});

test('hooks, MCP servers and env of the user are not replaced: only our hire gate and office tools are added', () => {
  const s = read('./server.mjs');
  const boss = s.slice(s.indexOf('const bossOptions = () =>'), s.indexOf('function tellBoss'));
  assert.match(boss, /PreToolUse: \[denyClaudeLaunch, \{ hooks: \[secGuard\.pre\] \}, \{ matcher: 'Agent\|Task'/);
  assert.match(boss, /PostToolUse: \[\{ hooks: \[secGuard\.post\] \}\]/); assert.match(boss, /UserPromptSubmit: \[\{ hooks: \[secGuard\.prompt\] \}\]/);
  assert.match(boss, /mcpServers: \{ office: officeTools \}/);
  assert.doesNotMatch(boss, /USER_ENV|\benv:/);
  const roster = read('./company.mjs');
  assert.doesNotMatch(roster, /permissionMode/, 'no agent definition sets a permission mode');
});

test('the terminal bridge only acts on Claude Code asks and stands aside for auto, bypass and dontAsk', () => {
  const s = read('./server.mjs');
  assert.match(s, /\['auto', 'bypassPermissions', 'dontAsk'\]\.includes\(sessionAgent\?\.mode\)/);
  assert.match(s, /if \(!clients\.size\) return json\(res, 200, \{ decision: 'terminal' \}\)/, 'with no tab open the terminal asks itself');
  const reg = read('./bridge/hooks/register.ts');
  assert.match(reg, /r\.decision !== 'ask'/);
  assert.match(reg, /crossSessionInbound/);
  assert.match(reg, /if \(inboundBlocked\) return/);
});
