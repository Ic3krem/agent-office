// Agent Office party server (phase 7). Zero dependencies: JSON over HTTP plus one Server-Sent Events stream per member,
// so it runs from a plain `node server.mjs` or the Docker image, behind a Cloudflare quick tunnel or on IP:port.
// Everything lives in memory; nothing is written to disk. Every message goes through party/protocol.mjs.
//
//   POST /join   {code, name, hostKey?} -> {token, id, name, party, host, seq}   (invite code; 16 members at most; the host key makes you the host)
//   GET  /events  Authorization: Bearer <token>   SSE: hello, member, leave, chat, kicked
//   GET  /poll    Authorization: Bearer <token>   long poll: JSON array of the same events (tunnels that buffer SSE);
//                 ?resync=1 restarts the queue with a hello (the client asks after a failed poll: delivery is at most once)
//   POST /office {office}  /avatar {avatar}  /chat {text}  /leave        (Bearer token)
//   POST /rtc {to,kind,data}  /emote {emote}                                (Bearer token; voice setup between slot holders; reactions in the meeting room)
//   POST /music {music|null} or {djAll}                                    (Bearer token; the shared player)
//   POST /admin/kick {id}  x-admin-key: <key>                              (host only; also bans that address)
//   POST /admin/end         x-admin-key: <key>                              (host only; tells everyone the party ended)
//   GET  /health
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dns from 'node:dns/promises';
import { LIMITS, cleanName, cleanChat, cleanOffice, cleanAvatar, cleanMusic, cleanRtc, cleanEmote } from './protocol.mjs';
import { createGames } from './games.mjs';

const sha = s => crypto.createHash('sha256').update(String(s ?? ''), 'utf8').digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const rand = n => crypto.randomBytes(n).toString('hex');

// Token bucket per key: `rate` per second, bursts up to `burst`. limit.refund(key) gives one token back.
export function limiter(rate, burst, now = () => Date.now()) {
  const b = new Map();
  const limit = key => {
    const t = now(), s = b.get(key) || { n: burst, t };
    s.n = Math.min(burst, s.n + (t - s.t) / 1000 * rate); s.t = t;
    if (b.size > 5000) b.clear(); // bounded memory under a flood of addresses
    if (s.n < 1) { b.set(key, s); return false; }
    s.n -= 1; b.set(key, s); return true;
  };
  limit.refund = key => { const s = b.get(key); if (s) s.n = Math.min(burst, s.n + 1); };
  return limit;
}

