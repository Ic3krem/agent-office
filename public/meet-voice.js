// Meeting-room voice (2.1): direct WebRTC audio between the apps holding a voice slot (a mesh of at most 8). Setup messages go
// through the local server (/api/party/rtc out, the stream's `signal` event in); nothing is recorded. The lower member id
// offers; one audio m-line per connection (BUNDLE), so ICE candidates travel as bare `candidate:` lines for m-line 0.
// The mic is opened only by join('mic') or the first setMuted(false), both called from a click. Classic script:
// root.MeetVoiceCore (pure, loads under Node) and root.MeetVoice (browser wiring; every browser API can be injected).
(function (root) {
  'use strict';
  const CONNECT_MS = 10000, REPLAN_MS = 1000, DISCONNECT_MS = 3000, KNOCK = 3, HOLD = 10; // disconnected this long = the far side is gone (it reloaded): restart
  const shouldOffer = (myId, otherId) => myId < otherId;
  // Without a slot nothing is kept: every connection closes.
  function plan(myId, slotIds, connectedIds) {
    const holders = slotIds.includes(myId) ? slotIds : [];
    return { connect: holders.filter(id => id !== myId && !connectedIds.includes(id)), close: connectedIds.filter(id => !holders.includes(id)) };
  }
  const NEXT = {
    start: { new: 'connecting' },
    connected: { new: 'connected', connecting: 'connected', restarting: 'connected' },
    timeout: { connecting: 'restarting', restarting: 'failed' },
    'ice-failed': { connecting: 'restarting', restarting: 'failed', connected: 'restarting' },
  };
  const nextState = (state, event) => (event === 'close' ? 'closed' : (NEXT[event] && NEXT[event][state]) || state);

  // ---- browser wiring ----
  // o: { api(path, body) -> Promise (the page's nonce-carrying POST), get(path) -> Promise<json> (the page's GET),
  //      view() -> the party view ({ you: { id }, voice: { ids } }), onSignal(fn) (fn gets each parsed `signal` message),
  //      onState(s) }, plus optional fakes for RTCPeerConnection, getUserMedia, AudioContext, MediaStream, Audio, timers, addEventListener.
  function create(o) {
    const fn = k => o[k] || ((...a) => root[k](...a));
    const PC = o.RTCPeerConnection || root.RTCPeerConnection, AC = o.AudioContext || root.AudioContext, MS = o.MediaStream || root.MediaStream;
    const gum = o.getUserMedia || (c => root.navigator.mediaDevices.getUserMedia(c)), newAudio = o.Audio || (() => new root.Audio());
    const setT = fn('setTimeout'), clearT = fn('clearTimeout'), setI = fn('setInterval'), clearI = fn('clearInterval');
    const onState = o.onState || (() => {});
    let mic = 'off', reason = null, gen = 0, tick = null, iceServers = [], myId = '', stream = null, track = null, localAn = null, ctx = null, opening = false;
    let peers = {}, sendQ = {}, waiting = {}, early = [], quiet = {}, pend = []; // waiting: ICE per holder before its offer; early: signals before join finished
    // pend: signals from a member our slot list does not show yet (signals are immediate, snapshots lag up to 3 s): HOLD replans at most
    const KEEP = 64, fp = sdp => (/^a=fingerprint:.*$/m.exec(sdp) || [''])[0]; // a new fingerprint = a new remote connection

    const peerStates = () => Object.fromEntries(Object.values(peers).map(p => [p.id, p.state]));
    const emit = () => onState({ mic, reason, peers: peerStates() });
    // One peer's messages go out one POST at a time so the server relays them in order (offer before its ICE).
    const send = (to, kind, data) => (sendQ[to] = (sendQ[to] || Promise.resolve()).then(() => o.api('/api/party/rtc', { to, kind, data })).catch(() => {}));
    const holders = () => { const v = o.view() || {}; myId = (v.you && v.you.id) || ''; return (v.voice && Array.isArray(v.voice.ids)) ? v.voice.ids : []; };
    // who has joined voice: a member still on the card (or on an app without voice) has no mic in its avatar and is never called
    const inCall = () => { const v = o.view() || {}; return (Array.isArray(v.members) ? v.members : []).filter(m => m && m.avatar && m.avatar.mic).map(m => m.id); };
    function meter(s) {
      if (!ctx) { ctx = new AC(); if (ctx.resume) ctx.resume().catch(() => {}); }
      const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(s).connect(an); return an;
    }

    async function openMic(g) {
      let s;
      try { s = await gum({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { if (g === gen) { mic = 'listen'; reason = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'no-device'; emit(); } return false; }
      if (g !== gen || stream) { s.getTracks().forEach(t => t.stop()); return g === gen; } // left while the prompt was open, or a mic is already open
      stream = s; track = s.getAudioTracks()[0]; mic = 'on'; reason = null; localAn = meter(s); return true;
    }
    async function offer(p, iceRestart) {
      try { await p.pc.setLocalDescription(await p.pc.createOffer(iceRestart ? { iceRestart: true } : undefined)); send(p.id, 'offer', p.pc.localDescription.sdp); } catch (e) {}
    }
    function flushIce(p) { p.ready = true; const q = p.ice; p.ice = []; q.forEach(c => p.pc.addIceCandidate(c).catch(() => {})); }
    function drop(p) {
      clearT(p.timer); p.timer = null; clearT(p.dis); p.dis = null; try { p.pc.close(); } catch (e) {}
      if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
    }
    function step(p, ev) {
      const s = nextState(p.state, ev); if (s === p.state) return;
      p.state = s; clearT(p.timer); p.timer = null;
      if (s === 'connected') p.renewed = false; // a replacement that worked may be replaced again (the peer reloads twice); still one try per failure
      if (s === 'connecting' || s === 'restarting') p.timer = setT(() => step(p, 'timeout'), CONNECT_MS);
      if (s === 'restarting' && shouldOffer(myId, p.id)) { offer(p, true); p.state = nextState(s, 'restart-sent'); }
      if (s === 'failed') drop(p); // kept in the list so the room can say it cannot connect
      emit();
    }
    function open(id) {
      const pc = new PC({ iceServers, bundlePolicy: 'max-bundle' }), p = { id, pc, state: 'new', timer: null, ice: waiting[id] || [], ready: false, audio: null, an: null, renewed: false, dis: null };
      peers[id] = p; delete waiting[id];
      pc.onicecandidate = e => send(id, 'ice', e.candidate ? e.candidate.candidate : ''); // '' = end of candidates
      pc.ontrack = e => {
        if (p.audio) return;
        const s = new MS([e.track]); p.audio = newAudio(); p.audio.srcObject = s; p.audio.play().catch(() => {}); p.an = meter(s);
      };
      // a closed far side is only 'failed' after ~30 s of missed consent checks, so a lasting 'disconnected' counts as failed too
      pc.onconnectionstatechange = () => {
        const c = pc.connectionState; clearT(p.dis); p.dis = null;
        if (c === 'connected') step(p, 'connected'); else if (c === 'failed') step(p, 'ice-failed');
        else if (c === 'disconnected') p.dis = setT(() => { p.dis = null; if (pc.connectionState === 'disconnected') step(p, 'ice-failed'); }, DISCONNECT_MS);
      };
      step(p, 'start');
      return p;
    }
    function close(id) { const p = peers[id]; p.state = 'closed'; drop(p); delete peers[id]; }
    function call(id) { const p = open(id); p.pc.addTransceiver(track || 'audio', { direction: track ? 'sendrecv' : 'recvonly' }); offer(p); return p; }
    // The far side has a new connection (reload, fast leave-and-retake) or rejected ours: start over once, then give up.
    function renew(p, sdp) {
      if (peers[p.id] !== p) return null;
      if (p.renewed) { clearT(p.timer); p.state = 'failed'; drop(p); emit(); return null; }
      close(p.id); const n = sdp === undefined ? call(p.id) : open(p.id); n.renewed = true; emit(); return n;
    }
    function replan() {
      const ids = holders(), on = inCall();
      if (pend.length) { const ready = pend.filter(x => ids.includes(myId) && ids.includes(x.m.from)); pend = pend.filter(x => !ready.includes(x) && ++x.age < HOLD); ready.forEach(x => handle(x.m)); }
      const pl = plan(myId, ids, Object.keys(peers));
      pl.close.forEach(close);
      pl.connect.filter(id => shouldOffer(myId, id) && on.includes(id)).forEach(call);
      // The offering side may still hold a connection to our old one (we reloaded or lost our slot for a moment) and would only
      // notice in ~10 s: after KNOCK replans without its offer we offer ourselves; our new fingerprint makes it start fresh.
      const wait = pl.connect.filter(id => !shouldOffer(myId, id) && on.includes(id)), q = {};
      for (const id of wait) { q[id] = (quiet[id] || 0) + 1; if (q[id] >= KNOCK) { delete q[id]; call(id); } }
      quiet = q;
      if (pl.close.length) emit();
    }
    async function answer(p, sdp) {
      const pc = p.pc;
      if (pc.signalingState !== 'stable' && shouldOffer(myId, p.id)) return; // glare: the offering side keeps its own offer
      p.ready = false;
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp });
        const t = pc.getTransceivers()[0];
        if (t) { t.direction = track ? 'sendrecv' : 'recvonly'; if (track && t.sender.track !== track) await t.sender.replaceTrack(track); }
        await pc.setLocalDescription(await pc.createAnswer());
        send(p.id, 'answer', pc.localDescription.sdp); flushIce(p);
        if (track && t && pc.signalingState === 'stable' && !/send/.test(t.currentDirection || '')) offer(p); // unmuted while answering: send now
      } catch (e) { const n = renew(p, sdp); if (n) answer(n, sdp); }
    }
    function handle(m) {
      if (mic === 'off' || !m || m.type !== 'rtc' || typeof m.data !== 'string' || typeof m.from !== 'string') return;
      if (!tick) { if (early.length < KEEP) early.push(m); return; } // replayed once join has the ICE servers
      const ids = holders();
      if (m.from === myId) return;
      if (!ids.includes(m.from) || !ids.includes(myId)) { if (pend.length < KEEP) pend.push({ m, age: 0 }); return; }
      let p = peers[m.from];
      if (m.kind === 'offer') {
        const rd = p && p.state !== 'failed' && p.pc.remoteDescription;
        // they came back, or our knock crossed their offer: start fresh
        if (p && (p.state === 'failed' || (rd && fp(rd.sdp) !== fp(m.data)) || (!rd && !shouldOffer(myId, m.from) && p.pc.signalingState === 'have-local-offer'))) { close(m.from); p = null; }
        answer(p || open(m.from), m.data);
      } else if (!p) { if (m.kind === 'ice') { const w = waiting[m.from] = waiting[m.from] || []; if (w.length < KEEP) w.push({ candidate: m.data, sdpMLineIndex: 0 }); } }
      else if (p.state === 'failed') return;
      else if (m.kind === 'answer') {
        if (p.pc.signalingState !== 'have-local-offer') return;
        const rd = p.pc.remoteDescription;
        if (rd && fp(rd.sdp) !== fp(m.data)) return renew(p);
        p.ready = false;
        p.pc.setRemoteDescription({ type: 'answer', sdp: m.data }).then(() => {
          flushIce(p); const t = p.pc.getTransceivers()[0];
          if (track && t && !/send/.test(t.currentDirection || '')) offer(p); // unmuted while this offer was in flight: send now
        }, () => renew(p));
      } else if (m.kind === 'ice') {
        const c = { candidate: m.data, sdpMLineIndex: 0 };
        if (p.ready) p.pc.addIceCandidate(c).catch(() => {}); else p.ice.push(c);
      }
    }

    async function join(mode) {
      if (mic !== 'off') return;
      const g = ++gen; mic = 'listen'; reason = null;
      if (mode === 'mic') opening = true; // a click on unmute meanwhile must not open a second device
      const micP = mode === 'mic' ? openMic(g).then(ok => { if (g === gen) opening = false; return ok; }) : null; // asked first, while still inside the click
      const cfg = await Promise.resolve().then(() => o.get('/api/party/voice-config')).catch(() => null);
      iceServers = cfg && Array.isArray(cfg.iceServers) ? cfg.iceServers : [];
      if (micP) await micP;
      if (g !== gen) return;
      tick = setI(replan, REPLAN_MS); replan(); emit();
      early.splice(0).forEach(handle);
    }
    async function setMuted(muted) {
      if (mic === 'off') return;
      if (track) { track.enabled = !muted; mic = muted ? 'muted' : 'on'; return emit(); }
      if (muted || opening) return;
      opening = true; const ok = await openMic(gen); opening = false;
      if (!ok) return;
      emit();
      const g = gen;
      for (const p of Object.values(peers)) { // listen -> mic: send on every connection and renegotiate (an offer in flight re-offers on its answer)
        const t = g === gen && p.state !== 'failed' && p.pc.getTransceivers()[0];
        if (!t) continue;
        t.direction = 'sendrecv';
        try { await t.sender.replaceTrack(track); } catch (e) { continue; } // closed under us (left, or the peer was replaced)
        if (g === gen && p.pc.signalingState === 'stable') offer(p);
      }
    }
    function leave() {
      gen++; if (tick) clearI(tick); tick = null;
      Object.keys(peers).forEach(close); peers = {}; sendQ = {}; waiting = {}; early = []; quiet = {}; pend = [];
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = track = localAn = null;
      if (ctx) ctx.close().catch(() => {}); ctx = null;
      const was = mic; mic = 'off'; reason = null; opening = false;
      if (was !== 'off') emit();
    }
    function level(id) {
      const an = id && id === myId ? localAn : peers[id] && peers[id].an;
      if (!an) return 0;
      const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b);
      let sum = 0; for (const v of b) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / b.length) * 4); // ponytail: x4 maps normal speech RMS (~0.05-0.2) onto 0.2-0.8; recalibrate in the live check
    }

    if (o.onSignal) o.onSignal(handle);
    fn('addEventListener')('pagehide', leave);
    return { join, setMuted, leave, peers: peerStates, level };
  }

  root.MeetVoiceCore = { shouldOffer, plan, nextState, CONNECT_MS };
  root.MeetVoice = { create };
})(globalThis);
