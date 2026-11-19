// Live check of the notch (not in npm test). Runs the real desktop app (desktop/main.mjs: its server and the notch window) on a
// temp profile and a free port, with no tray and no global shortcut (AGENT_OFFICE_NO_GLOBALS), audio muted and the cursor faked
// (the owner's mouse is never moved and the notch is never focused). The profile starts with a 2.1 kiro.json and a seeded
// notch-store.json. The calendar link points at calendar.example.com: the main process's fetch is wrapped before the app loads,
// so only that host is answered, from a fixture ICS served on 127.0.0.1 (the app's https/public-host rule is not weakened).
// The link is never printed; the check asserts it is in no log, file or page.
// The process launched by npm is only the parent: it builds the profile, starts this same file as a second Electron with the
// profile's environment (NOTCH_CHECK_CHILD), and after it quits checks that no helper it started (server, perf.ps1, PresentMon,
// PowerShell) is left running. Game mode 'always' starts perf.ps1 and, for the foreground program, our own PresentMon session.
// usage: npm run check:notch   (prints ALL PASSED; exit 1 on any failure)
const { app, BrowserWindow, screen, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), net = require('net'), http = require('http');
const root = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
app.commandLine.appendSwitch('mute-audio');

// A kiro.json as 2.1 wrote it: every 2.1 island setting, no look / homeCards / gameMode / games yet.
const FIXTURE_21 = { hidden: true, islandMode: 'always', lyricsOptInV2: true, islandSettings: {
  theme: 'forest', accent: '#ffcf6b', physics: 'snappy', pinned: ['today', 'mute', 'calendar', 'settings'], hour12: false, clockInPill: true,
  zone2: '', zone2Label: '', weekStart: 1, edgeDelay: 0, leaveDelay: 900, nowPlaying: false, kiroFace: true, animate: true, powerSaver: true,
  lyrics: false, notchEnabled: true, notchShortcut: 'Ctrl+Shift+N' } };

if (process.env.NOTCH_CHECK_CHILD !== '1') parent(); else child();

