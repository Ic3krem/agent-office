// Agent Office desktop app: runs the office server, keeps Tiro on the desktop, and lives in the tray.
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut, dialog, session, safeStorage } from 'electron';
import crypto from 'node:crypto';
import { normalizeGuardConfig, effectiveConfig, weakenings, signConfig, signRemember, verifyRemember } from '../guard/config.mjs';
import { CAT_NAMES } from '../guard/rules.mjs';
import { unsafeSwitches, unsafeEnv, unsafeMessage } from './startup-guard.mjs';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNowPlaying } from './nowplaying.mjs';
import { createLyrics, trackKey } from './lyrics.mjs';
import { checkForUpdate, downloadUpdate, makeUpdateDir, makeAssetPolicy, verifyBeforeLaunch, applyUpdatePatch, resolveFeed } from './updater.mjs';
import { officeNav } from './office-nav.mjs';
import { createRestartPolicy, restartLogLine } from './restart-policy.mjs';
import { candidatePorts, publishedPort, isAgentOffice } from '../ports.mjs';
import { readForWrite } from '../prefs-file.mjs';
import { resolveMode, pickDisplay, isleBoundsFor, inPeekZone, isFullscreenState, normalizeSettings, applyPatch, peekReady, notchEnabledOf, migrateNotchPrefs, migrateLyricsPrefs, notchStep } from './island-logic.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CFG_DIR = path.join(os.homedir(), '.claude', 'agent-office');
// The server binds 4777 or, when another program holds it, the next free port, and publishes the port in bridge.json.
const BRIDGE_FILE = path.join(CFG_DIR, 'bridge.json');
// AGENT_OFFICE_PORT pins one port (dev copies): probe that one and ignore the shared bridge.json, which may name another copy.
const PINNED = candidatePorts().length === 1;
let BASE = `http://localhost:${candidatePorts()[0]}`;
const followPort = () => { if (PINNED) return false; const p = publishedPort(BRIDGE_FILE), prev = BASE; if (p) BASE = `http://localhost:${p}`; return BASE !== prev; };
const KIRO_FILE = path.join(CFG_DIR, 'kiro.json');
const ICON = nativeImage.createFromPath(path.join(ROOT, 'desktop', 'icon.png'));
const KIRO_W = 380, KIRO_H = 600;

// A debugging port or inspector would let any local program drive the app's signed-in windows: refuse to start with one.
{ const bad = [...unsafeSwitches(process.argv), ...unsafeEnv().map(k => k + '=' + process.env[k])]; if (bad.length) { dialog.showErrorBox('Agent Office', unsafeMessage(bad)); process.exit(2); } }
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals'); // Tiro's see-through window
app.setAppUserModelId('io.github.ic3krem.agentoffice');