const POLL = { events: 200, bytes: 1_000_000 }; // a poller's queue; past either cap it gets a fresh hello instead
// The party itself, without HTTP (tested directly). send(member, event) delivers to that member's stream.
export function createParty({ code, name = 'TiroAgents party', adminKey = '', now = () => Date.now(), gameOpts = {} }) {
  const byToken = new Map(), banned = new Set(), chat = [];
  let seq = 0; // join order: every app lays the friend lots out the same way
  let music = null, djAll = true; // the shared player: what plays (server-stamped start) and whether guests may change it
  // members as relayed: the office without its layout (that can be 300 KB); a visit asks for it with /office-of
  const pub = m => ({ id: m.id, name: m.name, host: m.host, seq: m.seq, office: m.office && { ...m.office, layout: undefined }, avatar: m.avatar, voice: m.voice });
  const others = (m, ev) => { for (const o of byToken.values()) if (o !== m) o.send && o.send(ev); };
  const all = ev => { for (const o of byToken.values()) o.send && o.send(ev); };
  // Voice slots: the LIMITS.voice members longest in room 'meet' (ties by join order); a newcomer never displaces a holder. Everyone hears when the set changes.
  let holders = [];
  const slots = () => {
    const h = [...byToken.values()].filter(m => m.meetAt).sort((a, b) => a.meetAt - b.meetAt || a.seq - b.seq).slice(0, LIMITS.voice);
    for (const m of byToken.values()) m.voice = h.includes(m);
    const ids = h.map(m => m.id); if (ids.join() !== holders.join()) { holders = ids; all({ t: 'voice', ids }); }
  };
  const games = createGames({ broadcast: all, now, ...gameOpts });
  const api = {
    name, banned,
    join(body, addr) {
      if (banned.has(addr)) return { status: 403, body: { error: 'banned from this party' } };
      if (!body || typeof body.code !== 'string' || !safeEqual(body.code.trim().toUpperCase(), code)) return { status: 403, body: { error: 'wrong invite code' } };
      if (byToken.size >= LIMITS.members) return { status: 409, body: { error: 'party is full' } };
      let nm = cleanName(body.name) || 'Guest';
      const taken = new Set([...byToken.values()].map(m => m.name.toLowerCase()));
      for (let i = 2; taken.has(nm.toLowerCase()); i++) nm = cleanName(nm.slice(0, 16)) + ' ' + i;
      // The host (whoever holds the host key, e.g. the app that started the party) owns the town: their office is the main house.
      const host = !!adminKey && typeof body.hostKey === 'string' && safeEqual(body.hostKey, adminKey) && ![...byToken.values()].some(o => o.host);
      const m = { token: rand(24), id: rand(6), name: nm, host, seq: ++seq, addr, office: null, avatar: null, meetAt: 0, voice: false, last: now(), send: null };
      byToken.set(m.token, m);
      others(m, { t: 'member', m: pub(m) });
      return { status: 200, body: { token: m.token, id: m.id, name: m.name, party: name, host: m.host, seq: m.seq } };
    },
    member: token => (typeof token === 'string' && byToken.get(token)) || null,
    officeOf: id => { const m = [...byToken.values()].find(x => x.id === id); return m ? m.office : null; },
    hello: m => ({ t: 'hello', you: m.id, host: m.host, seq: m.seq, party: name, members: [...byToken.values()].filter(o => o !== m).map(pub), chat, game: games.state(), music, djAll, voice: holders, caps: ['voice'], at: now() }),
    attach(m, send) { if (m.send && m.send !== send) m.send(null); m.send = send; m.last = now(); send(api.hello(m)); },
    // Long poll: reply(jsonArray) is called once, when events are queued (or with [] when a newer poll replaces it).
    // The member's send becomes a capped queue (first poll gets the hello); returns a cancel for timeout or close.
    poll(m, reply, resync = false) {
      let s = m.send;
      if (!s || !s.q || s.closed) { s = queueSend(m); api.attach(m, s); } else if (resync) s.reset();
      m.last = now();
      if (s.wait) { const w = s.wait; s.wait = null; w('[]'); }
      s.wait = reply; s.flush();
      return () => { if (s.wait === reply) s.wait = null; m.last = now(); };
    },
    // mini-games: b.action race | type | quiz | answer
    game(m, b) {
      m.last = now();
      if (!b || typeof b !== 'object') return { ok: false, error: 'bad request' };
      if (b.action === 'race') return games.startRace(m);
      if (b.action === 'type') return games.finishRace(m, String(b.id || ''), typeof b.typed === 'string' ? b.typed.slice(0, 300) : '');
      if (b.action === 'quiz') return games.startQuiz(m, String(b.pack || ''), [...byToken.values()]);
      if (b.action === 'answer') return games.answer(m, String(b.id || ''), b.n, b.choice);
      return { ok: false, error: 'unknown game action' };
    },
    stop: () => games.stop(),
    detach(m, send) { if (m.send === send) m.send = null; m.last = now(); },
    office(m, o) { const c = cleanOffice(o); if (!c) return false; m.office = c; m.last = now(); others(m, { t: 'member', m: pub(m) }); return true; },
    avatar(m, a) { const c = cleanAvatar(a); if (!c) return false; const was = m.meetAt; m.meetAt = c.room === 'meet' ? was || now() : 0; m.avatar = c; m.last = now(); others(m, { t: 'avatar', id: m.id, avatar: c }); if (!!was !== !!m.meetAt) slots(); return true; },
    // Voice setup messages (offer/answer/ice) pass between two slot holders; never stored, the audio itself never touches the server.
    rtc(m, b) {
      const c = cleanRtc(b); if (!c) return { ok: false, error: 'bad request' };
      const to = [...byToken.values()].find(x => x.id === c.to);
      if (!m.voice || !to || to === m || !to.voice) return { ok: false, error: 'no voice slot' };
      m.last = now(); to.send && to.send({ t: 'rtc', from: m.id, kind: c.kind, data: c.data }); return { ok: true };
    },
    emote(m, b) {
      const e = cleanEmote(b && b.emote); if (e === null || !m.meetAt) return false;
      m.last = now(); for (const o of byToken.values()) if (o !== m && o.meetAt && o.send) o.send({ t: 'emote', id: m.id, emote: e }); return true; // the sender's page drew it already
    },
    // Shared player: {music: {...} | null} plays or stops (the host, or anyone while djAll); {djAll} is the host's switch.
    music(m, b) {
      m.last = now();
      if (!b || typeof b !== 'object') return { ok: false, error: 'bad request' };
      if (typeof b.djAll === 'boolean') { if (!m.host) return { ok: false, error: 'Only the host can change who plays music.' }; djAll = b.djAll; }
      else if ('music' in b) {
        if (!m.host && !djAll) return { ok: false, error: 'Only the host can change the music.' };
        const c = b.music === null ? null : cleanMusic({ ...b.music, startedAt: now() });
        if (b.music !== null && !c) return { ok: false, error: 'That link cannot be played.' };
        music = c;
      } else return { ok: false, error: 'bad request' };
      all({ t: 'music', music, djAll, at: now() }); return { ok: true };
    },
    say(m, text) { const t = cleanChat(text); if (!t) return false; const line = { id: m.id, name: m.name, text: t, at: now() }; chat.push(line); if (chat.length > LIMITS.chatKeep) chat.shift(); m.last = now(); all({ t: 'chat', line }); return true; },
    leave(m, why = 'left') { if (!byToken.delete(m.token)) return; m.meetAt = 0; m.voice = false; if (why === 'kicked' && m.send) m.send({ t: 'kicked' }); m.send && m.send(null); others(m, { t: 'leave', id: m.id }); slots(); },
    // The host ends the party: everyone hears it before the server goes away (their apps leave instead of retrying).
    end() { all({ t: 'ended' }); },
    kick(id) { const m = [...byToken.values()].find(x => x.id === id); if (!m) return false; banned.add(m.addr); api.leave(m, 'kicked'); return true; },
    // members without a stream, or without a poll, for 90 s are gone
    reap() { const t = now(); for (const m of [...byToken.values()]) if ((!m.send || m.send.q) && t - m.last > 90_000) api.leave(m, 'timeout'); },
    size: () => byToken.size,
  };
  function queueSend(m) {
    let q = [], bytes = 0;
    const s = ev => {
      if (ev === null) { s.closed = true; return s.flush(); }
      const j = JSON.stringify(ev);
      // overflow: drop the backlog; the hello snapshot already includes this event's change
      if (q.length >= POLL.events || bytes + j.length > POLL.bytes) s.reset(); else { q.push(j); bytes += j.length; }
      s.flush();
    };
    s.q = true;
    s.reset = () => { q = [JSON.stringify(api.hello(m))]; bytes = q[0].length; };
    s.flush = () => { if (!s.wait || (!q.length && !s.closed)) return; const w = s.wait, out = '[' + q.join(',') + ']'; s.wait = null; q = []; bytes = 0; w(out); };
    return s;
  }
  return api;
}