// ---------- parent: profile, child app, leftovers ----------
function parent() {
  require('./tmp-sweep.cjs').sweep();
  const tmps = [], mk = () => { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-notchcheck-')); tmps.push(t); return t; };
  app.setPath('userData', mk());
  const done = c => { for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true }); } catch {} app.exit(c); };
  app.whenReady().then(async () => {
    const prof = mk(), cfg = path.join(prof, '.claude', 'agent-office');
    for (const d of [cfg, path.join(prof, 'AppData', 'Roaming'), path.join(prof, 'AppData', 'Local')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'kiro.json'), JSON.stringify(FIXTURE_21));
    const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    fs.writeFileSync(path.join(cfg, 'notch-store.json'), JSON.stringify({ notes: [{ id: 'seednote1', text: 'Seeded note' }], timers: [], counters: [{ id: 'seedctr1', name: 'Water', goal: 8, count: 3, day }], pomodoro: { focus: 25, rest: 5, rounds: 4 } }));
    const port = await new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
    const t0 = new Date(Date.now() - 2000);
    const env = { ...process.env, USERPROFILE: prof, HOME: prof, APPDATA: path.join(prof, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(prof, 'AppData', 'Local'),
      AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_NO_GLOBALS: '1', AGENT_OFFICE_NO_TUNNEL: '1', NOTCH_CHECK_CHILD: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const c = spawn(process.execPath, [__filename, '--mute-audio', '--hidden'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    c.stdout.on('data', b => { out += b; process.stdout.write(b); }); c.stderr.on('data', b => { const s = String(b); if (!/DevTools|GPU|gpu_|cache/i.test(s)) process.stdout.write('[child stderr] ' + s); });
    const killer = setTimeout(() => { console.log('FAIL watchdog: the app did not quit within 240 s'); spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }); }, 240000);
    const code = await new Promise(r => c.on('exit', r)); clearTimeout(killer);
    // Leftovers: anything started by the app process, or carrying the profile, the app's perf.ps1, PresentMon or server.mjs, still alive.
    let left = '';
    if (process.platform === 'win32') for (let i = 0; i < 10; i++) {
      await wait(1000);
      const q = s => s.replace(/'/g, "''");
      const ps = `$t=[datetime]::Parse('${t0.toISOString()}'); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CreationDate -ge $t -and ($_.ParentProcessId -eq ${c.pid} -or $_.CommandLine -like '*${q(prof)}*' -or $_.CommandLine -like '*${q(path.join(root, 'desktop', 'perf.ps1'))}*' -or $_.ExecutablePath -like '*${q(path.join(root, 'vendor', 'presentmon'))}*' -or $_.CommandLine -like '*${q(path.join(root, 'server.mjs'))}*') } | ForEach-Object { '' + $_.ProcessId + ' ' + $_.Name }`;
      left = (spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).stdout || '').trim();
      if (!left) break;
    }
    const fails = (out.match(/^FAIL /mg) || []).length;
    const okRun = /^ALL PASSED$/m.test(out) && fails === 0;
    console.log((left ? 'FAIL' : 'PASS') + ' no helper of the app is left running after quit' + (left ? '  ' + JSON.stringify(left.split(/\r?\n/)) : ''));
    console.log('app exit code', code);
    const ok = okRun && !left;
    console.log(ok ? 'NOTCH CHECK PASSED' : 'NOTCH CHECK FAILED');
    done(ok ? 0 : 1);
  });
}

// ---------- child: the app itself, driven from its own main process ----------
function child() {
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'notch-check-userdata'));
  const CFG = path.join(os.homedir(), '.claude', 'agent-office');
  let failed = 0;
  const check = (n, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
  const finish = () => { console.log(failed ? 'FAILED ' + failed : 'ALL PASSED'); app.quit(); };
  setTimeout(() => { console.log('FAIL watchdog'); failed++; finish(); }, 200000).unref();
  process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); failed++; finish(); });

  // The fixture calendar: events today and tomorrow, one with a Teams link, served locally; the secret part of the link is random.
  const SECRET = crypto.randomBytes(12).toString('hex'), LINK = `https://calendar.example.com/ical/${SECRET}/basic.ics`;
  const pad = n => String(n).padStart(2, '0'), now = new Date();
  const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const day = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const soon = new Date(Math.ceil((Date.now() + 40 * 60e3) / 60e3) * 60e3); // more than 15 min ahead: never the closed line's "in N min"
  const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Design review', `DTSTART:${stamp(soon)}`, `DTEND:${stamp(new Date(+soon + 30 * 60e3))}`, 'DESCRIPTION:Join https://teams.microsoft.com/l/meetup-join/notch-check', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Team offsite', `DTSTART;VALUE=DATE:${day(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))}`, `DTEND;VALUE=DATE:${day(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))}`, 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const ics = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/calendar' }); r.end(ICS); }).listen(0, '127.0.0.1');
  const realFetch = globalThis.fetch; let calCalls = 0;
  globalThis.fetch = (u, o) => String(u).startsWith('https://calendar.example.com/') ? (calCalls++, realFetch(`http://127.0.0.1:${ics.address().port}/cal.ics`, { ...o, redirect: 'manual' })) : realFetch(u, o);
  const opened = []; shell.openExternal = async u => { opened.push(u); }; // nothing leaves for a browser

  import(require('url').pathToFileURL(path.join(root, 'desktop', 'main.mjs')).href).catch(e => { console.log('FAIL import ' + e.stack); failed++; finish(); });
  app.whenReady().then(async () => {
    const P = screen.getPrimaryDisplay().bounds, AWAY = { x: P.x + Math.round(P.width / 2), y: P.y + P.height - 5 };
    let fake = AWAY; screen.getCursorScreenPoint = () => fake;
    const until = async (fn, ms = 10000) => { let v; for (const end = Date.now() + ms; ;) { try { v = await fn(); } catch { v = null; } if (v || Date.now() > end) return v; await wait(200); } };
    const errors = [], hooked = new Set();
    const find = () => BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && / Island$/.test(x.getTitle()));
    const island = async () => {
      const w = await until(find, 60000); if (!w) return null;
      if (!hooked.has(w.id)) { hooked.add(w.id); w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(String(e.message).slice(0, 200)); }); w.webContents.on('render-process-gone', (_e, d) => errors.push('renderer gone ' + d.reason)); }
      await until(() => !w.webContents.isLoading() && w.webContents.executeJavaScript('typeof render === "function" && typeof S === "object"'), 30000);
      return w;
    };
    let w = await island();
    if (!w) { check('the notch window appears', false); return finish(); }
    const js = x => w.webContents.executeJavaScript(x);
    const txt = sel => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const bounds = () => w.getBounds();
    const openNow = async () => { const b = bounds(); fake = { x: b.x + Math.round(b.width / 2), y: P.y + 8 }; await wait(500); fake = { x: P.x + Math.round(P.width / 2) - 200, y: P.y + 200 }; return until(async () => (await js("view === 'open'")) && bounds().width >= 1000, 5000); };
    const closeNow = async () => { fake = AWAY; return until(async () => (await js("view !== 'open'")) && bounds().width < 1000, 8000); };
    const bridge = JSON.parse(fs.readFileSync(path.join(CFG, 'bridge.json'), 'utf8'));
    const BASE = 'http://127.0.0.1:' + new URL(w.webContents.getURL()).port;
    const ask = cmd => realFetch(BASE + '/bridge/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': bridge.key }, body: JSON.stringify({ session: 'notch-check', tool: 'Bash', input: { command: cmd } }) }).then(r => r.json());
    const kiro = () => JSON.parse(fs.readFileSync(path.join(CFG, 'kiro.json'), 'utf8')).islandSettings;
    const probe = () => js(`window.__decides = []; window.__chimes = []; if (!window.__f) { window.__f = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/decide')) __decides.push(JSON.parse(o.body)); return __f(u, o); }; } chime = k => { __chimes.push(k); }; 1`);
    await probe();

    // ---- a 2.1 kiro.json loads intact ----
    await until(() => js('online'), 15000);
    const s0 = await js('({ theme: S.theme, pinned: S.pinned, short: S.notchShortcut, physics: S.physics, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() })');
    check('2.1 kiro.json: theme, pinned actions and shortcut load intact', s0.theme === 'forest' && s0.accent === '#6bdb94' && s0.pinned.join() === 'today,mute,calendar,settings' && s0.short === 'Ctrl+Shift+N' && s0.physics === 'snappy', s0);
    const k0 = kiro();
    check('…and stay so on disk', k0.theme === 'forest' && k0.pinned.join() === 'today,mute,calendar,settings' && k0.notchShortcut === 'Ctrl+Shift+N' && k0.notchEnabled === true, { theme: k0.theme, pinned: k0.pinned, short: k0.notchShortcut, look: k0.look, gameMode: k0.gameMode });

    // ---- closed at start ----
    const c0 = { view: await js('view'), kind: await js("(document.querySelector('#pill') || {}).className"), b: bounds() };
    check('closed view at start', c0.view === 'closed' && c0.b.width === 180 && /\bclosed\b/.test(c0.kind), c0);

    // ---- a posted ask opens the notch on the Approvals card; Allow posts /api/decide allow ----
    const a1 = ask('echo first');
    const op1 = await until(async () => (await js("view === 'open' && !!document.querySelector('[data-card=approvals] [data-ask][data-d=allow]')")) && bounds().width >= 1000);
    check('a posted ask opens the notch and shows the Approvals card', !!op1, { view: await js('view'), b: bounds(), card: (await txt('[data-card=approvals]')).slice(0, 80) });
    await js("document.querySelector('[data-card=approvals] [data-ask][data-d=allow]').click(); 1");
    const r1 = await Promise.race([a1, wait(8000).then(() => null)]);
    const d1 = await js('__decides');
    check('clicking Allow posts /api/decide with allow', d1.length === 1 && d1[0].decision === 'allow' && r1 && r1.decision === 'allow', { decides: d1, bridge: r1 });
    await closeNow();

    // ---- typing y in the Notes input does not answer a second ask ----
    let r2 = null; const a2 = ask('echo second'); a2.then(r => { r2 = r; });
    await until(() => js("view === 'open' && asksOf(snap).length === 1"));
    await js("selectTab('notes'); 1");
    await until(() => js("!!document.querySelector('[data-fk=\"note-new-tab\"]')"));
    await js("document.querySelector('[data-fk=\"note-new-tab\"]').focus(); 1");
    for (const type of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: 'y' });
    await wait(1200);
    const typed = await js("document.querySelector('[data-fk=\"note-new-tab\"]').value");
    check('typing y in the Notes input does not answer a second ask', typed === 'y' && (await js('__decides.length')) === 1 && r2 === null && (await js('asksOf(snap).length')) === 1, { typed, decides: await js('__decides.length'), stillWaiting: await js('asksOf(snap).length') });
    await js("document.querySelector('[data-fk=\"note-new-tab\"]').value = ''; selectTab('approvals'); 1");
    await until(() => js("!!document.querySelector('#page [data-ask][data-d=deny]')"));
    await js("document.querySelector('#page [data-ask][data-d=deny]').click(); 1");
    await until(() => r2, 8000);
    check('…and the second ask is still answered by its own button (deny)', r2 && r2.decision === 'deny', r2);
    await closeNow();

    // ---- every tab renders without a console error ----
    await openNow();
    const before = errors.length, tabs = {};
    for (const t of await js('NotchCore.TABS')) { await js(`selectTab(${JSON.stringify(t)}); 1`); await wait(400); tabs[t] = (await js("document.getElementById('page').innerText.trim().length")) > 0 && (await js('tab')) === t; }
    await js("panel = 'settings'; render(); 1"); await wait(400); tabs.settings = (await js("document.getElementById('page').innerText")).includes('Toggle shortcut');
    check('every tab (and Settings) renders without a console error', Object.values(tabs).every(Boolean) && errors.length === before, { tabs, errors: errors.slice(before, before + 3) });
    await js("selectTab('notes'); 1"); await wait(300);
    check('the seeded store shows (notes and counters)', (await txt('#page')).length > 0 && (await js("[...document.querySelectorAll('[data-note]')].some(i => i.value === 'Seeded note')")) && (await js("store.counters.some(c => c.name === 'Water' && c.count === 3)")));
    await js("selectTab('home'); 1");
    await closeNow();

    // ---- a 2-second countdown fires once and shows in the closed line ----
    await js("__chimes = []; commit(s => { s.timers.push({ id: 'chktimer1', name: 'Tea', kind: 'countdown', endsAt: Date.now() + 2000, startedAt: Date.now(), pausedLeft: null, round: 0, phase: 'focus' }); }); 1");
    const running = await until(async () => { const t = await txt('#pill .lt'); return /^Tea 00:0[0-2]$/.test(t) && t; }, 1500);
    await wait(3500);
    const doneLine = await txt('#pill .lt'), ch1 = await js('__chimes.length');
    await wait(2500);
    const ch2 = await js('__chimes.length');
    check('a 2-second countdown shows in the closed line, fires once and says done', !!running && doneLine === 'Tea done' && ch1 === 1 && ch2 === 1, { running, doneLine, chimes: [ch1, ch2], b: bounds() });
    await js("commit(s => { s.timers = s.timers.filter(t => t.id !== 'chktimer1'); }); 1");

    // ---- the Calendar tab lists the fixture's events with a Join button ----
    await openNow(); await js("selectTab('calendar'); 1");
    await until(() => js("!!document.querySelector('[data-fk=\"cal-link\"]')"));
    await js(`(() => { const i = document.querySelector('[data-fk="cal-link"]'); i.value = ${JSON.stringify(LINK)}; i.form.requestSubmit(); })(); 1`);
    const listed = await until(async () => { const t = await txt('#page'); return /Design review/.test(t) && /Team offsite/.test(t) && t; }, 10000);
    const join = await js("[...document.querySelectorAll('#page [data-caljoin]')].map(b => b.textContent.trim())");
    check('the Calendar tab lists the fixture\'s events and a Join button', !!listed && join.length === 1 && join[0] === 'Join' && calCalls >= 1, { join, calCalls, host: await js('cal && cal.host') });
    const files = fs.readdirSync(CFG, { recursive: true }).map(f => path.join(CFG, String(f))).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    const leaks = files.filter(f => fs.readFileSync(f).includes(SECRET)).map(f => path.basename(f));
    const pageHas = await js(`document.documentElement.outerHTML.includes(${JSON.stringify(SECRET)}) || JSON.stringify(cal).includes(${JSON.stringify(SECRET)})`);
    check('the calendar link is in no page, log or file (calendar-link.bin is encrypted)', !pageHas && leaks.length === 0 && fs.existsSync(path.join(CFG, 'calendar-link.bin')), { pageHas, leaks });

    // ---- Trackers without plan limits ----
    await js("selectTab('trackers'); 1"); await wait(400);
    const lim = await js('snap && snap.usage ? snap.usage.limits : null'), trk = await txt('#page');
    check('Trackers shows "Not available" when plan limits are absent', /Plan, 5-hour session\s*Not available/.test(trk) && !(lim && lim.session), { limits: lim && (lim.error ? 'error' : lim.available === false ? 'available:false' : 'other'), text: trk.slice(0, 90) });
    await closeNow();

    // ---- game mode 'always' gives the game closed view ----
    await js("setPref({ gameMode: 'always' }); 1");
    const game = await until(async () => { const k = await js("(document.querySelector('#pill') || {}).className"); const t = await txt('#pill .lt'); return /\bgame\b/.test(k) && bounds().width === 360 && /% (CPU|GPU)/.test(t) && { k, t }; }, 15000);
    check("gameMode 'always' gives the game closed view", !!game, game || { kind: await js("(document.querySelector('#pill') || {}).className"), b: bounds() });

    // ---- Look: Solid recreates the window and the settings survive ----
    const oldId = w.id, oldForm = await js('form');
    await js("setPref({ look: 'solid' }); 1");
    const nw = await until(() => { const x = find(); return x && x.id !== oldId && x; }, 15000);
    if (nw) { w = await island(); await probe(); }
    const s1 = nw ? await until(() => js("online && ({ look: S.look, form, theme: S.theme, pinned: S.pinned, short: S.notchShortcut, gameMode: S.gameMode, notes: store.notes.length, dataLook: document.documentElement.dataset.look })"), 15000) : null;
    const k1 = kiro();
    check('switching Look to Solid recreates the window', !!nw && s1 && s1.look === 'solid' && s1.form === 'transparent' && s1.dataLook === 'solid', { oldForm, oldId, newId: nw && nw.id, s1 });
    check('…and the settings survive (page and kiro.json)', s1 && s1.theme === 'forest' && s1.pinned.join() === 'today,mute,calendar,settings' && s1.short === 'Ctrl+Shift+N' && s1.gameMode === 'always' && s1.notes >= 1
      && k1.look === 'solid' && k1.theme === 'forest' && k1.notchShortcut === 'Ctrl+Shift+N' && k1.gameMode === 'always', { k1: { look: k1.look, theme: k1.theme, short: k1.notchShortcut, gameMode: k1.gameMode } });
    const g2 = await until(async () => /\bgame\b/.test(await js("(document.querySelector('#pill') || {}).className")) && bounds().width === 360, 10000);
    check('…the new window is in the game closed view too', !!g2, { b: bounds() });

    // ---- the transparent window takes clicks only on its visible rectangle ----
    // Windows keeps this window style at least 39 px tall, so main cuts it with setShape; asked of Windows itself (WindowFromPoint, no input sent).
    const hwnd = () => String(w.getNativeWindowHandle().readBigUInt64LE(0));
    const hits = pts => { const ps = `Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(System.Drawing.Point p); [DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint f);' -ReferencedAssemblies System.Drawing; [void][W.U]::SetProcessDPIAware(); `
      + pts.map(p => screen.dipToScreenPoint(p)).map(p => `'' + [W.U]::GetAncestor([W.U]::WindowFromPoint((New-Object System.Drawing.Point ${p.x},${p.y})), 2).ToInt64()`).join('; ');
      return (spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).stdout || '').trim().split(/\r?\n/); };
    const clickRect = h => { const b = bounds(), cx = b.x + Math.round(b.width / 2), r = hits([{ x: cx, y: b.y + h - 2 }, { x: cx, y: b.y + h + 2 }]); return { b, inside: r[0] === hwnd(), below: r[1] === hwnd() }; };
    const hg = clickRect(36);
    check('the Solid game window takes clicks on its 36 px only (nothing below)', hg.b.y === P.y && hg.b.width === 360 && hg.inside && !hg.below, hg);
    await js("setPref({ gameMode: 'never' }); 1");
    const cl = await until(async () => /\bclosed\b/.test(await js("(document.querySelector('#pill') || {}).className")) && bounds().width === 180, 10000);
    const hc = clickRect(32);
    check('the Solid closed window takes clicks on its 32 px only (nothing below)', !!cl && hc.b.y === P.y && hc.inside && !hc.below, hc);

    check('no console errors in the notch page', errors.length === 0, errors.slice(0, 3));
    check('nothing was opened in a browser', opened.length === 0, opened.length);
    const logs = ['desktop.log', 'server.log'].map(f => path.join(CFG, f)).filter(f => fs.existsSync(f));
    check('the calendar link is in no log', logs.length > 0 && logs.every(f => !fs.readFileSync(f).includes(SECRET)), logs.map(f => path.basename(f)));
    fake = AWAY; ics.close();
    finish();
  });
}
