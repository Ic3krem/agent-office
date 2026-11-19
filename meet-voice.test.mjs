import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('./public/meet-voice.js', import.meta.url), 'utf8'), { filename: 'meet-voice.js' }); // same realm, so deepEqual sees plain objects
const C = globalThis.MeetVoiceCore, MV = globalThis.MeetVoice;

test('shouldOffer: exactly one side of every pair offers', () => {
  assert.equal(C.shouldOffer('a1', 'b2'), true); assert.equal(C.shouldOffer('b2', 'a1'), false);
});
test('plan: connect to new holders, close departed ones, nothing without a slot', () => {
  assert.deepEqual(C.plan('me', ['me', 'x', 'y'], ['y', 'z']), { connect: ['x'], close: ['z'] });
  assert.deepEqual(C.plan('me', ['x', 'y'], ['x']), { connect: [], close: ['x'] });
});
test('nextState: one restart, then failed; close always wins', () => {
  let s = C.nextState('new', 'start'); assert.equal(s, 'connecting');
  s = C.nextState(s, 'timeout'); assert.equal(s, 'restarting');
  assert.equal(C.nextState(s, 'connected'), 'connected');
  assert.equal(C.nextState(s, 'ice-failed'), 'failed');
  for (const st of ['new', 'connecting', 'connected', 'restarting', 'failed']) assert.equal(C.nextState(st, 'close'), 'closed');
});

