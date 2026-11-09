// The app's side of a party (phase 7): joins a party server, keeps one SSE stream open (or long-polls where a tunnel
// buffers SSE), publishes this office's feed
// (party/protocol.mjs feedOf: no task text, prompts, commands or paths) and the CEO avatar, and keeps what the others
// share. Everything that arrives is re-cleaned with the same protocol cleaners; party data is never trusted.
import crypto from 'node:crypto';
import { cleanName, cleanChat, cleanOffice, cleanAvatar, PRESENCE, LIMITS } from './party/protocol.mjs';

const STREAM_MAX = 2_000_000; // one SSE event bigger than this ends the connection
const GIVE_UP = 6; // reconnect attempts (backoff 1 s .. 30 s, about a minute) before telling the user the party is gone
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const gid = (v, p) => typeof v === 'string' && new RegExp('^' + p + '[0-9]{1,9}$').test(v) ? v : null;
const people = l => (Array.isArray(l) ? l : []).slice(0, LIMITS.members).map(x => x && typeof x === 'object' ? { name: cleanName(x.name) || 'Guest', ms: Math.max(0, Math.round(num(x.ms))), wpm: Math.max(0, Math.min(1000, Math.round(num(x.wpm)))), points: Math.max(0, Math.round(num(x.points))) } : null).filter(Boolean);

