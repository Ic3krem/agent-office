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
  assert.deepEqual(o, { stats: { done: 0, reports: 0 }, layout: { a: 1 }, looks: {}, agents: [{ id: 'ab', name: 'X', key: null, state: 'idle', bubble: 'Idle' }] });
  assert.equal(cleanOffice({ layout: { big: 'x'.repeat(LIMITS.layoutBytes) } }).layout, null);
  assert.equal(cleanOffice({ agents: Array.from({ length: 50 }, (_, i) => ({ id: 'a' + i, name: 'n' })) }).agents.length, LIMITS.agents);
  assert.deepEqual(cleanAvatar({ x: 1e9, y: -5, room: 'office:../../etc', presence: 'root' }), { x: 4000, y: 0, room: 'home', presence: 'available' });
  assert.equal(cleanName('  <b>Bo\u0000b</b>  \u2028'), 'Bo b');
  assert.equal(cleanName('Room 2089 \u202eevil'), 'Room 2089 evil', 'digits survive; bidi overrides do not');
  assert.equal(cleanChat('call 2028 0829'), 'call 2028 0829');
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

test('two app clients: join, see each other, share a clean office, chat, get kicked', async () => {
  const { createPartyClient, partyUrl } = await import('./party-client.mjs');
  assert.equal(partyUrl('javascript:alert(1)'), null); assert.equal(partyUrl('http://u:p@x.test'), null); assert.equal(partyUrl('https://a.trycloudflare.com/'), 'https://a.trycloudflare.com');
  const { server, port } = await startParty({ port: 0, host: '127.0.0.1', code: 'KAIN99', adminKey: 'a'.repeat(32) });
  const until = async (f, ms = 4000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
  const A = createPartyClient(), B = createPartyClient(), url = 'http://127.0.0.1:' + port;
  try {
    await assert.rejects(A.join(url, 'WRONG', 'Ana'), /wrong invite code/);
    await A.join(url, 'kain99', 'Ana'); await B.join(url, 'KAIN99', 'Ben');
    await until(() => A.view().live && B.view().live && A.view().members.length === 1 && B.view().members.length === 1);
    await A.publish(feedOf(snap, { version: 1, objects: [] }, {}, A.hashId), { x: 100, y: 200, room: 'lounge' });
    const ana = () => B.view().members.find(m => m.name === 'Ana');
    await until(() => ana() && ana().agents === 3 && ana().room === 'lounge');
    // town step 3: each member's agents, with exactly the protocol's per-agent fields (friends' agents travel by state)
    assert.deepEqual(ana().crew.map(a => Object.keys(a).sort().join()), Array(3).fill('bubble,id,key,name,state'));
    assert.deepEqual(ana().crew.map(a => a.state), ['working', 'working', 'limited']);
    assert.equal(JSON.stringify(ana().crew).includes('secret'), false);
    const office = await B.office(ana().id);
    assert.equal(JSON.stringify(office).includes('secret'), false);
    assert.equal(JSON.stringify(B.view()).includes(A.view().you.id) && !JSON.stringify(B.view()).includes('token'), true);
    await B.say('Tara, kain!');
    await until(() => A.view().chat.some(l => l.text === 'Tara, kain!' && l.name === 'Ben'));
    const r = await fetch(url + '/admin/kick', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'a'.repeat(32) }, body: JSON.stringify({ id: B.view().you.id }) });
    assert.equal(r.status, 200);
    await until(() => !B.view().connected && /removed you/.test(B.view().error));
    await until(() => A.view().members.length === 0);
  } finally { await A.leave(); await B.leave(); server.close(); server.closeAllConnections(); }
});

