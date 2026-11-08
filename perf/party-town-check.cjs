// Live check of the party world (not in npm test). Two app servers on temp profiles: Hal (:4797) hosts a party from the
// app (Host a party, without the public tunnel) and Ben (:4798) joins it. Checks: Hal is the host; both towns lay the
// lots out the same way (Hal's office is the main house, Ben's on friend-1); doors lead to your own office or a visit;
// Ben comes out of his office at his own lot; each sees the other walk the town and stand in the game hall; stopping
// the party ends it. PRESET=high runs the GPU renderer (lot changes remount Pixi over Pixi); default Low.
// usage: node_modules/.bin/electron perf/party-town-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
require('./tmp-sweep.cjs').sweep();
const PRESET = process.env.PRESET || 'low', errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const kids = [], tmps = [];
let failed = 0;
const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = c => { for (const k of kids) try { k.kill(); } catch {} for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
setTimeout(() => { console.log('FAIL watchdog'); done(1); }, 240000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const node = (args, env) => { const c = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env } }); c.log = ''; c.stdout.on('data', d => c.log += d); c.stderr.on('data', d => c.log += d); kids.push(c); return c; };
const until = async (fn, ms = 15000) => { let v; for (let t = 0; t < ms; t += 300) { v = await fn(); if (v) return v; await wait(300); } return v; };
const tmpDir = () => { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-towncheck-')); tmps.push(t); return t; };
app.setPath('userData', tmpDir());

app.whenReady().then(async () => {
  const mk = async (port, name) => {
    const tmp = tmpDir(), key = crypto.randomBytes(24).toString('hex');
    const s = node([path.join(root, 'server.mjs')], { USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, AGENT_OFFICE_NO_TUNNEL: '1' });
    for (let t = 0; !/running on/.test(s.log); t += 150) { if (t > 20000) throw new Error(name + ' server: ' + s.log.slice(0, 300)); await wait(150); }
    const ses = session.fromPartition(name), base = 'http://127.0.0.1:' + port;
    await ses.cookies.set({ url: base, name: 'ao_ui', value: key });
    const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false, session: ses } });
    const js = x => w.webContents.executeJavaScript(x);
    w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(name + ': ' + e.message); });
    const load = async u => { await w.loadURL(base + u); await until(() => js('!!(window.__town || window.OfficeWorld)')); };
    await load('/town');
    await js(`localStorage.setItem('ao.powerSaver', '1'); Graphics.save({ preset: '${PRESET}' })`); await load('/town');
    const post = (u, b) => js(`fetch('${u}', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: ${JSON.stringify(JSON.stringify(b))} }).then(r => r.json())`);
    return { w, js, load, post, name, server: s };
  };
  const H = await mk(4797, 'Hal'), B = await mk(4798, 'Ben');
  const hj = await H.post('/api/party/host', { action: 'start', name: 'Hal' });
  const hp = hj.party || {};
  check('Hal hosts from the app and is the host', hp.connected && hp.you && hp.you.host === true && hp.hosting && hp.hosting.state === 'on' && /^[A-Z2-9]{6}$/.test(hp.hosting.code), hj.error || hp.hosting);
  const bj = await B.post('/api/party/join', { url: 'http://' + hp.host, code: hp.hosting.code, name: 'Ben' });
  const bid = bj.party && bj.party.you && bj.party.you.id;
  check('Ben joins as a guest', !!bid && bj.party.you.host === false, bj.error);

  const lotsH = await until(async () => { const l = await H.js('__town.lots()'); return l.some(x => /^friend-1:office-/.test(x)) && l; });
  const lotsB = await until(async () => { const l = await B.js('__town.lots()'); return l.some(x => /^friend-1:office-/.test(x)) && l; });
  check('both towns are laid out the same (Ben on friend-1, the main house is the host)', JSON.stringify(lotsH) === JSON.stringify(lotsB), { lotsH, lotsB });
  const door = (who, lot) => who.js(`JSON.stringify(TownMap.friendTarget(__town.map.lots.find(l => l.id === '${lot}'), __town.world(), true))`);
  check("Ben's doors: the main house visits Hal; friend-1 is his own office", /Visit Hal's office \(host\)/.test(await door(B, 'home')) && /Enter your office/.test(await door(B, 'friend-1')), [await door(B, 'home'), await door(B, 'friend-1')]);
  check("Hal's doors: the main house is his office; friend-1 visits Ben", /#scene=office/.test(await door(H, 'home')) && /Visit Ben's office/.test(await door(H, 'friend-1')));

  // Ben comes out of his office at his own lot, not at the host's house
  await B.load('/'); await B.load('/town#from=home'); // a real page load, as from the office's door
  const lot1 = await B.js("__town.map.lots.find(l => l.id === 'friend-1').door");
  const pb0 = await until(async () => { const p = await B.js('({ x: __town.p.x, y: __town.p.y })'); return Math.hypot(p.x - lot1.x, p.y - lot1.y) < 30 && p; });
  check('Ben comes out of his office at his own lot', !!pb0, { pb0, lot1 });

  // Ben walks; Hal sees him in the town
  B.w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W' }); await wait(1200); B.w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
  const pb = await B.js('({ x: __town.p.x, y: __town.p.y })');
  const g = await until(async () => { const l = await H.js('__town.guests()'); return l[0] && Math.hypot(l[0].x - pb.x, l[0].y - pb.y) < 3 && l; });
  check("Hal sees Ben walking the town", !!g && g[0].name === 'Ben', { g, pb });

  // the game hall is shared: both inside, each sees the other
  await H.load('/#scene=games'); await B.load('/#scene=games');
  const seenH = await until(() => H.js('OfficeWorld.guestIds ? OfficeWorld.guestIds() : []').then(l => l.includes(bid) && l), 20000);
  check('Hal sees Ben in the game hall', !!seenH, seenH);

  check('no console errors', errors.length === 0, errors.slice(0, 3));
  await H.post('/api/party/host', { action: 'stop' });
  const off = await until(async () => { const p = await B.js("fetch('/api/party/presence', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: '{}' }).then(r => r.json())"); return p.party && !p.party.connected; }, 60000);
  check('stopping the party ends it for Ben', !!off);
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
});