// ---- wiring, driven with fakes ----
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
// hold: 'api' | 'get' | 'gum' keep those calls pending until r.release*(); srdFail(pc) makes setRemoteDescription reject.
function rig({ me = 'a', ids = ['a', 'b'], gum, hold = [], srdFail = () => false } = {}) {
  const r = { pcs: [], sent: [], waits: { api: [], get: [], gum: [], answer: [] }, states: [], gumCalls: 0, tracks: [], ctxs: [], listeners: {}, timers: [], now: 0, view: { you: { id: me }, voice: { ids } } };
  class PC {
    constructor(cfg) { this.cfg = cfg; this.tx = []; this.signalingState = 'stable'; this.connectionState = 'new'; this.closed = false; this.offers = []; this.cands = []; r.pcs.push(this); }
    addTransceiver(t, init) { const x = { direction: init.direction, sender: { track: typeof t === 'string' ? null : t, async replaceTrack(k) { x.sender.track = k; } } }; this.tx.push(x); return x; }
    getTransceivers() { return this.tx; }
    // the far side answers what was offered: our negotiated direction sends only if the offer said sendrecv
    async createOffer(o) { this.offers.push(o || {}); this.tx.forEach(x => { x.offered = x.direction; }); return { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' }; }
    async createAnswer() { this.tx.forEach(x => { x.answered = x.direction; }); if (hold.includes('answer')) await new Promise(res => r.waits.answer.push(res)); return { type: 'answer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; if (d.type === 'answer') this.tx.forEach(x => { x.currentDirection = x.answered === 'sendrecv' ? 'sendrecv' : 'recvonly'; }); }
    async setRemoteDescription(d) { if (srdFail(this)) throw new Error('bad sdp'); this.remoteDescription = d; if (d.type === 'offer') { if (!this.tx.length) this.addTransceiver('audio', { direction: 'recvonly' }); this.signalingState = 'have-remote-offer'; } else { this.signalingState = 'stable'; this.tx.forEach(x => { x.currentDirection = x.offered === 'sendrecv' ? 'sendrecv' : 'recvonly'; }); } }
    async addIceCandidate(c) { this.cands.push(c); }
    close() { this.closed = true; }
    set(s) { this.connectionState = s; this.onconnectionstatechange(); }
  }
  const timer = (fn, ms, every) => { const t = { fn, at: r.now + ms, ms, every }; r.timers.push(t); return t; };
  const clear = t => { r.timers = r.timers.filter(x => x !== t); };
  r.advance = async ms => {
    const end = r.now + ms;
    for (;;) { const t = r.timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; r.now = t.at; if (t.every) t.at += t.ms; else clear(t); t.fn(); await flush(); }
    r.now = end;
  };
  r.voice = MV.create({
    api: async (p, b) => { r.sent.push({ p, ...b }); if (hold.includes('api')) await new Promise(res => r.waits.api.push(res)); return { ok: true }; },
    get: async p => { if (hold.includes('get')) await new Promise(res => r.waits.get.push(res)); return p === '/api/party/voice-config' ? { iceServers: [{ urls: 'stun:x' }] } : {}; },
    // members default to every other holder having joined voice (avatar.mic set); a test sets r.view.members to say otherwise
    view: () => ({ ...r.view, members: r.view.members || r.view.voice.ids.filter(i => i !== r.view.you.id).map(id => ({ id, avatar: { room: 'meet', mic: 'listen' } })) }),
    onSignal: fn => { r.signal = fn; },
    onState: s => r.states.push(s),
    RTCPeerConnection: PC,
    getUserMedia: async c => { r.gumCalls++; r.gumArgs = c; if (hold.includes('gum')) await new Promise(res => r.waits.gum.push(res)); if (gum) throw gum; const k = { kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true; } }; r.tracks.push(k); return { getTracks: () => [k], getAudioTracks: () => [k] }; },
    AudioContext: class { constructor() { this.closed = false; r.ctxs.push(this); } createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return { getByteTimeDomainData(a) { a.fill(128); } }; } close() { this.closed = true; return Promise.resolve(); } },
    MediaStream: class { constructor(t) { this.t = t; } },
    Audio: () => ({ play: async () => {}, pause() {} }),
    setTimeout: (fn, ms) => timer(fn, ms), clearTimeout: clear, setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: clear,
    addEventListener: (n, fn) => { r.listeners[n] = fn; },
  });
  r.release = async k => { r.waits[k].splice(0).forEach(f => f()); await flush(); };
  return r;
}
const last = r => r.states[r.states.length - 1];

test('join listen: never captures, offers a recvonly audio line and trickles ICE as single lines', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  assert.equal(r.gumCalls, 0); assert.equal(r.pcs.length, 1);
  assert.deepEqual(r.pcs[0].cfg.iceServers, [{ urls: 'stun:x' }]);
  assert.equal(r.pcs[0].tx.length, 1); assert.equal(r.pcs[0].tx[0].direction, 'recvonly');
  assert.deepEqual(r.sent.map(m => [m.p, m.to, m.kind]), [['/api/party/rtc', 'b', 'offer']]);
  r.pcs[0].onicecandidate({ candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' } }); r.pcs[0].onicecandidate({ candidate: null }); await flush();
  assert.deepEqual(r.sent.slice(1).map(m => [m.kind, m.data]), [['ice', 'candidate:1 1 udp 1 1.2.3.4 5 typ host'], ['ice', '']]);
  await r.voice.setMuted(true); assert.equal(r.gumCalls, 0); assert.equal(last(r).mic, 'listen');
});

test('first unmute in listen mode opens the mic with the voice constraints', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  await r.voice.setMuted(false); await flush();
  assert.equal(r.gumCalls, 1); assert.deepEqual(r.gumArgs, { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  assert.equal(r.pcs[0].tx[0].direction, 'sendrecv'); assert.equal(r.pcs[0].tx[0].sender.track, r.tracks[0]); assert.equal(last(r).mic, 'on');
  await r.voice.setMuted(true); assert.equal(r.tracks[0].enabled, false); assert.equal(r.tracks[0].stopped, false); assert.equal(last(r).mic, 'muted');
  await r.voice.setMuted(false); assert.equal(r.gumCalls, 1); assert.equal(r.tracks[0].enabled, true);
});

test('getUserMedia refusal falls back to listen: denied or no-device', async () => {
  for (const [name, reason] of [['NotAllowedError', 'denied'], ['NotFoundError', 'no-device']]) {
    const r = rig({ gum: Object.assign(new Error('x'), { name }) }); await r.voice.join('mic'); await flush();
    assert.equal(r.gumCalls, 1); assert.equal(last(r).mic, 'listen'); assert.equal(last(r).reason, reason);
    assert.equal(r.pcs[0].tx[0].direction, 'recvonly');
  }
});

test('answerer: an offer from a holder gets an answer; ICE goes to m-line 0', async () => {
  const r = rig({ me: 'b', ids: ['a', 'b'] }); await r.voice.join('mic'); await flush();
  assert.equal(r.pcs.length, 0, 'the lower id offers');
  r.signal({ type: 'rtc', from: 'z', kind: 'offer', data: 'v=0\r\n' }); await flush(); assert.equal(r.pcs.length, 0, 'not a holder');
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: 'v=0\r\n' }); r.signal({ type: 'rtc', from: 'a', kind: 'ice', data: 'candidate:9' }); await flush();
  assert.equal(r.pcs.length, 1); assert.equal(r.pcs[0].tx[0].direction, 'sendrecv'); assert.equal(r.pcs[0].tx[0].sender.track, r.tracks[0]);
  assert.deepEqual(r.sent.map(m => [m.to, m.kind]), [['a', 'answer']]);
  assert.deepEqual(r.pcs[0].cands, [{ candidate: 'candidate:9', sdpMLineIndex: 0 }]);
});

test('leave: stops every track, closes every peer and the AudioContext; pagehide leaves too', async () => {
  for (const how of ['leave', 'pagehide']) {
    const r = rig({ ids: ['a', 'b', 'c'] }); await r.voice.join('mic'); await flush();
    assert.equal(r.pcs.length, 2);
    if (how === 'leave') r.voice.leave(); else r.listeners.pagehide();
    assert.ok(r.tracks.every(t => t.stopped)); assert.ok(r.pcs.every(p => p.closed)); assert.ok(r.ctxs.every(c => c.closed));
    assert.deepEqual(r.voice.peers(), {}); assert.equal(last(r).mic, 'off'); assert.equal(r.timers.length, 0);
  }
});

test('a peer stuck connecting for 10 s gets exactly one ICE restart, then failed', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  const pc = r.pcs[0]; assert.equal(r.voice.peers().b, 'connecting');
  await r.advance(9999); assert.equal(pc.offers.length, 1);
  await r.advance(1); assert.equal(r.voice.peers().b, 'restarting'); assert.equal(pc.offers.length, 2); assert.equal(pc.offers[1].iceRestart, true);
  await r.advance(10000); assert.equal(r.voice.peers().b, 'failed'); assert.ok(pc.closed); assert.equal(last(r).peers.b, 'failed');
  await r.advance(60000); assert.equal(pc.offers.length, 2); assert.equal(r.pcs.length, 1, 'no reconnect loop');
});

test('connected clears the timer; a holder leaving closes that peer only', async () => {
  const r = rig({ ids: ['a', 'b', 'c'] }); await r.voice.join('listen'); await flush();
  const [b, c] = r.pcs; b.set('connected'); c.set('connected'); await r.advance(30000);
  assert.deepEqual(r.voice.peers(), { b: 'connected', c: 'connected' });
  r.view = { you: { id: 'a' }, voice: { ids: ['a', 'b'] } }; await r.advance(1000);
  assert.equal(c.closed, true); assert.equal(b.closed, false); assert.deepEqual(r.voice.peers(), { b: 'connected' });
  assert.equal(r.voice.level('b'), 0); assert.equal(r.voice.level('nobody'), 0);
});

// ---- fix round 1 ----
const FP = x => 'v=0\r\na=fingerprint:sha-256 ' + x + '\r\n';

test('I1: a click to unmute while the join prompt is open asks once; leave stops every track ever opened', async () => {
  const r = rig({ hold: ['gum'] }); const j = r.voice.join('mic'); await flush();
  const m = r.voice.setMuted(false); await flush();
  await r.release('gum'); await r.release('gum'); await j; await m; await flush();
  assert.equal(r.gumCalls, 1);
  r.voice.leave(); assert.ok(r.tracks.length >= 1); assert.ok(r.tracks.every(t => t.stopped));
});

test('I2: messages to one peer go out one at a time, in order', async () => {
  const r = rig({ hold: ['api'] }); await r.voice.join('listen'); await flush();
  r.pcs[0].onicecandidate({ candidate: { candidate: 'candidate:1' } }); r.pcs[0].onicecandidate({ candidate: null }); await flush();
  assert.deepEqual(r.sent.map(m => m.kind), ['offer'], 'ICE waits for the offer POST');
  await r.release('api'); assert.deepEqual(r.sent.map(m => m.kind), ['offer', 'ice']);
  await r.release('api'); assert.deepEqual(r.sent.map(m => [m.kind, m.data]), [['offer', 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n'], ['ice', 'candidate:1'], ['ice', '']]);
});

test('I2: ICE that arrives before its offer is applied after it', async () => {
  const r = rig({ me: 'b' }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'ice', data: 'candidate:early' }); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  assert.deepEqual(r.pcs[0].cands, [{ candidate: 'candidate:early', sdpMLineIndex: 0 }]);
});

test('I2: an offer that arrives while join is still waiting is answered once join completes', async () => {
  const r = rig({ me: 'b', hold: ['get'] }); const j = r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  assert.equal(r.pcs.length, 0);
  await r.release('get'); await j; await flush();
  assert.deepEqual(r.sent.map(m => [m.to, m.kind]), [['a', 'answer']]);
  assert.deepEqual(r.pcs[0].cfg.iceServers, [{ urls: 'stun:x' }]);
});

test('I3 answerer: an offer from a new remote connection replaces the old one; a rejected offer gets a fresh connection', async () => {
  const r = rig({ me: 'b' }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush(); r.pcs[0].set('connected');
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') + 'a=x\r\n' }); await flush();
  assert.equal(r.pcs.length, 1, 'same fingerprint: renegotiation on the same connection');
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('B') }); await flush();
  assert.equal(r.pcs.length, 2); assert.ok(r.pcs[0].closed); assert.equal(r.voice.peers().a, 'connecting');
  assert.deepEqual(r.sent.filter(m => m.kind === 'answer').length, 3);
  const q = rig({ me: 'b', srdFail: pc => pc === q.pcs[0] }); await q.voice.join('listen'); await flush();
  q.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  assert.equal(q.pcs.length, 2); assert.ok(q.pcs[0].closed); assert.deepEqual(q.sent.map(m => m.kind), ['answer']);
});

test('I3 offerer: an answer from a new remote connection or a rejected answer re-offers once, then failed', async () => {
  const r = rig({ srdFail: pc => pc === r.pcs[1] }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush(); r.pcs[0].set('connected');
  r.pcs[0].set('failed'); await flush(); // restart offer goes out on the old connection
  assert.equal(r.pcs[0].offers.length, 2);
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('B') }); await flush();
  assert.equal(r.pcs.length, 2); assert.ok(r.pcs[0].closed); assert.equal(r.pcs[1].offers.length, 1); assert.equal(r.voice.peers().b, 'connecting');
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('B') }); await flush();
  assert.equal(r.voice.peers().b, 'failed'); assert.ok(r.pcs[1].closed); assert.equal(r.pcs.length, 2, 'no loop');
  await r.advance(60000); assert.equal(r.pcs.length, 2);
});