test('games: server-timed typing race and trivia with server-held answers', async () => {
  const { createGames, TRIVIA } = await import('./party/games.mjs');
  const ev = [], sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = createGames({ broadcast: e => ev.push(e), countdownMs: 30, raceMs: 3000, questionMs: 120, revealMs: 20, questions: 2, rand: () => 0.1 });
  const A = { id: 'aa', name: 'Ana' }, B = { id: 'bb', name: 'Ben' };
  try {
    assert.equal(G.startRace(A).ok, true);
    const r = ev.find(e => e.t === 'race');
    assert.equal(G.startQuiz(B, 'tech', [A, B]).ok, false, 'one game at a time');
    assert.match(G.finishRace(A, r.id, r.text).error, /wait for go/, 'no early finish');
    await sleep(60);
    assert.match(G.finishRace(B, r.id, r.text + 'x').error, /not quite/);
    assert.match(G.finishRace(A, r.id, r.text).error, /too fast/, 'no paste-speed finishes');
    await sleep(r.text.length * 30);
    const fin = G.finishRace(A, r.id, r.text); assert.equal(fin.ok, true); assert.ok(fin.wpm > 0);
    assert.match(G.finishRace(A, r.id, r.text).error, /already/);
    await sleep(3100);
    assert.deepEqual(ev.find(e => e.t === 'race-end').results.map(x => x.name), ['Ana']);
    assert.equal(G.startQuiz(A, 'nope', [A, B]).ok, false);
    assert.equal(G.startQuiz(A, 'tech', [A, B]).ok, true);
    await sleep(50);
    const q = ev.find(e => e.t === 'quiz-q'); assert.equal(q.n, 1); assert.equal('c' in q, false, 'the answer is not sent with the question');
    const right = TRIVIA.tech.find(x => x.q === q.q).c;
    assert.equal(G.answer(A, q.id, 1, right).ok, true); assert.equal(G.answer(A, q.id, 1, right).ok, false, 'one answer each');
    assert.equal(G.answer(B, q.id, 1, (right + 1) % 4).ok, true); assert.equal(G.answer(B, q.id, 1, 9).ok, false);
    await sleep(150);
    const rv = ev.find(e => e.t === 'quiz-reveal'); assert.equal(rv.correct, right);
    assert.ok(rv.scores[0].name === 'Ana' && rv.scores[0].points > 100 && rv.scores[1].points === 0, JSON.stringify(rv.scores));
    assert.equal(G.answer(B, q.id, 1, right).ok, false, 'closed question');
    await sleep(250);
    assert.ok(ev.some(e => e.t === 'quiz-end'));
  } finally { G.stop(); }
});

test('review fixes: malformed request, helper names, layout-free relays, global join limit', async () => {
  const net = await import('node:net');
  // non-roster sessions never share their title, first prompt or folder name
  const f = feedOf({ agents: [{ id: 'x', name: 'Fix the payroll export for Acme', status: 'idle' }, { id: 'y', name: 'C:\Users\me', status: 'idle', profile: { key: 'forge', helper: true } }] }, null, {}, id => 'h' + id);
  assert.deepEqual(f.agents.map(a => a.name), ['Helper 1', 'Helper 2']);
  const { server, port, party } = await startParty({ port: 0, host: '127.0.0.1', code: 'ABCDEF1234', adminKey: 'z'.repeat(32) });
  const U = p => 'http://127.0.0.1:' + port + p, post = (p, b, h = {}) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  try {
    await new Promise(ok => { const s = net.connect(port, '127.0.0.1', () => s.end('POST //[ HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}')); s.on('data', () => {}); s.on('close', ok); s.on('error', ok); });
    assert.equal((await fetch(U('/health'))).status, 200, 'still up after a malformed request');
    const a = await (await post('/join', { code: 'ABCDEF1234', name: 'A' })).json(), b = await (await post('/join', { code: 'ABCDEF1234', name: 'B' })).json();
    await post('/office', { office: { layout: { version: 1, big: 'x'.repeat(1000) }, agents: [] } }, { authorization: 'Bearer ' + a.token });
    const ac = new AbortController(), es = await fetch(U('/events'), { headers: { authorization: 'Bearer ' + b.token }, signal: ac.signal });
    const hello = new TextDecoder().decode((await es.body.getReader().read()).value);
    assert.ok(hello.includes('"hello"') && !hello.includes('xxxx'), 'hello carries offices without layouts');
    const full = await (await post('/office-of', { id: a.id }, { authorization: 'Bearer ' + b.token })).json();
    assert.equal(full.office.layout.big.length, 1000, 'a visitor fetches the layout on demand');
    ac.abort();
    let last = 0; for (let i = 0; i < 25; i++) last = (await post('/join', { code: 'WRONG' + i, name: 'x' }, { 'cf-connecting-ip': '1.2.3.' + i })).status;
    assert.equal(last, 429);
  } finally { server.close(); server.closeAllConnections(); }
});

