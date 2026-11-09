import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDERS, buildCommand, splitArgs, resolveLaunch, parseOutput, which, shellPath, detect } from './external-agents.mjs';

const L = { cmd: 'x', pre: [] };

test('codex argv, auto off', () => {
  assert.deepEqual(buildCommand('codex', { prompt: 'hi', auto: false }, { cmd: 'codex', pre: [] }), { cmd: 'codex', args: ['exec', '--json', '--skip-git-repo-check', '-'], stdin: 'hi' });
});

test('codex auto on adds exactly -a never -s workspace-write (global flags, before exec)', () => {
  const { args } = buildCommand('codex', { prompt: 'hi', auto: true }, L);
  assert.deepEqual(args, ['-a', 'never', '-s', 'workspace-write', 'exec', '--json', '--skip-git-repo-check', '-']);
});

test('gemini auto on adds --approval-mode=yolo; opencode auto adds nothing', () => {
  const off = buildCommand('gemini', { prompt: 'p' }, L), on = buildCommand('gemini', { prompt: 'p', auto: true }, L);
  assert.deepEqual(off, { cmd: 'x', args: ['--output-format', 'json'], stdin: 'p' });
  assert.deepEqual(on.args, ['--output-format', 'json', '--approval-mode=yolo']);
  assert.deepEqual(buildCommand('opencode', { prompt: 'p', auto: true }, L), buildCommand('opencode', { prompt: 'p', auto: false }, L));
  assert.deepEqual(buildCommand('opencode', { prompt: 'a & b' }, L), { cmd: 'x', args: ['run', 'a & b'], stdin: '' });
});

test('model flag and order: pre, base, model, auto, extra', () => {
  assert.deepEqual(buildCommand('gemini', { prompt: 'p', model: 'gpt-5', auto: true, extraArgs: '--debug "x y"' }, { cmd: 'node', pre: ['/e.js'] }).args,
    ['/e.js', '--output-format', 'json', '--model', 'gpt-5', '--approval-mode=yolo', '--debug', 'x y']);
  assert.deepEqual(buildCommand('opencode', { prompt: 'p', model: 'ollama/qwen3:8b' }, L).args, ['run', '--model', 'ollama/qwen3:8b', 'p']);
  assert.throws(() => buildCommand('codex', { prompt: 'p', model: 'a b' }, L), /Invalid model name/);
  assert.throws(() => buildCommand('codex', { prompt: 'p', model: '-x' }, L), /Invalid model name/);
});

test('custom {prompt} is one argv element; without it the prompt goes on stdin', () => {
  const r = buildCommand('custom', { prompt: 'a & b "c"', command: 'mytool --ask "{prompt}"' }, { cmd: 'mytool', pre: [] });
  assert.deepEqual(r.args.slice(-2), ['--ask', 'a & b "c"']);
  assert.equal(r.stdin, '');
  assert.deepEqual(buildCommand('custom', { prompt: 'q', command: 'mytool -x' }, { cmd: '/bin/mytool', pre: [] }), { cmd: '/bin/mytool', args: ['-x'], stdin: 'q' });
  assert.throws(() => buildCommand('custom', { prompt: 'q', command: '' }, L), /no confirmed command/);
});

test('splitArgs', () => {
  assert.deepEqual(splitArgs('a "b c" \'d e\''), ['a', 'b c', 'd e']);
  assert.deepEqual(splitArgs('x "say \\"hi\\"" C:\\dir\\f'), ['x', 'say "hi"', 'C:\\dir\\f']);
  assert.deepEqual(splitArgs('  '), []);
  assert.throws(() => splitArgs('"open'), /quote/);
});

