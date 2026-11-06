// Town perf harness: npm run perf:town. Temp-profile server on :4799, visible 1280x800 window, budgets enforced (exit 1 on a miss).
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), port = 4799, base = 'http://127.0.0.1:' + port, key = crypto.randomBytes(24).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-townperf-'));
app.setPath('userData', path.join(tmp, 'electron'));
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'), AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const done = code => { try { child.kill(); } catch {} app.exit(code); };
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
const MB = 1048576, pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

app.whenReady().then(async () => {
  for (let t = 0; !/running on/.test(log); t += 150) { if (t > 20000) throw new Error('server did not start: ' + log.slice(0, 300)); await wait(150); }
  await session.defaultSession.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { backgroundThrottling: true, contextIsolation: false } });
  const js = s => w.webContents.executeJavaScript(s);
  await w.loadURL(base + '/town');
  for (let t = 0; t < 15000 && !(await js('!!window.__town')); t += 200) await wait(200);
  if (!(await js('!!window.__town'))) throw new Error('town did not boot');
  const pid = w.webContents.getOSProcessId(); // only valid once the renderer exists
  const frames = () => js('__town.api.frameCount()');
  const rendererCpu = () => { const m = app.getAppMetrics().find(x => x.pid === pid); return m ? m.cpu.percentCPUUsage : NaN; };
  // mean of 1 s samples over 10 s, plus the worst single sample
  const sampleCpu = async () => { const a = []; rendererCpu(); for (let i = 0; i < 10; i++) { await wait(1000); a.push(rendererCpu()); } return { avg: a.reduce((x, y) => x + y, 0) / a.length, max: Math.max(...a) }; };

  await wait(5000);
  const fi0 = await frames(), idle = await sampleCpu(), idleFrames = (await frames()) - fi0;

  // walking: hold D/S alternately for 5 s, sample lastRenderMs on every animation frame
  await js(`window.__samples = []; (function s() { window.__samples.push(__town.api.stats().lastRenderMs); window.__walk = requestAnimationFrame(s); })()`);
  const fw0 = await frames(); w.webContents.focus();
  const k = (type, keyCode) => w.webContents.sendInputEvent({ type, keyCode });
  const t0 = Date.now(); let dir = 'D';
  while (Date.now() - t0 < 5000) { k('keyDown', dir); await wait(800); k('keyUp', dir); dir = dir === 'D' ? 'A' : 'D'; }
  await js('cancelAnimationFrame(window.__walk)'); const walkFrames = (await frames()) - fw0;
  if (walkFrames < 60) throw new Error('keyboard injection did not walk the player: ' + walkFrames + ' frames');
  const samples = (await js('window.__samples')).filter(x => x > 0);
  await wait(300);

  w.hide(); await wait(1000);
  const fh0 = await frames(), hid = await sampleCpu(), hidFrames = (await frames()) - fh0;
  w.show(); await wait(500);

  const mem = app.getAppMetrics().find(x => x.pid === pid).memory; // webContents.getProcessMemoryInfo is not in this Electron; same numbers (KB)
  const gpu = app.getAppMetrics().find(x => x.type === 'GPU');
  const stats = await js('__town.api.stats()');
  const gpuInfo = await app.getGPUInfo('basic').catch(() => ({}));
  const cpu0 = os.cpus()[0];
  const R = {
    date: new Date().toISOString(),
    machine: { cpu: cpu0.model.trim() + ' x' + os.cpus().length, gpu: (gpuInfo.gpuDevice || []).map(d => d.deviceString || d.vendorId).join(' | '), ramGB: +(os.totalmem() / 1073741824).toFixed(1), os: os.type() + ' ' + os.release(), electron: process.versions.electron },
    idle: { cpuAvg: idle.avg, cpuMax: idle.max, frameDelta: idleFrames },
    walking: { frames: walkFrames, p50: pct(samples, 0.5), p95: pct(samples, 0.95) },
    hidden: { cpuAvg: hid.avg, cpuMax: hid.max, frameDelta: hidFrames },
    memory: { rendererPrivateMB: (mem.privateBytes || 0) / 1024, gpuWorkingSetMB: gpu ? gpu.memory.workingSetSize / 1024 : null, textureMB: stats.textureBytes / MB, drawCalls: stats.drawCalls, sprites: stats.sprites },
  };
  const budgets = [
    ['idle CPU < 3%', R.idle.cpuAvg < 3, R.idle.cpuAvg],
    ['idle frame delta == 0', R.idle.frameDelta === 0, R.idle.frameDelta],
    ['hidden CPU < 0.5%', R.hidden.cpuAvg < 0.5, R.hidden.cpuAvg],
    ['hidden frame delta == 0', R.hidden.frameDelta === 0, R.hidden.frameDelta],
    ['walking p95 < 8 ms', R.walking.p95 < 8, R.walking.p95],
    ['renderer private < 250 MB', R.memory.rendererPrivateMB < 250, R.memory.rendererPrivateMB],
    ['textureBytes < 96 MB', R.memory.textureMB < 96, R.memory.textureMB],
  ];
  R.budgets = budgets.map(([name, ok, value]) => ({ name, ok, value }));
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'town-step1-' + R.date.slice(0, 10) + '.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R.machine));
  for (const [n, ok, v] of budgets) console.log((ok ? 'PASS ' : 'FAIL ') + n + '  (' + (+v).toFixed(3) + ')');
  console.log('extra: idle max ' + idle.max.toFixed(2) + '%, hidden max ' + hid.max.toFixed(2) + '%, walk p50 ' + R.walking.p50.toFixed(2) + ' ms over ' + samples.length + ' frames, gpu ' + (R.memory.gpuWorkingSetMB || 0).toFixed(0) + ' MB, drawCalls ' + stats.drawCalls + ', sprites ' + stats.sprites);
  const bad = budgets.filter(b => !b[1]);
  if (bad.length) console.log('BUDGET BROKEN: ' + bad.map(b => b[0]).join('; '));
  done(bad.length ? 1 : 0);
}).catch(e => { console.log('FAIL ' + e.stack); done(1); });
