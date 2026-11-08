// Office perf harness (town step 2; per-preset budgets in step 4): electron perf/office-perf.cjs. Temp-profile server on
// :4794, visible 1280x800 window, budgets enforced (exit 1 on a miss). Per graphics preset (Low, High): idle renderer CPU and
// frames, frame time while agents walk (preview 'work' scene) and renderer private memory. Then 20 enter/leave cycles
// town <-> office (High): the JS heap after gc() stays within +-10% of the first cycle and renderer private bytes plateau
// (cycles 11-20 rise <= 3%). 20 town <-> karinderya + game hall cycles are reported beside it.
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // a gc() before each cycle's memory sample keeps the drift honest
const root = path.join(__dirname, '..'), port = 4794, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
require('./tmp-sweep.cjs').sweep();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-officeperf-'));
app.setPath('userData', path.join(tmp, 'electron'));
// Chromium keeps decoded images and resources of earlier pages in the renderer's memory cache, which grows for the first
// handful of visits and then plateaus (the town step 2 report). Private bytes are sampled after webFrame.clearCache(), so
// they measure what the pages themselves keep; the raw number with the cache is reported beside it.
// The window is sandboxed with context isolation, as the app's windows are (desktop/main.mjs). An unsandboxed preload starts
// a Node environment on every navigation whose binding templates are never freed: about 0.1 MB of JS heap per cycle, all
// FunctionTemplateInfo and code objects (heap snapshot diff, docs/perf/town-step4.md). That drift was the harness's own.
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, "const { webFrame, contextBridge } = require('electron'); contextBridge.exposeInMainWorld('__clearCache', () => webFrame.clearCache());");
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 900 s'); done(1); }, 900000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { backgroundThrottling: true, contextIsolation: true, sandbox: true, preload } });
  // real mouse moves count as input (the office then draws smoothly for 1.5 s); the measured window never sees them. On the
  // step 4 machine something outside the harness moved the cursor 112 px every 20 s, which broke the office idle budget.
  w.setIgnoreMouseEvents(true);
  w.webContents.on('will-prevent-unload', e => e.preventDefault());
  const js = s => w.webContents.executeJavaScript(s);
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 100) { try { if (await fn()) return true; } catch {} await wait(100); } return false; };
  const art = `OfficeFurniture.sprite({ save() {}, restore() {}, drawImage() {} }, 'tires', 0, 0)`;
  const officeReady = sc => until(() => js(`!!(window.OfficeWorld && OfficeWorld.scene() === ${JSON.stringify(sc)} && OfficeWorld.framesDrawn() > 0) && ${art}`));
  const townReady = () => until(() => js('!!window.__town'));
  const metric = () => app.getAppMetrics().find(x => x.pid === w.webContents.getOSProcessId());
  const rendererCpu = () => { const m = metric(); return m ? m.cpu.percentCPUUsage : NaN; };
  const privMB = () => metric().memory.privateBytes / 1024;
  const sampleCpu = async () => { const a = []; rendererCpu(); for (let i = 0; i < 10; i++) { await wait(1000); a.push(rendererCpu()); } return { avg: a.reduce((x, y) => x + y, 0) / a.length, max: Math.max(...a) }; };

  // Per preset: Graphics.save on the temp profile, then a fresh load reads it (Graphics.load).
  const presetRun = async preset => {
    await w.loadURL(base + '/');
    if (!(await officeReady('office'))) throw new Error('office did not boot with its atlas');
    await js(`Graphics.save({ preset: '${preset}' })`); await w.loadURL(base + '/');
    if (!(await officeReady('office'))) throw new Error('office did not boot with its atlas (' + preset + ')');
    if ((await js('Graphics.load().then(g => g.preset)')) !== preset) throw new Error('preset ' + preset + ' not applied');
    // the zone labels fade and the lights settle once (about 16 s); idle is measured after that
    await until(() => js('OfficeFurniture.state.labels <= 0.02 && Math.abs(OfficeFurniture.state.dim - (OfficeWorld.debug().board.empty ? 1 : 0)) <= 0.01'), 25000);
    w.webContents.focus(); await wait(3000);
    const powerSaver = await js('OfficeWorld.powerSaver()');
    const f0 = await js('OfficeWorld.framesDrawn()'), idle = await sampleCpu(), idleFrames = (await js('OfficeWorld.framesDrawn()')) - f0;

    // agents walking: the preview 'work' scene. Sampled on every drawn frame: the draw (lastRenderMs, as the town's step 1
    // walking number) and the whole loop callback (tick + draw, through requestAnimationFrame)
    await js(`window.__ft = []; window.__dt = []; (() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const s = performance.now(), f = OfficeWorld.framesDrawn(); cb(t); if (OfficeWorld.framesDrawn() !== f) { window.__ft.push(performance.now() - s); window.__dt.push(OfficeWorld.lastRenderMs()); } }); })(); OfficeWorld.setDemo('work')`);
    await wait(3000); await js('window.__ft = []; window.__dt = []');
    const fw0 = await js('OfficeWorld.framesDrawn()'); await wait(30000); // about 225 frames: a few lone 10-17 ms frames (GC, the OS) cannot decide p95
    const walkFrames = (await js('OfficeWorld.framesDrawn()')) - fw0, moving = await js('OfficeWorld.debug().agents.filter(a => a.moving).length');
    const ft = (await js('window.__ft')).filter(x => x > 0), dt = (await js('window.__dt')).filter(x => x > 0);
    if (walkFrames < 60) throw new Error('the work scene did not animate: ' + walkFrames + ' frames');
    const workMem = privMB();
    await js('OfficeWorld.setDemo(null)');
    return {
      idle: { powerSaver, cpuAvg: idle.avg, cpuMax: idle.max, frames10s: idleFrames },
      work: { frames30s: walkFrames, movingAtEnd: moving, drawP50: pct(dt, 0.5), drawP95: pct(dt, 0.95), drawMax: Math.max(...dt), loopP50: pct(ft, 0.5), loopP95: pct(ft, 0.95), samples: dt.length, rendererPrivateMB: workMem },
    };
  };
  const presets = { low: await presetRun('low'), high: await presetRun('high') }; // the cycles below run on High (the GPU town)

  // The town page and the back/forward cache: a page kept there would hold its renderer (and Pixi textures) while hidden.
  // A marker set on the town survives a back navigation only if the same document came back.
  await w.loadURL(base + '/town'); await townReady(); await js('window.__bf = 1');
  await w.loadURL(base + '/'); await officeReady('office');
  w.webContents.navigationHistory.goBack(); await townReady();
  const bfcache = await js('window.__bf === 1');

  // enter/leave cycles through the door URLs (a door is a page navigation); memory sampled on the town page after gc()
  const visit = async url => { await w.loadURL(base + url).catch(() => w.loadURL(base + url)); };
  // 20 cycles per pair; sampled on the town page after each cycle: private bytes with the renderer cache (raw) and after
  // clearing it, and the JS heap after gc(). gc() runs twice with a pause: the previous document is torn down
  // asynchronously, and one early gc() can still find it alive (a one-off +6 MB sample in the step 4 diagnosis).
  const run = async scenes => {
    const out = [], raw = [], heap = [];
    for (let i = 0; i < 20; i++) {
      for (const sc of scenes) {
        await visit('/#scene=' + sc); if (!(await officeReady(sc))) throw new Error(sc + ' did not boot (cycle ' + (i + 1) + ')');
        await wait(400);
        await visit('/town#from=' + (sc === 'office' ? 'home' : sc)); if (!(await townReady())) throw new Error('town did not boot (cycle ' + (i + 1) + ')');
      }
      await js('gc()'); await wait(1500); raw.push(privMB());
      await js('__clearCache(); gc()'); await wait(1500); out.push(privMB());
      heap.push(await js('gc(); performance.memory.usedJSHeapSize') / 1048576);
    }
    // heap: the worst cycle against the first. Private plateau: the least-squares rise over cycles 11-20 as a share of the
    // fitted value at cycle 11 (one sample's noise, a few MB, cannot decide it)
    const heapDrift = Math.max(...heap.map(v => Math.abs(v - heap[0]) / heap[0] * 100));
    const ys = out.slice(10), ym = ys.reduce((x, y) => x + y, 0) / ys.length, slope = ys.reduce((t, y, i) => t + (i - 4.5) * (y - ym), 0) / ys.reduce((t, _, i) => t + (i - 4.5) ** 2, 0);
    const plateau = slope * 9 / (ym - slope * 4.5) * 100;
    return { mb: out, drift: (out[19] - out[0]) / out[0] * 100, plateau, heapMB: heap, heapDrift, rawMB: raw, rawDrift: (raw[19] - raw[0]) / raw[0] * 100 };
  };
  const office = await run(['office']), rooms = await run(['kain', 'games']);
  const c20 = office.mb[19];
  const gpuInfo = await app.getGPUInfo('basic').catch(() => ({})), cpu0 = os.cpus()[0];
  const R = {
    date: new Date().toISOString(),
    machine: { cpu: cpu0.model.trim() + ' x' + os.cpus().length, gpu: (gpuInfo.gpuDevice || []).map(d => d.deviceString || d.vendorId).join(' | '), ramGB: +(os.totalmem() / 1073741824).toFixed(1), os: os.type() + ' ' + os.release(), electron: process.versions.electron },
    presets, townInBfcache: bfcache,
    cycles: { office, interiors: rooms },
  };
  // Office idle is not 0 frames: power-saver idle draws one frame per 500 ms (office-motion FRAME.IDLE), the existing
  // baseline the town step 2 rulings keep; the budget is that cadence (20 frames in 10 s, +1 for timer slack).
  const budgets = [];
  for (const [p, cpu, mem] of [['low', 1, 180], ['high', 3, 250]]) {
    const r = presets[p], P = p[0].toUpperCase() + p.slice(1);
    budgets.push([P + ': office idle CPU < ' + cpu + '%', r.idle.cpuAvg < cpu, r.idle.cpuAvg],
      [P + ': office idle frames <= 21 in 10 s (power-saver idle cadence)', r.idle.frames10s <= 21, r.idle.frames10s],
      [P + ': work scene draw p95 < 8 ms', r.work.drawP95 < 8, r.work.drawP95],
      [P + ': renderer private < ' + mem + ' MB (work scene)', r.work.rendererPrivateMB < mem, r.work.rendererPrivateMB]);
  }
  budgets.push(['the town page is not kept in the back/forward cache', !bfcache, bfcache ? 1 : 0],
    ['renderer private < 250 MB (after 20 cycles)', c20 < 250, c20],
    ['20 town <-> office cycles: JS heap after gc() within +-10% of cycle 1 (worst cycle)', office.heapDrift <= 10, office.heapDrift],
    ['20 town <-> office cycles: renderer private plateau, cycles 11-20 rise <= 3% (cache cleared)', office.plateau <= 3, office.plateau]);
  // Interiors (info, not a budget: the cycle budget is town <-> office).
  R.budgets = budgets.map(([name, ok, value]) => ({ name, ok, value }));
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'office-step4-' + R.date.slice(0, 10) + '.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R.machine));
  for (const [n, ok, v] of budgets) console.log((ok ? 'PASS ' : 'FAIL ') + n + '  (' + (+v).toFixed(3) + ')');
  for (const [p, r] of Object.entries(presets)) console.log(p + ' extra: idle max ' + r.idle.cpuMax.toFixed(2) + '%, power saver ' + r.idle.powerSaver + ', draw p50 ' + r.work.drawP50.toFixed(2) + ' ms max ' + r.work.drawMax.toFixed(2) + ' ms, loop p50/p95 ' + r.work.loopP50.toFixed(2) + '/' + r.work.loopP95.toFixed(2) + ' ms over ' + r.work.samples + ' frames (' + r.work.movingAtEnd + ' moving at the end)');
  for (const [n, c] of [['office', office], ['kain+games', rooms]]) console.log(n + ' cycles: heap MB ' + c.heapMB.map(v => v.toFixed(2)).join(' ') + ' (worst ' + c.heapDrift.toFixed(1) + '%); private MB, cache cleared ' + c.mb.map(v => v.toFixed(0)).join(' ') + ' (' + c.drift.toFixed(1) + '% end to end, plateau ' + c.plateau.toFixed(1) + '%); with the cache ' + c.rawMB.map(v => v.toFixed(0)).join(' ') + ' (' + c.rawDrift.toFixed(1) + '%)');
  const bad = budgets.filter(b => !b[1]);
  console.log(bad.length ? 'BUDGET BROKEN: ' + bad.map(b => b[0]).join('; ') : 'ALL PASSED');
  done(bad.length ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