test('npm shim resolution', { skip: process.platform !== 'win32' && 'Windows paths on a real Windows file system' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-shim-')), shim = path.join(dir, 'codex.cmd');
  const text = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
  fs.writeFileSync(shim, text);
  fs.writeFileSync(path.join(dir, 'node.exe'), '');
  const r = resolveLaunch(shim, 'win32');
  assert.deepEqual(r, { cmd: path.join(dir, 'node.exe'), pre: [path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')] });
  fs.writeFileSync(path.join(dir, 'odd.cmd'), '@echo off\r\nstart something %*\r\n');
  assert.equal(resolveLaunch(path.join(dir, 'odd.cmd'), 'win32'), null, 'unrecognised launcher');
  assert.deepEqual(resolveLaunch('/usr/bin/codex', 'linux'), { cmd: '/usr/bin/codex', pre: [] });
  assert.deepEqual(resolveLaunch('C:\\x\\codex.exe', 'win32'), { cmd: 'C:\\x\\codex.exe', pre: [] });
});

test('parse codex jsonl', () => {
  const tail = ['{"type":"thread.started","thread_id":"t"}', '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}', 'partial garbage', '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'].join('\n');
  assert.deepEqual(parseOutput('codex-jsonl', tail), { text: 'done' });
  assert.deepEqual(parseOutput('codex-jsonl', '{"type":"turn.failed","error":{"message":"not logged in"}}\n'), { error: 'not logged in' });
  assert.deepEqual(parseOutput('codex-jsonl', ''), { text: '' });
});

test('parse gemini json and text', () => {
  assert.deepEqual(parseOutput('gemini-json', '{"error":{"message":"not signed in"}}'), { error: 'not signed in' });
  assert.deepEqual(parseOutput('gemini-json', 'Loaded cached credentials.\n{"response":"ok","stats":{}}\n'), { text: 'ok' });
  assert.deepEqual(parseOutput('text', '  hello\n'), { text: 'hello' });
});

test('which on win32 honours PATHEXT', { skip: process.platform !== 'win32' && 'Windows paths on a real Windows file system' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-which-'));
  fs.writeFileSync(path.join(dir, 'codex.cmd'), '');
  fs.writeFileSync(path.join(dir, 'codex.ps1'), '');
  fs.writeFileSync(path.join(dir, 'gemini.ps1'), '');
  assert.equal(which('codex', 'Z:\\nope;' + dir, 'win32'), path.join(dir, 'codex.cmd'));
  assert.equal(which('gemini', dir, 'win32'), null, '.ps1 is ignored');
  assert.equal(which('../codex', dir, 'win32'), null, 'only plain names');
});

test('shellPath on win32 adds the usual install folders', () => {
  const p = shellPath({ PATH: 'C:\\a', APPDATA: 'C:\\U\\AppData\\Roaming', LOCALAPPDATA: 'C:\\U\\AppData\\Local', USERPROFILE: 'C:\\U' }, 'win32').split(';');
  assert.equal(p[0], 'C:\\a');
  for (const d of ['C:\\U\\AppData\\Roaming\\npm', 'C:\\U\\AppData\\Local\\Programs', 'C:\\U\\.bun\\bin', 'C:\\U\\.local\\bin', 'C:\\U\\scoop\\shims']) assert.ok(p.includes(d), d);
});

test('detect lists installed CLIs with their version, never failing on a missing one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-det-'));
  const plat = process.platform, name = plat === 'win32' ? 'codex.exe' : 'codex';
  fs.writeFileSync(path.join(dir, name), ''); fs.chmodSync(path.join(dir, name), 0o755);
  const calls = [];
  const list = await detect({ pathStr: dir, platform: plat, run: async o => { calls.push(o); return { ok: true, stdoutTail: 'codex-cli 9.9.9\n' }; } });
  assert.deepEqual(list.map(d => d.cli), Object.keys(PROVIDERS));
  const c = list.find(d => d.cli === 'codex');
  assert.deepEqual([c.installed, c.version, c.path], [true, 'codex-cli 9.9.9', path.join(dir, name)]);
  assert.deepEqual(calls[0].args, ['--version']); assert.equal(calls[0].timeoutMs, 5000);
  assert.equal(list.find(d => d.cli === 'gemini').installed, false);
  assert.match(list.find(d => d.cli === 'gemini').install, /^npm install -g @google\/gemini-cli$/);
});
