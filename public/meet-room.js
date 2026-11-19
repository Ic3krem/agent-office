// Meeting-room UI (2.1): the consent card, the room list, mute (button and M key), the "In the meeting room" indicator and the
// banners ("Voice is full", old host). It drives MeetVoice (the WebRTC engine) from the party view; the microphone opens only
// inside a click or key press. The pure helpers and the controller (create) load under Node; mount() is browser-only.
// The join choice lives in sessionStorage ('meet.choice'), never on disk. Classic script: root.MeetRoom.
(function (root) {
  'use strict';
  const VOICE_SLOTS = 8; // party/protocol.mjs LIMITS.voice (a test keeps them equal)
  const LOUD = 0.08, KEY = 'meet.choice', FULL = 'Voice is full', OLD = 'The host needs TiroAgents 2.1 for voice';
  const TEXT = { speaking: 'speaking', on: 'on', muted: 'muted', listen: 'listen only', out: 'not joined' };
  // no mic in a member's avatar: in the room but not in the call (still on the card); never called, so never "cannot connect"
  const rowState = ({ mic, level, peer } = {}) => (!mic ? 'out' : peer === 'failed' ? 'failed' : mic === 'muted' ? 'muted' : mic === 'on' ? ((level || 0) > LOUD ? 'speaking' : 'on') : 'listen');
  // What entering the room should do, from the party view: nothing outside a party, a banner, the card, or a quiet re-join.
  // No slot: "Voice is full" only when every slot is taken; otherwise 'wait' (ours is a round trip away on entry).
  const entryAction = ({ inParty, support, mine, choice, holders = 0 }) => (!inParty ? 'none' : support === 'host-old' ? 'old-host' : !mine ? (holders >= VOICE_SLOTS ? 'full' : 'wait') : choice === 'mic' ? 'rejoin-muted' : choice === 'listen' ? 'rejoin-listen' : 'card');

  // Reactions (2.1): wire value = index into EMOTES (party/protocol.mjs); shown 3 s, never stored. One per person, the newest.
  const EMOTES = ['wave', 'clap', 'laugh', 'heart', 'thumbs', 'party'], EMOTE_MS = 3000;
  const activeEmotes = (list, now) => { const by = new Map(); for (const e of list || []) if (now - e.at < EMOTE_MS && (!by.has(e.id) || e.at >= by.get(e.id).at)) by.set(e.id, e); return [...by.values()]; };
  // Who came in and who left between two snapshots of the room's member ids (null before the first one: no events).
  const arrivals = (prev, cur) => (prev ? { in: cur.filter(i => !prev.includes(i)), out: prev.filter(i => !cur.includes(i)) } : { in: [], out: [] });
  // The chime follows the music setting (BgMusic mode 'off' or volume 0 = silent; there is no other sound setting) and reduced motion.
  const chimeOk = ({ reduced, mode, volume } = {}) => !reduced && typeof mode === 'string' && mode !== 'off' && typeof volume === 'number' && volume > 0; // no music state: silent
  // A key press in the room: 'mute' | 'hand' | reaction index | null. Held keys never repeat (M would re-toggle and re-ask for the mic).
  function keyAction(e, joined, cardOn) {
    const k = e.key, n = /^[1-6]$/.test(k) ? +k - 1 : -1, act = k === 'm' || k === 'M' ? 'mute' : k === 'h' || k === 'H' ? 'hand' : n >= 0 ? n : null;
    const t = e.target, tag = (t && t.tagName) || '';
    if (act === null || e.repeat || !joined || cardOn || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return null;
    return act;
  }

  // o: { voice(onState) -> engine, storage, toast(text), ui: { card(bool), banner(text|null), render() }, music: { hold(bool), duck(bool) }, now?, sendEmote(i), world?: { door(), chime() } }
  function create(o) {
    let party = null, joined = false, vs = { mic: 'off', reason: null, peers: {} }, lastReason = null, cardUp = false, hand = false, emotes = [], seen = null;
    const now = o.now || Date.now;
    const engine = o.voice(s => { vs = s; if (s.reason && s.reason !== lastReason) o.toast(s.reason === 'denied' ? 'Microphone blocked. You are in listen only mode.' : 'No microphone found. You are in listen only mode.'); lastReason = s.reason; o.ui.render(); });
    const choice = () => { try { const c = o.storage.getItem(KEY); return c === 'mic' || c === 'listen' ? c : null; } catch (e) { return null; } };
    const mic = () => (!joined || vs.mic === 'off' ? null : vs.mic === 'listen' && choice() === 'mic' && !vs.reason ? 'muted' : vs.mic);
    function join(mode) { joined = true; o.music.hold(true); o.music.duck(true); engine.join(mode); o.ui.render(); }
    function leave() {
      if (!joined) return;
      joined = false; engine.leave(); o.music.duck(false); o.music.hold(false); vs = { mic: 'off', reason: null, peers: {} }; lastReason = null; hand = false; emotes = []; seen = null; o.ui.render();
    }
    function onSnapshot(p) {
      party = p || null; const v = (p && p.voice) || {}, inParty = !!(p && p.connected);
      if (!inParty) { leave(); cardUp = false; o.ui.card(false); o.ui.banner(null); return; }
      if (!p.live) return o.ui.render(); // support reads 'host-old' until the first hello: decide nothing yet
      const act = entryAction({ inParty, support: v.support, mine: !!v.mine, choice: choice(), holders: Array.isArray(v.ids) ? v.ids.length : 0 });
      if (joined && (act === 'full' || act === 'wait' || act === 'old-host')) leave(); // a lost slot ends voice; re-joined muted when it is back
      if (!joined) {
        if (act === 'rejoin-muted') { join('listen'); o.toast('Muted. Press M to talk'); } // never reopens the microphone without a click
        else if (act === 'rejoin-listen') join('listen');
      }
      if (joined) { const ids = (p.members || []).filter(m => m.avatar && m.avatar.room === 'meet').map(m => m.id), d = arrivals(seen, ids); seen = ids; if (d.in.length || d.out.length) { o.world && o.world.door(); o.world && o.world.chime(); } }
      const wantCard = act === 'card' && !joined; if (wantCard !== cardUp) { cardUp = wantCard; o.ui.card(wantCard); } o.ui.banner(act === 'old-host' ? OLD : act === 'full' ? FULL : null); o.ui.render();
    }
    function choose(c) { // the card's two join buttons: called inside the click
      try { o.storage.setItem(KEY, c); } catch (e) {}
      cardUp = false; o.ui.card(false); join(c === 'mic' ? 'mic' : 'listen');
    }
    const toggleMute = () => { if (joined) engine.setMuted(mic() === 'on'); };
    function emote(i) { // key 1-6 or a button: draw it now (the server does not echo it back), then send; a refusal stays quiet
      if (!joined || !Number.isInteger(i) || i < 0 || i >= EMOTES.length) return;
      emotes.push({ id: 'you', emote: i, at: now() }); emotes = activeEmotes(emotes, now()); o.ui.render();
      try { Promise.resolve(o.sendEmote(i)).catch(() => {}); } catch (e) {}
    }
    function onEmote(id, i) { if (!joined || !Number.isInteger(i) || i < 0 || i >= EMOTES.length || !id) return; emotes.push({ id, emote: i, at: now() }); emotes = activeEmotes(emotes, now()); o.ui.render(); }
    const toggleHand = () => { if (joined) { hand = !hand; o.ui.render(); } };
    // what the world draws over the avatars; ids are 'you' or a member id
    function fx() {
      if (!joined || !party || !party.you) return { emotes: [], hands: [], levels: {} };
      const mem = (party.members || []).filter(m => m.avatar && m.avatar.room === 'meet'), levels = { you: engine.level(party.you.id) };
      for (const m of mem) levels[m.id] = engine.level(m.id);
      return { emotes: activeEmotes(emotes, now()), hands: (hand ? ['you'] : []).concat(mem.filter(m => m.avatar.hand).map(m => m.id)), levels };
    }
    function rows() {
      if (!party || !party.you) return [];
      const mk = (id, name, m, peer) => { const level = engine.level(id), state = rowState({ mic: m, level, peer }); return { id, name, state, level, hand: id === party.you.id ? hand : !!(party.members || []).some(m => m.id === id && m.avatar && m.avatar.hand), text: state === 'failed' ? "Can't connect to " + name + ': this network blocks direct calls' : TEXT[state] }; };
      return [mk(party.you.id, 'You', mic() || 'listen')].concat((party.members || []).filter(m => m.avatar && m.avatar.room === 'meet').map(m => mk(m.id, m.name, m.avatar.mic, vs.peers[m.id])));
    }
    const indicator = () => (joined ? 'In the meeting room · ' + { on: 'mic on', muted: 'muted', listen: 'listen only' }[mic() || 'listen'] : '');
    function dispose() { leave(); cardUp = false; o.ui.card(false); o.ui.banner(null); }
    return { onSnapshot, choose, toggleMute, emote, onEmote, toggleHand, fx, hand: () => joined && hand, rows, indicator, mic, dispose, joined: () => joined, engine };
  }

  // ---- browser only ----
  let cur = null;
  function h(tag, attrs, ...kids) {
    const e = root.document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }
  const btn = (label, on, extra) => h('button', Object.assign({ type: 'button', class: 'hud-btn', onclick: on }, extra || {}), label);
  // o: { api, getJ, es (the page's EventSource), toast(text), onLeave() (leaves the scene), onHand() (the hand changed) }. Rendered pieces: cur.el = { card, panel, banner, indicator, list, controls }.
  function mount(o) {
    if (cur || !root.document) return cur;
    const doc = root.document, store = (() => { try { return root.sessionStorage; } catch (e) { return null; } })();
    const el = {}; let latest = null; const party = () => latest;
    el.banner = h('div', { class: 'hud-item', role: 'status', hidden: true });
    el.indicator = h('div', { class: 'hud-dim', 'data-meet-indicator': 1 });
    el.list = h('div', { 'data-meet-list': 1, style: 'display:flex;flex-direction:column;gap:4px' });
    el.mute = btn('Unmute', () => c.toggleMute(), { 'data-meet-mute': 1 });
    const GLYPH = ['\u{1F44B}', '\u{1F44F}', '\u{1F602}', '\u2764\uFE0F', '\u{1F44D}', '\u{1F389}'];
    const hand = () => { c.toggleHand(); if (o.onHand) o.onHand(); }; // the page posts the avatar now, not on its next 1 s tick
    el.hand = btn('Raise hand (H)', hand, { 'data-meet-hand': 1 });
    el.emotes = h('div', { class: 'hud-row', 'data-meet-emotes': 1 }, EMOTES.map((n, i) => btn(GLYPH[i], () => c.emote(i), { 'aria-label': n + ' (' + (i + 1) + ')', title: n + ' (' + (i + 1) + ')', 'data-meet-emote': i })));
    el.controls = h('div', { class: 'hud-row', 'data-meet-controls': 1 }, el.mute, el.hand, btn('Leave room', () => o.onLeave && o.onLeave()));
    el.panel = h('div', { class: 'hud-panel', role: 'region', 'aria-label': 'Meeting room', style: 'top:auto;bottom:12px;right:12px;display:none;gap:8px;flex-direction:column;z-index:5200' }, el.banner, el.indicator, el.list, el.emotes, el.controls);
    el.card = h('div', { class: 'hud-panel', role: 'dialog', 'aria-label': 'Meeting room', hidden: true, style: 'top:50%;left:50%;right:auto;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 24px));gap:10px;z-index:5400' },
      h('h2', null, 'Meeting room'),
      h('div', null, 'People here talk by voice. Your app connects directly to theirs, so they can see your IP address. No audio is recorded or sent to a server.'),
      h('div', { class: 'hud-row' }, btn('Join with microphone', () => c.choose('mic'), { 'data-meet-choice': 'mic' }), btn('Listen only', () => c.choose('listen'), { 'data-meet-choice': 'listen' }), btn('Leave', () => o.onLeave && o.onLeave())));
    doc.body.append(el.panel, el.card);
    let cardOn = false, bannerText = null, timer = 0;
    const ui = {
      // modal only while up: the world ignores its keys while any modal dialog exists, even a hidden one
      card: v => { const was = cardOn; cardOn = !!v; el.card.hidden = !v; if (v) el.card.setAttribute('aria-modal', 'true'); else el.card.removeAttribute('aria-modal'); if (v && !was) { const b = el.card.querySelector('button'); b && b.focus({ preventScroll: true }); } },
      banner: t => { bannerText = t; ui.render(); },
      render() {
        const j = c.joined(), show = j || !!bannerText;
        el.panel.style.display = show ? 'flex' : 'none';
        el.banner.hidden = !bannerText; el.banner.textContent = bannerText || '';
        el.indicator.hidden = !j; el.controls.hidden = !j; el.emotes.hidden = !j; el.list.hidden = !j; el.indicator.textContent = c.indicator();
        const m = c.mic(); el.mute.textContent = m === 'on' ? 'Mute (M)' : m === 'muted' ? 'Unmute (M)' : 'Turn on microphone (M)'; el.mute.setAttribute('aria-pressed', String(m === 'muted')); el.hand.setAttribute('aria-pressed', String(c.hand())); el.hand.textContent = c.hand() ? 'Lower hand (H)' : 'Raise hand (H)';
        if (root.OfficeWorld && root.OfficeWorld.setFx) root.OfficeWorld.setFx(c.fx());
        if (j && !timer) timer = root.setInterval(ui.render, 120); else if (!j && timer) { root.clearInterval(timer); timer = 0; }
        el.list.replaceChildren(...(j ? c.rows() : []).map(r => h('div', { class: 'hud-item', 'data-state': r.state, style: 'display:flex;gap:8px;align-items:center;' + (r.state === 'speaking' ? 'border-color:#5fd38d;box-shadow:0 0 0 2px rgba(95,211,141,.5)' : '') }, h('b', null, r.name), r.hand ? h('span', { 'aria-label': 'hand raised' }, '\u270B') : null, h('span', { class: 'hud-dim' }, r.text))));
      },
    };
    let actx = null;
    function chime() { // two soft notes; one shared AudioContext (closed on unmount)
      try {
        const bm = root.BgMusic && root.BgMusic.state ? root.BgMusic.state() : {}, w = root.OfficeWorld;
        if (!chimeOk({ reduced: !!(w && w.frameState && w.frameState().reduced), mode: bm.mode, volume: bm.volume })) return;
        actx = actx || new (root.AudioContext || root.webkitAudioContext)();
        [659, 880].forEach((f, i) => { const t = actx.currentTime + i * 0.12, os = actx.createOscillator(), gn = actx.createGain(); os.type = 'sine'; os.frequency.value = f; gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.06, t + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); os.connect(gn); gn.connect(actx.destination); os.start(t); os.stop(t + 0.4); });
      } catch (e) {}
    }
    const c = create({
      voice: onState => root.MeetVoice.create({ api: o.api, get: o.getJ, view: () => party(), onSignal: fn => o.es.addEventListener('signal', e => { try { fn(JSON.parse(e.data)); } catch (x) {} }), onState }),
      storage: store || { getItem: () => null, setItem() {} }, toast: o.toast, ui,
      sendEmote: i => o.api('/api/party/emote', { emote: i }),
      world: {
        door: () => root.OfficeWorld && root.OfficeWorld.doorEvent && root.OfficeWorld.doorEvent(),
        chime: () => chime(),
      },
      music: { hold: b => root.BgMusic && root.BgMusic.hold(b), duck: b => root.PartyMusic && root.PartyMusic.duck(b) },
    });
    const onKey = e => {
      const a = keyAction(e, c.joined(), cardOn);
      if (a === null) return;
      e.preventDefault(); if (a === 'mute') c.toggleMute(); else if (a === 'hand') hand(); else c.emote(a);
    };
    root.addEventListener('keydown', onKey);
    o.es.addEventListener('signal', e => { try { const d = JSON.parse(e.data); if (d && d.type === 'emote') c.onEmote(d.id, d.emote); } catch (x) {} });
    root.addEventListener('pagehide', () => c.dispose());
    cur = { el, controller: c, setParty: p => { latest = p; c.onSnapshot(p); }, unmount() { c.dispose(); if (root.OfficeWorld && root.OfficeWorld.setFx) root.OfficeWorld.setFx(null); if (actx) { actx.close().catch(() => {}); actx = null; } root.removeEventListener('keydown', onKey); el.panel.remove(); el.card.remove(); cur = null; } };
    return cur;
  }
  root.MeetRoom = { VOICE_SLOTS, rowState, entryAction, activeEmotes, arrivals, chimeOk, keyAction, EMOTES, create, mount,
    hand: () => !!(cur && cur.controller.hand()), // for the avatar post: true only while raised in the room
    onSnapshot: p => { if (cur) cur.setParty(p); }, // the page calls this with every snapshot's party
    mic: () => (cur ? cur.controller.mic() : null), // for the avatar: 'on' | 'muted' | 'listen' | null (null outside the room)
    unmount: () => { if (cur) cur.unmount(); }, current: () => cur };
})(globalThis);
