// Live check of external specialists (not in npm test). An app server on a temp profile (:4793) with a fake "codex" CLI first
// on PATH (fixtures/fake-cli, an npm-style .cmd shim on Windows). Never runs the real Codex, Gemini or OpenCode.
// Checks: the Agents panel lists Codex as installed with the fake version; an ext-codex-1 desk joins the roster; the panel shows
// the warning and read-only lines; the test-only route runs the fake CLI (desk working, then idle, report back recorded) and is
// absent without AGENT_OFFICE_TEST_HOOKS=1; Stop ends a long run; no console errors.
// usage: node_modules/.bin/electron perf/external-check.cjs   (prints ALL PASSED)
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
require('./tmp-sweep.cjs').sweep();
const errors = [], kids = [], tmps = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const done = c => { for (const k of kids) try { k.kill(); } catch {} for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
setTimeout(() => { console.log('FAIL watchdog'); for (const k of kids) console.log('server log: ' + String(k.log || '').slice(-1500)); done(1); }, 120000).unref();
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, e => { console.log('FAIL ' + (e && e.stack)); done(1); });
const until = async (fn, ms = 15000) => { let v; for (let t = 0; t < ms; t += 250) { v = await fn(); if (v) return v; await wait(250); } return v; };
const tmpDir = () => { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-extcheck-')); tmps.push(t); return t; };
app.setPath('userData', tmpDir());

// A bin folder whose "codex" is the fake CLI.
const bin = tmpDir(), fake = path.join(root, 'fixtures', 'fake-cli');
fs.copyFileSync(path.join(fake, 'fake-cli.mjs'), path.join(bin, 'fake-cli.mjs'));
if (process.platform === 'win32') fs.copyFileSync(path.join(fake, 'fake-cli.cmd'), path.join(bin, 'codex.cmd'));
else { fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-cli.mjs" "$@"\n'); fs.chmodSync(path.join(bin, 'codex'), 0o755); }

const server = async (port, hooks) => {
  const tmp = tmpDir(), key = crypto.randomBytes(24).toString('hex');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'AppData'), LOCALAPPDATA: path.join(tmp, 'Local'),
    AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, AGENT_OFFICE_NO_TUNNEL: '1', ...(hooks ? { AGENT_OFFICE_TEST_HOOKS: '1' } : {}) };
  const pk = Object.keys(env).find(k => k.toUpperCase() === 'PATH'); const p = env[pk]; delete env[pk]; env.PATH = bin + path.delimiter + p;
  const s = spawn(process.execPath, [path.join(root, 'server.mjs')], { env }); s.log = ''; s.stdout.on('data', d => s.log += d); s.stderr.on('data', d => s.log += d); kids.push(s);
  for (let t = 0; !/running on/.test(s.log); t += 150) { if (t > 20000) throw new Error('server: ' + s.log.slice(0, 300)); await wait(150); }
  const ses = session.fromPartition('ext' + port), base = 'http://127.0.0.1:' + port;
  await ses.cookies.set({ url: base, name: 'ao_ui', value: key });
  const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: false, session: ses } });
  const js = x => w.webContents.executeJavaScript(x);
  w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(port + ': ' + e.message); });
  await w.loadURL(base + '/'); await until(() => js('!!window.OfficeWorld'));
  await js("localStorage.setItem('ao.powerSaver', '1')");
  const post = (u, b) => js(`fetch('${u}', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' }, body: ${JSON.stringify(JSON.stringify(b || {}))} }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))`);
  const get = u => js(`fetch('${u}', { headers: { 'x-nonce': (document.cookie.match(/(?:^|; )ao_nonce=([^;]*)/) || [])[1] || '' } }).then(r => r.json())`);
  // the first snapshot from the stream
  const snap = () => js(`(async () => { const ac = new AbortController(), r = await fetch('/api/stream', { signal: ac.signal }), rd = r.body.getReader(); let t = ''; while (!t.includes('\\n\\n')) { const c = await rd.read(); if (c.done) break; t += new TextDecoder().decode(c.value); } ac.abort(); return JSON.parse(t.slice(t.indexOf('data: ') + 6, t.indexOf('\\n\\n'))); })()`);
  return { s, w, js, post, get, snap };
};