test('a connection that stays disconnected for 3 s is restarted (the far side reloaded); a short blip is not', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  const pc = r.pcs[0]; r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush(); pc.set('connected');
  pc.set('disconnected'); await r.advance(2000); pc.set('connected'); await r.advance(5000);
  assert.equal(pc.offers.length, 1, 'a blip: no restart'); assert.equal(r.voice.peers().b, 'connected');
  pc.set('disconnected'); await r.advance(2999); assert.equal(pc.offers.length, 1);
  await r.advance(1); assert.equal(pc.offers.length, 2); assert.equal(pc.offers[1].iceRestart, true); assert.equal(r.voice.peers().b, 'restarting');
  r.voice.leave(); assert.equal(r.timers.length, 0);
});

test('knock: the answering side offers itself when no offer comes for 3 replans; an offer from the far side wins over the knock', async () => {
  const r = rig({ me: 'b' }); await r.voice.join('listen'); await flush();
  await r.advance(1999); assert.equal(r.pcs.length, 0, 'the lower id offers first');
  await r.advance(1); assert.equal(r.pcs.length, 1, 'knock on the third replan (about 2 s)'); assert.deepEqual(r.sent.map(m => [m.to, m.kind]), [['a', 'offer']]);
  await r.advance(5000); assert.equal(r.pcs.length, 1, 'one knock, not one per replan');
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  assert.equal(r.pcs.length, 2); assert.ok(r.pcs[0].closed); assert.deepEqual(r.sent.slice(-1).map(m => [m.to, m.kind]), [['a', 'answer']]);
  const q = rig({ me: 'b' }); await q.voice.join('listen'); await flush(); await q.advance(2000);
  q.signal({ type: 'rtc', from: 'a', kind: 'answer', data: FP('A') }); await flush(); q.pcs[0].set('connected');
  assert.deepEqual(q.voice.peers(), { a: 'connected' }); await q.advance(10000); assert.equal(q.pcs.length, 1);
});
test('the offering side answers a knock: a new connection from the far side replaces its stale one', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush(); r.pcs[0].set('connected');
  r.signal({ type: 'rtc', from: 'b', kind: 'offer', data: FP('B') }); await flush();
  assert.equal(r.pcs.length, 2); assert.ok(r.pcs[0].closed); assert.deepEqual(r.sent.slice(-1).map(m => [m.to, m.kind]), [['b', 'answer']]);
});