test('poll: first poll gets the hello, then events; queue overflow resyncs with a fresh hello; one poll at a time', () => {
  const party = createParty({ code: 'POLL01' });
  const a = party.join({ code: 'POLL01', name: 'Ana' }, '1.1.1.1').body, b = party.join({ code: 'POLL01', name: 'Ben' }, '2.2.2.2').body;
  const A = party.member(a.token), B = party.member(b.token), got = [];
  const reply = s => got.push(JSON.parse(s));
  party.poll(B, reply);
  assert.equal(got[0].length, 1); assert.equal(got[0][0].t, 'hello'); assert.equal(got[0][0].members[0].name, 'Ana');
  party.poll(B, reply); party.say(A, 'hi');
  assert.deepEqual(got[1].map(e => e.t), ['chat']); assert.equal(got[1][0].line.text, 'hi');
  const cancel = party.poll(B, s => reply(s)); party.poll(B, reply);
  assert.deepEqual(got[2], [], 'a newer poll ends the older one with []');
  cancel(); party.say(A, 'x'); assert.equal(got[3][0].line.text, 'x', 'a stale cancel leaves the newer poll alone');
  for (let i = 0; i < 300; i++) party.say(A, 'spam ' + i); // nobody polling: the queue overflows
  party.poll(B, reply);
  assert.equal(got[4][0].t, 'hello', 'overflow resyncs'); assert.ok(got[4].length <= 200);
  assert.equal(got[4][0].chat.at(-1).text, 'spam ' + (300 - got[4].length), 'the snapshot holds the dropped events');
  assert.equal(got[4].at(-1).line.text, 'spam 299', 'later events follow it');
  // a polling member is not reaped while polling, but is once it stops
  let t = 0; const P = createParty({ code: 'POLL02', now: () => t });
  const c = P.join({ code: 'POLL02', name: 'C' }, '3.3.3.3').body, C = P.member(c.token);
  const stop = P.poll(C, () => {}); t = 60_000; stop(); P.poll(C, () => {}); t = 120_000; P.reap(); assert.equal(P.size(), 1);
  t = 300_000; P.reap(); assert.equal(P.size(), 0);
});

test('http poll: auth required, hello then events, long-poll timeout returns []', async () => {
  const { server, port } = await startParty({ port: 0, host: '127.0.0.1', code: 'POLL03', adminKey: 'p'.repeat(32), pollMs: 300 });
  const U = p => 'http://127.0.0.1:' + port + p, post = (p, b, h = {}) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  try {
    assert.equal((await fetch(U('/poll'))).status, 401);
    assert.equal((await fetch(U('/poll'), { headers: { authorization: 'Bearer ' + 'a'.repeat(48) } })).status, 401);
    const a = await (await post('/join', { code: 'POLL03', name: 'A' })).json(), b = await (await post('/join', { code: 'POLL03', name: 'B' })).json();
    const poll = () => fetch(U('/poll'), { headers: { authorization: 'Bearer ' + b.token } });
    const r = await poll(); assert.equal(r.status, 200); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await r.json())[0].t, 'hello');
    const t0 = Date.now(); assert.deepEqual(await (await poll()).json(), []); assert.ok(Date.now() - t0 >= 250, 'held until the timeout');
    const p = poll(); await new Promise(r => setTimeout(r, 50));
    await post('/chat', { text: 'kumusta' }, { authorization: 'Bearer ' + a.token });
    const evs = await (await p).json(); assert.equal(evs[0].t, 'chat'); assert.equal(evs[0].line.text, 'kumusta');
  } finally { server.close(); server.closeAllConnections(); }
});

