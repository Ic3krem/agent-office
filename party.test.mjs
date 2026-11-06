import test from 'node:test';
import assert from 'node:assert/strict';
import { feedOf, cleanOffice, cleanAvatar, cleanName, cleanChat, bubbleOf, LIMITS } from './party/protocol.mjs';
import { createParty, startParty, limiter } from './party/server.mjs';

const SECRET = 'rm -rf C:\\Users\\me\\secret-plan.txt sk-ant-api03-XYZ';
const snap = { agents: [
  { id: '1111-session-id', isManager: true, name: 'Tiro', status: 'working', task: SECRET, cwd: 'C:\\work\\secret', logs: [{ k: 'tool', text: 'Bash: ' + SECRET }], perm: { cmd: SECRET } },
  { id: '2222-session-id', name: 'Forge', profile: { key: 'forge' }, status: 'working', task: SECRET, logs: [{ k: 'tool', text: 'Edit: C:\\secret.js' }] },
  { id: '3333', name: '<img src=x onerror=alert(1)>Bob', status: 'limited', task: SECRET },
] };

test('the feed carries names, roles, states and generic bubbles, never task text, paths or commands', () => {
  const f = feedOf(snap, { version: 1, objects: [] }, { ceo: { outfit: 2, evil: 'x' } }, id => 'h' + id.length);
  const wire = JSON.stringify(f);
  for (const bad of ['secret', 'rm -rf', 'sk-ant', 'session-id', 'C:', 'onerror', '<img']) assert.ok(!wire.includes(bad), 'leaked: ' + bad);
  assert.deepEqual(f.agents.map(a => [a.key, a.state, a.bubble]), [['tiro', 'working', 'Running a command'], ['forge', 'working', 'Coding…'], [null, 'limited', 'On break']]);
  assert.deepEqual(Object.keys(f.agents[0]).sort(), ['bubble', 'id', 'key', 'name', 'state']);
  assert.deepEqual(f.looks, { ceo: { outfit: 2 } });
});

test('cleaners drop unknown fields and clamp everything', () => {
  const o = cleanOffice({ layout: { a: 1 }, agents: [{ id: 'ab', name: 'X', state: 'hacking', bubble: 'I am reading /etc/passwd', task: 'x', extra: 1 }], prompt: 'x' });
  assert.deepEqual(o, { layout: { a: 1 }, looks: {}, agents: [{ id: 'ab', name: 'X', key: null, state: 'idle', bubble: 'Idle' }] });
  assert.equal(cleanOffice({ layout: { big: 'x'.repeat(LIMITS.layoutBytes) } }).layout, null);
  assert.equal(cleanOffice({ agents: Array.from({ length: 50 }, (_, i) => ({ id: 'a' + i, name: 'n' })) }).agents.length, LIMITS.agents);
  assert.deepEqual(cleanAvatar({ x: 1e9, y: -5, room: 'office:../../etc', presence: 'root' }), { x: 4000, y: 0, room: 'home', presence: 'available' });
  assert.equal(cleanName('  <b>Bo\u0000b</b>  \u2028'), 'Bo b');
  assert.equal(cleanChat('x'.repeat(500)).length, LIMITS.chat);
  assert.equal(bubbleOf({ status: 'blocked' }), 'Waiting for approval');
});

test('party: invite code, unique names, size cap, relayed data is clean, kick bans', () => {
  const party = createParty({ code: 'ABC123' });
  assert.equal(party.join({ code: 'nope', name: 'A' }, '1.1.1.1').status, 403);
  const a = party.join({ code: ' abc123 ', name: 'Ana' }, '1.1.1.1'), b = party.join({ code: 'ABC123', name: 'ana' }, '2.2.2.2');
  assert.equal(a.status, 200); assert.equal(b.body.name, 'ana 2');
  const A = party.member(a.body.token), B = party.member(b.body.token), got = [];
  party.attach(B, ev => got.push(ev));
  assert.equal(got[0].t, 'hello'); assert.equal(got[0].members.length, 1);
  assert.equal(JSON.stringify(got[0]).includes(a.body.token), false, 'tokens are never relayed');
  party.office(A, { agents: [{ id: 'x1', name: 'Forge', task: SECRET, bubble: SECRET }] });
  const m = got.find(e => e.t === 'member').m;
  assert.deepEqual(m.office.agents[0], { id: 'x1', name: 'Forge', key: null, state: 'idle', bubble: 'Idle' });
  party.say(A, 'Kumain ka na?'); assert.equal(got.at(-1).line.text, 'Kumain ka na?');
  for (let i = 0; i < 20; i++) party.join({ code: 'ABC123', name: 'g' + i }, '9.9.9.' + i);
  assert.equal(party.size(), LIMITS.members); assert.equal(party.join({ code: 'ABC123', name: 'late' }, '8.8.8.8').status, 409);
  assert.equal(party.kick(A.id), true); assert.equal(party.member(a.body.token), null);
  assert.equal(party.join({ code: 'ABC123', name: 'Ana again' }, '1.1.1.1').status, 403, 'kicked address is banned');
});

test('limiter: burst then refill', () => {
  let t = 0; const ok = limiter(1, 3, () => t);
  assert.deepEqual([ok('k'), ok('k'), ok('k'), ok('k')], [true, true, true, false]);
  t = 1000; assert.equal(ok('k'), true);
});

test('http: auth, content type, size, rate limits, spoofed proxy header, host-only kick, SSE stream', async () => {
  const { server, port } = await startParty({ port: 0, host: '127.0.0.1', code: 'PARTY1', adminKey: 'k'.repeat(32) });
  const U = p => 'http://127.0.0.1:' + port + p;
  const post = (p, body, h = {}) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    assert.equal((await fetch(U('/health'))).status, 200);
    assert.equal((await post('/office', { office: {} })).status, 401);
    assert.equal((await fetch(U('/join'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"code":"PARTY1"}' })).status, 415);
    const j = await (await post('/join', { code: 'PARTY1', name: 'Host' })).json();
    const auth = { authorization: 'Bearer ' + j.token };
    assert.equal((await post('/office', '{"office":' + JSON.stringify({ layout: { x: 'y'.repeat(LIMITS.body) } }) + '}', auth)).status, 413);
    assert.equal((await post('/chat', '{bad', auth)).status, 400);
    // SSE: a second member's join reaches the first member's stream
    const ac = new AbortController(), es = await fetch(U('/events'), { headers: auth, signal: ac.signal }), rd = es.body.getReader(), dec = new TextDecoder();
    let buf = ''; const next = async want => { while (!buf.includes(want)) buf += dec.decode((await rd.read()).value); };
    await next('"hello"');
    const g = await (await post('/join', { code: 'PARTY1', name: 'Guest' }, { 'cf-connecting-ip': '6.6.6.6' })).json();
    await next('"Guest"');
    // without a trusted proxy the header is ignored: kicking Guest bans 127.0.0.1, not the claimed address
    assert.equal((await post('/admin/kick', { id: g.id })).status, 403, 'needs the host key');
    assert.equal((await post('/admin/kick', { id: g.id }, { 'x-admin-key': 'k'.repeat(32) })).status, 200);
    assert.equal((await post('/join', { code: 'PARTY1', name: 'Again' }, { 'cf-connecting-ip': '7.7.7.7' })).status, 403, 'spoofed header does not dodge the ban');
    ac.abort();
    let last = 0; for (let i = 0; i < 8; i++) last = (await post('/join', { code: 'WRONG', name: 'x' })).status;
    assert.equal(last, 429, 'join attempts are rate limited');
  } finally { server.close(); server.closeAllConnections(); }
});
