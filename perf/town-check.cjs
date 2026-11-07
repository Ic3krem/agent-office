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
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 180 s'); done(1); }, 180000).unref();
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
  // idle: no frames (Low: ambient animation off)
  await js(`__town.api.setGraphics(Graphics.resolve({ preset: 'low' }, Graphics.env()))`); await wait(300);
  const f1 = await js('__town.api.frameCount()'); await wait(500);
  check('idle renders nothing', (await js('__town.api.frameCount()')) === f1);

  await wait(300);
  const shot = path.join(root, 'art', '.raw', 'town-check.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, (await w.webContents.capturePage()).toPNG());
  console.log('screenshot', shot);

  // Graphics (town step 4): High, Medium and Ultra at noon and 22:00. Shots go to $TOWN_SHOTS (default art/.raw).
  const shotDir = process.env.TOWN_SHOTS || path.dirname(shot);
  for (const preset of ['high', 'medium', 'ultra']) {
    await js(`Graphics.save({ preset: '${preset}' })`);
    for (const hour of [12, 22]) {
      await w.loadURL(base + '/town?hour=' + hour);
      for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
      await wait(800);
      const g = await js(`(() => { const s = __town.api.stats().graphics, c = document.getElementById('town'); return { shadows: s.shadows, lighting: s.lighting, rs: s.renderScale, w: c.width, cw: c.clientWidth }; })()`);
      const want = { high: { shadows: 'soft', lighting: 'glow', rs: 1 }, medium: { shadows: 'blob', lighting: 'tint', rs: .75 }, ultra: { shadows: 'tint', lighting: 'pools', rs: 1 } }[preset]; // ultra's 2x is capped at dpr 1
      check(`${preset} ${hour}h: graphics applied, backing store = css px x renderScale`, g.shadows === want.shadows && g.lighting === want.lighting && g.rs === want.rs && g.w === Math.round(g.cw * want.rs), g);
      const f = path.join(shotDir, `town-${preset}-${hour}.png`);
      fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG());
      console.log('screenshot', f);
    }
  }
  // 50% render scale (custom), upscaled without smoothing
  await js(`Graphics.save({ preset: 'custom', custom: { renderScale: .5, shadows: 'blob', lighting: 'tint' } })`);
  await w.loadURL(base + '/town?hour=12');
  for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
  await wait(800);
  const lo = await js(`(() => { const c = document.getElementById('town'); return { rs: __town.api.stats().graphics.renderScale, w: c.width, cw: c.clientWidth, ir: getComputedStyle(c).imageRendering }; })()`);
  check('50% scale: half-size backing store, pixelated upscale', lo.rs === .5 && lo.w === Math.round(lo.cw / 2) && lo.ir === 'pixelated', lo);
  const fl = path.join(shotDir, 'town-scale50-12.png');
  fs.writeFileSync(fl, (await w.webContents.capturePage()).toPNG());
  console.log('screenshot', fl);

  // a live preset change re-renders without a reload
  const fr = await js('__town.api.frameCount()');
  await js(`__town.api.setGraphics(Graphics.resolve({ preset: 'low' }, Graphics.env()))`); await wait(300);
  check('setGraphics re-renders with the new settings', (await js('__town.api.frameCount()')) > fr && (await js('__town.api.stats().graphics.shadows')) === 'off');
  check('no console errors after graphics changes', errors.length === 0, errors);

  // Ambient animation (town step 4): idle frame counts at the fps cap, and Ultra shots a few frames apart.
  const boot = async (preset, saver) => {
    await js(`localStorage.setItem('ao.powerSaver', '${saver}'); Graphics.save({ preset: '${preset}' })`);
    await w.loadURL(base + '/town?hour=12');
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    await wait(800);
  };
  const idleFrames = async ms => { const a = await js('__town.api.frameCount()'); await wait(ms); return (await js('__town.api.frameCount()')) - a; };
  await boot('low', '1');
  const lowF = await idleFrames(3000);
  check('Low (ambient off): 0 frames in 3 s idle', lowF === 0, lowF);
  await boot('high', '1');
  const hiF = await idleFrames(3000);
  check('High + power saver: ambient runs, <= 30 frames in 3 s (8 fps cap)', hiF > 0 && hiF <= 30, hiF);
  await js(`document.documentElement.dataset.anim = 'off'`); await wait(300);
  const offF = await idleFrames(3000);
  check('html[data-anim=off]: 0 frames in 3 s', offF === 0, offF);
  await boot('ultra', '0');
  const ulF = await idleFrames(1000);
  check('Ultra, power saver off: ambient near 60 fps', ulF >= 30, ulF);
  for (const n of [1, 2]) {
    const f = path.join(shotDir, `town-ambient-ultra-${n}.png`);
    fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG());
    console.log('screenshot', f);
    await wait(170);
  }
  check('no console errors with ambient on', errors.length === 0, errors);

  // Canvas2D (town step 4): Low draws with Canvas2D; day and 22:00 shots, and frame times while walking.
  await js(`localStorage.setItem('ao.powerSaver', '1')`);
  for (const hour of [12, 22]) {
    await js(`Graphics.save({ preset: 'low' })`);
    await w.loadURL(base + '/town?hour=' + hour);
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    await wait(800);
    const k = await js(`({ kind: __town.api.kind, frames: __town.api.frameCount(), w: document.getElementById('town').width, cw: document.getElementById('town').clientWidth })`);
    check(`Low ${hour}h: Canvas2D renderer at 50% scale`, k.kind === 'canvas' && k.frames > 0 && k.w === Math.round(k.cw / 2), k);
    const f = path.join(shotDir, `town-low-${hour}.png`);
    fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG());
    console.log('screenshot', f);
  }
  await js(`window.__ms = []; window.__msT = setInterval(() => __ms.push(__town.api.stats().lastRenderMs), 16)`);
  const lf0 = await js('__town.api.frameCount()');
  key_('keyDown', 'A'); await wait(1500); key_('keyUp', 'A'); await wait(100);
  const walk = await js(`(() => { clearInterval(__msT); const m = __ms.slice().sort((a, b) => a - b); return { frames: __town.api.frameCount() - ${lf0}, max: m[m.length - 1], p50: m[m.length >> 1] }; })()`);
  check('Low walk: frames render, each < 16 ms', walk.frames > 20 && walk.max < 16, walk);
  check('no console errors on Canvas2D', errors.length === 0, errors);

  // Live renderer swap: High (GPU) -> Low (Canvas2D) -> High, without a reload; texture memory comes back to the same.
  await js(`Graphics.save({ preset: 'high' })`);
  await w.loadURL(base + '/town?hour=12');
  for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
  await wait(800);
  const s0 = await js(`({ kind: __town.api.kind, tb: __town.api.stats().textureBytes })`);
  await js(`Graphics.save({ preset: 'low' })`); await wait(1500);
  const s1 = await js(`({ kind: __town.api.kind, frames: __town.api.frameCount(), id: document.getElementById('town') && document.querySelectorAll('canvas#town').length })`);
  check('swap High -> Low: Canvas2D on a fresh canvas', s0.kind === 'gpu' && s1.kind === 'canvas' && s1.frames > 0 && s1.id === 1, { s0, s1 });
  await js(`Graphics.save({ preset: 'high' })`); await wait(1500);
  const s2 = await js(`({ kind: __town.api.kind, tb: __town.api.stats().textureBytes, frames: __town.api.frameCount() })`);
  check('swap Low -> High: GPU again, same textureBytes as the first High', s2.kind === 'gpu' && s2.frames > 0 && s2.tb === s0.tb, { s0, s2 });
  const pw = await pos(), cr = await js('(() => { const b = document.getElementById("town").getBoundingClientRect(); return { x: b.left + b.width / 2 - 120, y: b.top + b.height / 2 + 40 }; })()');
  w.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cr.x), y: Math.round(cr.y), button: 'left', clickCount: 1 }); await wait(30);
  w.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cr.x), y: Math.round(cr.y), button: 'left', clickCount: 1 }); await wait(1500);
  const pw2 = await pos();
  check('after the swaps, click-to-walk still works on the new canvas', Math.hypot(pw2.x - pw.x, pw2.y - pw.y) > 20, { pw, pw2 });
  const fs2 = path.join(shotDir, 'town-high-after-swap-12.png');
  fs.writeFileSync(fs2, (await w.webContents.capturePage()).toPNG());
  console.log('screenshot', fs2);
  check('no console errors after swaps', errors.length === 0, errors);
  // A swap whose new mount fails keeps the old renderer and canvas: no error box, one canvas, still renders.
  const infos = [];
  const onInfo = e => { if (e.level === 'info') infos.push(e.message); };
  w.webContents.on('console-message', onInfo);
  await js(`TownRender2D.mount = () => Promise.reject(new Error('test: Canvas2D unavailable')); Graphics.save({ preset: 'low' })`); await wait(1500);
  const sf0 = await js('__town.api.frameCount()');
  await js('__town.api.setCamera(__town.p.x + 1, __town.p.y)'); await wait(300);
  const sf = await js(`({ kind: __town.api.kind, canvases: document.querySelectorAll('canvas#town').length, err: getComputedStyle(document.getElementById('err')).display, frames: __town.api.frameCount() - ${sf0} })`);
  w.webContents.off('console-message', onInfo);
  check('failed swap keeps the GPU renderer, no error box, one console.info', sf.kind === 'gpu' && sf.canvases === 1 && sf.err === 'none' && sf.frames > 0 && infos.filter(m => /could not switch renderer/.test(m)).length === 1, { sf, infos });

  // WebGL failure falls back to Canvas2D: the town loads, no error box
  await js(`Graphics.save({ preset: 'high' })`);
  await w.loadURL(base + '/town?failgl=1&hour=22'); // stored preset is High (GPU): without the GPU the town runs at Low
  for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
  await wait(800);
  const box = await js(`(() => { const e = document.getElementById('err'); return { shown: getComputedStyle(e).display !== 'none', kind: window.__town && __town.api.kind, frames: window.__town && __town.api.frameCount(), ms: window.__town && __town.api.stats().lastRenderMs, g: window.__town && __town.api.stats().graphics, w: document.getElementById('town').width, cw: document.getElementById('town').clientWidth } })()`);
  check('WebGL failure falls back to Canvas2D, no error box', !box.shown && box.kind === 'canvas' && box.frames > 0, box);
  check('the fallback runs at Low: 50% backing store, shadows and lighting off', box.g && box.g.renderScale === .5 && box.w === Math.round(box.cw / 2) && box.g.shadows === 'off' && box.g.lighting === 'off', box);
  const fg = path.join(shotDir, 'town-failgl-22.png');
  fs.writeFileSync(fg, (await w.webContents.capturePage()).toPNG());
  console.log('screenshot', fg);

  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
