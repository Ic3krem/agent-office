// Live check of town step 2 doors in Electron (not in npm test): temp-profile server on :4797, offscreen window, real keys.
// town -> office door -> office; office "Back to town" -> town at the home door; town -> kain -> Leave -> town; town -> games ->
// Leave -> town; a friend lot only explains itself; back/forward and direct #scene= loads. Each switch fades; no console errors.
// usage: node_modules/.bin/electron perf/scene-check.cjs [shot dir]   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4797, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const shots = process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs')) || path.join(root, 'art', '.raw');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-scenecheck-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 240 s'); done(1); }, 240000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false } });
  const errors = [];
  w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
  const js = s => w.webContents.executeJavaScript(s);
  const key_ = (type, keyCode) => w.webContents.sendInputEvent({ type, keyCode });
  const press = async k => { key_('keyDown', k); await wait(40); key_('keyUp', k); };
  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { try { if (await fn()) return true; } catch {} await wait(50); } return false; };
  const url = () => w.webContents.getURL().replace(base, '');
  const shot = async name => { await wait(300); const f = path.join(shots, 't6-' + name + '.png'); fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG()); console.log('screenshot', f); };
  const townReady = () => until(() => js('!!window.__town'));
  const officeReady = sc => until(() => js(`!!(window.OfficeWorld && OfficeWorld.scene() === ${JSON.stringify(sc)} && OfficeWorld.framesDrawn() > 0 && [...document.querySelectorAll('button')].some(b => b.textContent === 'Back to town'))`));
  // Pressing E / clicking fades out first (class set, opacity transition) and only then navigates.
  const fadesAndGoes = async (act, to, name) => {
    const before = url(); await act();
    const faded = await until(() => js(`document.documentElement.classList.contains('ao-fade')`), 180);
    check(name + ': fades out', faded && url() === before, { url: url() });
    check(name + ': arrives at ' + to, await until(() => url() === to, 8000), url());
  };
  const toDoor = async id => { // stand at a lot's door (redraw through the resize handler, which also updates the prompt)
    await js(`(() => { const l = __town.map.lots.find(l => l.id === ${JSON.stringify(id)}); __town.p.x = l.door.x; __town.p.y = l.door.y; __town.p.path = []; dispatchEvent(new Event('resize')); })()`);
    await wait(150);
    return js(`(() => { const b = document.getElementById('door'); return { near: __town.near(), shown: !b.hidden, text: b.textContent }; })()`);
  };
  const atDoor = id => js(`(() => { const l = __town.map.lots.find(l => l.id === ${JSON.stringify(id)}); return Math.hypot(__town.p.x - l.door.x, __town.p.y - l.door.y); })()`);
  const walkToExit = async () => { // spawn is just inside the door: walk +y (screen down-left = S + A) until Leave shows
    key_('keyDown', 'S'); key_('keyDown', 'A');
    const ok = await until(() => js('OfficeWorld.nearKind() === "door"'), 3000);
    key_('keyUp', 'S'); key_('keyUp', 'A'); await wait(150);
    return ok;
  };
  const fits = () => js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), P = OfficeFurniture.P, s = OfficeMotion.SPOTS.door, g = OfficeMotion.grid(), W = g.cols * g.cell, H = g.rows * g.cell;
    const pts = [P(0, 0, 110), P(W, 0, 0), P(0, H, 0), P(W, H, 0)].map(p => [c.left + p[0] / 1480 * c.width, c.top + p[1] / 920 * c.height]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), inside = xs.every(x => x >= 0 && x <= innerWidth) && ys.every(y => y >= 0 && y <= innerHeight);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, span = (Math.max(...xs) - Math.min(...xs)) / innerWidth;
    return { size: [W, H], inside, off: [Math.round(cx - innerWidth / 2), Math.round(cy - innerHeight / 2)], span: +span.toFixed(2), door: !!s }; })()`);

  // 1. town -> office door
  await w.loadURL(base + '/town'); check('town boots', await townReady());
  const home = await toDoor('home');
  check('home door prompt', home.near === 'home' && home.shown && /Enter the office/.test(home.text), home);
  await shot('town-door');
  await fadesAndGoes(() => press('E'), '/#scene=office', 'town -> office');
  check('office page boots in the office scene', await officeReady('office'));
  await wait(800); await shot('office');
  // 2. office Back to town -> town at the home door
  await fadesAndGoes(() => js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Back to town').click()`), '/town#from=home', 'office -> town');
  check('town boots at the home door', await townReady() && (await atDoor('home')) < 1, await atDoor('home'));
  // 3. kain and games: in by the door, out by walking onto the exit and pressing E
  for (const lot of ['kain', 'games']) {
    const d = await toDoor(lot);
    check(lot + ' door prompt', d.near === lot && d.shown && /Enter the/.test(d.text), d);
    await fadesAndGoes(() => press('E'), '/#scene=' + lot, 'town -> ' + lot);
    check(lot + ' scene boots', await officeReady(lot));
    // as in the office, the lights dim to the board and the zone labels fade once (about 16 s): wait that out before idle is measured
    await until(() => js('OfficeFurniture.state.labels <= 0.02 && Math.abs(OfficeFurniture.state.dim - (OfficeWorld.debug().board.empty ? 1 : 0)) <= 0.01'), 25000); await wait(600);
    const st = await js(`({ agents: OfficeWorld.debug().agents.length, kain: !!OfficeMotion.SPOTS['kain:1'], arcade: !!OfficeMotion.SPOTS['play:arcade1'], ceo: OfficeWorld.ceo(), spawn: OfficeMotion.SPAWN, label: [...document.querySelectorAll('span')].some(s => s.textContent === ${JSON.stringify(lot === 'kain' ? 'Karinderya' : 'Game hall')}) })`);
    check(lot + ': only the CEO, the interior pieces, the scene name', st.agents === 0 && Math.hypot(st.ceo.x - st.spawn.x, st.ceo.y - st.spawn.y) < 1 && (lot === 'kain' ? st.kain : st.arcade) && st.label, st);
    const f = await fits();
    check(lot + ': Fit frames the interior, centred', f.inside && f.door && Math.abs(f.off[0]) < 60 && Math.abs(f.off[1]) < 80 && f.span > 0.5, f);
    const f0 = await js('OfficeWorld.framesDrawn()'); await wait(1500); const idle = (await js('OfficeWorld.framesDrawn()')) - f0;
    check(lot + ': idle interior draws almost nothing', idle <= 4, idle);
    await shot(lot);
    if (lot === 'kain') { // Build mode inside the interior saves to kain.json, never to the office layout
      const btn = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)}); if (b) b.click(); return !!b; })()`);
      // Two office windows watch: one in Build mode, one not. Saving the karinderya must not touch either (per-scene versions).
      const watch = [];
      for (const building of [true, false]) {
        const o = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false } });
        o.webContents.on('console-message', e => { if (e.level === 'error') errors.push('office window: ' + e.message); });
        await o.loadURL(base + '/');
        const oj = s => o.webContents.executeJavaScript(s);
        await until(() => oj(`!!(window.OfficeWorld && OfficeWorld.framesDrawn() > 0 && [...document.querySelectorAll('button')].some(b => b.textContent === 'Back to town'))`));
        await oj(`(() => { const f = OfficeWorld.applyLayout; window.__applied = 0; OfficeWorld.applyLayout = l => { window.__applied++; return f(l); }; })()`);
        if (building) await oj(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Build').click()`);
        await wait(400);
        watch.push({ o, oj, building });
      }
      check('kain: Build opens', await btn('Build')); await wait(400);
      const at = await js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), P = OfficeFurniture.P, a = P(450, 123, 0), b = P(490, 123, 0), s = q => [Math.round(c.left + q[0] / 1480 * c.width), Math.round(c.top + q[1] / 920 * c.height)]; return [s(a), s(b)]; })()`);
      const m = (type, [x, y]) => w.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      m('mouseMove', at[0]); m('mouseDown', at[0]); await wait(50);
      for (let i = 1; i <= 8; i++) { m('mouseMove', [Math.round(at[0][0] + (at[1][0] - at[0][0]) * i / 8), Math.round(at[0][1] + (at[1][1] - at[0][1]) * i / 8)]); await wait(30); }
      m('mouseUp', at[1]); await wait(300);
      check('kain: Save pressed', await btn('Save')); await wait(800);
      const files = fs.readdirSync(tmp, { recursive: true }).map(String), kf = files.find(f => /[\\/]world[\\/]kain\.json$/.test(f));
      const saved = kf && JSON.parse(fs.readFileSync(path.join(tmp, kf), 'utf8')), pt = saved && saved.objects.find(o => o.id === 'picnic-table');
      check('kain: Build mode saves to kain.json', !!(saved && saved.scene === 'kain' && pt && pt.x !== 450), pt);
      check('kain: the office layout is not written', !files.some(f => /[\\/]world[\\/]layout\.json$/.test(f)));
      await wait(1500); // a stream message carries the new versions
      for (const { o, oj, building } of watch) {
        const r = await oj(`({ warned: document.body.innerText.includes('Layout changed in another window'), applied: window.__applied, building: document.body.classList.contains('ao-building') })`);
        check('kain save: an office window ' + (building ? 'in Build mode sees no "Layout changed"' : 'outside Build does not re-apply its layout'), building ? r.building && !r.warned : r.applied === 0 && !r.warned, r);
        o.destroy();
      }
      await btn('Done'); await wait(300);
    }
    check(lot + ': walking onto the door offers Leave', await walkToExit());
    await fadesAndGoes(() => press('E'), '/town#from=' + lot, lot + ' -> town');
    check('town boots at the ' + lot + ' door', await townReady() && (await atDoor(lot)) < 1, await atDoor(lot));
  }
  // 4. a friend lot explains itself and goes nowhere
  const fr = await toDoor('friend-2');
  check('friend lot prompt', fr.near === 'friend-2' && fr.shown && fr.text === 'Friend lots open in party mode', fr);
  await shot('friend');
  await press('E'); await wait(500);
  check('friend lot: E does nothing', url() === '/town#from=games' && !(await js(`document.documentElement.classList.contains('ao-fade')`)), url());
  const tf = await js('__town.api.frameCount()'); await wait(500);
  check('town idle renders nothing', (await js('__town.api.frameCount()')) === tf);
  // 5. back / forward, direct loads and a bad scene
  const nav = w.webContents.navigationHistory || w.webContents;
  nav.goBack(); check('back: the game hall again', await until(() => url() === '/#scene=games') && await officeReady('games'), url());
  nav.goForward(); check('forward: the town at the games door', await until(() => url() === '/town#from=games') && await townReady() && (await atDoor('games')) < 1, url());
  await w.loadURL(base + '/#scene=kain'); check('direct load of /#scene=kain', await officeReady('kain'));
  await w.loadURL(base + '/#scene=../x'); check('a bad #scene= falls back to the office', await officeReady('office'));
  await wait(500);
  check('no console errors', errors.length === 0, errors);

  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
