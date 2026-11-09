// Live check of beta.6 (not in npm test): the town HUD, chat bubbles, party music, background music, manor themes, the
// office's Add desk / Claude / Music / Manor panels and #build. Two app servers on temp profiles: Hal (:4791) hosts a
// party from the app (no public tunnel) and Ben (:4792) joins. https requests in the test sessions are answered locally
// (a generated tone for https://radio.test/), so nothing leaves the machine.
// usage: node_modules/.bin/electron perf/hud-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
require('./tmp-sweep.cjs').sweep();
const errors = [], kids = [], tmps = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = c => { for (const k of kids) try { k.kill(); } catch {} for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
setTimeout(() => { console.log('FAIL watchdog'); done(1); }, 300000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const node = (args, env) => { const c = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env } }); c.log = ''; c.stdout.on('data', d => c.log += d); c.stderr.on('data', d => c.log += d); kids.push(c); return c; };
const until = async (fn, ms = 15000) => { let v; for (let t = 0; t < ms; t += 300) { v = await fn(); if (v) return v; await wait(300); } return v; };
const tmpDir = () => { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-hudcheck-')); tmps.push(t); return t; };
app.setPath('userData', tmpDir());

// 120 s of a quiet 440 Hz tone, 8 kHz mono 8-bit WAV, served with range requests (so the player can seek).
const WAV = (() => { const n = 8000 * 120, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(6 * Math.sin(i * 2 * Math.PI * 440 / 8000)); return b; })();
const fakeHttps = ses => ses.protocol.handle('https', req => {
  const u = new URL(req.url);
  if (u.host !== 'radio.test') return new Response('offline in this check', { status: 404 });
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return new Response(WAV, { headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(WAV.length) } });
  const s = +m[1], e = m[2] ? Math.min(+m[2], WAV.length - 1) : WAV.length - 1;
  return new Response(WAV.subarray(s, e + 1), { status: 206, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${WAV.length}`, 'content-length': String(e - s + 1) } });
});

app.whenReady().then(async () => {
  const mk = async (port, name) => {
    const tmp = tmpDir(), key = crypto.randomBytes(24).toString('hex');
    const s = node([path.join(root, 'server.mjs')], { USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, AGENT_OFFICE_NO_TUNNEL: '1' });
    for (let t = 0; !/running on/.test(s.log); t += 150) { if (t > 20000) throw new Error(name + ' server: ' + s.log.slice(0, 300)); await wait(150); }
    const ses = session.fromPartition(name), base = 'http://127.0.0.1:' + port;
    fakeHttps(ses);
    await ses.cookies.set({ url: base, name: 'ao_ui', value: key });
    const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false, session: ses, autoplayPolicy: 'no-user-gesture-required' } });
    const js = x => w.webContents.executeJavaScript(x);
    w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(name + ': ' + e.message); });
    const load = async u => { await w.loadURL(base + u); await until(() => js('!!(window.__town || window.OfficeWorld) && !!window.Hud')); };
    await load('/town');
    await js(`localStorage.setItem('ao.powerSaver', '1'); Graphics.save({ preset: 'low' })`);
    const post = (u, b) => js(`fetch('${u}', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: ${JSON.stringify(JSON.stringify(b))} }).then(r => r.json())`);
    const get = u => js(`fetch('${u}').then(r => r.json())`);
    await post('/api/switch', { name: 'kiro', on: false }); // goals must never start a real Claude session here
    await load('/town');
    return { w, js, load, post, get, name };
  };
  const H = await mk(4791, 'Hal'), B = await mk(4792, 'Ben');

  // ---- HUD on the town page ----
  const bar = await H.js(`document.querySelector('[data-hud-menu]').click(), [...document.querySelectorAll('.hud-bar [data-hud]')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.hud, Math.round(r.height), Math.round(r.width)]; })`);
  check('town HUD: six buttons, top right, at least 44 px', bar.map(b => b[0]).join() === 'tasks,graphics,build,party,music,manor' && bar.every(b => b[1] >= 44 && b[2] >= 44), bar);
  await H.post('/api/task', { text: 'Check the beta.6 HUD' });
  await H.js(`Hud.toggle('tasks')`);
  const tasks = await until(() => H.js(`(document.querySelector('[data-hud-panel=tasks] [data-wait]') || {}).textContent || ''`).then(t => /Check the beta\.6 HUD/.test(t) && t));
  check('Tasks lists the new goal under Waiting', !!tasks, tasks);
  await H.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc closes the panel', await H.js(`!document.querySelector('[data-hud-panel]') && Hud.isOpen() === ''`));
  await H.js(`Hud.toggle('graphics')`);
  const gb = await until(() => H.js(`document.querySelectorAll('[data-hud-panel=graphics] button[aria-pressed]').length`));
  await H.js(`Hud.toggle('manor')`);
  check('one panel at a time: Graphics (with its presets) gives way to Manor', gb >= 5 && await H.js(`document.querySelectorAll('[data-hud-panel]').length === 1 && !!document.querySelector('[data-hud-panel=manor]')`), gb);
  await H.js(`Hud.close()`);

  // ---- background music ----
  const bg = await until(() => H.js('BgMusic.state()').then(s => s.on && s));
  check('built-in background music plays in town', bg && bg.mode === 'builtin' && bg.place === 'town', bg);

  // ---- party: host, join, manor on the friend lot, chat bubble over the member ----
  const hp = (await H.post('/api/party/host', { action: 'start', name: 'Hal' })).party;
  const bp = (await B.post('/api/party/join', { url: 'http://' + hp.host, code: hp.hosting.code, name: 'Ben' })).party;
  const bid = bp && bp.you && bp.you.id;
  check('local party: Hal hosts, Ben joins', !!bid && hp.you.host === true);
  await B.post('/api/manor/set', { theme: 'cottage', colors: {} });
  const lot = await until(() => H.js('__town.lots()').then(l => l.find(x => /^friend-1:office-country:/.test(x))), 20000);
  check("Ben's manor (Cottage) shows on his friend lot in Hal's town, tinted", !!lot, await H.js('__town.lots()'));
  B.w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W' }); await wait(1200); B.w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
  await until(() => H.js('__town.guests()').then(g => g.length > 0));
  await B.post('/api/party/chat', { text: 'hello from the plaza' });
  const bub = await until(() => H.js('__town.bubbles()').then(l => l.find(b => b.who === bid && b.text === 'hello from the plaza')));
  check("Ben's chat shows as a bubble over Ben in Hal's town", !!bub, await H.js('__town.bubbles()'));
  const mine = await until(() => B.js('__town.bubbles()').then(l => l.find(b => b.who === 'me')));
  check('…and over Ben himself in his own town', !!mine);

  // ---- party music: a stream reaches the other app and plays in sync ----
  const pm = await H.post('/api/party/music', { link: 'https://radio.test/tone.wav', title: 'Test tone' });
  check('Hal plays a stream link', !!pm.party, pm);
  const pos = w => w.js(`(() => { const e = PartyMusic.element(), m = PartyMusic.current(); return e && e.tagName === 'AUDIO' && !e.paused && e.currentTime > 0 ? { t: e.currentTime, want: PartyMusic.posOf(m, Date.now()) } : null; })()`);
  const ph = await until(() => pos(H), 20000), pb = await until(() => pos(B), 20000);
  check('the stream plays on both apps', !!ph && !!pb, { ph, pb });
  await wait(4000);
  const [qh, qb] = [await pos(H), await pos(B)];
  check('in sync within 2 s (each other and the party clock)', qh && qb && Math.abs(qh.t - qb.t) < 2 && Math.abs(qh.t - qh.want) < 2 && Math.abs(qb.t - qb.want) < 2, { qh, qb });
  check('background music ducks under party music', await B.js('BgMusic.state().ducked') === true);
  await B.js(`Hud.toggle('music')`);
  const now = await until(() => B.js(`(document.querySelector('[data-hud-panel=music] [data-now]') || {}).textContent || ''`).then(t => /Test tone/.test(t) && t));
  check('the Music panel shows what plays', !!now, now);
  await H.post('/api/party/music', { djAll: false });
  const refused = await B.post('/api/party/music', { link: 'https://radio.test/other.wav' });
  check('with "anyone can DJ" off a guest cannot change the music', !!refused.error, refused);
  await H.post('/api/party/music', { stop: true });
  check('stopping the music un-ducks the background', await until(() => B.js('!PartyMusic.element() && BgMusic.state().ducked === false')));
  await B.post('/api/music/set', { bg: 'off' }); await B.js(`BgMusic.start('town')`);
  check('background music off stops it', await B.js('BgMusic.state().on === false'));

  // ---- the office page ----
  await B.load('/');
  const wash = await until(() => B.js('OfficeFurniture.state.manor'));
  check("Ben's office floor and walls take his Cottage colours", !!wash && wash.floor === '#b98a5a', wash);
  const ext = await B.get('/api/external');
  check('/api/external rows carry a signed-in state', Array.isArray(ext.detected) && ext.detected.every(d => d.signin && /^(yes|no|unknown)$/.test(d.signin.state)), ext.detected && ext.detected.map(d => d.cli + ':' + (d.signin && d.signin.state)));
  const add = await B.js(`(async () => { const L = (await fetch('/api/world').then(r => r.json())).layout || WorldModel.officeLayout(); const r = WorldEdit.addDeskAuto(L, 'ext-codex-1'); if (!r.ok) return r; const s = await fetch('/api/world', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: JSON.stringify({ layout: r.layout }) }); return { ok: s.ok }; })()`);
  const desks = (await B.get('/api/external')).desks || [];
  check('Add desk places ext-codex-1 and the server accepts the layout', add.ok && desks.some(d => d.key === 'ext-codex-1'), { add, desks: desks.map(d => d.key) });
  const cl = await B.get('/api/claude');
  check('/api/claude answers (found or the install line, a status, what is used)', typeof cl.found === 'boolean' && cl.status && typeof cl.status.loggedIn === 'boolean' && cl.using === 'account', cl && { found: cl.found, loggedIn: cl.status && cl.status.loggedIn, using: cl.using });
  for (const p of ['music', 'manor', 'claude']) {
    await B.js(`document.querySelector('[aria-label="Settings menu"]').click()`); await until(() => B.js(`!!document.querySelector('[data-hud-open=${p}]')`));
    await B.js(`document.querySelector('[data-hud-open=${p}]').click()`);
    check('office ' + p + ' pill opens its panel', !!(await until(() => B.js(`!!document.querySelector('[data-hud-panel=${p}]')`))));
  }
  check('the Claude panel shows a status line', !!(await until(() => B.js(`!!document.querySelector('[data-claude-status]') || /not found/.test(document.querySelector('[data-hud-panel=claude]').textContent)`))));
  await B.load('/#build');
  check('/#build opens Build mode', !!(await until(() => B.js(`document.body.classList.contains('ao-building')`))));

  const real = errors.filter(e => !/radio\.test|offline in this check|youtube|spotify/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 3));
  await H.post('/api/party/host', { action: 'stop' });
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
});
