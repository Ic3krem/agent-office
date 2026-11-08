// Live check of /town in Electron (not in npm test): temp-profile server on :4798, offscreen window, real key and mouse input.
// usage: node_modules/.bin/electron perf/town-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4798, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
require('./tmp-sweep.cjs').sweep();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-towncheck-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 300 s'); done(1); }, 300000).unref();
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


  // ---- town step 5: spots. Walking into each spot shows its line once (none again within the cooldown); parked visitors
  // draw at their points in both renderers; with ambient off nothing animates, visitors and animals included. ----
  // Visitors: up to 13 parked agents across the spots, injected by wrapping api.setTravellers (the page's own list is empty).
  const VIS = `(() => { const out = [], want = { park: ['sit', 'sit', 'dogwalk', 'dogwalk'], court: ['shoot', 'shoot', 'stand', 'stand'], tree: ['sit', 'sit'], waterfall: ['stand'], pasture: ['lean', 'lean'] };
    for (const s of __town.map.spots) { const used = new Set(); for (const act of want[s.id] || []) { const k = s.points.findIndex((p, j) => p.act === act && !used.has(j)); if (k < 0) continue; used.add(k);
      const p = s.points[k]; out.push({ id: 'vis-' + s.id + '-' + k, x: p.x, y: p.y, face: p.face, frame: 0, pose: act, spot: s.id, name: s.id + ' ' + k, moving: false, look: OfficeSprites.lookOf({ id: 'vis-' + s.id + k, name: s.id }) }); } }
    const api = __town.api; if (!api.__orig) { api.__orig = api.setTravellers; api.setTravellers = l => api.__orig(l.concat(window.__vis)); }
    window.__vis = out; api.setTravellers([]); return out.length; })()`;
  const bootAt = async (preset, q = '') => {
    await js(`localStorage.setItem('ao.powerSaver', '1'); Graphics.save({ preset: '${preset}' })`);
    await w.loadURL(base + '/town?hour=12' + q);
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    await wait(900);
  };
  await bootAt('high');
  const lines = await js(`fetch('/town/scenery-lines.json').then(r => r.json())`);
  const areas = (await js(`__town.map.spots.map(s => ({ id: s.id, rect: s.rect, target: s.points.find(p => p.act !== 'sit') || s.points[0] }))`))
    .map(a => ({ ...a, lines: [...lines.spots[a.id].day, ...lines.spots[a.id].night] }));
  const fnt = await js(`__town.map.decor.find(d => d.type === 'fountain')`);
  areas.push({ id: 'fountain', start: { x: fnt.x, y: fnt.y + 125 }, target: { x: fnt.x, y: fnt.y + 35 }, lines: [...lines.fountain.day, ...lines.fountain.night] });
  const arrive = async (t, ms = 12000) => { for (let i = 0; i < ms; i += 100) { const p = await pos(); if (!(await js('__town.p.moving')) && Math.hypot(p.x - t.x, p.y - t.y) < 12) return true; await wait(100); } return false; };
  // animals off for the walk-ins: a cat that wanders up first would speak instead (one bubble at a time; unit-tested)
  await js('window.__af = TownAnimals.frame; TownAnimals.frame = () => []; 0');
  for (const a of areas) {
    // a start outside the exit rect that walks to the target (the shortest of the candidates round the spot)
    const start = a.start || await js(`(() => { const r = ${JSON.stringify(a.rect)}, t = ${JSON.stringify(a.target)}, g = __town.grid, c = [];
      for (let k = 0; k <= 1; k += 0.1) { const x = r[0] - 60 + k * (r[2] - r[0] + 120), y = r[1] - 60 + k * (r[3] - r[1] + 120); c.push({ x, y: r[1] - 60 }, { x, y: r[3] + 60 }, { x: r[0] - 60, y }, { x: r[2] + 60, y }); }
      let best = null; for (const q of c) { if (q.x < 15 || q.y < 15 || q.x > __town.map.size.w - 15 || q.y > __town.map.size.h - 15 || g.blocked[WorldPath.cellOf(g, q)]) continue;
        const pth = WorldPath.findPath(g, q, t); if (!pth.length) continue; let len = 0; for (let i = 1; i < pth.length; i++) len += Math.hypot(pth[i].x - pth[i - 1].x, pth[i].y - pth[i - 1].y);
        if (!best || len < best.len) best = { x: q.x, y: q.y, len }; } return best; })()`);
    await js(`(() => { const q = WorldPlayer.unstick(WorldPlayer.create(${start.x}, ${start.y}), __town.grid); Object.assign(__town.p, { x: q.x, y: q.y, path: [], pi: 0 }); __town.draw(); })()`);
    for (let i = 0; i < 80 && (await js('__town.say()')) !== null; i++) await wait(100); // one bubble at a time: let the last one go
    const n0 = await js('__town.said()');
    await js(`__town.walk(${a.target.x}, ${a.target.y})`);
    const in1 = await arrive(a.target), said1 = await js('__town.said()'), text = await js('__town.say()');
    check(`spot ${a.id}: walking in shows its line once`, in1 && said1 === n0 + 1 && a.lines.includes(text), { start, arrived: in1, said: said1 - n0, text });
    if (a.id === 'park') { await wait(400); const f = path.join(shotDir, 'town-step5-bubble.png'); fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG()); console.log('screenshot', f); }
    await js(`__town.walk(${start.x}, ${start.y})`); await arrive(start);
    await js(`__town.walk(${a.target.x}, ${a.target.y})`); await arrive(a.target);
    const again = await js('__town.said()') - said1, t2 = await js('__town.say()'); // an animal may speak (cats on the plaza); the spot may not
    check(`spot ${a.id}: walking in again within 60 s shows nothing`, again === 0 || (again === 1 && !a.lines.includes(t2)), { again, text: t2 });
  }
  await js('TownAnimals.frame = window.__af; 0');
  const visitorsDrawn = async () => { // one non-moving visitor per spot: the renderer's hit test finds it at its point
    const list = await js(`window.__vis.filter(v => v.pose !== 'dogwalk').sort((a, b) => (b.x + b.y) - (a.x + a.y)).filter((v, i, a) => a.findIndex(o => o.spot === v.spot) === i)`), miss = [];
    for (const v of list) {
      await js(`__town.api.setCamera(${v.x}, ${v.y})`); await wait(250);
      const hit = await js(`(() => { const [x, y] = __town.api.toScreen(${v.x}, ${v.y}, 12); const h = __town.api.travellerAt(x, y); return h && h.id; })()`);
      if (hit !== v.id) miss.push({ id: v.id, hit });
    }
    return { n: list.length, miss };
  };
  check('High: 13 parked visitors across the spots', (await js(VIS)) === 13);
  const vh = await visitorsDrawn();
  check('High: each parked visitor draws at its point', vh.n === 5 && !vh.miss.length, vh);
  const fa = await js('__town.api.frameCount()'); await wait(2000);
  check('High: visitors and animals animate on ambient frames (power saver cap)', (await js('__town.api.frameCount()')) - fa > 0);
  await js(`document.documentElement.dataset.anim = 'off'`); await wait(400);
  const fo = await js('__town.api.frameCount()'); await wait(3000);
  check('High, ambient off: 0 frames in 3 s with visitors and animals present', (await js('__town.api.frameCount()')) === fo);
  check('no console errors at the spots', errors.length === 0, errors);
  await bootAt('low');
  check('Low: 13 parked visitors', (await js(VIS)) === 13 && (await js('__town.api.kind')) === 'canvas');
  const vl = await visitorsDrawn();
  check('Low: each parked visitor draws at its point', vl.n === 5 && !vl.miss.length, vl);
  await js(`__town.api.setCamera(1080, 655)`); await wait(500);
  const fl0 = await js('__town.api.frameCount()'); await wait(3000);
  check('Low (ambient off): 0 frames in 3 s with visitors and animals present', (await js('__town.api.frameCount()')) === fl0);
  check('no console errors on Low at the spots', errors.length === 0, errors);

  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
