import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeSignin, parseClaudeStatus, LOGIN, terminalPlan } from './cli-auth.mjs';

const launch = { cmd: '/bin/x', pre: [] };
const runs = res => async o => { runs.last = o; if (res instanceof Error) throw res; return res; };
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cliauth-'));

test('codex: login status exit 0 is signed in, 1 is not', async () => {
  assert.equal((await probeSignin('codex', { run: runs({ code: 0, stdoutTail: 'Logged in' }), env: {}, home: tmpHome(), launch })).state, 'yes');
  assert.deepEqual(runs.last.args, ['login', 'status']);
  assert.equal(runs.last.timeoutMs, 5000);
  assert.equal((await probeSignin('codex', { run: runs({ code: 1 }), env: {}, home: tmpHome(), launch })).state, 'no');
});

test('gemini: an API key env or a settings auth type is signed in', async () => {
  const h = tmpHome();
  assert.equal((await probeSignin('gemini', { env: { GEMINI_API_KEY: 'x' }, home: h })).state, 'yes');
  assert.equal((await probeSignin('gemini', { env: { GOOGLE_GENAI_USE_GCA: 'true' }, home: h })).state, 'yes');
  assert.equal((await probeSignin('gemini', { env: {}, home: h })).state, 'no');
  fs.mkdirSync(path.join(h, '.gemini'));
  fs.writeFileSync(path.join(h, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  assert.equal((await probeSignin('gemini', { env: {}, home: h })).state, 'yes');
  fs.writeFileSync(path.join(h, '.gemini', 'settings.json'), JSON.stringify({ selectedAuthType: 'gemini-api-key' }));
  assert.equal((await probeSignin('gemini', { env: {}, home: h })).state, 'yes');
  fs.writeFileSync(path.join(h, '.gemini', 'settings.json'), '{not json');
  assert.equal((await probeSignin('gemini', { env: {}, home: h })).state, 'no');
});

test('opencode: a listed provider is signed in; empty is not; a failed run is unknown', async () => {
  assert.equal((await probeSignin('opencode', { run: runs({ code: 0, stdoutTail: '┌  Credentials\n│\n●  Anthropic oauth\n│\n└  1 credentials' }), env: {}, home: tmpHome(), launch })).state, 'yes');
  assert.deepEqual(runs.last.args, ['auth', 'list']);
  assert.equal((await probeSignin('opencode', { run: runs({ code: 0, stdoutTail: '┌  Credentials\n└  0 credentials' }), env: {}, home: tmpHome(), launch })).state, 'no');
  const u = await probeSignin('opencode', { run: runs(new Error('boom')), env: {}, home: tmpHome(), launch });
  assert.equal(u.state, 'unknown'); assert.equal(u.note, 'uses its own config');
});

test('not installed: no run', async () => {
  let ran = false;
  assert.equal((await probeSignin('codex', { run: async () => { ran = true; }, env: {}, home: tmpHome(), launch: null })).state, 'unknown');
  assert.equal(ran, false);
});

test('parseClaudeStatus reads the JSON and never keeps more than it shows', () => {
  const s = parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.com', loginExpiresAt: '2030-01-01T00:00:00Z', orgId: 'secret-org' }));
  assert.deepEqual(s, { loggedIn: true, method: 'subscription', email: 'someone@example.com', expires: '2030-01-01T00:00:00Z' });
  assert.equal(parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: 'console' })).method, 'console');
  assert.equal(parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: 'apiKey' })).method, 'console');
  assert.equal(parseClaudeStatus('nope').loggedIn, false);
  assert.equal(parseClaudeStatus(JSON.stringify({ loggedIn: false })).loggedIn, false);
});

test('LOGIN args are fixed', () => {
  assert.deepEqual(LOGIN, { codex: ['login'], gemini: [], opencode: ['auth', 'login'], claude: ['auth', 'login'], 'claude-console': ['auth', 'login', '--console'] });
});

test('terminalPlan: Windows starts a console window, no shell flag, args as given', () => {
  const p = terminalPlan('win32', { cmd: 'C:\\Tools\\node.exe', pre: ['C:\\npm\\codex.js'] }, ['login'], { comspec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.deepEqual(p, { cmd: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', 'start', '', 'C:\\Tools\\node.exe', 'C:\\npm\\codex.js', 'login'] });
});

test('terminalPlan: no launch or no terminal means a command to copy', () => {
  assert.deepEqual(terminalPlan('win32', null, ['login'], { copyAs: 'codex login' }), { copy: 'codex login' });
  assert.deepEqual(terminalPlan('linux', { cmd: '/usr/bin/codex', pre: [] }, ['login'], { exists: () => false }), { copy: '/usr/bin/codex login' });
  const l = terminalPlan('linux', { cmd: '/usr/bin/codex', pre: [] }, ['login'], { exists: f => f === '/usr/bin/konsole' });
  assert.deepEqual(l, { cmd: '/usr/bin/konsole', args: ['-e', '/usr/bin/codex', 'login'] });
});

test('terminalPlan: macOS writes a .command file with quoted words', () => {
  const p = terminalPlan('darwin', { cmd: "/opt/it's/claude", pre: [] }, ['auth', 'login'], { tmpdir: '/tmp' });
  assert.equal(p.cmd, '/usr/bin/open'); assert.deepEqual(p.args.slice(0, 2), ['-a', 'Terminal']);
  assert.match(p.file, /^\/tmp\/tiroagents-login-[0-9a-f]+\.command$/);
  assert.equal(p.text, "#!/bin/sh\n'/opt/it'\\''s/claude' 'auth' 'login'\n");
});