app.whenReady().then(async () => {
  const A = await server(4793, true);
  await A.post('/api/switch', { name: 'kiro', on: false }); // no Claude session in a live check: report-backs go to the notes

  // (a) detection
  const ext0 = await A.get('/api/external?refresh=1');
  const cx = (ext0.detected || []).find(d => d.cli === 'codex');
  check('(a) Codex is detected with the fake version', cx && cx.installed && cx.version === 'fake-cli 1.2.3', cx);

  // (b) an ext-codex-1 desk joins the roster
  const { layout } = await A.get('/api/world');
  check('(b0) the Build catalog offers external desks', await A.js("RoleCatalog.ROLES.filter(r => r.kind === 'external').length") === 12);
  layout.objects.push({ id: 'desk-9', type: 'dept-desk', x: 1120, y: 500, desk: 'desk-9', role: 'ext-codex-1' });
  const saved = await A.post('/api/world', { layout });
  const r1 = await A.post('/api/roster', {});
  check('(b) saving a layout with an ext-codex-1 desk puts it on the roster', saved.status === 200 && (r1.roster || []).some(r => r.key === 'ext-codex-1' && r.desk === 'desk-9'), { saved: saved.status, keys: (r1.roster || []).map(r => r.key) });

  // (c) the Agents panel shows the desk with its warning and read-only lines
  await A.js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Agents').click()");
  const panel = await until(() => A.js(`(() => { const d = document.querySelector('[data-ext-desk="ext-codex-1"]'); return d && d.textContent; })()`));
  check('(c) the desk shows the warning line', !!panel && panel.includes("Runs with Codex's own permissions; TiroAgents' Security Guard does not check its commands."), panel);
  check('(c) the desk shows the read-only line and the usage label', !!panel && panel.includes('Read-only: turn on Auto mode to let it edit.') && panel.includes('usage: external'));
  const det = await A.js(`(() => { const d = document.querySelector('[data-cli="codex"]'); return d && d.textContent; })()`);
  check('(c) the panel lists Codex as installed', !!det && det.includes('fake-cli 1.2.3'), det);

  // (d) a run through the test-only route: working, then idle, and the answer reaches Tiro's inbox
  const PROMPT = 'SLEEP 2500 Review a & b | c > d %PATH% "q"';
  const st = await A.post('/api/external/test-run', { key: 'ext-codex-1', prompt: PROMPT });
  check('(d) the run starts', st.ok === true && st.text === 'started', st);
  const deskOf = s => (s.agents || []).find(a => a.profile && a.profile.key === 'ext-codex-1');
  const working = await until(async () => { const s = await A.snap(); const a = deskOf(s); return a && a.status === 'working' && s.boss.running === 1 && a; });
  check('(d) the desk turns working and counts toward the team', !!working, working && { status: working.status, task: working.task, role: working.role });
  const tell = await until(async () => (await A.post('/api/external/test-run', { lastTell: true })).lastTell, 20000);
  check('(d) the answer is reported back', /^Codex \(Codex CLI\) finished: echo: SLEEP 2500 Review a & b \| c > d %PATH% "q"/.test(tell || ''), tell);
  const idle = await until(async () => { const s = await A.snap(); const a = deskOf(s); return a && a.status === 'idle' && s.boss.running === 0; });
  check('(d) the desk goes idle and the count is released', !!idle);

  // (e) Stop during a long run
  await A.post('/api/external/test-run', { key: 'ext-codex-1', prompt: 'SLEEP 60000 a long task' });
  await until(async () => { const s = await A.snap(); return s.boss.running === 1; });
  const stop = await A.post('/api/external/stop', { key: 'ext-codex-1' });
  const stopped = await until(async () => { const t = (await A.post('/api/external/test-run', { lastTell: true })).lastTell; return /stopped by the user$/.test(t) && t; }, 10000);
  check('(e) Stop ends the run', stop.ok === true && !!stopped, { stop, stopped });
  check('(e) the count is released after Stop', await until(async () => (await A.snap()).boss.running === 0, 5000));
  check('(e) Stop on an idle desk is a 404', (await A.post('/api/external/stop', { key: 'ext-codex-1' })).status === 404);

  // the test route does not exist without the flag
  const B = await server(4794, false);
  check('(d) the test-only route is absent without AGENT_OFFICE_TEST_HOOKS', (await B.post('/api/external/test-run', { key: 'ext-codex-1', prompt: 'x' })).status === 404);

  check('(f) no console errors', errors.length === 0, errors.slice(0, 3));
  console.log(failed ? 'FAILED ' + failed : 'ALL PASSED');
  done(failed ? 1 : 0);
});
