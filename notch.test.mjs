import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSettings, applyPatch, DEFAULT_SETTINGS, validAccelerator, canonicalAccelerator, notchEnabledOf, migrateNotchPrefs, notchStep, resolveMode } from './desktop/island-logic.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

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

test('controls: dashboard Breaker box row (desktop only) and the island settings toggle and shortcut field', () => {
  const oo = read('./public/office-objects.js'), isl = read('./public/island.html');
  assert.match(oo, /window\.agentOfficeDesktop && window\.agentOfficeDesktop\.notch/);
  assert.match(oo, /data-act = 'notch'|dataset\.act = 'notch'/); assert.match(oo, /case 'notch':/);
  assert.match(oo, /queueMicrotask\(\(\) => notchRow\(body\)\)/);
  assert.match(isl, /chips\('notchEnabled', \[\[true, 'On'\], \[false, 'Off'\]\]\)/);
  assert.match(isl, /data-nshort/); assert.match(isl, /setPref\(\{ notchShortcut: t\.value\.trim\(\) \}\)/);
  assert.match(isl, /notchEnabled: true, notchShortcut: ''/, 'reset to defaults leaves the notch on');
});
