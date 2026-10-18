// Agent Office desktop app: runs the office server, keeps Kiro on the desktop, and lives in the tray.
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4777, BASE = `http://localhost:${PORT}`;
const CFG_DIR = path.join(os.homedir(), '.claude', 'agent-office');
const KIRO_FILE = path.join(CFG_DIR, 'kiro.json');
const ICON = nativeImage.createFromPath(path.join(ROOT, 'desktop', 'icon.png'));
const KIRO_W = 380, KIRO_H = 600;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals'); // Kiro's see-through window
app.setAppUserModelId('io.github.ic3krem.agentoffice');

let server, office, kiro, tray;
const prefs = (() => { try { return JSON.parse(fs.readFileSync(KIRO_FILE, 'utf8')); } catch { return {}; } })();
const savePrefs = () => { try { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.writeFileSync(KIRO_FILE, JSON.stringify(prefs)); } catch {} };

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
const external = wc => wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });

// ---------- the office window: closing hides it, the tray brings it back ----------
function openOffice() {
  if (!office) {
    office = new BrowserWindow({ width: 1440, height: 900, minWidth: 380, minHeight: 500, title: 'Agent Office', icon: ICON, backgroundColor: '#0f0c0d', autoHideMenuBar: true, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    office.loadURL(url('/'));
    external(office.webContents);
    office.on('closed', () => { office = null; });
    office.once('ready-to-show', () => office.show());
  } else { office.show(); }
  office.focus();
}

// ---------- Kiro: a transparent, always-on-top window; clicks pass through except on Kiro itself ----------
function onScreen(x, y) {
  return screen.getAllDisplays().some(d => x + KIRO_W > d.workArea.x + 60 && x < d.workArea.x + d.workArea.width - 60 && y + KIRO_H > d.workArea.y + 60 && y < d.workArea.y + d.workArea.height);
}
function showKiro() {
  if (kiro) return kiro.showInactive();
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = prefs.x != null && onScreen(prefs.x, prefs.y) ? { x: prefs.x, y: prefs.y } : { x: wa.x + wa.width - KIRO_W - 12, y: wa.y + wa.height - KIRO_H };
  kiro = new BrowserWindow({
    ...pos, width: KIRO_W, height: KIRO_H, transparent: true, frame: false, resizable: false, movable: true, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: true, show: false, title: 'Kiro',
    webPreferences: { preload: path.join(ROOT, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
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

// Start with Windows (on unless turned off in the tray), re-registered each start so it follows the installed exe.
const syncLogin = () => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.autostart !== false, args: ['--hidden'] }); };

// ---------- tray ----------
function buildTray() {
  tray = new Tray(ICON.resize({ width: 16, height: 16 }));
  tray.setToolTip('Agent Office');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open office', click: openOffice },
    { label: 'Show Kiro', type: 'checkbox', checked: !!kiro && kiro.isVisible(), click: i => { prefs.hidden = !i.checked; savePrefs(); i.checked ? showKiro() : kiro?.hide(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.isPackaged && prefs.autostart !== false, enabled: app.isPackaged, click: i => { prefs.autostart = i.checked; savePrefs(); syncLogin(); } },
    { type: 'separator' },
    { label: 'Quit Agent Office', click: () => app.quit() },
  ]);
  tray.on('click', openOffice);
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

app.on('second-instance', openOffice);
app.on('window-all-closed', () => {}); // keep running in the tray
app.on('before-quit', () => server?.kill());

app.whenReady().then(async () => {
  syncLogin();
  buildTray();
  try { await ensureServer(); }
  catch (e) { tray.displayBalloon?.({ title: 'Agent Office', content: e.message }); return; }
  if (!prefs.hidden) showKiro();
  if (!process.argv.includes('--hidden')) openOffice();
});
