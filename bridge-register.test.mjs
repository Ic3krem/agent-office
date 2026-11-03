import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The plugin (bridge/hooks/register.ts) is imported as it is (Node strips its type annotations) and driven with a small fake of the
// Claude Code host, against the real server on a spare port. register.test.ts covers the same behaviour inside Claude Code's own
// test harness, which cannot run here.
const { register } = await import('./bridge/hooks/register.ts');

function startServer(env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-breg-')), port = 47100 + Math.floor(Math.random() * 400);
  const uiKey = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, USERPROFILE: tmp, HOME: tmp, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: uiKey, CLAUDE_CODE_PATH: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { if (/running on/.test(out)) return resolve({ child, port, tmp, uiKey }); if (Date.now() - t0 > 20000) { child.kill(); return reject(new Error('server did not start: ' + out.slice(0, 300))); } setTimeout(tick, 150); };
    tick();
  });
}
const raw = (port, p, { method = 'POST', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, res => {
    let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on('error', reject); req.end(body === undefined ? (method === 'POST' ? '{}' : undefined) : JSON.stringify(body));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A minimal Claude Code host. fetches go to whatever server the bridge.json it serves points at, and every request is recorded.
function makeTerminal({ home, bridgeJson, sessionId, cwd = home, files = {} }) {
  const handlers = {}, seen = [], submitted = [], aborted = [];
  let tick = null;
  const on = (ev, fn) => { handlers[ev] = fn; return { catch() {} }; };
  register(on);
  const $ = {
    env: { get: async n => (n === 'USERPROFILE' ? home : undefined) },
    fs: { read: async f => {
      const key = f.split('\\').join('/');
      if (key.endsWith('/.claude/agent-office/bridge.json')) return JSON.stringify(bridgeJson);
      if (key in files) return files[key];
      throw new Error('ENOENT ' + key);
    } },
    session: { id: async () => sessionId },
    http: { fetch: async (url, init = {}) => {
      seen.push({ path: url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), headers: init.headers || {}, method: init.method });
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
      return { status: r.status, ok: r.ok, headers: {}, text: await r.text() };
    } },
    clock: { every: (_ms, fn) => { tick = fn; } },
    prompt: { submit: async e => { submitted.push(e.text); return e; } },
    turn: { abort: async e => { aborted.push(e.turnId); } },
    ui: { status: () => {} },
  };
  return {
    seen, submitted, aborted,
    start: () => handlers['session.start']($, { cwd }, async e => e),
    tick: async () => { await tick(); },
    check: (tool, decision = 'ask') => handlers['tool.check']($, { tool, input: { command: 'x' }, tool_use_id: 'tu' + Math.random() }, async () => ({ decision })),
    reqs: p => seen.filter(s => s.path.startsWith(p)),
  };
}

const uiSend = async (s, id, text) => {
  const page = await raw(s.port, '/', { method: 'GET', headers: { cookie: 'ao_ui=' + s.uiKey } });
  const nonce = page.headers['set-cookie'].join(';').match(/ao_nonce=([0-9a-f]+)/)[1];
  return raw(s.port, '/api/send', { headers: { cookie: 'ao_ui=' + s.uiKey, 'x-nonce': nonce }, body: { id, text } });
};
const setup = async (t, env) => {
  const s = await startServer(env);
  t.after(() => { try { s.child.kill(); } catch {} });
  s.bridgeJson = JSON.parse(fs.readFileSync(path.join(s.tmp, '.claude', 'agent-office', 'bridge.json'), 'utf8'));
  return s;
};

test('register -> token -> poll with the token; a poll without it is refused; asks carry the token', { timeout: 60000 }, async t => {
  const s = await setup(t);
  const term = makeTerminal({ home: s.tmp, bridgeJson: s.bridgeJson, sessionId: 'term-A' });
  await term.start();
  const reg = term.reqs('/bridge/register');
  assert.equal(reg.length, 1); assert.ok(!('x-session-token' in reg[0].headers), 'registering sends no token');

  await term.tick();
  const polls = term.reqs('/bridge/poll');
  assert.equal(polls.length, 1);
  assert.match(polls[0].headers['x-session-token'], /^[0-9a-f]{32}$/, 'the poll carries the registered token');
  assert.equal(polls[0].headers['x-key'], s.bridgeJson.key);

  assert.equal((await raw(s.port, '/bridge/poll?session=term-A', { method: 'GET', headers: { 'x-key': s.bridgeJson.key } })).status, 403, 'poll without a token is refused');

  assert.equal((await uiSend(s, 'term-A', 'hello from the office')).status, 200);
  await term.tick();
  assert.deepEqual(term.submitted, ['hello from the office']);

  const r = await term.check('Bash', 'allow');       // an allowed call never asks
  assert.equal(r.decision, 'allow'); assert.equal(term.reqs('/bridge/ask').length, 0);
  const asked = await Promise.race([term.check('Bash', 'ask'), sleep(1500).then(() => 'pending')]);
  assert.equal(term.reqs('/bridge/ask').length, 1);
  assert.match(term.reqs('/bridge/ask')[0].headers['x-session-token'], /^[0-9a-f]{32}$/, 'the ask carries the token');
  assert.ok(asked === 'pending' || asked.decision, 'the ask is put to the dashboard (waiting, or handed back when nobody watches)');
});

test('a second terminal cannot take over a live session id (409, backoff, no crash); after the idle window it can, and the old token stops working', { timeout: 60000 }, async t => {
  const s = await setup(t, { AGENT_OFFICE_BRIDGE_IDLE_MS: '1500' });
  const A = makeTerminal({ home: s.tmp, bridgeJson: s.bridgeJson, sessionId: 'shared-id' });
  await A.start(); await A.tick();
  const tokenA = A.reqs('/bridge/poll')[0].headers['x-session-token'];

  const B = makeTerminal({ home: s.tmp, bridgeJson: s.bridgeJson, sessionId: 'shared-id' });
  await assert.doesNotReject(B.start());
  assert.equal(B.reqs('/bridge/register').length, 1);
  await B.tick();                                                       // registration refused (409): back off, no poll
  assert.equal(B.reqs('/bridge/poll').length, 0, 'the refused terminal never polls the live session');
  await B.tick();
  assert.equal(B.reqs('/bridge/register').length, 1, 'and it backs off instead of hammering the server');
  assert.equal((await raw(s.port, '/bridge/register', { headers: { 'x-key': s.bridgeJson.key }, body: { session: 'shared-id' } })).status, 409);

  await sleep(1800);                                                    // A went quiet: the id can be registered afresh
  let got = false;
  for (let i = 0; i < 40 && !got; i++) { await B.tick(); got = B.reqs('/bridge/poll').length > 0; }
  assert.ok(got, 'after the idle window the new terminal registers and polls');
  assert.notEqual(B.reqs('/bridge/poll')[0].headers['x-session-token'], tokenA);
  assert.equal((await raw(s.port, '/bridge/poll?session=shared-id', { method: 'GET', headers: { 'x-key': s.bridgeJson.key, 'x-session-token': tokenA } })).status, 403, 'the old terminal\'s token no longer works');
  await assert.doesNotReject(A.tick());                                 // A is told 403 and drops its token without crashing
});

test('an older server without /bridge/register (404) is polled unbound, exactly as before', { timeout: 30000 }, async t => {
  const seen = [];
  const old = http.createServer((req, res) => {
    seen.push({ url: req.url, token: req.headers['x-session-token'] });
    if (req.url.startsWith('/bridge/register')) { res.writeHead(404); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"messages":["legacy hello"],"abort":false}');
  });
  await new Promise(r => old.listen(0, '127.0.0.1', r)); t.after(() => old.close());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-old-'));
  const term = makeTerminal({ home, bridgeJson: { port: old.address().port, key: 'k'.repeat(48) }, sessionId: 'legacy' });
  await term.start(); await term.tick();
  assert.deepEqual(term.submitted, ['legacy hello']);
  assert.ok(seen.filter(x => x.url.startsWith('/bridge/poll')).every(x => x.token === undefined), 'no token header toward an older server');
  assert.equal(seen.filter(x => x.url.startsWith('/bridge/register')).length, 1, 'registration is tried once, not on every tick');
});

test('crossSessionInbound refuse or hold in the user, project or local settings blocks delivery; accept or unset does not', { timeout: 60000 }, async t => {
  const s = await setup(t);
  const home = s.tmp, proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-proj-'));
  const norm = p => p.split('\\').join('/');
  const cases = [
    ['user refuse', { [norm(path.join(home, '.claude/settings.json'))]: '{"crossSessionInbound":"refuse"}' }, false],
    ['project hold', { [norm(path.join(proj, '.claude/settings.json'))]: '{"crossSessionInbound":"hold"}' }, false],
    ['local refuse', { [norm(path.join(proj, '.claude/settings.local.json'))]: '{"crossSessionInbound":"refuse"}' }, false],
    ['accept', { [norm(path.join(proj, '.claude/settings.json'))]: '{"crossSessionInbound":"accept"}' }, true],
    ['unset', {}, true],
    ['broken file', { [norm(path.join(proj, '.claude/settings.json'))]: '{nope' }, true],
  ];
  let n = 0;
  for (const [name, files, delivered] of cases) {
    const id = 'inb-' + (++n);
    const term = makeTerminal({ home, bridgeJson: s.bridgeJson, sessionId: id, cwd: norm(proj), files });
    await term.start(); await term.tick();
    assert.equal((await uiSend(s, id, 'msg ' + name)).status, 200, name);
    await term.tick();
    assert.deepEqual(term.submitted, delivered ? ['msg ' + name] : [], name);
    if (!delivered) {   // blocked terminals only show they are alive: the queued message is not taken from the server
      const tok = term.reqs('/bridge/poll')[0].headers['x-session-token'];
      const left = JSON.parse((await raw(s.port, '/bridge/poll?session=' + id, { method: 'GET', headers: { 'x-key': s.bridgeJson.key, 'x-session-token': tok } })).body);
      assert.deepEqual(left.messages, ['msg ' + name], name + ': message still queued');
    }
  }
});
