import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('./public/meet-room.js', import.meta.url), 'utf8'), { filename: 'meet-room.js' });
const M = globalThis.MeetRoom;

test('rowState: not joined (no mic) first, then a failed peer, then listen, muted, on, speaking above 0.08', () => {
  assert.equal(M.rowState({ peer: 'failed' }), 'out', 'a member still on the card is never "cannot connect"');
  assert.equal(M.rowState({ mic: 'on', level: 0.9, peer: 'failed' }), 'failed');
  assert.equal(M.rowState({ mic: 'listen', level: 0.9, peer: 'connected' }), 'listen');
  assert.equal(M.rowState({ mic: 'muted', level: 0.9 }), 'muted');
  assert.equal(M.rowState({ mic: 'on', level: 0.02 }), 'on');
  assert.equal(M.rowState({ mic: 'on', level: 0.08 }), 'on');
  assert.equal(M.rowState({ mic: 'on', level: 0.3 }), 'speaking');
  assert.equal(M.rowState({}), 'out');
});

test('entryAction: every entry case', () => {
  const a = o => M.entryAction({ inParty: true, support: 'ok', mine: true, choice: null, holders: 1, ...o });
  assert.equal(a({ inParty: false }), 'none');
  assert.equal(a({ inParty: false, support: 'host-old' }), 'none');
  assert.equal(a({ support: 'host-old' }), 'old-host');
  // no slot yet: "Voice is full" only when all 8 slots are taken; otherwise wait quietly for our own (on entry it takes a round trip)
  assert.equal(a({ mine: false }), 'wait');
  assert.equal(a({ mine: false, choice: 'mic', holders: 7 }), 'wait');
  assert.equal(a({ mine: false, holders: 8 }), 'full');
  assert.equal(a({ mine: false, choice: 'mic', holders: 8 }), 'full');
  assert.equal(a({}), 'card');
  assert.equal(a({ choice: 'mic' }), 'rejoin-muted');
  assert.equal(a({ choice: 'listen' }), 'rejoin-listen');
});

// ---- the controller, driven with fakes ----
function rig({ choice = null } = {}) {
  const r = { calls: [], toasts: [], ui: { card: false, banner: null }, store: choice ? { 'meet.choice': choice } : {}, emit: null, engine: null, t: 1000, sent: [], reject: false };
  r.engine = { join: m => r.calls.push('join:' + m), setMuted: b => r.calls.push('muted:' + b), leave: () => r.calls.push('leave'), peers: () => ({}), level: () => 0 };
  r.room = M.create({
    voice: onState => { r.emit = onState; return r.engine; },
    storage: { getItem: k => r.store[k] ?? null, setItem: (k, v) => { r.store[k] = v; } },
    toast: t => r.toasts.push(t), ui: { card: v => { r.ui.card = v; }, banner: t => { r.ui.banner = t; }, render() {} },
    music: { hold: b => r.calls.push('hold:' + b), duck: b => r.calls.push('duck:' + b) },
    now: () => r.t, sendEmote: i => { r.sent.push(i); return r.reject ? Promise.reject(new Error('429')) : Promise.resolve({ ok: true }); },
    world: { door: () => r.calls.push('door'), chime: () => r.calls.push('chime') },
  });
  return r;
}
const party = (o = {}) => ({ connected: true, live: true, you: { id: 'me' }, members: [], voice: { support: 'ok', ids: ['me'], mine: true }, ...o });

