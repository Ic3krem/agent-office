import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSettings, applyPatch, DEFAULT_SETTINGS, validAccelerator, canonicalAccelerator, notchEnabledOf, migrateNotchPrefs, notchStep, resolveMode } from './desktop/island-logic.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const NOTCH_FILES = ['notch-views.js', 'notch-page.js'];
const islandPage = () => [read('./public/island.html'), ...['notch-core.js', ...NOTCH_FILES].map(f => read('./public/' + f))].join('\n'); // the page and its classic scripts

test('notchEnabled defaults to on and is validated like every other island setting', () => {
  assert.equal(DEFAULT_SETTINGS.notchEnabled, true, 'default behaviour as before: the notch is on');
  assert.equal(normalizeSettings({}).notchEnabled, true);
  assert.equal(normalizeSettings(undefined).notchEnabled, true);
  assert.equal(normalizeSettings({ notchEnabled: false }).notchEnabled, false);
  for (const bad of ['false', 0, null, {}, [], 'no']) assert.equal(normalizeSettings({ notchEnabled: bad }).notchEnabled, true, 'a non-boolean falls back to the default: ' + JSON.stringify(bad));
  assert.equal(applyPatch({ notchEnabled: false, theme: 'forest' }, { lyrics: false }).notchEnabled, false, 'a patch that does not name it leaves it alone');
  assert.equal(applyPatch({ theme: 'forest' }, { notchEnabled: false }).theme, 'forest', 'and naming it changes only it');
  assert.equal(applyPatch({}, { notchEnabled: false }).notchEnabled, false);
});

test('the notch shortcut is off by default and only accepts safe, canonical accelerators', () => {
  assert.equal(DEFAULT_SETTINGS.notchShortcut, '');
  assert.equal(normalizeSettings({}).notchShortcut, '');
  assert.equal(canonicalAccelerator('ctrl+alt+n'), 'Ctrl+Alt+N');
  assert.equal(canonicalAccelerator('Shift + Control + f9'), 'Ctrl+Shift+F9');
  assert.equal(normalizeSettings({ notchShortcut: 'alt+ctrl+n' }).notchShortcut, 'Ctrl+Alt+N');
  for (const bad of ['N', 'Ctrl+N', 'Alt+F4x', 'Ctrl+Alt+Esc', 'Ctrl+Alt+K', 'ctrl+alt+k', 'Alt+Alt+X', 'Ctrl+Alt+Shift+Super+X', 'Ctrl+Alt+', '', 'Ctrl+Alt+NN', 'Ctrl+Alt+F25', 'Hyper+Alt+N', 5, null, {}, 'x'.repeat(80)]) {
    assert.equal(validAccelerator(bad), false, 'invalid: ' + JSON.stringify(bad));
    assert.equal(normalizeSettings({ notchShortcut: bad }).notchShortcut, '', 'normalised away: ' + JSON.stringify(bad));
  }
  assert.equal(validAccelerator('Ctrl+Alt+N'), true); assert.equal(validAccelerator('Ctrl+Shift+F12'), true);
});

test('legacy off becomes an explicit setting once, so later patches cannot turn the notch back on', () => {
  assert.equal(notchEnabledOf({}), true);
  assert.equal(notchEnabledOf({ islandMode: 'smart' }), true);
  assert.equal(notchEnabledOf({ islandMode: 'off' }), false, 'islandMode off meant no island');
  assert.equal(notchEnabledOf({ islandOff: true }), false, 'so did the older islandOff flag');
  assert.equal(notchEnabledOf({ islandMode: 'off', islandSettings: { notchEnabled: true } }), true, 'an explicit value wins');
  assert.equal(notchEnabledOf({ islandMode: 'always', islandSettings: { notchEnabled: false } }), false);
  assert.equal(resolveMode({ islandMode: 'off' }), 'off');

  const legacy = { islandMode: 'off', islandMute: true, islandSettings: { theme: 'midnight' } };
  const m = migrateNotchPrefs(legacy);
  assert.equal(m.islandSettings.notchEnabled, false); assert.equal(m.islandSettings.theme, 'midnight'); assert.equal(m.islandMute, true);
  assert.equal(notchEnabledOf({ ...m, islandSettings: applyPatch(m.islandSettings, { lyrics: false }) }), false, 'a patch of another knob keeps it off');
  assert.deepEqual(migrateNotchPrefs(m), m, 'idempotent');
  assert.equal(migrateNotchPrefs({}).islandSettings.notchEnabled, true);
  assert.equal(migrateNotchPrefs({ islandSettings: 'junk' }).islandSettings.notchEnabled, true);
  const same = { islandSettings: { notchEnabled: false } };
  assert.equal(migrateNotchPrefs(same), same, 'nothing to migrate: the same object comes back');
});

