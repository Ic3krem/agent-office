// Agent Office desktop app: runs the office server, keeps Tiro on the desktop, and lives in the tray.
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNowPlaying } from './nowplaying.mjs';
import { createLyrics, trackKey } from './lyrics.mjs';
import { checkForUpdate, downloadUpdate, integrityWarning } from './updater.mjs';
import { resolveMode, pickDisplay, isleBoundsFor, inPeekZone, isFullscreenState, normalizeSettings, applyPatch, peekReady } from './island-logic.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4777, BASE = `http://localhost:${PORT}`;
const CFG_DIR = path.join(os.homedir(), '.claude', 'agent-office');
const KIRO_FILE = path.join(CFG_DIR, 'kiro.json');
const ICON = nativeImage.createFromPath(path.join(ROOT, 'desktop', 'icon.png'));
const KIRO_W = 380, KIRO_H = 600;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals'); // Tiro's see-through window
app.setAppUserModelId('io.github.ic3krem.agentoffice');

let server, office, kiro, island, tray;
const prefs = (() => { try { return JSON.parse(fs.readFileSync(KIRO_FILE, 'utf8')); } catch { return {}; } })();
// agentNames is owned by the server (rename UI): keep whatever is on disk so a stale in-memory copy never overwrites it.
const savePrefs = () => { try { fs.mkdirSync(CFG_DIR, { recursive: true }); let disk = {}; try { disk = JSON.parse(fs.readFileSync(KIRO_FILE, 'utf8')); } catch {} const out = { ...prefs }; if (disk.agentNames) out.agentNames = disk.agentNames; else delete out.agentNames; fs.writeFileSync(KIRO_FILE, JSON.stringify(out)); } catch {} };