test('no choice yet: the card shows, nothing is captured or joined', () => {
  const r = rig(); r.room.onSnapshot(party());
  assert.equal(r.ui.card, true); assert.deepEqual(r.calls, []);
});
test('card buttons: microphone joins with mic inside the click, listen only joins listen', () => {
  const r = rig(); r.room.onSnapshot(party()); r.room.choose('mic');
  assert.deepEqual(r.calls, ['hold:true', 'duck:true', 'join:mic']); assert.equal(r.store['meet.choice'], 'mic'); assert.equal(r.ui.card, false);
  const l = rig(); l.room.onSnapshot(party()); l.room.choose('listen');
  assert.deepEqual(l.calls, ['hold:true', 'duck:true', 'join:listen']); assert.equal(l.store['meet.choice'], 'listen');
});
test('re-entry after a microphone choice: listen, shown muted, toast, first unmute opens the mic', () => {
  const r = rig({ choice: 'mic' }); r.room.onSnapshot(party());
  assert.deepEqual(r.calls, ['hold:true', 'duck:true', 'join:listen']); assert.equal(r.ui.card, false);
  r.emit({ mic: 'listen', reason: null, peers: {} });
  assert.equal(r.room.mic(), 'muted'); assert.deepEqual(r.toasts, ['Muted. Press M to talk']);
  r.room.toggleMute(); assert.equal(r.calls.at(-1), 'muted:false');
  r.emit({ mic: 'on', reason: null, peers: {} }); assert.equal(r.room.mic(), 'on');
  r.room.toggleMute(); assert.equal(r.calls.at(-1), 'muted:true');
});
test('re-entry after listen only: joins listening, no toast', () => {
  const r = rig({ choice: 'listen' }); r.room.onSnapshot(party()); r.emit({ mic: 'listen', reason: null, peers: {} });
  assert.equal(r.room.mic(), 'listen'); assert.deepEqual(r.toasts, []);
});
test('a denied microphone falls back to listen only and says so', () => {
  const r = rig(); r.room.onSnapshot(party()); r.room.choose('mic'); r.emit({ mic: 'listen', reason: 'denied', peers: {} });
  assert.equal(r.room.mic(), 'listen'); assert.match(r.toasts[0], /listen only/i);
});
test('old host: banner, no card, no join', () => {
  const r = rig(); r.room.onSnapshot(party({ voice: { support: 'host-old', ids: [], mine: false } }));
  assert.equal(r.ui.banner, 'The host needs TiroAgents 2.1 for voice'); assert.equal(r.ui.card, false); assert.deepEqual(r.calls, []);
});
test('not live yet: the old-host banner is not shown', () => {
  const r = rig(); r.room.onSnapshot(party({ live: false, voice: { support: 'host-old', ids: [], mine: false } }));
  assert.equal(r.ui.banner, null); assert.equal(r.ui.card, false);
});
test('VOICE_SLOTS matches the party protocol', async () => {
  assert.equal(M.VOICE_SLOTS, (await import('./party/protocol.mjs')).LIMITS.voice);
});
test('entering: no banner while our slot is on its way (F4)', () => {
  const r = rig(); r.room.onSnapshot(party({ voice: { support: 'ok', ids: ['x'], mine: false } }));
  assert.equal(r.ui.banner, null); assert.equal(r.ui.card, false); assert.deepEqual(r.calls, []);
  r.room.onSnapshot(party()); assert.equal(r.ui.card, true);
});
test('no slot: "Voice is full", then joins automatically when the slot arrives, never opening the mic', () => {
  const r = rig({ choice: 'mic' }); r.room.onSnapshot(party({ voice: { support: 'ok', ids: ['1', '2', '3', '4', '5', '6', '7', '8'], mine: false } }));
  assert.equal(r.ui.banner, 'Voice is full'); assert.deepEqual(r.calls, []);
  r.room.onSnapshot(party()); assert.deepEqual(r.calls, ['hold:true', 'duck:true', 'join:listen']); assert.equal(r.ui.banner, null);
});
test('leaving: the party ending, a kick, a lost slot or the scene closing leaves at once', () => {
  const cases = { 'party ended': { connected: false }, 'lost slot': { voice: { support: 'ok', ids: [], mine: false } }, kicked: null };
  for (const [name, snap] of Object.entries(cases)) {
    const r = rig({ choice: 'listen' }); r.room.onSnapshot(party()); r.emit({ mic: 'listen', reason: null, peers: {} });
    r.calls.length = 0; r.room.onSnapshot(snap === null ? null : party(snap));
    assert.deepEqual(r.calls, ['leave', 'duck:false', 'hold:false'], name); assert.equal(r.room.mic(), null, name);
  }
  const r = rig({ choice: 'listen' }); r.room.onSnapshot(party()); r.calls.length = 0; r.room.dispose();
  assert.deepEqual(r.calls, ['leave', 'duck:false', 'hold:false']);
});
test('rows: people in the room with their state, a failed peer says why', () => {
  const r = rig({ choice: 'mic' }); r.engine.level = id => (id === 'b' ? 0.5 : 0);
  r.room.onSnapshot(party({ members: [{ id: 'b', name: 'Bea', avatar: { room: 'meet', mic: 'on' } }, { id: 'c', name: 'Cy', avatar: { room: 'meet', mic: 'on' } }, { id: 'd', name: 'Di', avatar: { room: 'town' } }, { id: 'e', name: 'Ed', avatar: { room: 'meet', mic: 'listen' } }, { id: 'f', name: 'Flo', avatar: { room: 'meet' } }] }));
  r.emit({ mic: 'listen', reason: null, peers: { c: 'failed', f: 'failed' } });
  const rows = r.room.rows();
  assert.deepEqual(rows.map(x => [x.name, x.state, x.text]), [
    ['You', 'muted', 'muted'], ['Bea', 'speaking', 'speaking'], ['Cy', 'failed', "Can't connect to Cy: this network blocks direct calls"], ['Ed', 'listen', 'listen only'], ['Flo', 'out', 'not joined']]);
});
test('indicator text follows the state', () => {
  const r = rig({ choice: 'listen' }); r.room.onSnapshot(party()); r.emit({ mic: 'listen', reason: null, peers: {} });
  assert.equal(r.room.indicator(), 'In the meeting room · listen only'); r.emit({ mic: 'on', reason: null, peers: {} });
  assert.equal(r.room.indicator(), 'In the meeting room · mic on');
});
test('the card is raised once: later snapshots do not re-raise it (so focus is not pulled back)', () => {
  const r = rig(); let ups = 0; const card = r.ui; // count ui.card(true) calls through a wrapped rig
  const room = M.create({ voice: () => r.engine, storage: { getItem: () => null, setItem() {} }, toast() {}, music: { hold() {}, duck() {} }, ui: { card: v => { if (v) ups++; }, banner() {}, render() {} } });
  room.onSnapshot(party()); room.onSnapshot(party()); room.onSnapshot(party({ members: [{ id: 'b', name: 'Bea', avatar: { room: 'meet', mic: 'on' } }] }));
  assert.equal(ups, 1);
});