test('notch toggle state machine: one effect per transition, safe when repeated', () => {
  assert.deepEqual(notchStep({ enabled: true, alive: false }, 'enable'), { enabled: true, alive: true, effect: 'create' }, 'first run or after a close: create');
  assert.deepEqual(notchStep({ enabled: true, alive: true }, 'enable'), { enabled: true, alive: true, effect: 'none' }, 'already there: nothing to do');
  assert.deepEqual(notchStep({ enabled: true, alive: true }, 'disable'), { enabled: false, alive: false, effect: 'destroy' });
  assert.deepEqual(notchStep({ enabled: false, alive: false }, 'disable'), { enabled: false, alive: false, effect: 'none' }, 'disabling twice is harmless');
  assert.equal(notchStep({ enabled: false, alive: false }, 'toggle').effect, 'create');
  assert.equal(notchStep({ enabled: true, alive: true }, 'toggle').effect, 'destroy');
  assert.deepEqual(notchStep({ enabled: true, alive: true }, 'closed'), { enabled: true, alive: false, effect: 'none' }, 'a window that vanished does not flip the setting');
  assert.equal(notchStep({ enabled: true, alive: false }, 'enable').effect, 'create', 'and the next apply brings it back');
  assert.deepEqual(notchStep(undefined, 'nonsense'), { enabled: false, alive: false, effect: 'none' });
  // a rapid on/off/on sequence ends with exactly one window
  let s = { enabled: true, alive: true }, creates = 0, destroys = 0;
  for (const a of ['disable', 'enable', 'disable', 'enable', 'enable']) { const r = notchStep(s, a); creates += r.effect === 'create'; destroys += r.effect === 'destroy'; s = r; }
  assert.deepEqual([creates, destroys, s.alive], [2, 2, true]);
});

