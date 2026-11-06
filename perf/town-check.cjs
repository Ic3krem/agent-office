// Live check of /town in Electron (not in npm test): temp-profile server on :4798, offscreen window, real key and mouse input.
// usage: node_modules/.bin/electron perf/town-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4798, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-towncheck-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 90 s'); done(1); }, 90000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false } });
  const errors = [];
  w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
  const js = s => w.webContents.executeJavaScript(s);
  const pos = () => js('({x:__town.p.x,y:__town.p.y})');
  const key_ = (type, keyCode) => w.webContents.sendInputEvent({ type, keyCode });

  await w.loadURL(base + '/town');
  for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
  check('page boots', await js('!!window.__town'));
  await wait(1000);
  check('no console errors', errors.length === 0, errors);
  check('error box hidden', await js(`getComputedStyle(document.getElementById('err')).display === 'none'`));

  // click on the plaza: walk to a point 80 css px right of / below the centre
  const spawn = await js('__town.map.spawn'), plaza = await js('__town.map.plaza');
  const r = await js('(() => { const b = document.getElementById("town").getBoundingClientRect(); return { x: b.left + b.width / 2 + 90, y: b.top + b.height / 2 + 20 }; })()');
  const tgt = await js(`__town.toWorld(${r.x}, ${r.y})`);
  check('click target is on the plaza', tgt[0] > plaza[0] && tgt[0] < plaza[2] && tgt[1] > plaza[1] && tgt[1] < plaza[3], tgt);
  const mouse = type => w.webContents.sendInputEvent({ type, x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  mouse('mouseMove'); mouse('mouseDown'); await wait(30); mouse('mouseUp');
  await wait(2500);
  const p1 = await pos();
  check('click-to-walk arrives', Math.hypot(p1.x - tgt[0], p1.y - tgt[1]) < 8, { p1, tgt, spawn });

  // hold D for 1 s
  const f0 = await js('__town.api.frameCount()');
  key_('keyDown', 'D'); await wait(1000); key_('keyUp', 'D'); await wait(200);
  const p2 = await pos();
  check('holding D moves the player', Math.hypot(p2.x - p1.x, p2.y - p1.y) > 50, { p1, p2 });
  check('frames rendered while walking', (await js('__town.api.frameCount()')) - f0 > 20);

  // keydown then blur: nothing keeps walking
  key_('keyDown', 'A'); await wait(150);
  await js('window.dispatchEvent(new Event("blur"))'); await wait(150);
  const p3 = await pos(); await wait(500); const p4 = await pos();
  check('blur clears held keys', p3.x === p4.x && p3.y === p4.y, { p3, p4 });
  key_('keyUp', 'A');
  // idle: no frames
  const f1 = await js('__town.api.frameCount()'); await wait(500);
  check('idle renders nothing', (await js('__town.api.frameCount()')) === f1);

  await wait(300);
  const shot = path.join(root, 'art', '.raw', 'town-check.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, (await w.webContents.capturePage()).toPNG());
  console.log('screenshot', shot);

  // WebGL failure shows the message box
  await w.loadURL(base + '/town?failgl=1'); await wait(2000);
  const box = await js(`(() => { const e = document.getElementById('err'); return { shown: getComputedStyle(e).display !== 'none', text: e.textContent } })()`);
  check('WebGL failure shows the error box', box.shown && /could not load/.test(box.text) && /Back to the office/.test(box.text), box);

  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