const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'" };
// trustProxy: the host name of the tunnel container (cloudflared). Its CF-Connecting-IP header is believed only on requests
// that really come from that container's address, so a direct IP:port visitor cannot fake an address to dodge a ban.
export function startParty({ port = 4880, host = '0.0.0.0', code, adminKey, name, trustProxy = '', pollMs = 20_000, maxStreams = LIMITS.members * 2 } = {}) {
  const party = createParty({ code, name, adminKey });
  const musicLimit = limiter(1, 3), joinLimit = limiter(0.2, 5), badJoins = limiter(0.5, 20), msgLimit = limiter(10, 20), chatLimit = limiter(1, 3), rtcLimit = limiter(20, 60), emoteLimit = limiter(1, 5), officeLimit = limiter(1, 3), kickLimit = limiter(0.5, 5), pollLimit = limiter(5, 10);
  const ipKey = a => a.includes(':') ? a.split(':').slice(0, 4).join(':') : a; // IPv6 by /64
  let proxyIps = new Set();
  const resolveProxy = () => trustProxy && dns.lookup(trustProxy, { all: true }).then(r => { proxyIps = new Set(r.map(x => x.address)); }).catch(() => {});
  resolveProxy();
  const peer = req => String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  const addrOf = req => (proxyIps.has(peer(req)) && typeof req.headers['cf-connecting-ip'] === 'string' && req.headers['cf-connecting-ip'].slice(0, 64)) || peer(req);
  const json = (res, status, body) => { res.writeHead(status, { ...SEC, 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req, max) => new Promise((ok, bad) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { if (n - c.length <= max) bad(Object.assign(new Error('too large'), { status: 413 })); } else chunks.push(c); });
    req.on('end', () => { if (n > max) return; try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { bad(Object.assign(new Error('bad JSON'), { status: 400 })); } });
    req.on('error', bad);
  });
  let streams = 0;
  const server = http.createServer(async (req, res) => {
    let url, addr;
    try {
      url = new URL(req.url, 'http://x'); addr = addrOf(req);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, party: party.name, members: party.size() });
      const token = (/^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '') || [])[1];
      if (req.method === 'GET' && url.pathname === '/events') {
        const m = party.member(token); if (!m) return json(res, 401, { error: 'join first' });
        if (streams >= maxStreams) return json(res, 503, { error: 'busy' });
        streams++;
        res.writeHead(200, { ...SEC, 'content-type': 'text/event-stream', connection: 'keep-alive' });
        const send = ev => { if (ev === null || res.writableLength > 1_000_000) return res.end(); res.write('data: ' + JSON.stringify(ev) + '\n\n'); }; // slow reader: hang up
        party.attach(m, send);
        const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => { streams--; clearInterval(ping); party.detach(m, send); });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/poll') {
        const m = party.member(token); if (!m) return json(res, 401, { error: 'join first' });
        if (!pollLimit(m.token)) return json(res, 429, { error: 'slow down' });
        if (streams >= maxStreams) return json(res, 503, { error: 'busy' });
        streams++;
        let done = false, cancel = null; const resync = url.searchParams.get('resync') === '1';
        // a poll answered with events is free: queued events end it at once (trickle ICE, a busy town), and their senders have their own
        // limits. Only polls that end empty (timeout, or replaced by a newer poll) count, so a client hammering /poll is still limited.
        // A resync always counts: it answers at once with a full hello the client asked for.
        const finish = body => { if (done) return; done = true; streams--; clearTimeout(t); if (cancel) cancel(); if (body !== null) { if (body !== '[]' && !resync) pollLimit.refund(m.token); res.writeHead(200, { ...SEC, 'content-type': 'application/json' }); res.end(body); } };
        const t = setTimeout(() => finish('[]'), pollMs);
        res.on('close', () => finish(null));
        cancel = party.poll(m, finish, resync);
        return;
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'send JSON' });
      if (url.pathname === '/join') {
        if (!joinLimit(ipKey(addr))) return json(res, 429, { error: 'too many tries; wait a minute' });
        const r = party.join(await readBody(req, 4096), addr);
        if (r.status === 403 && !badJoins('all')) return json(res, 429, { error: 'too many tries; wait a minute' }); // all wrong codes, from every address
        return json(res, r.status, r.body);
      }
      if (url.pathname === '/admin/kick' || url.pathname === '/admin/end') {
        if (!kickLimit('admin')) return json(res, 429, { error: 'slow down' });
        if (!adminKey || !safeEqual(req.headers['x-admin-key'] || '', adminKey)) return json(res, 403, { error: 'host only' });
        if (url.pathname === '/admin/end') { party.end(); return json(res, 200, {}); }
        const b = await readBody(req, 4096); return json(res, party.kick(String(b.id || '')) ? 200 : 404, {});
      }
      const m = party.member(token); if (!m) return json(res, 401, { error: 'join first' });
      if (url.pathname !== '/rtc' && url.pathname !== '/emote' && !msgLimit(m.token)) return json(res, 429, { error: 'slow down' }); // those two have their own limiters
      if (url.pathname === '/office') { if (!officeLimit(m.token)) return json(res, 429, { error: 'slow down' }); return json(res, party.office(m, (await readBody(req, LIMITS.body)).office) ? 200 : 400, {}); }
      if (url.pathname === '/office-of') { const o = party.officeOf(String((await readBody(req, 4096)).id || '')); return o ? json(res, 200, { office: o }) : json(res, 404, { error: 'no such member' }); }
      if (url.pathname === '/avatar') return json(res, party.avatar(m, (await readBody(req, 4096)).avatar) ? 200 : 400, {});
      if (url.pathname === '/chat') { const b = await readBody(req, 4096); if (!chatLimit(m.token)) return json(res, 429, { error: 'slow down' }); return json(res, party.say(m, b.text) ? 200 : 400, {}); }
      if (url.pathname === '/rtc') { const b = await readBody(req, 16384); if (!rtcLimit(m.token)) return json(res, 429, { error: 'slow down' }); const r = party.rtc(m, b); return json(res, r.ok ? 200 : 400, r); }
      if (url.pathname === '/emote') { const b = await readBody(req, 4096); if (!emoteLimit(m.token)) return json(res, 429, { error: 'slow down' }); return json(res, party.emote(m, b) ? 200 : 400, {}); }
      if (url.pathname === '/music') { const b = await readBody(req, 4096); if (!musicLimit(m.token)) return json(res, 429, { error: 'slow down' }); const r = party.music(m, b); return json(res, r.ok ? 200 : 400, r); }
      if (url.pathname === '/game') { const r = party.game(m, await readBody(req, 4096)); return json(res, r.ok ? 200 : 400, r); }
      if (url.pathname === '/leave') { party.leave(m); return json(res, 200, {}); }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.status === 413) { res.setHeader('connection', 'close'); res.on('finish', () => req.destroy()); } // answer first, then drop the rest of the upload
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    }
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  const reaper = setInterval(() => { party.reap(); resolveProxy(); }, 15_000); reaper.unref();
  server.on('close', () => { clearInterval(reaper); party.stop(); });
  return new Promise(ok => server.listen(port, host, () => ok({ server, party, port: server.address().port, streams: () => streams })));
}