let server, office, kiro, island, tray;
const LOG_FILE = path.join(CFG_DIR, 'desktop.log');
const logLine = line => { try { fs.mkdirSync(CFG_DIR, { recursive: true }); try { if (fs.statSync(LOG_FILE).size > 200000) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch {} fs.appendFileSync(LOG_FILE, line + String.fromCharCode(10)); } catch {} };
// Startup read takes the same path as saves (readForWrite): a torn file is re-read once, a corrupt one moved to kiro.json.bad-<time>
// and logged, so the app never starts on defaults while a good file is mid-write (its next save would overwrite the real keys).
const prefs = (() => { try { return migrateLyricsPrefs(migrateNotchPrefs(readForWrite(KIRO_FILE, { log: logText }))); } catch (e) { logText('prefs not read, using defaults: ' + e.message); return migrateLyricsPrefs(migrateNotchPrefs({})); } })();
// agentNames, looks and graphics are owned by the server (rename, wardrobe and Graphics UI): keep whatever is on disk so a stale in-memory copy never overwrites it.
// A torn kiro.json is re-read once; a corrupt one is moved aside to kiro.json.bad-<time> and logged (readForWrite), so saves never stall.
const savePrefs = () => { try { fs.mkdirSync(CFG_DIR, { recursive: true }); let disk; try { disk = readForWrite(KIRO_FILE, { log: logText }); } catch (e) { logText('prefs not saved: ' + e.message); return; } const out = { ...prefs }; for (const k of ['agentNames', 'looks', 'graphics']) { if (disk[k]) out[k] = disk[k]; else delete out[k]; } fs.writeFileSync(KIRO_FILE, JSON.stringify(out)); } catch {} };

// ---------- the office server (reused if it is already running, e.g. from start.ps1) ----------
// The UI key exists only here and in the server's memory (env at spawn, then removed there). The windows get it as an HttpOnly
// SameSite=Strict cookie; it is never in a URL, a file or a log. Agents can read bridge.json but this key is not in it.
const UI_KEY = crypto.randomBytes(24).toString('hex');
// Every /api POST needs the server's per-start nonce: read it the way a window does (a page load sets the ao_nonce cookie).
const uiNonce = () => fetch(BASE + '/island', { headers: { cookie: 'ao_ui=' + UI_KEY }, signal: AbortSignal.timeout(2000) }).then(r => { r.body?.cancel(); return (/ao_nonce=([0-9a-f]+)/.exec(r.headers.get('set-cookie') || '') || [])[1] || ''; });
const uiPost = (p, body) => uiNonce().then(nonce => fetch(BASE + p, { method: 'POST', headers: { cookie: 'ao_ui=' + UI_KEY, 'content-type': 'application/json', 'x-nonce': nonce }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) }));
const signedIn = () => uiPost('/api/roster', {}).then(r => r.ok, () => false);
// Event log for the desktop shell: no environment, arguments or keys, only the event, exit code or signal, and the retry plan. Capped in size.
const logEvent = ev => logLine(restartLogLine(Date.now(), ev));
function logText(t) { logLine(new Date().toISOString() + ' prefs ' + String(t).slice(0, 300)); }
const restart = createRestartPolicy();
let quitting = false, gaveUp = false, restartTimer = null;
function spawnServer() {
  // Electron's own Node runs the server, so the app needs no separate Node install.
  // Packaged, ROOT is inside app.asar, which the OS sees as a file: a cwd there fails the spawn with ENOENT. Electron still
  // reads server.mjs from the archive, so only the working directory has to be a real folder.
  const started = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: app.isPackaged ? process.resourcesPath : ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_OFFICE_UI_KEY: UI_KEY, AGENT_OFFICE_GUARD_KEY: GUARD_KEY }, stdio: 'ignore', windowsHide: true });
  server = child;
  child.on('error', e => logEvent({ event: 'spawn-error', error: e?.code }));
  child.on('exit', (code, signal) => {
    if (server === child) server = null;
    if (quitting) return;
    const r = restart.onExit(Date.now() - started);
    logEvent({ event: 'exited', code, signal, attempt: r.attempt, delayMs: r.retry ? r.delayMs : undefined });
    if (!r.retry) { gaveUp = true; logEvent({ event: 'gave-up', attempt: r.attempt }); try { tray?.displayBalloon?.({ title: 'Agent Office', content: 'The office server stopped and could not be restarted. Quit and reopen Agent Office.' }); } catch {} return; }
    restartTimer = setTimeout(async () => {
      restartTimer = null; if (quitting || (await signedIn())) return;
      const before = BASE;
      spawnServer();
      if (await waitForServer() && BASE !== before) relocateWindows(); // it came back on another port: windows follow
    }, r.delayMs);
  });
}
// Our own server answers the UI key; anything else on the published port does not.
async function waitForServer() {
  for (let i = 0; i < 60; i++) { followPort(); if (await signedIn()) return true; if (gaveUp) return false; await new Promise(r => setTimeout(r, 500)); }
  return false;
}
async function ensureServer() {
  followPort();
  if (await signedIn()) return;
  if (await isAgentOffice(new URL(BASE).port)) throw new Error('Agent Office is already running on ' + BASE + ' (started by another program). Quit it, then start the app again.');
  spawnServer();
  if (!(await waitForServer())) throw new Error('The Agent Office server did not start. Details: ' + LOG_FILE);
}
function relocateWindows() {
  signInWindows();
  for (const w of [office, kiro, island]) {
    if (!w || w.isDestroyed()) continue;
    try { const u = new URL(w.webContents.getURL()); w.loadURL(url(u.pathname + u.search + u.hash)); } catch {}
  }
}
const url = p => `${BASE}${p}`;
const signInWindows = () => session.defaultSession.cookies.set({ url: BASE, name: 'ao_ui', value: UI_KEY, httpOnly: true, sameSite: 'strict', path: '/' });
// Every window: external links open in the browser, the page itself can never navigate away from the local server, no popups.
const external = wc => {
  wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  wc.on('will-navigate', (e, u) => { try { if (new URL(u).origin === new URL(BASE).origin) return; } catch {} e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
};

// Manager display name: read from kiro.json agentNames.tiro (server-owned), fallback "Tiro". Polled so renames show live.
let mgrName = 'Tiro';
const readMgrName = () => { try { const n = JSON.parse(fs.readFileSync(KIRO_FILE, 'utf8'))?.agentNames?.tiro; return typeof n === 'string' && n.trim() ? n.trim().slice(0, 40) : 'Tiro'; } catch { return 'Tiro'; } };
function applyMgrName(force) {
  const n = readMgrName();
  if (n === mgrName && !force) return;
  mgrName = n;
  try { if (kiro && !kiro.isDestroyed()) kiro.setTitle(n); } catch {}
  try { if (island && !island.isDestroyed()) island.setTitle(`${n} Island`); } catch {}
  try { tray?.setToolTip(`Agent Office - ${n}`); } catch {}
}
const keepTitle = w => w.on('page-title-updated', e => e.preventDefault());

// ---------- the office window: closing destroys it, the tray opens a new one ----------
const VIEWS = new Set(['today', 'reports', 'usage', 'office']);
function openOffice(view) {
  view = typeof view === 'string' && VIEWS.has(view) && view !== 'office' ? view : ''; // 'office' = just open the window
  if (!office) {
    office = new BrowserWindow({ width: 1440, height: 900, minWidth: 380, minHeight: 500, title: 'Agent Office', icon: ICON, backgroundColor: '#0f0c0d', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(ROOT, 'desktop', 'office-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
    office.loadURL(url('/') + (view ? '#' + view : ''));
    external(office.webContents);
    // The page refuses to unload while Build mode has unsaved changes: ask here, or the window would silently stay open.
    // An app quit (tray Quit, update install) always wins: before-quit has already stopped the server, so Stay would leave a dead app.
    office.webContents.on('will-prevent-unload', e => { if (quitting) return e.preventDefault(); if (dialog.showMessageBoxSync(office, { type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, message: 'You have unsaved layout changes.' }) === 0) e.preventDefault(); });
    office.on('closed', () => { office = null; });
    office.once('ready-to-show', () => office.show());
  } else {
    office.show();
    const nav = officeNav(office.webContents.getURL(), view);
    if (nav.load) office.loadURL(url('/') + (nav.hash ? '#' + nav.hash : ''));
    else if (nav.hash) office.webContents.executeJavaScript(`location.hash=${JSON.stringify(nav.hash)}`).catch(() => {});
  }
  office.focus();
}

// ---------- Tiro: a transparent, always-on-top window; clicks pass through except on Tiro itself ----------
function onScreen(x, y) {
  return screen.getAllDisplays().some(d => x + KIRO_W > d.workArea.x + 60 && x < d.workArea.x + d.workArea.width - 60 && y + KIRO_H > d.workArea.y + 60 && y < d.workArea.y + d.workArea.height);
}
function showKiro() {
  if (kiro) return kiro.showInactive();
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = prefs.x != null && onScreen(prefs.x, prefs.y) ? { x: prefs.x, y: prefs.y } : { x: wa.x + wa.width - KIRO_W - 12, y: wa.y + wa.height - KIRO_H };
  kiro = new BrowserWindow({
    ...pos, width: KIRO_W, height: KIRO_H, transparent: true, frame: false, resizable: false, movable: true, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: true, show: false, title: mgrName,
    webPreferences: { preload: path.join(ROOT, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  keepTitle(kiro);
  kiro.setAlwaysOnTop(true, 'screen-saver');
  kiro.setVisibleOnAllWorkspaces(true);
  kiro.setIgnoreMouseEvents(true, { forward: true });
  kiro.loadURL(url('/kiro'));
  external(kiro.webContents);
  kiro.once('ready-to-show', () => kiro.showInactive());
  kiro.on('closed', () => { kiro = null; });
}
const fromKiro = e => kiro && e.sender === kiro.webContents;
ipcMain.on('kiro:interactive', (e, on) => { if (fromKiro(e)) kiro.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('kiro:move', (e, dx, dy) => {
  if (!fromKiro(e) || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500) return;
  const [x, y] = kiro.getPosition(); kiro.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('kiro:moved', e => { if (!fromKiro(e)) return; [prefs.x, prefs.y] = kiro.getPosition(); savePrefs(); });
ipcMain.on('kiro:office', e => { if (fromKiro(e)) openOffice(); });


// ---------- Tiro island: a click-through notch at the top centre of a display ----------
// Prefs in kiro.json: islandMode always|smart|off, islandMute, islandDisplay cursor|primary|<display id>.
const isleMode = () => resolveMode(prefs);
const notchOn = () => notchEnabledOf(prefs);   // kiro.json islandSettings.notchEnabled (default on)
const isleDisplay = () => pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, screen.getCursorScreenPoint(), prefs.islandDisplay);
const isle = { fs: false, peek: false, edgeSince: null };
const isleSettings = () => normalizeSettings(prefs.islandSettings);
const alive = () => island && !island.isDestroyed();
let nowPlaying = null; // latest SMTC session (or null), pushed to the island on change and on page load
const pushNowPlaying = () => { if (alive()) island.webContents.send('island:nowplaying', isleSettings().nowPlaying && nowPlaying ? { ...nowPlaying, key: trackKey(nowPlaying) } : null); };
// Synced lyrics (LRCLIB, disk-cached in ~/.claude/agent-office/lyrics-cache). Only title/artist/album/duration ever leave the machine, only while a track is playing and the lyrics pref is on.
const lyricsClient = createLyrics({ dir: path.join(CFG_DIR, 'lyrics-cache'), userAgent: `Agent Office v${app.getVersion()} (local desktop app)` });
let lyr = { key: '', lines: null }, lyrAsked = '';
const pushLyrics = () => { if (alive()) island.webContents.send('island:lyrics', lyr.lines ? { key: lyr.key, lines: lyr.lines.map(l => [l.t, l.text]) } : null); };
function refreshLyrics() {
  const s = isleSettings(), key = s.lyrics && s.nowPlaying && nowPlaying ? trackKey(nowPlaying) : '';
  if (!key) { if (lyr.lines || lyr.key) { lyr = { key: '', lines: null }; pushLyrics(); } lyrAsked = ''; return; }
  if (key !== lyr.key) { lyr = { key, lines: null }; pushLyrics(); lyrAsked = ''; }
  if (!nowPlaying.playing || lyrAsked === key) return;
  lyrAsked = key;
  lyricsClient.get(nowPlaying).then(lines => { if (lyr.key === key) { lyr = { key, lines }; pushLyrics(); } });
}
const np = createNowPlaying(n => { nowPlaying = n; pushNowPlaying(); refreshLyrics(); });
// The SMTC poller is a resident PowerShell: it runs only while the island window is visible (not hidden, not behind a fullscreen app)
// and the now-playing setting is on, and is stopped otherwise.
const syncNowPlaying = () => { if (notchOn() && isleSettings().nowPlaying && isleMode() !== 'off' && alive() && island.isVisible() && !isle.fs) np.start(); else np.stop(); };
const pushIsland = () => { if (alive()) island.webContents.send('island:state', { mode: isleMode(), mute: !!prefs.islandMute, fs: isle.fs, peek: isle.peek, settings: isleSettings(), notchShortcutOk: notchKeyOk }); };
function placeIsland(force) {
  if (!alive()) return;
  const b = isleBoundsFor(isleDisplay().bounds), c = island.getBounds();
  if (!force && c.x === b.x && c.y === b.y && c.width === b.width && c.height === b.height) return;
  island.setBounds(b); island.setBounds(b); // twice: Windows mis-sizes the first call when the target display has another DPI scale
}
// Notch off: the window is destroyed, not just hidden, so nothing renders, polls or listens for it.
function destroyIsland() { if (alive()) { const w = island; island = null; try { w.destroy(); } catch {} } isle.peek = false; isle.edgeSince = null; }
function showIsland() {
  if (alive()) { placeIsland(); return island.showInactive(); }
  island = new BrowserWindow({
    ...isleBoundsFor(isleDisplay().bounds), transparent: true, frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, focusable: true, show: false, title: `${mgrName} Island`,
    webPreferences: { preload: path.join(ROOT, 'desktop', 'island-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required' }, // the chime plays with nobody clicking
  });
  keepTitle(island);
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true);
  island.setIgnoreMouseEvents(true, { forward: true });
  island.loadURL(url('/island'));
  external(island.webContents);
  island.webContents.on('did-finish-load', () => { pushIsland(); pushNowPlaying(); pushLyrics(); pushUpdate(); });
  island.once('ready-to-show', () => island.showInactive());
  island.on('show', () => syncNowPlaying()); island.on('hide', () => syncNowPlaying()); // the SMTC helper follows the window
  const me = island; island.on('closed', () => { if (island === me) island = null; }); // a destroyed window must not clear a newer one
}
const fromIsland = e => island && e.sender === island.webContents;
const fromOffice = e => office && !office.isDestroyed() && e.sender === office.webContents;
// ---------- Security Guard settings: the only place a weaker setting can be confirmed ----------
// A weaker setting needs a native confirmation dialog that only this process can show; the confirmed settings are saved with an HMAC (guard/confirmed.json)
// keyed by a secret that is encrypted with the OS (Electron safeStorage). A page, an agent or a hand edit of kiro.json cannot produce that HMAC.
const GUARD_DIR = path.join(CFG_DIR, 'guard');
let GUARD_KEY = '', GUARD_WEAK = false;   // GUARD_WEAK: the HMAC key sits in a plain 0600 file (no OS keyring)
function loadGuardKey() {
  try {
    fs.mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 });
    const enc = path.join(GUARD_DIR, 'hmac.key.enc'), plain = path.join(GUARD_DIR, 'hmac.key');
    if (safeStorage.isEncryptionAvailable()) {
      if (fs.existsSync(enc)) { try { return safeStorage.decryptString(fs.readFileSync(enc)); } catch { /* unreadable: make a new one below */ } }
      const k = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(enc, safeStorage.encryptString(k), { mode: 0o600 }); return k;
    }
    GUARD_WEAK = true;
    if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8').trim();            // no OS encryption here: a 0600 file is the best available
    const k = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(plain, k, { mode: 0o600 }); return k;
  } catch { GUARD_WEAK = true; return crypto.randomBytes(32).toString('hex'); }
}
// The terminal hook is 'node guard/hook.mjs': without node on PATH it cannot run, so say so instead of failing silently
let NODE_ON_PATH = true;
try { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { timeout: 2000, windowsHide: true, stdio: 'ignore' }); NODE_ON_PATH = r.status === 0; } catch { NODE_ON_PATH = false; }
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const guardEffective = () => effectiveConfig(prefs.guard, readJ(path.join(GUARD_DIR, 'confirmed.json')), GUARD_KEY);
const guardRemembered = () => verifyRemember(readJ(path.join(GUARD_DIR, 'remember.json'))?.entries, GUARD_KEY);
function guardSave(cfg) {
  const next = normalizeGuardConfig(cfg);
  prefs.guard = next; savePrefs();
  fs.mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(GUARD_DIR, 'confirmed.json'), JSON.stringify({ config: next, hmac: signConfig(next, GUARD_KEY) }), { mode: 0o600 });
  return next;
}
const guardSender = e => fromOffice(e) || fromIsland(e);
const guardView = () => ({ config: guardEffective().config, notices: guardEffective().notices, remembered: guardRemembered().map(r => ({ key: r.key, label: r.label || '', at: r.at || 0 })), names: CAT_NAMES, weakStorage: GUARD_WEAK, nodeOnPath: NODE_ON_PATH });
ipcMain.handle('guard:get', e => (guardSender(e) ? guardView() : null));
ipcMain.handle('guard:set', async (e, patch) => {
  if (!guardSender(e) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const word = typeof patch._confirm === 'string' ? patch._confirm.trim().toLowerCase() : '';
  const cur = guardEffective().config, next = normalizeGuardConfig({ ...cur, ...patch, trustedHosts: patch.trustedHosts ?? cur.trustedHosts, trustedNpx: patch.trustedNpx ?? cur.trustedNpx, syncRoots: patch.syncRoots ?? cur.syncRoots });
  const weak = weakenings(cur, next);
  if (weak.length) {
    if (GUARD_WEAK && word !== 'turn down') return { ...guardView(), needWord: true };   // weaker protection on this system: a typed word is required as well
    const parent = (fromOffice(e) ? office : island) || undefined;
    const lines = weak.map(w => '- ' + (CAT_NAMES[w.what] || w.what) + (w.from ? ': ' + w.from + ' -> ' + w.to : ': ' + w.to)).join('\n');
    const r = await dialog.showMessageBox(parent, { type: 'warning', title: 'Security Guard', message: 'Turn down Security Guard protection?', detail: lines + '\n\nThis makes it less likely that you are asked before secrets leave this computer, scripts run, or credentials are read. Only continue if you started this change yourself.', buttons: ['Keep protection on', 'Turn it down'], defaultId: 0, cancelId: 0, noLink: true });
    if (r.response !== 1) return guardView();
  }
  guardSave(next);
  return guardView();
});
ipcMain.handle('guard:remember', (e, key, label) => {
  if (!guardSender(e) || typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null;
  const entries = guardRemembered().filter(r => r.key !== key).concat([(() => { const e = { key, at: Date.now(), label: String(label ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) }; e.sig = signRemember(e, GUARD_KEY); return e; })()]).slice(-200);
  try { fs.mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(GUARD_DIR, 'remember.json'), JSON.stringify({ entries }), { mode: 0o600 }); } catch { return null; }
  return guardView();
});
ipcMain.handle('guard:forget', (e, key) => {
  if (!guardSender(e)) return null;
  const entries = key === 'all' ? [] : guardRemembered().filter(r => r.key !== key);
  try { fs.writeFileSync(path.join(GUARD_DIR, 'remember.json'), JSON.stringify({ entries }), { mode: 0o600 }); } catch { return null; }
  return guardView();
});
ipcMain.handle('notch:get', e => (fromOffice(e) ? notchOn() : null));
ipcMain.handle('notch:set', (e, on) => { if (!fromOffice(e) || typeof on !== 'boolean') return null; setNotch(on); return notchOn(); });
ipcMain.on('island:interactive', (e, on) => { if (fromIsland(e)) island.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('island:focus', e => { if (fromIsland(e)) island.focus(); });
// Settings panel in the island: the page sends a patch, main validates + persists, then echoes the result back.
ipcMain.on('island:settings', (e, patch) => {
  if (!fromIsland(e) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
  const was = notchOn(), key = isleSettings().notchShortcut;
  prefs.islandSettings = applyPatch(prefs.islandSettings, patch); savePrefs();
  if (notchOn() !== was) { if (notchOn() && resolveMode(prefs) === 'off') { prefs.islandMode = 'always'; savePrefs(); } setImmediate(applyIsland); } // the island may be closing itself: let this handler return first
  if (isleSettings().notchShortcut !== key) registerNotchShortcut();
  syncNowPlaying(); pushIsland(); pushNowPlaying(); refreshLyrics();
});
ipcMain.on('island:media', (e, verb) => { if (fromIsland(e) && isleSettings().nowPlaying) np.control(verb); });
ipcMain.on('island:mute', (e, on) => { if (fromIsland(e)) { prefs.islandMute = !!on; savePrefs(); pushIsland(); } });
ipcMain.on('island:office', (e, view) => { if (fromIsland(e)) openOffice(view); });

// ---------- updates ----------
// The feed is fixed in the main process (GitHub releases of Ic3krem/agent-office); only the main-process environment variable
// AGENT_OFFICE_UPDATE_FEED can point elsewhere (enterprise mirror), and even then the manifest must carry a valid Ed25519 signature.
// Nothing the page sends (IPC) or kiro.json holds can change the feed. Prefs: updateAuto (check on start, default on).
const CURRENT = app.getVersion();
const FEED = resolveFeed();
const assetPolicy = makeAssetPolicy(FEED);
let upd = { state: 'idle', current: CURRENT, feed: FEED, busy: '' };
const updView = () => ({ ...upd, auto: prefs.updateAuto !== false });
const pushUpdate = () => { if (alive()) island.webContents.send('island:update', updView()); };
async function runCheck() {
  if (upd.busy) return;
  upd = { ...upd, busy: 'check', error: '' }; pushUpdate();
  const r = await checkForUpdate({ feed: FEED, current: CURRENT });
  upd = { ...r, busy: '' }; pushUpdate();
}
// Installing needs a confirmation dialog owned by the main process, so a compromised page cannot trigger it silently.
async function runInstall() {
  if (upd.busy || upd.state !== 'available') return;
  if (!upd.url || !upd.sha256) { upd = { ...upd, error: 'The signed manifest lists a new version but no installer for this platform.' }; return pushUpdate(); }
  upd = { ...upd, busy: 'confirm', error: '' }; pushUpdate();
  const { response } = await dialog.showMessageBox({ type: 'question', title: 'Install Agent Office update', message: `Install Agent Office ${upd.available}?`, detail: `You are running ${CURRENT}. The installer is downloaded, checked against the signed release manifest, and then started; Agent Office will close while it installs.`, buttons: ['Cancel', 'Download and install'], defaultId: 0, cancelId: 0, noLink: true });
  if (response !== 1) { upd = { ...upd, busy: '' }; return pushUpdate(); }
  const job = { url: upd.url, sha256: upd.sha256, name: upd.name, version: upd.available };
  upd = { ...upd, busy: 'download' }; pushUpdate();
  try {
    const dir = makeUpdateDir(path.join(CFG_DIR, 'updates'));
    const { file } = await downloadUpdate({ url: job.url, sha256: job.sha256, name: job.name, dir, policy: assetPolicy });
    upd = { ...upd, busy: 'install' }; pushUpdate();
    await verifyBeforeLaunch({ file, sha256: job.sha256, version: job.version, current: CURRENT }); // hash again right before launch
    if (process.platform === 'win32') spawn(file, [], { detached: true, stdio: 'ignore' }).unref(); // the NSIS installer relaunches the app when it finishes
    else await shell.openPath(file);
    setTimeout(() => app.quit(), 800);
  } catch (e) { upd = { ...upd, busy: '', error: String(e.message || e).slice(0, 200) }; pushUpdate(); }
}
ipcMain.handle('update:get', e => fromIsland(e) ? updView() : null);
ipcMain.handle('update:check', async e => { if (fromIsland(e)) await runCheck(); return updView(); });
ipcMain.handle('update:install', e => { if (fromIsland(e)) runInstall(); return updView(); });
// The page may only switch auto-check on or off; a "feed" (or anything else) in the patch is ignored.
ipcMain.handle('update:set', (e, patch) => { if (!fromIsland(e)) return updView(); if (applyUpdatePatch(prefs, patch)) { savePrefs(); pushUpdate(); } return updView(); });

// Smart mode: a resident PowerShell reports Windows' "is something fullscreen" state (SHQueryUserNotificationState) every 1.5 s.
let fsProc = null;
function watchFullscreen(on) {
  if (!on || process.platform !== 'win32') {
    if (fsProc) { fsProc.kill(); fsProc = null; }
    if (isle.fs) { isle.fs = false; pushIsland(); }
    return;
  }
  if (fsProc) return;
  const ps = `Add-Type -Name N -Namespace W -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);'; while ($true) { $s = 0; [void][W.N]::SHQueryUserNotificationState([ref]$s); Write-Output $s; Start-Sleep -Milliseconds 1500 }`;
  fsProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  fsProc.stdout.on('data', d => {
    buf += d; const lines = buf.split(String.fromCharCode(10)); buf = lines.pop();
    for (const l of lines) { const n = parseInt(l.trim(), 10); if (Number.isNaN(n)) continue; const f = isFullscreenState(n); if (f !== isle.fs) { isle.fs = f; pushIsland(); syncNowPlaying(); } }
  });
  const me = fsProc; fsProc.on('exit', () => { if (fsProc === me) fsProc = null; });
}

// Follow the cursor's display, and (smart mode) peek when the cursor touches the top edge.
function cursorTick() {
  if (!alive() || !island.isVisible()) return;
  if (prefs.islandDisplay == null || prefs.islandDisplay === 'cursor') placeIsland();
  const inZone = isleMode() === 'smart' && inPeekZone(isleDisplay().bounds, screen.getCursorScreenPoint(), isle.peek);
  const now = Date.now();
  if (!inZone) isle.edgeSince = null; else if (isle.edgeSince == null) isle.edgeSince = now;
  const peek = inZone && (isle.peek || peekReady(isle.edgeSince, now, isleSettings().edgeDelay)); // edge delay only gates the first peek
  if (peek !== isle.peek) { isle.peek = peek; pushIsland(); }
}
// Event-light: 200 ms only in smart mode (the edge peek needs it), once a second otherwise (display following only).
const cursorLoop = () => { try { cursorTick(); } catch {} setTimeout(cursorLoop, isleMode() === 'smart' ? 200 : 1000).unref(); };
cursorLoop();


function applyIsland() {
  const on = notchOn(), m = isleMode();
  prefs.islandOff = !on || m === 'off'; savePrefs();
  const step = notchStep({ enabled: on, alive: alive() }, on ? 'enable' : 'disable');
  if (step.effect === 'destroy') destroyIsland();
  else if (on && m === 'off') { if (alive()) island.hide(); }
  else if (on) showIsland();
  watchFullscreen(on && m === 'smart');
  syncNowPlaying();
  pushIsland();
  if (office && !office.isDestroyed()) office.webContents.send('notch:state', on);
}
// The one place the notch is switched on or off (tray, dashboard, island settings and the optional shortcut all come here).
function setNotch(on) {
  on = !!on;
  prefs.islandSettings = applyPatch(prefs.islandSettings, { notchEnabled: on });
  if (on && resolveMode(prefs) === 'off') prefs.islandMode = 'always';
  savePrefs(); applyIsland();
}
// Optional global shortcut (off unless islandSettings.notchShortcut is set); a failed registration just leaves it unregistered.
let notchKey = '', notchKeyOk = true;
function registerNotchShortcut() {
  if (notchKey) { try { globalShortcut.unregister(notchKey); } catch {} notchKey = ''; }
  const acc = isleSettings().notchShortcut; notchKeyOk = true;
  if (!acc) return;
  try { if (globalShortcut.register(acc, () => setNotch(!notchOn()))) notchKey = acc; else notchKeyOk = false; } catch { notchKeyOk = false; }
}
function toggleIsland() {
  if (!notchOn()) return; // the notch is switched off: this shortcut only expands or pins a notch that exists
  if (!alive() || !island.isVisible()) showIsland();
  island.webContents.send('island:toggle');
}
const resync = () => { placeIsland(true); };
const watchDisplays = () => { for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, resync); }; // screen only exists after app ready

// Start with Windows (on unless turned off in the tray), re-registered each start so it follows the installed exe.
const syncLogin = () => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.autostart !== false, args: ['--hidden'] }); };

// ---------- window visibility -> server ----------
// Tells the server whether any window is on screen, so it can slow its pushes and skip background work while nothing is shown.
// Sent on change over the same signed-in cookie the windows use. Checked on window events and once every 2 s.
let lastVisible = null;
const anyWindowVisible = () => [office, kiro, island].some(w => w && !w.isDestroyed() && w.isVisible() && !w.isMinimized());
function reportVisibility() {
  const v = anyWindowVisible();
  if (v === lastVisible) return;
  lastVisible = v;
  uiPost('/api/visibility', { visible: v }).then(r => { if (!r.ok) lastVisible = null; }, () => { lastVisible = null; });
}
function startVisibilityReports() {
  app.on('browser-window-created', (e, w) => { for (const ev of ['show', 'hide', 'minimize', 'restore', 'closed']) w.on(ev, () => setTimeout(reportVisibility, 50)); });
  reportVisibility();
  setInterval(reportVisibility, 2000).unref();
}

// ---------- tray ----------
function buildTray() {
  tray = new Tray(ICON.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Agent Office - ${mgrName}`);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open office', click: () => openOffice() },
    { label: 'Show notch', type: 'checkbox', checked: notchOn(), click: i => setNotch(i.checked) },
    { label: 'Island (Ctrl+Alt+K)', submenu: [
      ...[['always', 'Always'], ['smart', 'Smart (hide when idle or fullscreen, peek at top edge)']].map(([v, l]) => ({ label: l, type: 'radio', checked: isleMode() === v, enabled: notchOn(), click: () => { prefs.islandMode = v; savePrefs(); applyIsland(); } })),
      { type: 'separator' },
      { label: 'Chime on approval / done', type: 'checkbox', checked: !prefs.islandMute, click: i => { prefs.islandMute = !i.checked; savePrefs(); pushIsland(); } },
      { type: 'separator' },
      { label: 'Display: follow cursor', type: 'radio', checked: (prefs.islandDisplay ?? 'cursor') === 'cursor', click: () => { prefs.islandDisplay = 'cursor'; savePrefs(); placeIsland(true); } },
      { label: 'Display: primary', type: 'radio', checked: prefs.islandDisplay === 'primary', click: () => { prefs.islandDisplay = 'primary'; savePrefs(); placeIsland(true); } },
      ...screen.getAllDisplays().map((d, n) => ({ label: `Display: ${n + 1} (${d.bounds.width}x${d.bounds.height})${d.id === screen.getPrimaryDisplay().id ? ' primary' : ''}`, type: 'radio', checked: prefs.islandDisplay === d.id, click: () => { prefs.islandDisplay = d.id; savePrefs(); placeIsland(true); } })),
    ] },
    { label: `Show ${mgrName}`, type: 'checkbox', checked: !!kiro && kiro.isVisible(), click: i => { prefs.hidden = !i.checked; savePrefs(); i.checked ? showKiro() : kiro?.hide(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.isPackaged && prefs.autostart !== false, enabled: app.isPackaged, click: i => { prefs.autostart = i.checked; savePrefs(); syncLogin(); } },
    { type: 'separator' },
    { label: 'Quit Agent Office', click: () => app.quit() },
  ]);
  tray.on('click', () => openOffice());
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

app.on('second-instance', () => openOffice());
app.on('window-all-closed', () => {}); // keep running in the tray
app.on('before-quit', () => { quitting = true; clearTimeout(restartTimer); server?.kill(); fsProc?.kill(); np.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  GUARD_KEY = loadGuardKey();
  { const eff = guardEffective(); if (JSON.stringify(eff.config) !== JSON.stringify(normalizeGuardConfig(prefs.guard))) { prefs.guard = eff.config; savePrefs(); } }   // a Guard setting weakened outside the app is repaired
  syncLogin();
  mgrName = readMgrName();
  buildTray();
  // The name lives in kiro.json: react to changes of that file (debounced) and re-check every 10 s as a fallback.
  let nameTimer;
  try { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.watch(CFG_DIR, { persistent: false }, (ev, f) => { if (!f || f === 'kiro.json') { clearTimeout(nameTimer); nameTimer = setTimeout(() => applyMgrName(), 300); } }).on('error', () => {}); } catch {}
  setInterval(() => applyMgrName(), 10000).unref();
  startVisibilityReports();
  try { await ensureServer(); await signInWindows(); }
  catch (e) { tray.displayBalloon?.({ title: 'Agent Office', content: e.message }); return; }
  if (!prefs.hidden) showKiro();
  watchDisplays();
  applyIsland();
  if (prefs.updateAuto !== false) setTimeout(runCheck, 8000); // check only; installing always needs a click
  globalShortcut.register('Control+Alt+K', toggleIsland);
  registerNotchShortcut();
  if (!process.argv.includes('--hidden')) openOffice();
});