test('client falls back to long polling when a proxy buffers the SSE stream (like a quick tunnel)', async () => {
  const http = await import('node:http');
  const { createPartyClient } = await import('./party-client.mjs');
  const { server, port } = await startParty({ port: 0, host: '127.0.0.1', code: 'TUNNEL', adminKey: 't'.repeat(32), pollMs: 1000 });
  // forwards each request, sends the headers at once but holds the body until the response ends
  const seen = [];
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, pr => {
      res.writeHead(pr.statusCode, pr.headers); res.flushHeaders();
      const chunks = []; pr.on('data', c => chunks.push(c)); pr.on('end', () => res.end(Buffer.concat(chunks)));
    });
    up.on('error', () => res.destroy()); res.on('close', () => up.destroy());
    req.pipe(up);
  });
  await new Promise(ok => proxy.listen(0, '127.0.0.1', ok));
  const until = async (f, ms = 6000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
  const A = createPartyClient({ firstByteMs: 300 }), B = createPartyClient();
  try {
    await A.join('http://127.0.0.1:' + proxy.address().port, 'TUNNEL', 'Ana');
    await B.join('http://127.0.0.1:' + port, 'TUNNEL', 'Ben');
    await until(() => A.view().live && A.view().members.length === 1 && B.view().live);
    assert.ok(seen.includes('/events') && seen.includes('/poll'), 'tried SSE, then polled');
    await B.say('Tara, kain!');
    await until(() => A.view().chat.some(l => l.text === 'Tara, kain!' && l.name === 'Ben'));
    await A.say('Sige!');
    await until(() => B.view().chat.some(l => l.text === 'Sige!'));
    await A.leave();
    const n = seen.length; await new Promise(r => setTimeout(r, 1500));
    assert.equal(seen.length, n, 'leave stops the poll loop');
    await until(() => B.view().members.length === 0);
  } finally { await A.leave(); await B.leave(); proxy.close(); proxy.closeAllConnections(); server.close(); server.closeAllConnections(); }
});