// Run directly (node server.mjs, or the Docker image): settings from the environment.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // one bad request must never take the party down
  process.on('unhandledRejection', e => console.error('unhandled:', e && e.message));
  process.on('uncaughtException', e => console.error('uncaught:', e && e.message));
  const env = process.env;
  const code = (env.PARTY_CODE || rand(5)).trim().toUpperCase(), adminKey = env.PARTY_ADMIN_KEY || rand(16);
  // Hosted from the app: stdin is a pipe from it, so the party ends when the app does; PARTY_BIND=127.0.0.1 keeps it
  // off the network (friends come in through the tunnel).
  if (env.PARTY_PARENT_PIPE === '1') { const gone = () => process.exit(0); process.stdin.on('end', gone); process.stdin.on('error', gone); process.stdin.resume(); }
  const { port } = await startParty({ host: env.PARTY_BIND || '0.0.0.0', port: +env.PARTY_PORT || 4880, code, adminKey, name: cleanName(env.PARTY_NAME) || 'TiroAgents party', trustProxy: env.PARTY_TRUST_PROXY || '' });
  console.log(`Party server on port ${port}. Invite code: ${code}`);
  console.log(`Host key (keep it; kicks people): ${adminKey}`);
  // in Docker the host port can differ from the one inside the container; compose passes it as PARTY_PUBLIC_PORT
  console.log(`Friends on your network: http://<this machine's IP>:${+env.PARTY_PUBLIC_PORT || port}  (the port is the host's PARTY_PORT; this link shows your IP to whoever you give it to)`);
  // With the cloudflared container: ask its metrics endpoint for the quick-tunnel name and print the shareable link.
  if (env.PARTY_TUNNEL_METRICS) for (let i = 0; i < 30; i++) {
    try { const j = await (await fetch(env.PARTY_TUNNEL_METRICS + '/quicktunnel')).json(); if (j.hostname) { console.log(`Share this link: https://${j.hostname}  with code ${code}`); break; } } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
}
