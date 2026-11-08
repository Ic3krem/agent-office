// Two app servers (temp profiles, :4797 Ana and :4798 Ben) join a local party server (:4791), both open /town.
// Checks: each town lists the other on a friend lot with an office building, Ben's walking shows up in Ana's town, and
// Ana's #visit=<Ben> opens Ben's office. usage: node_modules/.bin/electron perf/party-town-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
require('./tmp-sweep.cjs').sweep();
const PRESET = process.env.PRESET || 'low', errors = []; // PRESET=high: the GPU renderer (lot changes remount Pixi over Pixi)
const wait = ms => new Promise(r => setTimeout(r, ms));
const kids = [], tmps = [];
let failed = 0;
const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = c => { for (const k of kids) try { k.kill(); } catch {} for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
setTimeout(() => { console.log('FAIL watchdog'); done(1); }, 150000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const node = (args, env) => { const c = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env } }); c.log = ''; c.stdout.on('data', d => c.log += d); c.stderr.on('data', d => c.log += d); kids.push(c); return c; };
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ao-towncheck-')));

app.whenReady().then(async () => {
  const party = node([path.join(root, 'party/server.mjs')], { PARTY_PORT: '4791', PARTY_CODE: 'TEST1' });
  const mk = async (port, name) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-towncheck-')); tmps.push(tmp);
    const key = crypto.randomBytes(24).toString('hex');
    const s = node([path.join(root, 'server.mjs')], { USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key });
    for (let t = 0; !/running on/.test(s.log); t += 150) { if (t > 20000) throw new Error(name + ' server: ' + s.log.slice(0, 300)); await wait(150); }
    const ses = session.fromPartition(name), base = 'http://127.0.0.1:' + port;
    await ses.cookies.set({ url: base, name: 'ao_ui', value: key });
    const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false, session: ses } });
    const js = x => w.webContents.executeJavaScript(x);
    w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(name + ': ' + e.message); });
    await w.loadURL(base + '/town');
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    await js("localStorage.setItem('ao.powerSaver', '1'); Graphics.save({ preset: '" + PRESET + "' })"); await w.loadURL(base + '/town');
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    const j = await js(`fetch('/api/party/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: JSON.stringify({ url: 'http://127.0.0.1:4791', code: 'TEST1', name: '${name}' }) }).then(r => r.json())`);
    return { w, js, base, id: j.party && j.party.you && j.party.you.id, err: j.error };
  };
  for (let t = 0; !/Invite code/.test(party.log); t += 100) { if (t > 10000) throw new Error('party: ' + party.log); await wait(100); }
  const A = await mk(4797, 'Ana'), B = await mk(4798, 'Ben');
  check('both joined', !!A.id && !!B.id, { a: A.id || A.err, b: B.id || B.err });

  let lots = []; for (let t = 0; t < 15000; t += 300) { lots = await A.js('__town.lots()'); if (lots.some(l => /^friend-1:office-/.test(l))) break; await wait(300); }
  check("Ben's office stands on a friend lot in Ana's town", lots.some(l => /^friend-1:office-/.test(l)), lots);
  let lotsB = []; for (let t = 0; t < 15000; t += 300) { lotsB = await B.js('__town.lots()'); if (lotsB.some(l => /^friend-1:office-/.test(l))) break; await wait(300); }
  check("Ana's office stands on a friend lot in Ben's town", lotsB.some(l => /^friend-1:office-/.test(l)), lotsB);

  // Ben walks right for 1.5 s; Ana's town shows Ben near where Ben is
  B.w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D' }); await wait(1500); B.w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'D' });
  const pb = await B.js('({ x: __town.p.x, y: __town.p.y })');
  let g = []; for (let t = 0; t < 10000; t += 300) { g = await A.js('__town.guests()'); if (g[0] && Math.hypot(g[0].x - pb.x, g[0].y - pb.y) < 3) break; await wait(300); }
  check("Ben shows in Ana's town at Ben's position", g.length === 1 && g[0].name === 'Ben' && Math.hypot(g[0].x - pb.x, g[0].y - pb.y) < 3, { g, pb });
  await wait(3000); // Ben's figure finishes gliding
  const fa = await A.js('__town.api.frameCount ? __town.api.frameCount() : -1'); await wait(3000); const fb = await A.js('__town.api.frameCount ? __town.api.frameCount() : -1');
  if (PRESET === 'low') check("Ana's town stops drawing once Ben stands still", fb - fa <= 2, { frames: fb - fa });
  check('no console errors in either window', errors.length === 0, errors.slice(0, 3));
  check('renderer kind', true, await A.js('__town.api.kind'));

  const tgt = await A.js(`JSON.stringify(TownMap.friendTarget(__town.map.lots.find(l => l.id === 'friend-1'), ${JSON.stringify([{ id: B.id, name: 'Ben' }])}, true))`);
  check("friend-1's door visits Ben", JSON.parse(tgt).url === '/#visit=' + B.id, tgt);
  await A.w.loadURL(A.base + '/#visit=' + B.id);
  let txt = ''; for (let t = 0; t < 15000; t += 300) { txt = await A.js('document.body.innerText'); if (/Visiting Ben's office/.test(txt)) break; await wait(300); }
  check("Ana is visiting Ben's office", /Visiting Ben's office/.test(txt));
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
});