test('activeEmotes: gone at exactly 3000 ms, newest per person wins', () => {
  const L = [{ id: 'a', emote: 0, at: 1000 }, { id: 'a', emote: 2, at: 2000 }, { id: 'b', emote: 1, at: 1000 }, { id: 'c', emote: 5, at: 500 }];
  assert.deepEqual(M.activeEmotes(L, 3999).map(e => e.id + e.emote).sort(), ['a2', 'b1']);
  assert.deepEqual(M.activeEmotes(L, 4000).map(e => e.id + e.emote), ['a2']); // b expired at exactly 3000 ms old
  assert.deepEqual(M.activeEmotes(L, 5000), []);
  assert.deepEqual(M.activeEmotes(null, 1), []);
});
test('arrivals and chimeOk', () => {
  assert.deepEqual(M.arrivals(null, ['a']), { in: [], out: [] });
  assert.deepEqual(M.arrivals(['a', 'b'], ['b', 'c']), { in: ['c'], out: ['a'] });
  assert.equal(M.chimeOk({ reduced: false, mode: 'builtin', volume: 0.4 }), true);
  assert.equal(M.chimeOk({ reduced: true, mode: 'builtin', volume: 0.4 }), false);
  assert.equal(M.chimeOk({ reduced: false, mode: 'off', volume: 0.4 }), false);
  assert.equal(M.chimeOk({ reduced: false, mode: 'builtin', volume: 0 }), false);
  assert.equal(M.chimeOk({ reduced: false }), false, 'no music state: silent');
  assert.equal(M.chimeOk(), false);
});
test('keyAction: M, H, 1-6; ignores repeats, typing, modifiers, the card and outside the room', () => {
  const k = (key, x = {}) => M.keyAction(Object.assign({ key, target: { tagName: 'BODY' } }, x), true, false);
  assert.deepEqual([k('m'), k('M'), k('h'), k('1'), k('6'), k('7'), k('x')], ['mute', 'mute', 'hand', 0, 5, null, null]);
  assert.equal(k('m', { repeat: true }), null, 'holding M does not auto-repeat the toggle');
  assert.equal(k('h', { repeat: true }), null); assert.equal(k('2', { repeat: true }), null);
  assert.equal(k('m', { target: { tagName: 'INPUT' } }), null); assert.equal(k('m', { ctrlKey: true }), null);
  assert.equal(M.keyAction({ key: 'm', target: {} }, false, false), null); assert.equal(M.keyAction({ key: 'm', target: {} }, true, true), null);
});
test('reactions: own draws at once and is sent, incoming shows 3 s, a refused send stays quiet, nothing outside the room', async () => {
  const r = rig({ choice: 'listen' }); r.room.emote(1); assert.deepEqual(r.sent, []); // not in the room yet
  r.room.onSnapshot(party()); assert.equal(r.room.joined(), true);
  r.room.emote(3); assert.deepEqual(r.sent, [3]); assert.deepEqual(r.room.fx().emotes, [{ id: 'you', emote: 3, at: 1000 }]);
  r.reject = true; r.room.emote(9); r.room.emote(2); await new Promise(x => setImmediate(x)); // out of range ignored; rejection swallowed
  assert.deepEqual(r.sent, [3, 2]);
  r.room.onEmote('b', 4); assert.equal(r.room.fx().emotes.find(e => e.id === 'b').emote, 4);
  r.t = 3999; assert.deepEqual(r.room.fx().emotes.map(e => e.id + e.emote).sort(), ['b4', 'you2']); // one per person, the newest
  r.t = 4000; assert.equal(r.room.fx().emotes.length, 0);
});
test('hand: toggles, shows in rows and fx, cleared on leaving', () => {
  const r = rig({ choice: 'listen' }); r.room.onSnapshot(party());
  r.room.toggleHand(); assert.equal(r.room.hand(), true); assert.deepEqual(r.room.fx().hands, ['you']); assert.equal(r.room.rows()[0].hand, true);
  r.room.onSnapshot(party({ members: [{ id: 'b', name: 'Bea', avatar: { room: 'meet', mic: 'on', hand: true } }] }));
  assert.deepEqual(r.room.fx().hands, ['you', 'b']); assert.equal(r.room.rows()[1].hand, true);
  r.room.onSnapshot(party({ connected: false })); assert.equal(r.room.hand(), false);
  r.room.toggleHand(); assert.equal(r.room.hand(), false); // not joined: no toggle
});
test('door and chime on someone entering or leaving, not on our own entry', () => {
  const r = rig({ choice: 'listen' }); const m = id => ({ id, name: id, avatar: { room: 'meet', mic: 'on' } });
  r.room.onSnapshot(party({ members: [m('b')] })); assert.ok(!r.calls.includes('door')); // baseline
  r.room.onSnapshot(party({ members: [m('b'), m('c')] })); assert.deepEqual(r.calls.filter(c => c === 'door' || c === 'chime'), ['door', 'chime']);
  r.room.onSnapshot(party({ members: [m('c')] })); assert.equal(r.calls.filter(c => c === 'door').length, 2);
});
test('consent card wording: no audio is recorded (setup data does pass the party server)', () => {
  const src = fs.readFileSync(new URL('./public/meet-room.js', import.meta.url), 'utf8');
  assert.match(src, /so they can see your IP address\. No audio is recorded or sent to a server\./); assert.doesNotMatch(src, /Nothing is recorded/);
});