test('http poll: resync, leave and kick answer a held poll at once, abort frees the slot, 429 and 503', async () => {
  const { server, port, streams } = await startParty({ port: 0, host: '127.0.0.1', code: 'POLL04', adminKey: 'q'.repeat(32), pollMs: 3000 });
  const U = p => 'http://127.0.0.1:' + port + p, post = (p, b, h = {}) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  const join = async n => (await (await post('/join', { code: 'POLL04', name: n })).json()).token;
  const poll = (tok, q = '', o = {}) => fetch(U('/poll' + q), { headers: { authorization: 'Bearer ' + tok }, ...o });
  const until = async (f, ms = 3000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
  const fast = async p => { const t = Date.now(), r = await p; assert.ok(Date.now() - t < 1500, 'answered at once'); return r; };
  try {
    const a = await join('A'), b = await join('B'), cj = await (await post('/join', { code: 'POLL04', name: 'C' })).json(), c = cj.token, d = await join('D');
    // resync: the queue restarts from a hello that already holds what was queued
    assert.equal((await (await poll(b)).json())[0].t, 'hello');
    await post('/chat', { text: 'missed?' }, { authorization: 'Bearer ' + a });
    const rs = await (await poll(b, '?resync=1')).json();
    assert.equal(rs.length, 1); assert.equal(rs[0].t, 'hello'); assert.equal(rs[0].chat.at(-1).text, 'missed?');
    // leave while a poll is held
    const held = poll(b); await new Promise(r => setTimeout(r, 100));
    await post('/leave', {}, { authorization: 'Bearer ' + b });
    assert.deepEqual(await (await fast(held)).json(), []);
    assert.equal((await poll(b)).status, 401);
    // a client that aborts mid-poll gives its slot back
    await (await poll(d)).json();
    const ac = new AbortController(), gone = poll(d, '', { signal: ac.signal }).catch(() => {});
    await until(() => streams() === 1); ac.abort(); await gone;
    await until(() => streams() === 0);
    // 429: polls have their own burst
    const st = await Promise.all(Array.from({ length: 14 }, () => poll(a).then(r => r.status)));
    assert.ok(st.includes(429), st.join());
    await until(() => streams() === 0);
    // kick while a poll is held (last: it bans this address)
    await (await poll(c)).json();
    const kheld = poll(c); await new Promise(r => setTimeout(r, 100));
    assert.equal((await post('/admin/kick', { id: cj.id }, { 'x-admin-key': 'q'.repeat(32) })).status, 200);
    assert.deepEqual((await (await fast(kheld)).json()).map(e => e.t), ['kicked']);
    assert.equal((await poll(c)).status, 401);
  } finally { server.close(); server.closeAllConnections(); }
  // 503: the streams cap counts held polls
  const s2 = await startParty({ port: 0, host: '127.0.0.1', code: 'POLL05', adminKey: 'r'.repeat(32), pollMs: 3000, maxStreams: 1 });
  const U2 = p => 'http://127.0.0.1:' + s2.port + p, j2 = async n => (await (await fetch(U2('/join'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'POLL05', name: n }) })).json()).token;
  try {
    const e = await j2('E'), f = await j2('F'), p2 = t => fetch(U2('/poll'), { headers: { authorization: 'Bearer ' + t } });
    await (await p2(e)).json();
    const h = p2(e); await new Promise(r => setTimeout(r, 100));
    assert.equal((await p2(f)).status, 503);
    s2.party.say(s2.party.member(f), 'free'); await (await h).json();
  } finally { s2.server.close(); s2.server.closeAllConnections(); }
});

test('client poll: a failed poll asks for a resync; one throwing event does not drop the rest of the batch', async () => {
  const { createPartyClient } = await import('./party-client.mjs');
  const urls = []; let n = 0;
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const hang = o => new Promise((_, bad) => o.signal.addEventListener('abort', () => bad(o.signal.reason)));
  const line = text => ({ t: 'chat', line: { id: 'cd', name: 'Ben', text, at: 1 } });
  const fetchImpl = async (u, o) => {
    const x = new URL(u), p = x.pathname + x.search; urls.push(p);
    if (p === '/join') return json({ token: 'a'.repeat(48), id: 'ab', name: 'Ana', party: 'P' });
    if (p === '/leave') return json({});
    if (p === '/events') return new Response(new ReadableStream({ start: c => o.signal.addEventListener('abort', () => c.error(o.signal.reason)) })); // headers, never a byte
    n++;
    if (n === 1) return json([{ t: 'hello', you: 'ab', members: [], chat: [] }]);
    if (n === 2) return json({ error: 'bad gateway' }, 502);
    if (n === 3) return json([line('one'), line('two')]);
    return hang(o);
  };
  let boom = true;
  const A = createPartyClient({ fetchImpl, firstByteMs: 50, onChange: () => { if (boom && A.view().chat.length === 1) { boom = false; throw new Error('ui hook'); } } });
  const until = async (f, ms = 4000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
  try {
    await A.join('http://party.test', 'X', 'Ana');
    await until(() => A.view().chat.length === 2 && urls.filter(u => u.startsWith('/poll')).length >= 4);
    assert.deepEqual(A.view().chat.map(l => l.text), ['one', 'two']);
    assert.deepEqual(urls.filter(u => u.startsWith('/poll')).slice(0, 4), ['/poll', '/poll', '/poll?resync=1', '/poll']);
  } finally { await A.leave(); }
  const k = urls.length; await new Promise(r => setTimeout(r, 300)); assert.equal(urls.length, k, 'leave stops the loop');
});