test('desktop wiring: one setter, sender-checked IPC with a validated payload, tray checkbox, no unauthenticated route', () => {
  const main = read('./desktop/main.mjs'), server = read('./server.mjs'), pre = read('./desktop/office-preload.cjs'), isl = read('./desktop/island-preload.cjs');
  // the dashboard reaches the desktop only through two sender-checked IPC handlers
  assert.match(main, /ipcMain\.handle\('notch:get', e => \(fromOffice\(e\) \? notchOn\(\) : null\)\)/);
  assert.match(main, /ipcMain\.handle\('notch:set', \(e, on\) => \{ if \(!fromOffice\(e\) \|\| typeof on !== 'boolean'\) return null; setNotch\(on\)/);
  assert.match(main, /const fromOffice = e => office && !office\.isDestroyed\(\) && e\.sender === office\.webContents/);
  assert.match(pre, /ipcRenderer\.invoke\('notch:get'\)/); assert.match(pre, /ipcRenderer\.invoke\('notch:set', on === true\)/);
  assert.equal((pre.match(/ipcRenderer\.invoke\('notch:/g) || []).length, 2, 'the notch part exposes nothing but get and set');
  assert.deepEqual([...pre.matchAll(/ipcRenderer\.invoke\('([a-z]+):/g)].map(m => m[1]).filter((v, i, all) => all.indexOf(v) === i).sort(), ['auth', 'external', 'guard', 'music', 'notch', 'spotify'], 'the office preload only reaches the notch, Security Guard, external-desk confirm, sign-in, music folder and Spotify sign-in handlers');
  // every one of those handlers checks the sender
  for (const ch of ['auth:login', 'auth:logout', 'auth:keyState', 'auth:setKey', 'auth:removeKey', 'auth:setMode', 'music:pickFolder', 'spotify:signIn']) assert.match(main, new RegExp("ipcMain\\.handle\\('" + ch + "', [^]{0,50}?fromOffice\\(e\\)"), ch + ' is sender-checked');
  assert.match(main, /preload: path\.join\(ROOT, 'desktop', 'office-preload\.cjs'\)/);
  // the island's own toggle goes through the existing, sender-checked settings channel and is validated by normalizeSettings
  assert.match(main, /ipcMain\.on\('island:settings', \(e, patch\) => \{\s*if \(!fromIsland\(e\)/);
  assert.match(isl, /settings: patch =>/);
  // tray, setter, destroy
  assert.match(main, /\{ label: 'Show notch', type: 'checkbox', checked: notchOn\(\), click: i => setNotch\(i\.checked\) \}/);
  assert.match(main, /function setNotch\(on\) \{[^}]*applyPatch\(prefs\.islandSettings, \{ notchEnabled: on \}\)/s);
  assert.match(main, /function destroyIsland\(\) \{ if \(alive\(\)\) \{ const w = island; island = null; try \{ w\.destroy\(\)/);
  assert.match(main, /const step = notchStep\(\{ enabled: on, alive: alive\(\) \}, on \? 'enable' : 'disable'\)/);
  assert.match(main, /if \(island === me\) island = null/, 'a destroyed window cannot clear a newer one');
  assert.match(main, /watchFullscreen\(on && m === 'smart'\)/); assert.match(main, /notchOn\(\) && isleSettings\(\)\.nowPlaying/, 'poller and watcher stop with the notch');
  // Ctrl+Alt+K only expands an existing notch; the optional shortcut is off unless configured and failure is tolerated
  assert.match(main, /function toggleIsland\(\) \{\s*if \(!notchOn\(\)\) return;/);
  assert.match(main, /if \(!acc\) return;/); assert.match(main, /catch \{ notchKeyOk = false; \}/);
  assert.ok(main.indexOf("globalShortcut.register('Control+Alt+K', toggleIsland)") < main.lastIndexOf('registerNotchShortcut();'));
  // launch at login (--hidden) and the single-instance lock are untouched; state is remembered through kiro.json
  assert.match(main, /process\.argv\.includes\('--hidden'\)/); assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /migrateNotchPrefs\(readForWrite\(KIRO_FILE/);
  // nothing new is reachable over HTTP
  assert.doesNotMatch(server, /api\/notch/);
});

test('notch window: never click-through, island IPC sender-checked, view pushed, globals can be skipped for test runs', () => {
  const main = read('./desktop/main.mjs'), isl = read('./desktop/island-preload.cjs');
  assert.doesNotMatch(main, /island\.setIgnoreMouseEvents/, 'the island is never click-through (only Tiro\'s own window still is)');
  assert.doesNotMatch(main, /'island:interactive'/);
  const handlers = [...main.matchAll(/ipcMain\.on\('island:[a-zA-Z]+', (?:\([^)]*\)|e) => \{?\s*([^\n]*)/g)];
  assert.equal(handlers.length, (main.match(/ipcMain\.on\('island:/g) || []).length, 'every island handler was found');
  assert.ok(handlers.length >= 7, 'found the island handlers');
  for (const [all, body] of handlers) assert.match(body, /^(if \()?!?fromIsland\(e\)/, 'sender-checked: ' + all.slice(0, 40));
  for (const ch of ['notch:store:get', 'notch:store:set']) { const at = main.indexOf("ipcMain.handle('" + ch + "'"); assert.ok(at > 0, ch); assert.match(main.slice(at, at + 160), /fromIsland\(e\)/, ch + ' is sender-checked'); }
  assert.match(main, /acceptStore\(store\)/); assert.match(isl, /ipcRenderer\.invoke\('notch:store:get'\)/); assert.match(isl, /ipcRenderer\.invoke\('notch:store:set', store\)/);
  assert.match(main, /ipcMain\.on\('island:closedView'/); assert.match(main, /ipcMain\.on\('island:hold'/);
  assert.match(isl, /closedView: kind => ipcRenderer\.send\('island:closedView'/); assert.match(isl, /hold: h => ipcRenderer\.send\('island:hold'/);
  assert.match(main, /'island:state', \{[^}]*view: isle\.view/);
  // Esc: the page asks main to close at once; hoverStep gets the one-shot dismiss
  assert.match(isl, /dismiss: \(\) => ipcRenderer\.send\('island:dismiss'\)/);
  assert.match(main, /ipcMain\.on\('island:dismiss', e => \{ if \(fromIsland\(e\)\)/); assert.match(main, /\.\.\.isle\.hold, dismiss: isle\.dismiss \}\)/);
  // the system material follows the app theme: dark, set before the material window is created
  // the system material follows the app theme: dark only while the window is in the material form, 'system' otherwise and after destroy
  assert.match(main, /nativeTheme\.themeSource = isle\.form === 'material' \? 'dark' : 'system';[^\n]*\n\s*try \{\s*island = new BrowserWindow/);
  assert.match(main, /function destroyIsland\(\) \{[^\n]*nativeTheme\.themeSource = 'system'/);
  // the window is sized to the view it shows (winView), which a pending shrink changes only when its timer fires
  assert.match(main, /function placeIsland\(force, d = isleDisplay\(\)\) \{\s*if \(!alive\(\)\) return;\s*const b = isleRect\(isle\.winView, d\)/);
  assert.match(main, /, resize = \(\) => \{ isle\.winView = isle\.view; placeIsland\(true, d\); \}/);
  assert.match(main, /plan === 'later'\) isle\.shrinkT = setTimeout\(resize, delay\)/);
  // one display lookup per cursor tick
  const tick = main.slice(main.indexOf('function cursorTick()'), main.indexOf('const cursorLoop'));
  assert.equal((tick.match(/isleDisplay\(\)/g) || []).length, 1, 'cursorTick computes the display once');
  for (const call of ['placeIsland(false, d)', 'inPeekZone(d.bounds,', 'isleRect(ck, d)', "isleRect('open', d)", "ck, d);"]) assert.ok(tick.includes(call), 'the tick passes its display down: ' + call);
  assert.match(tick, /ck = isle\.game \? 'game' : isle\.closedKind/, 'game mode: the closed view is the game view and Smart does not hide it for fullscreen');
  assert.match(tick, /smartAway\(\{[^}]*closedKind: ck,/);
  assert.match(islandPage(), /e\.key === 'Escape'[^\n]*desk\.dismiss\(\)/);
  // AGENT_OFFICE_NO_GLOBALS=1: no tray, no global shortcuts (test runs next to the installed app)
  assert.match(main, /const NO_GLOBALS = process\.env\.AGENT_OFFICE_NO_GLOBALS === '1'/);
  assert.match(main, /if \(!NO_GLOBALS\) buildTray\(\)/);
  assert.match(main, /if \(!NO_GLOBALS\) \{ globalShortcut\.register\('Control\+Alt\+K', toggleIsland\); registerNotchShortcut\(\); \}/);
});

test('notch page: tabs, form from main, no click-through bridge, scripts served, Y/N not taken from text fields', () => {
  const html = read('./public/island.html'), page = islandPage(), isl = read('./desktop/island-preload.cjs'), main = read('./desktop/main.mjs'), server = read('./server.mjs');
  assert.doesNotMatch(isl + page, /interactive/, 'the window is never click-through: the no-op bridge and its calls are gone');
  assert.match(main, /'island:state', \{[^}]*form: isle\.form/, 'main tells the page which window form it is in');
  // Smart mode: the page's busy signal reaches main's pure rule
  assert.match(isl, /busy: !!\(h && h\.busy\)/); assert.match(main, /isle\.busy = h\.busy === true/);
  assert.match(main, /const away = smartAway\(\{[^\n]*busy: isle\.busy, \.\.\.isle\.hold \}\)/);
  assert.match(page, /desk\.hold\(\{ pinned: pn, forced: fo, busy: bz \}\)/);
  for (const f of ['notch-core.js', ...NOTCH_FILES]) {
    assert.match(html, new RegExp(`<script src="\\./${f.replace('.', '\\.')}"></script>`), f + ' is loaded by the page');
    assert.match(server, new RegExp(`'/${f.replace('.', '\\.')}': \\['${f.replace('.', '\\.')}', 'text/javascript'\\]`), f + ' is in STATIC');
  }
  assert.match(page, /role="tablist"/); assert.match(page, /role="tab"/); assert.match(page, /ArrowRight/);
  assert.match(page, /closest\('input, textarea'\)/); assert.match(page, /isContentEditable/);
  assert.doesNotMatch(page, /\son[a-z]+="/, 'no inline event handlers');
  assert.doesNotMatch(page, /https?:\/\/(?!www\.w3\.org)/, 'no remote resources');
});

test('controls: dashboard Breaker box row (desktop only) and the island settings toggle and shortcut field', () => {
  const oo = read('./public/office-objects.js'), isl = islandPage();
  assert.match(oo, /window\.agentOfficeDesktop && window\.agentOfficeDesktop\.notch/);
  assert.match(oo, /data-act = 'notch'|dataset\.act = 'notch'/); assert.match(oo, /case 'notch':/);
  assert.match(oo, /queueMicrotask\(\(\) => notchRow\(body\)\)/);
  assert.match(isl, /chips\('notchEnabled', \[\[true, 'On'\], \[false, 'Off'\]\]\)/);
  assert.match(isl, /data-nshort/); assert.match(isl, /setPref\(\{ notchShortcut: t\.value\.trim\(\) \}\)/);
  assert.match(isl, /notchEnabled: true, notchShortcut: ''/, 'reset to defaults leaves the notch on');
});