// Party link: http(s) only, no credentials in it, trailing slash trimmed.
export function partyUrl(v) {
  let u; try { u = new URL(String(v || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export function createPartyClient({ onChange = () => {}, fetchImpl = fetch, firstByteMs = 5000 } = {}) {
  let st = null; // { base, token, you, name, members: Map, chat: [], presence, ctrl, retry, lastOffice, avatar }
  let error = '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hashId = id => crypto.createHash('sha256').update(salt + String(id)).digest('hex').slice(0, 12);
  const call = async (p, body) => {
    const r = await fetchImpl(st.base + p, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + st.token }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10_000) });
    if (r.status === 401) { drop('The party no longer knows you (it may have restarted).'); }
    return r.ok;
  };
  function drop(why) { if (st) { try { st.ctrl.abort(); } catch {} clearTimeout(st.retry); } st = null; error = why || ''; onChange(); }

  function onEvent(ev) {
    if (!st || !ev || typeof ev !== 'object') return;
    const upsert = m => { if (!m || typeof m.id !== 'string' || !/^[a-f0-9]{1,16}$/.test(m.id) || m.id === st.you) return;
      if (!st.members.has(m.id) && st.members.size >= LIMITS.members) return;
      const cur = st.members.get(m.id) || {}; st.members.set(m.id, { id: m.id, host: m.host === true || (m.host === undefined && !!cur.host), seq: Number.isInteger(m.seq) ? m.seq : cur.seq || 0, name: cleanName(m.name) || cur.name || 'Guest', office: m.office !== undefined ? cleanOffice(m.office) : cur.office || null, avatar: m.avatar !== undefined ? cleanAvatar(m.avatar) : cur.avatar || null }); };
    if (ev.t === 'hello') { if (typeof ev.host === 'boolean') st.host = ev.host; if (Number.isInteger(ev.seq)) st.seq = ev.seq; st.game = { race: null, quiz: null }; const gs = ev.game || {}; if (gs.race) onGame({ t: 'race', at: gs.at, ...gs.race }); if (gs.quiz) { onGame({ t: 'quiz', id: gs.quiz.id }); onGame({ t: 'quiz-q', at: gs.at, ...gs.quiz }); } st.members.clear(); (Array.isArray(ev.members) ? ev.members : []).slice(0, LIMITS.members).forEach(upsert); st.chat = []; (Array.isArray(ev.chat) ? ev.chat : []).forEach(addChat); }
    else if (ev.t === 'member') upsert(ev.m);
    else if (ev.t === 'avatar') { const m = st.members.get(ev.id); if (m) m.avatar = cleanAvatar(ev.avatar); }
    else if (ev.t === 'leave') st.members.delete(ev.id);
    else if (ev.t === 'chat') addChat(ev.line);
    else if (ev.t === 'kicked') return drop('The host removed you from the party.');
    else if (ev.t === 'ended') return drop('The host ended the party.');
    else onGame(ev);
    onChange();
  }
  // Games: times are moved onto this machine's clock with the server stamp `at`; texts are cleaned like chat.
  function onGame(ev, local = Date.now()) {
    const g = st.game, shift = v => num(v) - num(ev.at) + local;
    if (ev.t === 'race' && gid(ev.id, 'r')) { g.race = { id: ev.id, text: cleanChat(ev.text), startsAt: shift(ev.startsAt), ends: shift(ev.ends), by: cleanName(ev.by), results: [], over: false, mine: null }; g.quiz = null; }
    else if ((ev.t === 'race-result' || ev.t === 'race-end') && g.race && ev.id === g.race.id) { g.race.results = people(ev.results); if (ev.t === 'race-end') g.race.over = true; }
    else if (ev.t === 'quiz' && gid(ev.id, 'q')) { g.quiz = { id: ev.id, pack: cleanName(ev.pack), by: cleanName(ev.by), q: null, scores: [], over: false }; g.race = null; }
    else if (ev.t === 'quiz-q' && g.quiz && ev.id === g.quiz.id) g.quiz.q = { n: Math.round(num(ev.n)), of: Math.round(num(ev.of)), text: cleanChat(ev.q), a: (Array.isArray(ev.a) ? ev.a : []).slice(0, 4).map(x => cleanChat(x).slice(0, 80)), ends: shift(ev.ends), correct: null, mine: null };
    else if (ev.t === 'quiz-reveal' && g.quiz && ev.id === g.quiz.id) { if (g.quiz.q) g.quiz.q.correct = Number.isInteger(ev.correct) && ev.correct >= 0 && ev.correct < 4 ? ev.correct : null; g.quiz.scores = people(ev.scores); }
    else if (ev.t === 'quiz-end' && g.quiz && ev.id === g.quiz.id) { g.quiz.over = true; g.quiz.q = null; g.quiz.scores = people(ev.scores); }
  }
  function addChat(l) { if (!l || typeof l !== 'object') return; const text = cleanChat(l.text); if (!text) return; st.chat.push({ name: cleanName(l.name) || 'Guest', text, mine: l.id === st.you, at: Number.isFinite(l.at) ? l.at : Date.now() }); if (st.chat.length > LIMITS.chatKeep) st.chat.shift(); }

  // SSE first. The server sends the hello at once, so a stream with no bytes after firstByteMs is being buffered
  // (Cloudflare quick tunnels do that): switch this session to the /poll long poll.
  async function stream(me, tries = 0) {
    if (me.poll) return poll(me);
    // one way on purpose: a tunnel that buffers SSE once will keep doing it, so polling lasts for the rest of the session
    const quiet = new AbortController(), t = setTimeout(() => { me.poll = true; quiet.abort(); }, firstByteMs);
    try {
      const r = await fetchImpl(me.base + '/events', { headers: { authorization: 'Bearer ' + me.token }, redirect: 'error', signal: AbortSignal.any([me.ctrl.signal, quiet.signal]) });
      if (r.status === 401) return st === me && drop('The party no longer knows you (it may have restarted).');
      if (!r.ok || !r.body) throw new Error('stream ' + r.status);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        if (!me.live) { clearTimeout(t); tries = 0; me.live = true; onChange(); }
        buf += dec.decode(value, { stream: true });
        if (buf.length > STREAM_MAX) throw new Error('event too large');
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split('\n').find(l => l.startsWith('data: ')); if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch {} } }
      }
    } catch (e) { if (me.ctrl.signal.aborted) return; } finally { clearTimeout(t); }
    if (st !== me) return;
    me.live = false; onChange();
    if (me.poll) return poll(me);
    if (tries >= GIVE_UP) return drop('Lost the connection to the party.'); // the server is gone (about a minute of failed reconnects)
    me.retry = setTimeout(() => stream(me, tries + 1), Math.min(30_000, 1000 * 2 ** tries)); // reconnect with backoff
  }
  // Long poll: each answer is a JSON array of events (the first one starts with a hello); errors back off.
  async function poll(me, tries = 0) {
    try {
      const r = await fetchImpl(me.base + '/poll' + (me.resync ? '?resync=1' : ''), { headers: { authorization: 'Bearer ' + me.token }, redirect: 'error', signal: AbortSignal.any([me.ctrl.signal, AbortSignal.timeout(45_000)]) });
      if (r.status === 401) return st === me && drop('The party no longer knows you (it may have restarted).');
      if (!r.ok) throw new Error('poll ' + r.status);
      const text = await r.text(); if (text.length > STREAM_MAX) throw new Error('poll too large');
      const evs = JSON.parse(text); if (!Array.isArray(evs)) throw new Error('not a poll answer');
      if (st !== me) return;
      tries = 0; me.resync = false; if (!me.live) { me.live = true; onChange(); }
      for (const ev of evs) { try { onEvent(ev); } catch {} }
    } catch (e) {
      if (me.ctrl.signal.aborted) return;
      tries++; me.resync = true; // delivery is at most once: a lost answer may have held events, so start over from a hello
      if (st === me && me.live) { me.live = false; onChange(); }
    }
    if (st !== me) return;
    if (tries > GIVE_UP) return drop('Lost the connection to the party.');
    me.retry = setTimeout(() => poll(me, tries), tries ? Math.min(30_000, 1000 * 2 ** (tries - 1)) : 0);
  }

  return {
    hashId,
    async join(url, code, name, hostKey) {
      const base = partyUrl(url); if (!base) throw new Error('Paste the party link (http:// or https://).');
      if (st) drop();
      const r = await fetchImpl(base + '/join', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: String(code || '').slice(0, 64), name: cleanName(name) || 'Guest', ...(hostKey ? { hostKey: String(hostKey).slice(0, 128) } : {}) }), signal: AbortSignal.timeout(10_000) });
      let j = {}; try { j = await r.json(); } catch {}
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error.slice(0, 120) : 'Could not join (' + r.status + ').');
      if (typeof j.token !== 'string' || !/^[a-f0-9]{48}$/.test(j.token)) throw new Error('That does not look like a party server.');
      st = { base, token: j.token, you: String(j.id || ''), host: j.host === true, seq: Number.isInteger(j.seq) ? j.seq : 0, name: cleanName(j.name) || 'Guest', party: cleanName(j.party) || 'Party', members: new Map(), chat: [], game: { race: null, quiz: null }, presence: 'available', ctrl: new AbortController(), live: false, lastOffice: '', avatar: '' };
      error = ''; stream(st); onChange(); return true;
    },
    // stop the stream/poll loop first: the server answers a pending poll on /leave, and that answer must not start another poll
    async leave() { if (!st) return; const me = st; try { me.ctrl.abort(); } catch {} clearTimeout(me.retry); try { await call('/leave'); } catch {} if (st === me) drop(); },
    async say(text) { const t = cleanChat(text); if (!st || !t) return false; return call('/chat', { text: t }); },
    // Mini-games: action race | type | quiz | answer. Returns the server's answer ({ok, error?, wpm?}).
    async game(action, b = {}) {
      if (!st) return { ok: false, error: 'not in a party' };
      const r = await fetchImpl(st.base + '/game', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + st.token }, body: JSON.stringify({ ...b, action }), signal: AbortSignal.timeout(10_000) });
      let j = {}; try { j = await r.json(); } catch {}
      const out = { ok: !!j.ok, error: typeof j.error === 'string' ? cleanChat(j.error) : '', wpm: Math.round(num(j.wpm)) };
      if (st && out.ok && action === 'type' && st.game.race) st.game.race.mine = out.wpm;
      if (st && out.ok && action === 'answer' && st.game.quiz && st.game.quiz.q) st.game.quiz.q.mine = b.choice;
      onChange(); return out;
    },
    async setPresence(p) { if (!st || !PRESENCE.includes(p)) return false; st.presence = p; onChange(); st.avatar = ''; return true; },
    // feed: () => feedOf(...) from the server; avatar: {x, y, room}. Each is sent only when it changed.
    async publish(feed, avatar) {
      if (!st || !st.live) return;
      const me = st;
      const o = JSON.stringify(feed); if (o !== me.lastOffice) { me.lastOffice = o; try { await call('/office', { office: feed }); } catch { me.lastOffice = ''; } }
      if (avatar && st === me) { const a = cleanAvatar({ ...avatar, presence: me.presence }), k = JSON.stringify(a); if (k !== me.avatar) { me.avatar = k; try { await call('/avatar', { avatar: a }); } catch { me.avatar = ''; } } }
    },
    // a member's full office (with layout), asked for when visiting
    async office(id) {
      if (!st || !st.members.has(id)) return null;
      const r = await fetchImpl(st.base + '/office-of', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + st.token }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return null;
      const text = await r.text(); if (text.length > LIMITS.body) return null;
      try { return cleanOffice(JSON.parse(text).office); } catch { return null; }
    },
    // What the page sees: no token, no offices (those are fetched one at a time when visiting).
    view() {
      if (!st) return { connected: false, error };
      return { connected: true, live: st.live, host: new URL(st.base).host, party: st.party, you: { id: st.you, name: st.name, presence: st.presence, host: st.host, seq: st.seq }, error,
        game: st.game,
        members: [...st.members.values()].sort((a, b) => a.seq - b.seq).map(m => ({ host: m.host, seq: m.seq, stats: m.office ? m.office.stats : null, id: m.id, name: m.name, presence: (m.avatar && m.avatar.presence) || 'available', room: (m.avatar && m.avatar.room) || 'home', agents: m.office ? m.office.agents.length : 0, working: m.office ? m.office.agents.filter(a => a.state === 'working').length : 0, crew: m.office ? m.office.agents.map(({ id, name, key, state, bubble }) => ({ id, name, key, state, bubble })) : [], avatar: m.avatar })),
        chat: st.chat.slice(-30) };
    },
  };
}