test('a peer that reloads twice: a replacement that reached connected can be replaced again', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  const reload = async (i, fpx) => { r.pcs[i].set('failed'); await flush(); r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP(fpx) }); await flush(); };
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush(); r.pcs[0].set('connected');
  await reload(0, 'B'); assert.equal(r.pcs.length, 2);
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('B') }); await flush(); r.pcs[1].set('connected');
  await reload(1, 'C'); assert.equal(r.pcs.length, 3, 'second reload gets a fresh connection'); assert.equal(r.voice.peers().b, 'connecting');
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('C') }); await flush();
  await reload(2, 'D'); // never reached connected
  assert.equal(r.voice.peers().b, 'failed', 'a replacement that never connected still gives up once'); assert.equal(r.pcs.length, 3);
});

// ---- final review fixes ----
test('F1: unmuting while our offer is in flight re-offers once the answer lands, so the far side hears us', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  const pc = r.pcs[0]; assert.equal(pc.signalingState, 'have-local-offer');
  await r.voice.setMuted(false); await flush();
  assert.equal(pc.offers.length, 1, 'not stable: no second offer yet');
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush();
  assert.equal(pc.offers.length, 2, 'the negotiated direction lacks send: offer again');
  assert.equal(pc.tx[0].offered, 'sendrecv');
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush();
  assert.equal(pc.offers.length, 2, 'sending now: no further offer');
});
test('F1: a listen-only answer that already sends nothing does not re-offer without a track', async () => {
  const r = rig(); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'b', kind: 'answer', data: FP('A') }); await flush();
  assert.equal(r.pcs[0].offers.length, 1);
});
test('F1: leaving during the unmute loop (replaceTrack rejects) settles quietly', async () => {
  const r = rig({ ids: ['a', 'b', 'c'] }); await r.voice.join('listen'); await flush();
  let left = 0; const rt = () => { if (!left++) r.voice.leave(); };
  r.pcs.forEach(pc => pc.tx.forEach(x => { x.sender.replaceTrack = async () => { rt(); throw new Error('closed'); }; }));
  await assert.doesNotReject(r.voice.setMuted(false));
  assert.ok(r.tracks.every(t => t.stopped)); assert.equal(last(r).mic, 'off');
});
const notJoined = (...ids) => ids.map(id => ({ id, avatar: { room: 'meet' } })); // in the room with a slot, still on the card
test('F2: no call to a holder who has not joined voice (no mic in the avatar); the call starts once they join', async () => {
  const r = rig({ ids: ['a', 'b', 'c'] }); r.view.members = [...notJoined('b'), { id: 'c', avatar: { room: 'meet', mic: 'on' } }];
  await r.voice.join('listen'); await flush();
  assert.deepEqual(r.sent.filter(m => m.kind === 'offer').map(m => m.to), ['c']);
  await r.advance(30000); assert.deepEqual(Object.keys(r.voice.peers()), ['c'], 'never marked failed: never called');
  r.view.members = [{ id: 'b', avatar: { room: 'meet', mic: 'listen' } }, { id: 'c', avatar: { room: 'meet', mic: 'on' } }]; await r.advance(1000);
  assert.equal(r.sent.filter(m => m.kind === 'offer' && m.to === 'b').length, 1); assert.equal(r.voice.peers().b, 'connecting');
});
test('F2: no knock to a lower holder who has not joined, but an offer from one is still answered', async () => {
  const r = rig({ me: 'b' }); r.view.members = notJoined('a');
  await r.voice.join('listen'); await flush(); await r.advance(10000);
  assert.equal(r.pcs.length, 0, 'no knock');
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  assert.deepEqual(r.sent.map(m => [m.to, m.kind]), [['a', 'answer']]);
});
test('F7: an offer (and its ICE) from a member not yet in our slot list waits for the next replan that lists them', async () => {
  const r = rig({ me: 'b', ids: ['b'] }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); r.signal({ type: 'rtc', from: 'a', kind: 'ice', data: 'candidate:q' }); await flush();
  assert.equal(r.pcs.length, 0);
  r.view.voice.ids = ['a', 'b']; await r.advance(1000);
  assert.equal(r.pcs.length, 1); assert.deepEqual(r.sent.map(m => [m.to, m.kind]), [['a', 'answer']]);
  assert.deepEqual(r.pcs[0].cands, [{ candidate: 'candidate:q', sdpMLineIndex: 0 }]);
});
test('F7: held signals expire after about 10 s and are dropped on leave', async () => {
  const r = rig({ me: 'b', ids: ['b'] }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await r.advance(11000);
  r.view.voice.ids = ['a', 'b']; r.view.members = notJoined('a'); await r.advance(1000);
  assert.equal(r.pcs.length, 0, 'expired');
  const q = rig({ me: 'b', ids: ['b'] }); await q.voice.join('listen'); await flush();
  q.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  q.voice.leave(); q.view.voice.ids = ['a', 'b']; q.view.members = notJoined('a'); await q.voice.join('listen'); await flush(); await q.advance(1000);
  assert.equal(q.pcs.length, 0, 'dropped on leave');
});

test('R4: the answering side unmuting while its answer is being made re-offers once it is stable', async () => {
  const r = rig({ me: 'b', hold: ['answer'] }); await r.voice.join('listen'); await flush();
  r.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush();
  const pc = r.pcs[0]; assert.equal(pc.signalingState, 'have-remote-offer');
  await r.voice.setMuted(false); await flush(); assert.equal(pc.offers.length, 0, 'not stable: no offer yet');
  await r.release('answer');
  assert.deepEqual(r.sent.map(m => m.kind), ['answer', 'offer'], 'the answer went out recvonly: offer again');
  r.signal({ type: 'rtc', from: 'a', kind: 'answer', data: FP('A') }); await flush();
  assert.equal(pc.offers.length, 1, 'sending now: no further offer');
  const q = rig({ me: 'b' }); await q.voice.join('listen'); await flush(); // listen only: nothing to send, no offer
  q.signal({ type: 'rtc', from: 'a', kind: 'offer', data: FP('A') }); await flush(); assert.deepEqual(q.sent.map(m => m.kind), ['answer']);
});
