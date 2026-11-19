// Live check of the 2.1 meeting room with voice (not in npm test). A local party server on a free port and two app servers on
// temp profiles, Ann (:4790) and Bob (:4791), each with a window shaped like the app's office window (its webPreferences,
// preload and the app's permission policy from desktop/media-permissions.mjs). Chromium's fake microphone (a beep) and fake
// permission UI. Ann joins with the microphone, Bob listens only. Proves: audio flows (real WebRTC between the two apps), the
// setup messages Chromium really produces pass party/protocol.mjs's cleaner and limits, listen only never captures, re-entry
// is muted with no capture until M (and a held M toggles once), reloads (twice each side) and a slot dropped and re-taken
// within a second reconnect, reactions and raised hands reach the other app, music is ducked in the room and restored on
// leaving, leaving leaves no live track and an empty room, and a member without a slot cannot relay setup messages.
// https requests in the test sessions are answered locally (a generated tone for https://radio.test/); WebRTC itself uses
// the app's default public STUN servers, as the app does.
// Audio output is muted (--mute-audio): nothing is heard, the levels are read from the analysers.
// Long-poll mode (npm run check:meet -- --poll, or MEET_CHECK_POLL=1): the apps reach the party through a local proxy that holds
// every response body until it ends, as a Cloudflare quick tunnel does with SSE. No byte of /events arrives within 5 s, so each
// app's party client switches to /poll for the session (party-client.mjs), the share-link path. The proxy counts /poll and 429s.
// usage: npm run check:meet   (prints ALL PASSED; exit 1 on any failure)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), net = require('net'), http = require('http');
const POLL = process.argv.includes('--poll') || process.env.MEET_CHECK_POLL === '1';
const root = path.join(__dirname, '..');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('mute-audio'); // the beeps, chimes and test tone never reach the speakers; capture, WebRTC and analyser levels still work
require('./tmp-sweep.cjs').sweep();
const errors = [], kids = [], tmps = [];
const T0 = Date.now(), step = m => console.log('.. ' + ((Date.now() - T0) / 1000).toFixed(1) + 's ' + m);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = c => { for (const k of kids) try { k.kill(); } catch {} for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
setTimeout(() => { console.log('FAIL watchdog'); done(1); }, 600000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const node = (args, env) => { const c = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env }, windowsHide: true }); c.log = ''; c.stdout.on('data', d => c.log += d); c.stderr.on('data', d => c.log += d); kids.push(c); return c; };
const until = async (fn, ms = 15000, every = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await wait(every); } };
const tmpDir = () => { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-meetcheck-')); tmps.push(t); return t; };
const freePort = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
app.setPath('userData', tmpDir());

const WAV = (() => { const n = 8000 * 120, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(6 * Math.sin(i * 2 * Math.PI * 440 / 8000)); return b; })();
const fakeHttps = ses => ses.protocol.handle('https', req => {
  const u = new URL(req.url);
  if (u.host !== 'radio.test') return new Response('offline in this check', { status: 404 });
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return new Response(WAV, { headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(WAV.length) } });
  const s = +m[1], e = m[2] ? Math.min(+m[2], WAV.length - 1) : WAV.length - 1;
  return new Response(WAV.subarray(s, e + 1), { status: 206, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${WAV.length}`, 'content-length': String(e - s + 1) } });
});

// Runs before the page's own scripts on every load: counts getUserMedia and keeps its streams (live-track checks), records
// every /api/party/rtc body and its answer, every RTCPeerConnection, every AudioContext and every srcObject play() result.
const PROBE = `(() => {
  const W = window; W.__gum = 0; W.__streams = []; W.__rtc = []; W.__pcs = []; W.__acs = []; W.__plays = [];
  const md = navigator.mediaDevices, g = md && md.getUserMedia.bind(md);
  if (g) md.getUserMedia = c => { W.__gum++; return g(c).then(s => { W.__streams.push(s); return s; }); };
  const f = W.fetch; W.fetch = (u, o) => { const p = f(u, o); if (String(u).includes('/api/party/rtc')) { const r = { body: o && o.body }; W.__rtc.push(r); p.then(x => x.clone().json()).then(j => { r.res = j; }, e => { r.err = String(e); }); } return p; };
  const PC = W.RTCPeerConnection; W.__pcLog = []; W.RTCPeerConnection = function (...a) { const pc = new PC(...a), n = W.__pcs.push(pc), t0 = Date.now(); pc.addEventListener('connectionstatechange', () => W.__pcLog.push(n + ':' + pc.connectionState + '@' + Date.now() % 100000)); pc.addEventListener('iceconnectionstatechange', () => W.__pcLog.push(n + ':ice-' + pc.iceConnectionState + '@' + Date.now() % 100000)); return pc; }; W.RTCPeerConnection.prototype = PC.prototype;
  const AC = W.AudioContext; W.AudioContext = function (...a) { const c = new AC(...a); W.__acs.push(c); return c; }; W.AudioContext.prototype = AC.prototype;
  const pl = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const p = pl.call(this); if (this.srcObject) { const r = { el: this }; W.__plays.push(r); p.then(() => { r.ok = true; }, e => { r.err = e && e.name; }); } return p; };
  W.__live = () => W.__streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length;
})()`;

app.whenReady().then(async () => {
  const { decidePermission, originOf } = await import(require('url').pathToFileURL(path.join(root, 'desktop', 'media-permissions.mjs')).href);
  const { cleanRtc, LIMITS } = await import(require('url').pathToFileURL(path.join(root, 'party', 'protocol.mjs')).href);

  // ---- the party server ----
  const pport = await freePort(), code = 'MEET42';
  const ps = node([path.join(root, 'party', 'server.mjs')], { PARTY_PORT: String(pport), PARTY_BIND: '127.0.0.1', PARTY_CODE: code, PARTY_NAME: 'Meet check' });
  for (let t = 0; !/Party server on port/.test(ps.log); t += 150) { if (t > 15000) throw new Error('party server: ' + ps.log.slice(0, 300)); await wait(150); }
  const purl = 'http://127.0.0.1:' + pport; step('party server on ' + pport);
  // the apps' way to the party: direct (SSE), or through the buffering proxy (long poll)
  const net_ = { polls: 0, events: 0, pollers: new Set(), s429: {}, rtcOut: 0 };
  let appUrl = purl;
  if (POLL) {
    const proxy = http.createServer((req, res) => {
      const pth = req.url.split('?')[0];
      if (pth === '/poll') { net_.polls++; net_.pollers.add(req.headers.authorization); } else if (pth === '/events') net_.events++; else if (pth === '/rtc') net_.rtcOut++;
      const up = http.request({ host: '127.0.0.1', port: pport, method: req.method, path: req.url, headers: req.headers }, pr => {
        if (pr.statusCode === 429) net_.s429[pth] = (net_.s429[pth] || 0) + 1;
        res.writeHead(pr.statusCode, pr.headers); res.flushHeaders();
        const chunks = []; pr.on('data', c => chunks.push(c)); pr.on('end', () => res.end(Buffer.concat(chunks)));
      });
      up.on('error', () => res.destroy()); res.on('close', () => up.destroy());
      req.pipe(up);
    });
    await new Promise(ok => proxy.listen(0, '127.0.0.1', ok)); kids.push({ kill: () => { proxy.close(); proxy.closeAllConnections(); } });
    appUrl = 'http://127.0.0.1:' + proxy.address().port; step('long-poll mode: the apps reach the party through a buffering proxy on ' + proxy.address().port);
  }
  const timing = {};

  const mk = async (port, name) => {
    const tmp = tmpDir(), key = crypto.randomBytes(24).toString('hex');
    const s = node([path.join(root, 'server.mjs')], { USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, AGENT_OFFICE_NO_TUNNEL: '1', CLAUDE_CODE_PATH: '' });
    for (let t = 0; !/running on/.test(s.log); t += 150) { if (t > 20000) throw new Error(name + ' server: ' + s.log.slice(0, 300)); await wait(150); }
    step(name + ' server running');
    const ses = session.fromPartition('meet-' + name), base = 'http://127.0.0.1:' + port, perms = [];
    fakeHttps(ses);
    await ses.cookies.set({ url: base, name: 'ao_ui', value: key });
    // the window as desktop/main.mjs builds the office window, plus offscreen so it never takes the screen
    const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, session: ses, preload: path.join(root, 'desktop', 'office-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required' } });
    ses.setPermissionRequestHandler((wc, permission, cb, d) => { const ok = decidePermission({ permission, origin: originOf(d.requestingUrl), isMainWindow: wc === w.webContents, mediaTypes: d.mediaTypes, appOrigin: base }); perms.push(permission + ':' + ok); cb(ok); });
    ses.setPermissionCheckHandler((wc, permission, origin, d) => decidePermission({ permission, origin: originOf(origin), isMainWindow: wc === w.webContents, mediaTypes: d.mediaType === 'audio' || d.mediaType === 'video' ? [d.mediaType] : [], appOrigin: base }));
    await w.loadURL('about:blank'); w.webContents.debugger.attach('1.3'); await w.webContents.debugger.sendCommand('Page.enable'); // a renderer first: Page.enable on a fresh webContents waits forever, and the script below needs it
    await w.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    const js = (x, gesture) => w.webContents.executeJavaScript(x, !!gesture);
    w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(name + ': ' + e.message); });
    const reload = async () => { await js('window.__old = 1'); w.webContents.reload(); await until(() => js("typeof window.__old === 'undefined' && !!(window.MeetRoom && MeetRoom.current() && window.OfficeWorld)").catch(() => false)); };
    const meetReady = () => until(() => js('!!(window.MeetRoom && MeetRoom.current() && window.OfficeWorld)'));
    const load = async u => { await w.loadURL(base + u); await until(() => js('!!(window.__town || window.OfficeWorld) && !!window.Hud')); };
    const post = (u, b) => js(`fetch('${u}', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: ${JSON.stringify(JSON.stringify(b))} }).then(r => r.json())`);
    const key_ = (k, rep) => { w.webContents.focus(); w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: rep ? ['isAutoRepeat'] : [] }); };
    const keyUp = k => w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
    const C = 'MeetRoom.current().controller';
    const me = () => js(`${C}.rows()[0] && ${C}.rows()[0].id`);
    const level = id => js(`${C}.engine.level(${JSON.stringify(id)})`);
    const peers = () => js(`${C}.engine.peers()`);
    step(name + ': server up, loading town'); await load('/town'); step(name + ': town loaded');
    await js(`localStorage.setItem('ao.powerSaver', '1'); Graphics.save({ preset: 'low' })`);
    await post('/api/switch', { name: 'kiro', on: false }); // never start a real Claude session here
    return { w, js, load, reload, post, name, perms, base, meetReady, key_, keyUp, C, me, level, peers };
  };
  const A = await mk(4790, 'Ann'), B = await mk(4791, 'Bob');
  const ja = await A.post('/api/party/join', { url: appUrl, code, name: 'Ann' }), jb = await B.post('/api/party/join', { url: appUrl, code, name: 'Bob' });
  const aid = ja.party && ja.party.you && ja.party.you.id, bid = jb.party && jb.party.you && jb.party.you.id;
  check('both apps join the local party', !!aid && !!bid, { ja: ja.error, jb: jb.error });
  console.log('ids: Ann ' + aid + ', Bob ' + bid + ' (the lower id offers: ' + (aid < bid ? 'Ann' : 'Bob') + ')');
  const pm = await A.post('/api/party/music', { link: 'https://radio.test/tone.wav', title: 'Test tone' });
  check('party music (a local stream) is on before the room', !!pm.party, pm.error);

  // samples of B's level() for an id over ms: { max, med, n }
  const sample = async (W, id, ms = 3000) => { const v = []; for (let t = 0; t < ms; t += 60) { v.push(await W.level(id)); await wait(60); } v.sort((a, b) => a - b); return { max: +v[v.length - 1].toFixed(4), med: +v[v.length >> 1].toFixed(4), p90: +v[Math.floor(v.length * 0.9)].toFixed(4), above: v.filter(x => x > 0.08).length, n: v.length }; };
  const connected = (W, id, ms = 20000) => until(async () => (await W.peers())[id] === 'connected', ms);
  const rowOf = async (W, id) => (await W.js(`${W.C}.rows()`)).find(r => r.id === id);
  const errBefore = () => errors.length;

  // ---- in: the card, Ann with the mic, Bob listen only ----
  await A.load('/#scene=meet'); await B.load('/#scene=meet');
  await A.meetReady(); await B.meetReady();
  const shown = `getComputedStyle(MeetRoom.current().el.card).display !== 'none'`; // computed: the hidden attribute alone once lost to the panel's display:flex
  const cards = await until(async () => (await A.js(shown)) && (await B.js(shown)), 15000);
  check('both see the consent card', !!cards);
  await A.js(`document.querySelector('[data-meet-choice=mic]').click()`, true);
  await B.js(`document.querySelector('[data-meet-choice=listen]').click()`, true); const tJoin = Date.now();
  const modal = `!!document.querySelector('[role=dialog][aria-modal=true]')`; // while one exists the world ignores the walking keys
  check('the card goes away once chosen, and no modal dialog is left to swallow the keys', !(await A.js(shown)) && !(await B.js(shown)) && !(await A.js(modal)) && !(await B.js(modal)));
  check('both connect (Ann sees Bob, Bob sees Ann)', !!(await connected(A, bid)) && !!(await connected(B, aid)), { a: await A.peers(), b: await B.peers() });
  timing.firstConnectMs = Date.now() - tJoin;
  const rowA = await until(async () => { const r = await rowOf(B, aid); return r && (r.state === 'on' || r.state === 'speaking') && r; });
  check("Ann's row on Bob is on or speaking", !!rowA, await rowOf(B, aid));
  const sOn = await sample(B, aid);
  check("Bob hears Ann: level(Ann) > 0 on Bob", sOn.max > 0, sOn);
  check('Bob (listen only) never called getUserMedia', await B.js('window.__gum') === 0 && await B.js('MeetRoom.current().controller.mic()') === 'listen');
  check('Ann asked for the mic once', await A.js('window.__gum') === 1 && await A.js('MeetRoom.current().controller.mic()') === 'on');
  // with --use-fake-ui-for-media-stream Chromium may grant the mic without asking the session's handler at all; then there is nothing to check
  if (A.perms.length) check("the app's permission policy granted Ann's mic request", A.perms.includes('media:true') && !A.perms.includes('media:false'), { ann: A.perms, bob: B.perms });
  else console.log('INFO the permission handler was never asked (the fake media UI answered); policy covered by desktop-permissions.test.mjs');

  // proof 3: the level scale with the fake device (a beep), Ann's own meter and Ann muted (silence)
  const sOwn = await sample(A, aid);
  await A.key_('M'); A.keyUp('M');
  check('M mutes Ann', !!(await until(() => A.js(`${A.C}.mic() === 'muted'`))));
  await wait(800);
  const sMuted = await sample(B, aid);
  console.log('levels: Bob hears Ann on ' + JSON.stringify(sOn) + ', Ann own meter ' + JSON.stringify(sOwn) + ', Bob hears Ann muted ' + JSON.stringify(sMuted));
  check('the fake beep crosses the speaking mark (0.08) on the far side', sOn.max > 0.08, sOn);
  check('silence (muted) never crosses it', sMuted.max <= 0.08, sMuted);
  await A.key_('M'); A.keyUp('M');
  check('M unmutes Ann (no second capture)', !!(await until(() => A.js(`${A.C}.mic() === 'on'`))) && await A.js('window.__gum') === 1);
  // a held M (auto-repeat) toggles once
  await A.key_('M'); for (let i = 0; i < 5; i++) { await wait(40); await A.key_('M', true); } A.keyUp('M');
  await wait(300);
  check('a held M toggles once', await A.js(`${A.C}.mic()`) === 'muted', await A.js(`${A.C}.mic()`));
  await A.key_('M'); A.keyUp('M'); await until(() => A.js(`${A.C}.mic() === 'on'`));

  // proof 7 (in): music ducked and the background tune held while in the room
  const duckIn = async W => W.js(`({ bg: BgMusic.state().on, el: PartyMusic.element() ? PartyMusic.element().volume : null })`);
  const dA = await until(async () => { const d = await duckIn(A); return d.el === 0.25 && d; }, 8000) || await duckIn(A);
  check('in the room: party music ducked (0.25) and the background tune off', dA.el === 0.25 && dA.bg === false, dA);

  // proof 2: AudioContexts running, remote audio play() allowed with no click
  const audio = async W => W.js(`({ acs: __acs.map(c => c.state), plays: __plays.map(p => p.ok ? 'ok' : p.err || 'pending'), paused: __plays.filter(p => p.el.srcObject).map(p => p.el.paused), live: __plays.filter(p => p.el.srcObject).map(p => p.el.srcObject.getAudioTracks().some(t => t.readyState === 'live')) })`);
  const au = await audio(B);
  check('Bob: remote audio plays (not blocked by autoplay), AudioContexts running', au.plays.length > 0 && au.plays.every(p => p === 'ok') && au.paused.includes(false) && au.acs.includes('running') && !au.acs.includes('suspended'), au);

  // ---- proof 6: reactions and raised hand ----
  await A.key_('2'); A.keyUp('2'); const t0 = Date.now();
  const seen = await until(() => B.js(`${B.C}.fx().emotes.some(e => e.id === ${JSON.stringify(aid)} && e.emote === 1)`), 3000, 50);
  const tSeen = Date.now() - t0;
  const gone = await until(async () => !(await B.js(`${B.C}.fx().emotes.some(e => e.id === ${JSON.stringify(aid)})`)), 6000, 50);
  const shownMs = Date.now() - t0 - tSeen;
  check('a reaction (key 2) shows on Bob for about 3 s', !!seen && !!gone && tSeen < 1500 && shownMs > 2400 && shownMs < 3600, { arrivesMs: tSeen, shownMs });
  await A.key_('H'); A.keyUp('H'); const t1 = Date.now();
  const hand = await until(async () => { const r = await rowOf(B, aid); return r && r.hand; }, 5000, 50);
  const tHand = Date.now() - t1;
  check('a raised hand shows on Bob within about a second', !!hand && tHand <= 1500, { ms: tHand });
  await A.key_('H'); A.keyUp('H');
  check('…and lowering it clears it', !!(await until(async () => { const r = await rowOf(B, aid); return r && !r.hand; }, 5000)));

  // ---- proof 1: what Chromium really produces passes the cleaner, within the limits ----
  // a loopback pair in Ann's page (a clone of her fake mic track, no new capture): offer, answer, then an ICE-restart offer
  // taken after gathering completes, so it carries a=candidate lines
  const loop = await A.js(`(async () => {
    const ice = c => new Promise(r => { if (c.iceGatheringState === 'complete') return r(); c.addEventListener('icegatheringstatechange', () => c.iceGatheringState === 'complete' && r()); });
    const t = __streams[0].getAudioTracks()[0].clone(), a = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' }), b = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' }), cands = [];
    a.onicecandidate = e => { if (e.candidate) { cands.push(e.candidate.candidate); b.addIceCandidate(e.candidate); } }; b.onicecandidate = e => { if (e.candidate) a.addIceCandidate(e.candidate); };
    a.addTransceiver(t, { direction: 'sendrecv' });
    await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
    await ice(a); await ice(b);
    const offer = a.localDescription.sdp, answer = b.localDescription.sdp;
    await a.setLocalDescription(await a.createOffer({ iceRestart: true })); await new Promise(r => setTimeout(r, 1500));
    const restart = a.localDescription.sdp; a.close(); b.close(); t.stop();
    return { offer, answer, restart, cands };
  })()`);
  const sent = (await A.js('__rtc.map(r => ({ body: r.body, res: r.res }))')).concat(await B.js('__rtc.map(r => ({ body: r.body, res: r.res }))'));
  const bodies = sent.map(s => JSON.parse(s.body)), kinds = {};
  for (const b of bodies) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  const bad = bodies.filter(b => !cleanRtc(b)).map(b => b.kind + ':' + b.data.slice(0, 80));
  check('every setup message the apps sent passes cleanRtc and the server said ok', bodies.length > 0 && !bad.length && sent.every(s => s.res && s.res.ok === true), { kinds, bad: bad.slice(0, 3), notOk: sent.filter(s => !(s.res && s.res.ok)).map(s => s.res).slice(0, 3) });
  const sdps = bodies.filter(b => b.kind !== 'ice').map(b => b.data).concat([loop.offer, loop.answer, loop.restart]);
  const cands = bodies.filter(b => b.kind === 'ice' && b.data).map(b => b.data).concat(loop.cands);
  const withCand = [loop.offer, loop.answer, loop.restart].filter(s => /\r\na=candidate:/.test(s)).length;
  const maxSdp = Math.max(...sdps.map(s => s.length)), maxCand = Math.max(...cands.map(s => s.length));
  console.log('rtc: sent ' + JSON.stringify(kinds) + '; largest SDP ' + maxSdp + ' bytes (limit ' + LIMITS.sdp + '), largest candidate ' + maxCand + ' bytes (limit ' + LIMITS.ice + '); loopback SDPs with a=candidate lines: ' + withCand + '/3; candidate types ' + JSON.stringify([...new Set(cands.map(c => (/ typ (\w+)/.exec(c) || [])[1]))]));
  check('real offer, answer and ICE-restart offer (with a=candidate lines) pass cleanRtc', /\r\na=candidate:/.test(loop.restart) && ['offer', 'answer', 'restart'].every(k => cleanRtc({ to: 'abc', kind: k === 'answer' ? 'answer' : 'offer', data: loop[k] })), { restartHasCandidates: /\r\na=candidate:/.test(loop.restart), bad: ['offer', 'answer', 'restart'].filter(k => !cleanRtc({ to: 'abc', kind: k === 'answer' ? 'answer' : 'offer', data: loop[k] })) });
  check('every real SDP <= ' + LIMITS.sdp + ' bytes, every real candidate <= ' + LIMITS.ice, maxSdp <= LIMITS.sdp && maxCand <= LIMITS.ice && cands.every(c => cleanRtc({ to: 'abc', kind: 'ice', data: c })), { maxSdp, maxCand });

  // ---- proof 4: reloads. Ann (mic) twice: back muted with no capture until M; Bob (listen) twice: hears with no click ----
  for (let i = 1; i <= 2; i++) {
    const e0 = errBefore();
    const tR = Date.now(); await A.reload();
    const back = await until(() => A.js(`${A.C}.joined() && ${A.C}.mic() === 'muted'`));
    check(`Ann reload ${i}: back in the room muted, no card`, !!back && !(await A.js(shown)));
    const rc = !!(await connected(A, bid, 30000)) && !!(await connected(B, aid, 30000)); timing['annReload' + i + 'Ms'] = Date.now() - tR;
    check(`Ann reload ${i}: both sides reconnect`, rc, { a: await A.peers(), b: await B.peers(), bobPcs: await B.js('__pcLog'), annPcs: await A.js('__pcLog') });
    await wait(1500);
    check(`Ann reload ${i}: no capture until M`, await A.js('window.__gum') === 0 && await A.js('__live()') === 0);
    await A.key_('M'); A.keyUp('M');
    check(`Ann reload ${i}: M opens the mic once`, !!(await until(() => A.js(`${A.C}.mic() === 'on'`))) && await A.js('window.__gum') === 1);
    const s = await until(async () => { const x = await sample(B, aid, 1500); return x.max > 0 && x; }, 20000, 0);
    check(`Ann reload ${i}: Bob hears Ann again`, !!s, s || await sample(B, aid, 1500));
    if (errors.length > e0) console.log('  (console errors so far: ' + errors.slice(e0).join(' | ').slice(0, 300) + ')');
  }
  for (let i = 1; i <= 2; i++) {
    const tR = Date.now(); await B.reload();
    check(`Bob reload ${i}: back listening, no card, no click`, !!(await until(() => B.js(`${B.C}.joined() && ${B.C}.mic() === 'listen'`))) && !(await B.js(shown)));
    const rcb = !!(await connected(A, bid, 30000)) && !!(await connected(B, aid, 30000)); timing['bobReload' + i + 'Ms'] = Date.now() - tR;
    check(`Bob reload ${i}: both sides reconnect`, rcb, { a: await A.peers(), b: await B.peers(), annPcs: await A.js('__pcLog'), bobPcs: await B.js('__pcLog') });
    const s = await until(async () => { const x = await sample(B, aid, 1500); return x.max > 0 && x; }, 20000, 0);
    const au2 = await audio(B);
    check(`Bob reload ${i}: hears Ann with no click (play allowed, AudioContexts running), never captured`, !!s && au2.plays.length > 0 && au2.plays.every(p => p === 'ok') && au2.paused.includes(false) && au2.acs.includes('running') && !au2.acs.includes('suspended') && await B.js('window.__gum') === 0, { s, au2 });
  }

  // ---- proof 5: Ann's slot dropped and re-taken within a second leaves no stale connection ----
  // Eve, a member who never enters the room, watches the party server's slot events (and is used for the /rtc check below)
  const jr = await (await fetch(purl + '/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Eve' }) })).json();
  const slotEv = [];
  const eve = require('http').get(purl + '/events', { headers: { authorization: 'Bearer ' + jr.token } }, res => { let buf = ''; res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(blk); if (m) { try { const e = JSON.parse(m[1]); if (e.t === 'voice') slotEv.push({ at: Date.now(), has: e.ids.includes(aid) }); } catch {} } } }); });
  eve.on('error', () => {});
  await wait(1000);
  const pos = await A.js('OfficeWorld.ceo()');
  const r1 = await A.post('/api/party/avatar', { x: pos.x, y: pos.y, room: 'town' }); await wait(300);
  const r2 = await A.post('/api/party/avatar', { x: pos.x, y: pos.y, room: 'meet', mic: 'on' });
  await until(() => slotEv.some(e => e.has), 5000);
  const drop = slotEv.find(e => !e.has), retake = drop && slotEv.find(e => e.has && e.at >= drop.at);
  check('slot: the party server saw it dropped and re-taken within a second', !r1.error && !r2.error && !!drop && !!retake && retake.at - drop.at < 1000, { slotEv: slotEv.map(e => ({ has: e.has, ms: e.at - (slotEv[0] || e).at })) });
  const t5 = Date.now(); await A.js('__pcLog.push("--retake@" + Date.now() % 100000)'); await B.js('__pcLog.push("--retake@" + Date.now() % 100000)');
  // Ann's page may or may not have seen the gap (snapshots are 1 s apart). If it did, voice in the room ended (as "Voice is
  // full" does): the mic closed and the room re-joined muted, as on re-entry; then M brings her back.
  await wait(3000);
  const muted5 = await A.js(`${A.C}.mic()`), live5 = await A.js('__live()');
  check('slot re-taken: Ann either kept her mic or is back muted with it closed', muted5 === 'on' || (muted5 === 'muted' && live5 === 0), { saw: muted5 === 'muted', muted5, live5 });
  if (muted5 === 'muted') { await A.key_('M'); A.keyUp('M'); }
  const back5 = await until(async () => (await A.peers())[bid] === 'connected' && (await B.peers())[aid] === 'connected' && (await sample(B, aid, 1200)).max > 0, 20000, 0);
  const open5 = { a: await A.js(`__pcs.filter(p => p.connectionState !== 'closed').length`), b: await B.js(`__pcs.filter(p => p.connectionState !== 'closed').length`) };
  check('slot re-taken: after M audible again, one open connection each side (no stale one)', !!back5 && open5.a === 1 && open5.b === 1, { ms: Date.now() - t5, open5, a: await A.peers(), b: await B.peers(), annPcs: await A.js('__pcLog.slice(-8)'), bobPcs: await B.js('__pcLog.slice(-8)'), lvl: await sample(B, aid, 1200), dbgA: await A.js(`(()=>{const p=__pcs.filter(p=>p.connectionState!=='closed').pop();return p?{cs:p.connectionState,tx:p.getTransceivers().map(t=>({d:t.direction,cd:t.currentDirection,s:t.sender.track&&t.sender.track.readyState,en:t.sender.track&&t.sender.track.enabled,r:t.receiver.track&&t.receiver.track.readyState+'/'+t.receiver.track.muted}))}:null})()`), dbgB: await B.js(`(()=>{const p=__pcs.filter(p=>p.connectionState!=='closed').pop();return p?{cs:p.connectionState,tx:p.getTransceivers().map(t=>({d:t.direction,cd:t.currentDirection,s:t.sender.track&&t.sender.track.readyState,en:t.sender.track&&t.sender.track.enabled,r:t.receiver.track&&t.receiver.track.readyState+'/'+t.receiver.track.muted}))}:null})()`), micA: await A.js(`${A.C}.mic()`), playsB: await B.js('__plays.slice(-2).map(p => [p.ok, p.el.paused])') });

  // ---- a member who never entered the room cannot relay setup messages ----
  const rr = await (await fetch(purl + '/rtc', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jr.token }, body: JSON.stringify({ to: aid, kind: 'offer', data: loop.offer }) })).json();
  check('a third member outside the room gets ok:false from /rtc (with a valid SDP)', !!jr.token && rr.ok === false, rr);
  eve.destroy(); await fetch(purl + '/leave', { method: 'POST', headers: { authorization: 'Bearer ' + jr.token } }).catch(() => {});

  // ---- proof 7: leaving. Ann presses Leave room: no live track, indicator gone, Bob's room empty; music restored ----
  await A.js(`addEventListener('pagehide', () => { try { const p = MeetRoom.current() ? MeetRoom.current().el.panel : null; sessionStorage.setItem('__left', JSON.stringify({ live: __live(), streams: __streams.length, panel: p ? p.style.display : 'unmounted', ind: !!document.querySelector('[data-meet-indicator]') && !document.querySelector('[data-meet-indicator]').hidden })); } catch (e) { sessionStorage.setItem('__left', String(e)); } })`);
  await A.js(`[...document.querySelectorAll('[data-meet-controls] button')].find(b => /Leave room/.test(b.textContent)).click()`, true);
  check('Ann is back in town', !!(await until(() => A.js('location.pathname === "/town" && !!window.__town').catch(() => false))));
  const left = JSON.parse(await A.js(`sessionStorage.getItem('__left') || 'null'`));
  check('Ann left with no live track and no indicator', !!left && left.streams > 0 && left.live === 0 && !left.ind, left);
  const emptied = await until(async () => JSON.stringify(await B.peers()) === '{}' && (await B.js(`${B.C}.rows().length`)) === 1, 15000);
  check("Bob's peer list is empty and his room lists only himself", !!emptied, { peers: await B.peers(), rows: await B.js(`${B.C}.rows().map(r => r.name)`) });
  const dOut = await A.js(`({ bg: BgMusic.state().on, el: PartyMusic.element() ? PartyMusic.element().volume : null })`);
  check("in town after leaving: Ann's background tune plays and party music is not ducked", dOut.bg === true && dOut.el === 1, dOut); // the party stream plays in town too: its element must be there, back at full
  // the in-page restore, without a navigation: Bob's room is disposed (as on leaving) and the modules come back
  await B.js(`${B.C}.dispose()`);
  const dB = await until(async () => { const d = await B.js(`({ bg: BgMusic.state().on, el: PartyMusic.element() ? PartyMusic.element().volume : null, ind: MeetRoom.current().el.indicator.hidden, panel: MeetRoom.current().el.panel.style.display, live: __live() })`); return d.el === 1 && d.bg === true && d; }, 8000) || await B.js(`({ bg: BgMusic.state().on, el: PartyMusic.element() ? PartyMusic.element().volume : null })`);
  check('Bob leaves in place: party music back to full, background tune back on, indicator hidden', dB.el === 1 && dB.bg === true && dB.ind === true && dB.panel === 'none' && dB.live === 0, dB);

  console.log('timing (' + (POLL ? 'long poll' : 'SSE') + '): ' + JSON.stringify(timing));
  if (POLL) {
    console.log('long poll: ' + JSON.stringify({ polls: net_.polls, pollers: net_.pollers.size, eventsTries: net_.events, rtcPosts: net_.rtcOut, s429: net_.s429 }));
    check('long-poll mode: both apps used /poll (the SSE stream was buffered)', net_.pollers.size >= 2 && net_.polls > 0, { polls: net_.polls, pollers: net_.pollers.size });
    check('long-poll mode: no request was refused with 429', !Object.keys(net_.s429).length, net_.s429);
  }
  const real = errors.filter(e => !/radio\.test|offline in this check|youtube|spotify/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 5));
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
