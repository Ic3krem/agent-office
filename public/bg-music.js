// Background music (beta.6): original generative lo-fi made with WebAudio at runtime (soft chords, a light beat, vinyl
// noise), one tune per place, or the user's own folder (/api/music/file?i=). No audio files ship with the app.
// Ducks -12 dB under party music, pauses while the page is hidden. Classic script: root.BgMusic.
(function (root) {
  'use strict';
  const DUCK = Math.pow(10, -12 / 20);
  // A small seeded PRNG (mulberry32) from the place name, so every visit to a place plays its own tune.
  const rng = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  // Degrees of the major scale (0-based) for some lo-fi friendly four-chord loops, played as 7th chords.
  const LOOPS = [[1, 4, 0, 5], [0, 5, 3, 4], [5, 3, 0, 4], [3, 4, 2, 5], [0, 2, 3, 1], [5, 1, 4, 0]];
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const note = (rootN, deg) => rootN + SCALE[deg % 7] + 12 * Math.floor(deg / 7);
  function plan(place) {
    const r = rng(hash('tiro:' + place)), rootN = 48 + Math.floor(r() * 8), loop = LOOPS[Math.floor(r() * LOOPS.length)];
    return { bpm: 64 + Math.floor(r() * 22), root: rootN, swing: 0.08 + r() * 0.08, chords: loop.map(d => [note(rootN, d), note(rootN, d + 2), note(rootN, d + 4), note(rootN, d + 6) - (r() < 0.5 ? 0 : 12)]) };
  }
  const shuffle = (n, rand = Math.random) => { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---- browser only ----
  let ctx = null, master = null, timer = 0, audio = null, st = { on: false, place: '', mode: 'off', volume: 0.4, ducked: false, held: false, order: [], at: 0, tracks: [] };
  const nonce = () => (String(root.document.cookie).match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '';
  const level = () => st.volume * (st.ducked ? DUCK : 1);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function noiseBuf(sec) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function generative(place) {
    const P = plan(place), beat = 60 / P.bpm, bar = beat * 4;
    ctx = ctx || new (root.AudioContext || root.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 1.5); // fade in (the crossfade on a scene change)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(master);
    const vinyl = ctx.createBufferSource(), vg = ctx.createGain(), hp = ctx.createBiquadFilter();
    vinyl.buffer = noiseBuf(2); vinyl.loop = true; hp.type = 'highpass'; hp.frequency.value = 3000; vg.gain.value = 0.012;
    vinyl.connect(hp).connect(vg).connect(master); vinyl.start();
    const hatBuf = noiseBuf(0.05);
    let next = ctx.currentTime + 0.1, n = 0;
    const pad = (t, m) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = hz(m); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.3); g.gain.linearRampToValueAtTime(0, t + bar); o.connect(g).connect(lp); o.start(t); o.stop(t + bar + 0.05); };
    const kick = t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g).connect(master); o.start(t); o.stop(t + 0.3); };
    const hat = t => { const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(); s.buffer = hatBuf; f.type = 'highpass'; f.frequency.value = 7000; g.gain.value = 0.04; s.connect(f).connect(g).connect(master); s.start(t); };
    const schedule = () => { // a bar ahead, so timers that run late never leave a gap
      while (next < ctx.currentTime + bar) {
        const c = P.chords[n % P.chords.length]; c.forEach(m => pad(next, m));
        kick(next); kick(next + beat * 2.5);
        for (let i = 0; i < 4; i++) hat(next + beat * i + beat / 2 + P.swing * beat);
        next += bar; n++;
      }
    };
    schedule(); timer = setInterval(schedule, 250);
  }
  function playTrack() {
    if (!st.order.length) return;
    const i = st.order[st.at % st.order.length];
    audio.src = '/api/music/file?i=' + i; audio.volume = level(); audio.play().catch(() => {});
  }
  function folder() {
    audio = audio || Object.assign(new root.Audio(), { preload: 'auto' });
    audio.onended = () => { st.at++; playTrack(); };
    st.order = shuffle(st.tracks.length); st.at = 0; playTrack();
  }
  function stop() {
    clearInterval(timer); timer = 0;
    if (master) { try { master.disconnect(); } catch (e) {} master = null; }
    if (ctx) { const c = ctx; ctx = null; c.close().catch(() => {}); }
    if (audio) { audio.pause(); audio.removeAttribute('src'); }
    st.on = false;
  }
  function apply() { if (master && ctx) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.3); if (audio) audio.volume = level(); }
  async function start(place) {
    st.place = place || st.place || 'office';
    if (st.held) return state(); // the meeting room: voice matters more than lo-fi
    let m = { bg: 'builtin', volume: 0.4, tracks: [] };
    try { const r = await root.fetch('/api/music', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': nonce() }, body: '{}' }); if (r.ok) m = await r.json(); } catch (e) {}
    stop();
    st.mode = m.bg; st.volume = m.volume; st.tracks = m.tracks || []; st.folderName = m.folderName || '';
    if (st.held || root.document.hidden || m.bg === 'off') return state();
    st.on = true;
    if (m.bg === 'folder' && st.tracks.length) folder(); else generative(st.place);
    return state();
  }
  const state = () => ({ on: st.on, place: st.place, mode: st.mode, volume: st.volume, ducked: st.ducked, folderName: st.folderName || '', tracks: st.tracks.length, track: st.mode === 'folder' && st.order.length ? st.tracks[st.order[st.at % st.order.length]] : '' });
  if (root.document && root.addEventListener) root.document.addEventListener('visibilitychange', () => { // power saver: nothing plays while hidden
    if (root.document.hidden) { if (st.on) { stop(); st.resume = true; } } else if (st.resume) { st.resume = false; start(); }
  });
  if (root.addEventListener) root.addEventListener('pagehide', () => stop()); // release the AudioContext on every page change (town <-> office)
  root.BgMusic = { DUCK, plan, shuffle, start, stop, state,
    setVolume(v) { st.volume = Math.max(0, Math.min(1, +v || 0)); apply(); },
    hold(on) { st.held = !!on; if (st.held) stop(); else start(); }, // pauses the tune for the meeting room, restarts it on leaving
    duck(on) { if (st.ducked === !!on) return; st.ducked = !!on; apply(); },
    next() { if (audio && st.mode === 'folder') { st.at++; playTrack(); } },
    prev() { if (audio && st.mode === 'folder') { st.at = Math.max(0, st.at - 1); playTrack(); } } };
})(globalThis);
