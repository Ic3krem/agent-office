// Party music (beta.6): every app plays the party's shared track from its source (YouTube's privacy-enhanced embed,
// Spotify's embed, or an https audio stream); nothing is captured or re-streamed. Late joiners seek to
// now - startedAt + pos; YouTube and streams resync past 2 s of drift (Spotify's embed seeks on load only).
// The embeds are driven with postMessage, so no remote script is loaded. Classic script: root.PartyMusic.
(function (root) {
  'use strict';
  const posOf = (m, now) => (!m ? 0 : m.paused ? m.pos : m.pos + Math.max(0, now - m.startedAt) / 1000);
  function embed(m, now) {
    if (m.src === 'youtube') return { kind: 'iframe', url: 'https://www.youtube-nocookie.com/embed/' + m.ref + '?enablejsapi=1&autoplay=1&playsinline=1&start=' + Math.floor(posOf(m, now || Date.now())) };
    if (m.src === 'spotify') { const [k, id] = m.ref.split(':'); return { kind: 'iframe', url: 'https://open.spotify.com/embed/' + k + '/' + id }; }
    return { kind: 'audio', url: m.ref };
  }
  const drift = (actual, m, now) => Math.abs(actual - posOf(m, now)) > 2;

  // ---- browser only ----
  let box = null, el = null, cur = null, key = '', ytTime = null, ducked = false;
  const YT = 'https://www.youtube-nocookie.com', SPOT = 'https://open.spotify.com';
  const send = (origin, msg) => { try { el.contentWindow.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg), origin); } catch (e) {} };
  const yt = (func, args) => send(YT, { event: 'command', func, args: args || [] });
  function holder() {
    if (box) return box;
    box = root.document.createElement('div'); box.id = 'party-player';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:5000;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.45)';
    root.document.body.appendChild(box);
    root.addEventListener('message', e => { // YouTube reports its time once we say we are listening
      if (e.origin !== YT || !el || e.source !== el.contentWindow) return;
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (d && d.info && typeof d.info.currentTime === 'number') { ytTime = d.info.currentTime; check(); }
    });
    return box;
  }
  // The meeting room: YouTube and streams drop to 25% volume; Spotify's embed has no volume, so it is paused and re-synced on leaving.
  function applyDuck() {
    if (!el || !cur) return;
    if (cur.src === 'youtube') yt('setVolume', [ducked ? 25 : 100]);
    else if (cur.src === 'stream') el.volume = ducked ? 0.25 : 1;
    else if (ducked) send(SPOT, { command: 'pause' });
    else if (!cur.paused) { send(SPOT, { command: 'seek', timestamp: Math.round(posOf(cur, Date.now()) * 1000) }); send(SPOT, { command: 'resume' }); }
  }
  function duck(on) { if (ducked === !!on) return; ducked = !!on; applyDuck(); }
  function check() {
    if (!cur || cur.paused) return;
    const now = Date.now();
    if (cur.src === 'stream' && el && el.readyState > 0 && isFinite(el.duration) && drift(el.currentTime, cur, now)) el.currentTime = posOf(cur, now);
    if (cur.src === 'youtube' && ytTime !== null && drift(ytTime, cur, now)) { yt('seekTo', [posOf(cur, now), true]); ytTime = null; }
  }
  // music: the party view's music (null = nothing plays). Builds the element on a new track, then follows play/pause.
  function sync(m) {
    if (root.BgMusic) root.BgMusic.duck(!!(m && !m.paused));
    const k = m ? m.src + '|' + m.ref + '|' + m.startedAt : '';
    if (k !== key) {
      key = k; cur = m; ytTime = null;
      if (box) box.innerHTML = ''; el = null;
      if (!m) { if (box) box.hidden = true; return; }
      const e = embed(m), b = holder(); b.hidden = false;
      if (e.kind === 'audio') {
        el = root.document.createElement('audio'); el.src = e.url; el.preload = 'auto';
        el.addEventListener('loadedmetadata', () => { if (isFinite(el.duration)) el.currentTime = posOf(cur, Date.now()); if (!cur.paused) el.play().catch(() => {}); });
        b.hidden = true; // nothing to show for a stream (the HUD shows what plays)
      } else {
        el = root.document.createElement('iframe'); el.src = e.url; el.title = 'Party music';
        el.allow = 'autoplay; encrypted-media'; el.style.cssText = 'display:block;border:0;width:' + (m.src === 'spotify' ? 300 : 240) + 'px;height:' + (m.src === 'spotify' ? 80 : 135) + 'px';
        el.addEventListener('load', () => {
          if (m.src === 'youtube') { send(YT, { event: 'listening', id: 1 }); if (cur.paused) yt('pauseVideo'); if (ducked) applyDuck(); }
          else if (!cur.paused && !ducked) { send(SPOT, { command: 'seek', timestamp: Math.round(posOf(cur, Date.now()) * 1000) }); send(SPOT, { command: 'resume' }); }
        });
      }
      b.appendChild(el);
      if (e.kind === 'audio') { if (ducked) el.volume = 0.25; el.load(); }
      return;
    }
    const was = cur; cur = m;
    if (!el || was.paused === m.paused) return check();
    if (m.src === 'stream') { if (m.paused) el.pause(); else { if (isFinite(el.duration)) el.currentTime = posOf(m, Date.now()); el.play().catch(() => {}); } }
    else if (m.src === 'youtube') { if (m.paused) yt('pauseVideo'); else { yt('seekTo', [posOf(m, Date.now()), true]); yt('playVideo'); } }
    else if (!(ducked && !m.paused)) send(SPOT, { command: m.paused ? 'pause' : 'resume' }); // in the room Spotify stays paused
  }
  if (root.setInterval && root.document) root.setInterval(check, 3000);
  root.PartyMusic = { posOf, embed, drift, sync, duck, element: () => el, current: () => cur };
})(globalThis);
