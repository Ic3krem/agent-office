// Town perf harness: npm run perf:town. Temp-profile server on :4799, a visible window shaped like the app's office window
// (1440x900, its webPreferences and preload; the town is a navigation in that window), budgets enforced (exit 1 on a miss). Runs once per graphics preset (Low: Canvas2D, no ambient; High: GPU, ambient at its fps cap), set through
// Graphics.save on the temp profile: idle CPU and frames, a walk up a ramp onto a terrace and back (draw time p95), hidden
// CPU and frames, a mouse move (the town has no hover drawing: it must not start redrawing), renderer private memory and
// texture bytes.
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4799, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
require('./tmp-sweep.cjs').sweep();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-townperf-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 300 s'); done(1); }, 300000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const MB = 1048576, pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
// Low and High budgets (town step 4 plan, Task 10)
const BUDGET = { low: { cpu: 1, p95: 16, mem: 180, tex: 48 }, high: { cpu: 3, p95: 8, mem: 250, tex: 96 } };
const RAMP_FOOT = [650, 548]; // just below the ramp [620,380,680,540] (dir n): 1.25 s of walking world north (212 units) climbs onto the NW orchard terrace (the park)
const EAST_FOOT = [1690, 548]; // town step 5: the east ramp [1660,380,1720,540], up between the court and the pasture

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(root, 'desktop', 'office-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  // real mouse moves count as input (the office then draws smoothly for 1.5 s); the measured window never sees them. On the
  // step 4 machine something outside the harness moved the cursor 112 px every 20 s, which broke the office idle budget.
  // The mouse check injects its own moves with sendInputEvent, which this does not block.
  w.setIgnoreMouseEvents(true);
  const js = s => w.webContents.executeJavaScript(s);
  const boot = async () => {
    for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
    if (!(await js('!!window.__town'))) throw new Error('town did not boot');
  };
  await w.loadURL(base + '/town'); await boot();
  const frames = () => js('__town.api.frameCount()');
  const k = (type, keyCode) => w.webContents.sendInputEvent({ type, keyCode });

  const presetRun = async preset => {
    await js(`Graphics.save({ preset: '${preset}' })`);
    await w.loadURL(base + '/town'); await boot();
    const pid = w.webContents.getOSProcessId(); // only valid once the renderer exists
    const rendererCpu = () => { const m = app.getAppMetrics().find(x => x.pid === pid); return m ? m.cpu.percentCPUUsage : NaN; };
    // mean of 1 s samples over 10 s, plus the worst single sample
    const sampleCpu = async () => { const a = []; rendererCpu(); for (let i = 0; i < 10; i++) { await wait(1000); a.push(rendererCpu()); } return { avg: a.reduce((x, y) => x + y, 0) / a.length, max: Math.max(...a) }; };
    const g = await js('(({ kind, stats }) => ({ kind, ...stats().graphics }))(__town.api)');

    // town step 5: 13 agents parked at the spots for the whole run (idle, walk, hidden), as perf/town-check.cjs injects them
    await js(`(() => { const out = [], want = { park: ['sit', 'sit', 'dogwalk', 'dogwalk'], court: ['shoot', 'shoot', 'stand', 'stand'], tree: ['sit', 'sit'], waterfall: ['stand'], pasture: ['lean', 'lean'] };
      for (const s of __town.map.spots) { const used = new Set(); for (const act of want[s.id] || []) { const k = s.points.findIndex((p, j) => p.act === act && !used.has(j)); if (k < 0) continue; used.add(k);
        const p = s.points[k]; out.push({ id: 'vis-' + s.id + '-' + k, x: p.x, y: p.y, face: p.face, frame: 0, pose: act, spot: s.id, name: s.id, moving: false, look: OfficeSprites.lookOf({ id: 'vis-' + s.id + k, name: s.id }) }); } }
      const api = __town.api; api.__orig = api.setTravellers; api.setTravellers = l => api.__orig(l.concat(window.__vis)); window.__vis = out; api.setTravellers([]); })()`);

    await wait(5000);
    const fi0 = await frames(), idle = await sampleCpu(), idleFrames = (await frames()) - fi0;
    // sendInputEvent mouse moves; frames in the first second and in 3 s starting 3 s later. The page counts the moves it saw.
    await js('window.__moves = 0; addEventListener("pointermove", () => window.__moves++, true)');
    const fm0 = await frames();
    for (const [x, y] of [[700, 440], [740, 470], [720, 450]]) { w.webContents.sendInputEvent({ type: 'mouseMove', x, y }); await wait(50); }
    await wait(1000); const fm1 = await frames(); await wait(1850); const fm2 = await frames(); await wait(3000);
    const mouse = { moves: await js('window.__moves'), burst: fm1 - fm0, after: (await frames()) - fm2 };

    // walking: from the foot of a ramp, hold W+D (screen up-right = world north: up the ramp onto the terrace) then S+A (back
    // down), twice; lastRenderMs is
    // sampled on every drawn frame, and the highest ground the player stood on is kept
    const foot = f => js(`(() => { const q = WorldPlayer.unstick(WorldPlayer.create(${f}), __town.grid); __town.p.x = q.x; __town.p.y = q.y; })()`);
    await foot(RAMP_FOOT);
    const start = await js('({ x: Math.round(__town.p.x), y: Math.round(__town.p.y) })');
    await js(`window.__samples = []; window.__hmax = 0; (function s() { const f = __town.api.frameCount(); if (f !== window.__lf) { window.__lf = f; window.__samples.push(__town.api.stats().lastRenderMs); window.__hmax = Math.max(window.__hmax, TownMap.heightAt(__town.map, __town.p.x, __town.p.y)); } window.__walk = requestAnimationFrame(s); })()`);
    const fw0 = await frames(); w.webContents.focus();
    for (const f of [RAMP_FOOT, EAST_FOOT]) { await foot(f); for (let i = 0; i < 2; i++) for (const ks of [['W', 'D'], ['S', 'A']]) { for (const c of ks) k('keyDown', c); await wait(1250); for (const c of ks) k('keyUp', c); } }
    await js('cancelAnimationFrame(window.__walk)'); const walkFrames = (await frames()) - fw0;
    if (walkFrames < 120) throw new Error('keyboard injection did not walk the player: ' + walkFrames + ' frames');
    const end = await js('({ x: Math.round(__town.p.x), y: Math.round(__town.p.y) })'), samples = (await js('window.__samples')).filter(x => x > 0), hmax = await js('window.__hmax'), terrace = await js('TownMap.LEVEL_H');
    await wait(300);

    // hidden: dirty the scene every 100 ms so only the document.hidden guard keeps it from rendering
    w.hide(); await wait(1000);
    if ((await js('document.hidden')) !== true) throw new Error('window.hide() did not make the document hidden');
    await js('window.__dirty = setInterval(() => __town.api.setCamera(Math.random() * 4, Math.random() * 4), 100)');
    const fh0 = await frames(), hid = await sampleCpu(), hidFrames = (await frames()) - fh0;
    await js('clearInterval(window.__dirty)');
    w.show(); await wait(500);

    const mem = app.getAppMetrics().find(x => x.pid === pid).memory; // webContents.getProcessMemoryInfo is not in this Electron; same numbers (KB)
    if (typeof mem.privateBytes !== 'number') throw new Error('privateBytes missing from getAppMetrics');
    const gpu = app.getAppMetrics().find(x => x.type === 'GPU');
    const stats = await js('__town.api.stats()');
    return {
      graphics: g,
      idle: { cpuAvg: idle.avg, cpuMax: idle.max, frameDelta: idleFrames }, mouse,
      walking: { frames: walkFrames, p50: pct(samples, 0.5), p95: pct(samples, 0.95), max: Math.max(...samples), samples: samples.length, highestGround: hmax, terrace, start, end },
      hidden: { cpuAvg: hid.avg, cpuMax: hid.max, frameDelta: hidFrames },
      memory: { rendererPrivateMB: mem.privateBytes / 1024, gpuWorkingSetMB: gpu ? gpu.memory.workingSetSize / 1024 : null, textureMB: stats.textureBytes / MB, drawCalls: stats.drawCalls, sprites: stats.sprites },
    };
  };
  const presets = { low: await presetRun('low'), high: await presetRun('high') };

  const gpuInfo = await app.getGPUInfo('basic').catch(() => ({}));
  const cpu0 = os.cpus()[0];
  const R = {
    date: new Date().toISOString(),
    machine: { cpu: cpu0.model.trim() + ' x' + os.cpus().length, gpu: (gpuInfo.gpuDevice || []).map(d => d.deviceString || d.vendorId).join(' | '), ramGB: +(os.totalmem() / 1073741824).toFixed(1), os: os.type() + ' ' + os.release(), electron: process.versions.electron },
    presets,
  };
  const budgets = [];
  for (const [p, r] of Object.entries(presets)) {
    const B = BUDGET[p], P = p[0].toUpperCase() + p.slice(1);
    budgets.push(
      [P + ': graphics applied (' + r.graphics.kind + ' renderer, ambient ' + r.graphics.ambient + ')', r.graphics.kind === (p === 'low' ? 'canvas' : 'gpu') && r.graphics.ambient === (p === 'low' ? 'off' : 'all'), r.graphics.ambientFps],
      [P + ': idle CPU < ' + B.cpu + '%', r.idle.cpuAvg < B.cpu, r.idle.cpuAvg],
      [P + ': hidden CPU < 0.5%', r.hidden.cpuAvg < 0.5, r.hidden.cpuAvg],
      [P + ': hidden frame delta == 0', r.hidden.frameDelta === 0, r.hidden.frameDelta],
      [P + ': walk reached the terrace (ground height >= one level)', r.walking.highestGround >= r.walking.terrace, r.walking.highestGround],
      [P + ': town walk (ramp onto a terrace) draw p95 < ' + B.p95 + ' ms', r.walking.p95 < B.p95, r.walking.p95],
      [P + ': renderer private < ' + B.mem + ' MB', r.memory.rendererPrivateMB < B.mem, r.memory.rendererPrivateMB],
      [P + ': textureBytes < ' + B.tex + ' MB', r.memory.textureMB < B.tex, r.memory.textureMB]);
  }
  budgets.push(['Low (ambient off): idle frame delta == 0', presets.low.idle.frameDelta === 0, presets.low.idle.frameDelta],
    ['Low: a mouse move reaches the page and the town stays still (0 frames in the 3 s after 3 s)', presets.low.mouse.moves > 0 && presets.low.mouse.after === 0, presets.low.mouse.after],
    ['High: after a mouse move the town settles to its ambient cap (<= ambientFps * 3 + 2 frames in 3 s)', presets.high.mouse.moves > 0 && presets.high.mouse.after <= presets.high.graphics.ambientFps * 3 + 2, presets.high.mouse.after]);
  R.budgets = budgets.map(([name, ok, value]) => ({ name, ok, value }));
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'town-step5-' + R.date.slice(0, 10) + '.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R.machine));
  for (const [n, ok, v] of budgets) console.log((ok ? 'PASS ' : 'FAIL ') + n + '  (' + (+v).toFixed(3) + ')');
  for (const [p, r] of Object.entries(presets)) console.log(p + ' extra: ' + r.graphics.kind + ', ambient ' + r.graphics.ambient + ' at ' + r.graphics.ambientFps + ' fps, idle frames ' + r.idle.frameDelta + ' in 10 s, idle max ' + r.idle.cpuMax.toFixed(2) + '%, hidden max ' + r.hidden.cpuMax.toFixed(2) + '%, walk p50 ' + r.walking.p50.toFixed(2) + ' max ' + r.walking.max.toFixed(2) + ' ms over ' + r.walking.samples + ' frames (from ' + JSON.stringify(r.walking.start) + ' to ' + JSON.stringify(r.walking.end) + ', highest ground ' + r.walking.highestGround + '), gpu ' + (r.memory.gpuWorkingSetMB || 0).toFixed(0) + ' MB, drawCalls ' + r.memory.drawCalls + ', sprites ' + r.memory.sprites);
  const bad = budgets.filter(b => !b[1]);
  console.log(bad.length ? 'BUDGET BROKEN: ' + bad.map(b => b[0]).join('; ') : 'ALL PASSED');
  done(bad.length ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
