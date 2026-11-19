// Claude Code detection (native, npm, nothing), how the SDK is pointed at it, and the sign-in steps in the Claude panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findClaude, claudeSdkOptions } from './office.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-claudefind-'));
const touch = (f, text = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, { mode: 0o755 }); return f; };
const src = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const win = process.platform === 'win32';

test('native install in ~/.local/bin: runs the binary, the SDK uses it too', () => {
  const home = tmp(), exe = touch(path.join(home, '.local', 'bin', win ? 'claude.exe' : 'claude'));
  const c = findClaude(home, { PATH: '' }, process.platform, '');
  assert.deepEqual(c, { cmd: exe, pre: [], sdk: exe });
  assert.deepEqual(claudeSdkOptions(c), { pathToClaudeCodeExecutable: exe });
});

test('npm install (claude.cmd shim): runs node + cli.js; the SDK gets cli.js and that node', { skip: !win }, () => {
  const home = tmp(), npm = path.join(tmp(), 'npm');
  touch(path.join(npm, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
  const node = touch(path.join(npm, 'node.exe')), cli = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const c = findClaude(home, { PATH: npm }, 'win32', npm);
  assert.deepEqual(c, { cmd: node, pre: [cli], sdk: cli });
  assert.deepEqual(claudeSdkOptions(c), { pathToClaudeCodeExecutable: cli, executable: node });
});

test('npm install of Claude Code 2.1.3xx (claude.cmd shim in front of bin\\claude.exe): runs the exe directly', { skip: !win }, () => {
  const home = tmp(), npm = path.join(tmp(), 'npm');
  touch(path.join(npm, 'claude.cmd'), '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  const exe = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  assert.deepEqual(findClaude(home, { PATH: npm }, 'win32', npm), { cmd: exe, pre: [], sdk: exe });
});

test('only .js/.mjs count as scripts (the SDK runs other files as binaries); the shell PATH is looked up only after the native checks miss', () => {
  const s = src('./office.mjs');
  assert.doesNotMatch(s, /\[cm\]\?js/);
  assert.match(s, /\/\\\.m\?js\$\//);
  assert.match(s, /pathStr \?\?= shellPath\(env, platform\)/);
});

test('npm install on macOS/Linux (bin symlink to cli.js): node + cli.js, not the shebang', { skip: win }, () => {
  const home = tmp(), d = tmp(), cli = touch(path.join(d, 'lib', 'cli.js'), '#!/usr/bin/env node\n'), node = touch(path.join(d, 'nodebin', 'node'));
  fs.mkdirSync(path.join(d, 'bin')); fs.symlinkSync(cli, path.join(d, 'bin', 'claude'));
  const c = findClaude(home, { PATH: '' }, process.platform, path.join(d, 'bin') + ':' + path.join(d, 'nodebin'));
  assert.deepEqual(c, { cmd: node, pre: [fs.realpathSync(cli)], sdk: fs.realpathSync(cli) });
});

test('nothing installed: null, and no SDK path', () => {
  const home = tmp(), empty = tmp();
  assert.equal(findClaude(home, { PATH: empty }, process.platform, empty), null);
  assert.deepEqual(claudeSdkOptions(null), {});
});

test('the server re-detects Claude Code when the panel asks with refresh, and every caller uses the launch form', () => {
  const s = src('./server.mjs');
  assert.match(s, /let CLAUDE = findClaude\(\)/);
  assert.match(s, /if \(fresh\) CLAUDE = findClaude\(\) \|\| \(CLAUDE && fs\.existsSync\(CLAUDE\.cmd\) \? CLAUDE : null\)/, 'mid-update: keep the old path while it still exists');
  assert.match(s, /cmd: CLAUDE\.cmd, args: \[\.\.\.CLAUDE\.pre, 'auth', 'status'\]/);
  assert.match(s, /claudeSdkOptions\(CLAUDE\)/);
  assert.doesNotMatch(s, /pathToClaudeCodeExecutable: CLAUDE\b/);
  const m = src('./desktop/main.mjs');
  assert.match(m, /cli === 'claude-console'\) return findClaude\(\)/);
  assert.match(m, /cmd: c\.cmd, args: \[\.\.\.c\.pre, 'auth', 'logout'\]/);
  assert.match(m, /windowsVerbatimArguments: !!plan\.verbatim/);
});

test('Claude panel: install steps per OS with Copy, Refresh, sign-in steps, and polling after Sign in', () => {
  const s = src('./public/hud.js');
  const sv = src('./server.mjs'); // the install lines come from /api/claude (the CSP test keeps external hosts out of the page source)
  for (const t of ["windows: 'irm https://claude.ai/install.ps1 | iex'", "unix: 'curl -fsSL https://claude.ai/install.sh | bash'", 'installers: CLAUDE_INSTALLERS']) assert.ok(sv.includes(t), t);
  for (const t of ['Install Claude Code', 'c.installers.windows', 'c.installers.unix', 'npm install -g @anthropic-ai/claude-code',
    'Then click Refresh', "btn('Refresh'", 'A terminal window opens and your browser shows the Claude sign-in page.', 'Finish signing in in the browser.',
    'claude auth login', 'clipboard.writeText', 'data-claude-steps', 'Update Claude Code']) assert.ok(s.includes(t), t);
  assert.match(s, /\/api\/claude\?refresh=1/);
  assert.match(s, /3000/); // polls every 3 s after Sign in, for up to about 2 min
  assert.match(s, /else if \(!busy\) refresh\(\)/, 'a tick is skipped while a refresh (up to 5 s of auth status) is in flight');
});
