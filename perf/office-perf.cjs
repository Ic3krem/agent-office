// Office perf harness (town step 2): electron perf/office-perf.cjs. Temp-profile server on :4794, visible 1280x800 window,
// budgets enforced (exit 1 on a miss). Measures the office page with the shipped atlas: idle renderer CPU and frames, frame
// time while agents walk (preview 'work' scene), renderer private memory, and 20 enter/leave cycles town <-> office with
// renderer memory within +-10% of the first cycle (20 town <-> karinderya + game hall cycles are reported beside it).
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // a gc() before each cycle's memory sample keeps the drift honest
const root = path.join(__dirname, '..'), port = 4794, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-officeperf-'));
app.setPath('userData', path.join(tmp, 'electron'));
// Chromium keeps decoded images and resources of earlier pages in the renderer's memory cache, which grows for the first
// handful of visits and then plateaus (the town step 2 report). The cycle budget samples after webFrame.clearCache(), so it
// measures what the pages themselves keep; the raw number with the cache is reported beside it.
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, "const { webFrame } = require('electron'); window.__clearCache = () => webFrame.clearCache();");
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const done = code => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
setTimeout(() => { console.log('FAIL watchdog: harness exceeded 600 s'); done(1); }, 600000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { backgroundThrottling: true, contextIsolation: false, sandbox: false, preload } });
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

  await w.loadURL(base + '/');
  if (!(await officeReady('office'))) throw new Error('office did not boot with its atlas');
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

  // enter/leave cycles through the door URLs (a door is a page navigation); memory sampled on the town page after gc()
  const visit = async url => { await w.loadURL(base + url).catch(() => w.loadURL(base + url)); };
  // 20 cycles per pair; memory sampled on the town page after each cycle, with the renderer cache (raw) and after clearing it
  const run = async scenes => {
    const out = [], raw = [];
    for (let i = 0; i < 20; i++) {
      for (const sc of scenes) {
        await visit('/#scene=' + sc); if (!(await officeReady(sc))) throw new Error(sc + ' did not boot (cycle ' + (i + 1) + ')');
        await wait(400);
        await visit('/town#from=' + (sc === 'office' ? 'home' : sc)); if (!(await townReady())) throw new Error('town did not boot (cycle ' + (i + 1) + ')');
      }
      await js('window.gc && gc()'); await wait(1500); raw.push(privMB());
      await js('__clearCache(); window.gc && gc()'); await wait(1500); out.push(privMB());
    }
    return { mb: out, drift: (out[19] - out[0]) / out[0] * 100, rawMB: raw, rawDrift: (raw[19] - raw[0]) / raw[0] * 100 };
  };
  const office = await run(['office']), rooms = await run(['kain', 'games']);
  const c20 = office.mb[19], drift = office.drift;
  const gpuInfo = await app.getGPUInfo('basic').catch(() => ({})), cpu0 = os.cpus()[0];
  const R = {
    date: new Date().toISOString(),
    machine: { cpu: cpu0.model.trim() + ' x' + os.cpus().length, gpu: (gpuInfo.gpuDevice || []).map(d => d.deviceString || d.vendorId).join(' | '), ramGB: +(os.totalmem() / 1073741824).toFixed(1), os: os.type() + ' ' + os.release(), electron: process.versions.electron },
    idle: { powerSaver, cpuAvg: idle.avg, cpuMax: idle.max, frames10s: idleFrames },
    work: { frames30s: walkFrames, movingAtEnd: moving, drawP50: pct(dt, 0.5), drawP95: pct(dt, 0.95), drawMax: Math.max(...dt), loopP50: pct(ft, 0.5), loopP95: pct(ft, 0.95), samples: dt.length, rendererPrivateMB: workMem },
    cycles: { office, interiors: rooms },
  };
  // Office idle is not 0 frames: power-saver idle draws one frame per 500 ms (office-motion FRAME.IDLE), the existing
  // baseline the town step 2 rulings keep; the budget is that cadence (20 frames in 10 s, +1 for timer slack).
  const budgets = [
    ['office idle CPU < 3%', R.idle.cpuAvg < 3, R.idle.cpuAvg],
    ['office idle frames <= 21 in 10 s (power-saver idle cadence)', R.idle.frames10s <= 21, R.idle.frames10s],
    ['work scene draw p95 < 8 ms', R.work.drawP95 < 8, R.work.drawP95],
    ['renderer private < 250 MB (work scene)', R.work.rendererPrivateMB < 250, R.work.rendererPrivateMB],
    ['renderer private < 250 MB (after 20 cycles)', c20 < 250, c20],
    ['20 town <-> office cycles: memory within +-10% (renderer cache cleared)', Math.abs(drift) <= 10, drift],
  ];
  // Interiors (info, not a budget: the brief's cycle budget is town <-> office): 40 interior visits creep about 0.25 MB
  // each, all of it V8/Blink/Electron binding templates and session-history entries per navigation (heap snapshot diff,
  // docs/perf/town-step2.md); the documents, DOM nodes and listeners stay flat.
  R.budgets = budgets.map(([name, ok, value]) => ({ name, ok, value }));
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'office-step2-' + R.date.slice(0, 10) + '.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R.machine));
  for (const [n, ok, v] of budgets) console.log((ok ? 'PASS ' : 'FAIL ') + n + '  (' + (+v).toFixed(3) + ')');
  console.log('extra: idle max ' + idle.max.toFixed(2) + '%, power saver ' + powerSaver + ', draw p50 ' + R.work.drawP50.toFixed(2) + ' ms max ' + R.work.drawMax.toFixed(2) + ' ms, loop p50/p95 ' + R.work.loopP50.toFixed(2) + '/' + R.work.loopP95.toFixed(2) + ' ms over ' + dt.length + ' frames (' + moving + ' moving at the end)');
  for (const [n, c] of [['office', office], ['kain+games', rooms]]) console.log(n + ' cycles (cache cleared) ' + c.mb.map(v => v.toFixed(0)).join(' ') + '; with the cache ' + c.rawMB.map(v => v.toFixed(0)).join(' ') + ' (' + c.rawDrift.toFixed(1) + '%)');
  const bad = budgets.filter(b => !b[1]);
  if (bad.length) console.log('BUDGET BROKEN: ' + bad.map(b => b[0]).join('; '));
  done(bad.length ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