// ---------- the office server (reused if it is already running, e.g. from start.ps1) ----------
const up = () => fetch(BASE + '/', { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
async function ensureServer() {
  if (await up()) return;
  // Electron's own Node runs the server, so the app needs no separate Node install.
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) { if (await up()) return; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('The Agent Office server did not start on port ' + PORT);
}
const key = () => JSON.parse(fs.readFileSync(path.join(CFG_DIR, 'bridge.json'), 'utf8')).key;
const url = p => `${BASE}${p}?key=${encodeURIComponent(key())}`;
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

// ---------- the office window: closing hides it, the tray brings it back ----------
const VIEWS = new Set(['today', 'reports', 'usage', 'office']);
function openOffice(view) {
  view = typeof view === 'string' && VIEWS.has(view) && view !== 'office' ? view : ''; // 'office' = just open the window
  if (!office) {
    office = new BrowserWindow({ width: 1440, height: 900, minWidth: 380, minHeight: 500, title: 'Agent Office', icon: ICON, backgroundColor: '#0f0c0d', autoHideMenuBar: true, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
    office.loadURL(url('/') + (view ? '#' + view : ''));
    external(office.webContents);
    office.on('closed', () => { office = null; });
    office.once('ready-to-show', () => office.show());
  } else { office.show(); if (view) office.webContents.executeJavaScript(`location.hash=${JSON.stringify(view)}`).catch(() => {}); }
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
const syncNowPlaying = () => { if (isleSettings().nowPlaying && isleMode() !== 'off') np.start(); else np.stop(); };
const pushIsland = () => { if (alive()) island.webContents.send('island:state', { mode: isleMode(), mute: !!prefs.islandMute, fs: isle.fs, peek: isle.peek, settings: isleSettings() }); };
function placeIsland(force) {
  if (!alive()) return;
  const b = isleBoundsFor(isleDisplay().bounds), c = island.getBounds();
  if (!force && c.x === b.x && c.y === b.y && c.width === b.width && c.height === b.height) return;
  island.setBounds(b); island.setBounds(b); // twice: Windows mis-sizes the first call when the target display has another DPI scale
}
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
  island.on('closed', () => { island = null; });
}
const fromIsland = e => island && e.sender === island.webContents;
ipcMain.on('island:interactive', (e, on) => { if (fromIsland(e)) island.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('island:focus', e => { if (fromIsland(e)) island.focus(); });
// Settings panel in the island: the page sends a patch, main validates + persists, then echoes the result back.
ipcMain.on('island:settings', (e, patch) => {
  if (!fromIsland(e) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
  prefs.islandSettings = applyPatch(prefs.islandSettings, patch); savePrefs(); syncNowPlaying(); pushIsland(); pushNowPlaying(); refreshLyrics();
});
ipcMain.on('island:media', (e, verb) => { if (fromIsland(e) && isleSettings().nowPlaying) np.control(verb); });
ipcMain.on('island:mute', (e, on) => { if (fromIsland(e)) { prefs.islandMute = !!on; savePrefs(); pushIsland(); } });
ipcMain.on('island:office', (e, view) => { if (fromIsland(e)) openOffice(view); });

// ---------- updates ----------
// Prefs in kiro.json: updateFeed (https JSON URL, file or folder; empty = not configured), updateAuto (check on start, default on).
const CURRENT = app.getVersion();
let upd = { state: prefs.updateFeed ? 'idle' : 'unconfigured', current: CURRENT, feed: prefs.updateFeed || '', busy: '' };
const updView = () => ({ ...upd, auto: prefs.updateAuto !== false, warning: integrityWarning(upd) });
const pushUpdate = () => { if (alive()) island.webContents.send('island:update', updView()); };
async function runCheck() {
  if (upd.busy) return;
  upd = { ...upd, busy: 'check', error: '' }; pushUpdate();
  const r = await checkForUpdate({ feed: prefs.updateFeed, current: CURRENT });
  upd = { ...r, busy: '' }; pushUpdate();
}
async function runInstall() {
  if (upd.busy || upd.state !== 'available') return;
  if (!upd.url) { upd = { ...upd, error: 'The feed lists a new version but no installer for this platform.' }; return pushUpdate(); }
  upd = { ...upd, busy: 'download', error: '' }; pushUpdate();
  try {
    const { file } = await downloadUpdate({ url: upd.url, sha256: upd.sha256, dir: path.join(os.tmpdir(), 'agent-office-update-' + Date.now()) });
    upd = { ...upd, busy: 'install' }; pushUpdate();
    if (process.platform === 'win32') spawn(file, [], { detached: true, stdio: 'ignore' }).unref(); // the NSIS installer relaunches the app when it finishes
    else await shell.openPath(file);
    setTimeout(() => app.quit(), 800);
  } catch (e) { upd = { ...upd, busy: '', error: String(e.message || e).slice(0, 200) }; pushUpdate(); }
}
ipcMain.handle('update:get', e => fromIsland(e) ? updView() : null);
ipcMain.handle('update:check', async e => { if (fromIsland(e)) await runCheck(); return updView(); });
ipcMain.handle('update:install', e => { if (fromIsland(e)) runInstall(); return updView(); });
ipcMain.handle('update:set', async (e, patch) => {
  if (!fromIsland(e) || !patch || typeof patch !== 'object') return updView();
  if (typeof patch.auto === 'boolean') { prefs.updateAuto = patch.auto; savePrefs(); }
  if (typeof patch.feed === 'string') {
    prefs.updateFeed = patch.feed.trim().slice(0, 500); savePrefs();
    upd = { state: prefs.updateFeed ? 'idle' : 'unconfigured', current: CURRENT, feed: prefs.updateFeed, busy: '' };
    if (prefs.updateFeed) await runCheck();
  }
  pushUpdate(); return updView();
});

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
    for (const l of lines) { const n = parseInt(l.trim(), 10); if (Number.isNaN(n)) continue; const f = isFullscreenState(n); if (f !== isle.fs) { isle.fs = f; pushIsland(); } }
  });
  const me = fsProc; fsProc.on('exit', () => { if (fsProc === me) fsProc = null; });
}

// One light timer: follow the cursor's display, and (smart mode) peek when the cursor touches the top edge.
setInterval(() => {
  if (!alive() || !island.isVisible()) return;
  if (prefs.islandDisplay == null || prefs.islandDisplay === 'cursor') placeIsland();
  const inZone = isleMode() === 'smart' && inPeekZone(isleDisplay().bounds, screen.getCursorScreenPoint(), isle.peek);
  const now = Date.now();
  if (!inZone) isle.edgeSince = null; else if (isle.edgeSince == null) isle.edgeSince = now;
  const peek = inZone && (isle.peek || peekReady(isle.edgeSince, now, isleSettings().edgeDelay)); // edge delay only gates the first peek
  if (peek !== isle.peek) { isle.peek = peek; pushIsland(); }
}, 200).unref();

function applyIsland() {
  const m = isleMode(); prefs.islandOff = m === 'off'; savePrefs();
  if (m === 'off') { if (alive()) island.hide(); } else showIsland();
  watchFullscreen(m === 'smart');
  syncNowPlaying();
  pushIsland();
}
function toggleIsland() {
  if (isleMode() === 'off') { prefs.islandMode = 'always'; applyIsland(); }
  if (!alive() || !island.isVisible()) showIsland();
  island.webContents.send('island:toggle');
}
const resync = () => { placeIsland(true); };
const watchDisplays = () => { for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, resync); }; // screen only exists after app ready

// Start with Windows (on unless turned off in the tray), re-registered each start so it follows the installed exe.
const syncLogin = () => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.autostart !== false, args: ['--hidden'] }); };

// ---------- tray ----------
function buildTray() {
  tray = new Tray(ICON.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Agent Office - ${mgrName}`);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open office', click: () => openOffice() },
    { label: 'Island (Ctrl+Alt+K)', submenu: [
      ...[['always', 'Always'], ['smart', 'Smart (hide when idle or fullscreen, peek at top edge)'], ['off', 'Off']].map(([v, l]) => ({ label: l, type: 'radio', checked: isleMode() === v, click: () => { prefs.islandMode = v; applyIsland(); } })),
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
app.on('before-quit', () => { server?.kill(); fsProc?.kill(); np.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  syncLogin();
  mgrName = readMgrName();
  buildTray();
  setInterval(() => applyMgrName(), 3000);
  try { await ensureServer(); }
  catch (e) { tray.displayBalloon?.({ title: 'Agent Office', content: e.message }); return; }
  if (!prefs.hidden) showKiro();
  watchDisplays();
  applyIsland();
  if (prefs.updateAuto !== false && prefs.updateFeed) setTimeout(runCheck, 8000); // check only; installing always needs a click
  globalShortcut.register('Control+Alt+K', toggleIsland);
  if (!process.argv.includes('--hidden')) openOffice();
});
