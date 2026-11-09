import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanExternal, signExternal, effectiveExternal, confirmedFile, confirmExternal } from './external-settings.mjs';
import { createWorldStore } from './world-store.mjs';

const K = 'k'.repeat(64);
const signed = cfg => ({ config: cfg, hmac: signExternal(cfg, K) });

test('model applies unsigned', () => {
  const e = effectiveExternal({ 'ext-codex-1': { model: 'gpt-5' } }, null, null);
  assert.deepEqual(e['ext-codex-1'], { model: 'gpt-5', auto: false, args: '', command: '' });
  assert.deepEqual(e.changedOutside, []);
});

test('auto without hmac is ignored and reported', () => {
  const e = effectiveExternal({ 'ext-codex-1': { auto: true } }, null, K);
  assert.equal(e['ext-codex-1'].auto, false);
  assert.deepEqual(e.changedOutside, ['ext-codex-1']);
  const f = effectiveExternal({ 'ext-codex-1': { auto: true } }, { config: { 'ext-codex-1': { auto: true } }, hmac: 'forged' }, K);
  assert.equal(f['ext-codex-1'].auto, false, 'a forged hmac is no confirmation');
  const g = effectiveExternal({ 'ext-codex-1': { auto: true } }, signed({ 'ext-codex-1': { auto: true } }), null);
  assert.equal(g['ext-codex-1'].auto, false, 'no key (browser only): weaker settings never apply');
});

test('signed auto, args and command apply', () => {
  const cfg = { 'ext-codex-1': { auto: true, args: '--search', command: '' }, 'ext-custom-1': { auto: false, args: '', command: 'mytool --ask "{prompt}"' } };
  const e = effectiveExternal({ 'ext-codex-1': { model: 'o3', auto: true, args: '--search' }, 'ext-custom-1': { command: 'mytool --ask "{prompt}"' } }, signed(cfg), K);
  assert.deepEqual(e['ext-codex-1'], { model: 'o3', auto: true, args: '--search', command: '' });
  assert.equal(e['ext-custom-1'].command, 'mytool --ask "{prompt}"');
  assert.deepEqual(e.changedOutside, []);
});

test('tampered command is ignored', () => {
  const e = effectiveExternal({ 'ext-custom-1': { command: 'b' } }, signed({ 'ext-custom-1': { command: 'a' } }), K);
  assert.equal(e['ext-custom-1'].command, '');
  assert.deepEqual(e.changedOutside, ['ext-custom-1']);
  const t = signed({ 'ext-custom-1': { command: 'a' } }); t.config['ext-custom-1'].command = 'evil';
  assert.equal(effectiveExternal({ 'ext-custom-1': { command: 'evil' } }, t, K)['ext-custom-1'].command, '', 'editing confirmed.json breaks its hmac');
});

test('non-external keys and bad values dropped', () => {
  assert.deepEqual(cleanExternal({ forge: { model: 'x' }, 'ext-codex-9': { model: 'x' }, 'ext-gemini-1': { model: 'bad model', auto: 'yes', args: 5, command: 'c'.repeat(501) }, 'ext-opencode-2': { model: 'ollama/qwen3:8b', extra: 1 } }),
    { 'ext-gemini-1': {}, 'ext-opencode-2': { model: 'ollama/qwen3:8b' } });
  assert.deepEqual(cleanExternal(null), {}); assert.deepEqual(cleanExternal([1]), {});
  assert.equal(effectiveExternal({ 'ext-codex-1': { model: '-rf' } }, null, null)['ext-codex-1'].model, '');
});

test('confirmExternal writes kiro.json external and a signed confirmed.json (0600), keeping other prefs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ext-')), kiro = path.join(dir, 'kiro.json');
  fs.writeFileSync(kiro, JSON.stringify({ workDir: 'x', external: { 'ext-codex-1': { model: 'o3' } } }));
  confirmExternal({ cfgDir: dir, kiroFile: kiro, secret: K }, 'ext-codex-1', { auto: true, args: '' });
  const k = JSON.parse(fs.readFileSync(kiro, 'utf8'));
  assert.equal(k.workDir, 'x');
  assert.deepEqual(k.external['ext-codex-1'], { model: 'o3', auto: true, args: '', command: '' });
  const conf = JSON.parse(fs.readFileSync(confirmedFile(dir), 'utf8'));
  assert.deepEqual(effectiveExternal(k.external, conf, K)['ext-codex-1'], { model: 'o3', auto: true, args: '', command: '' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(confirmedFile(dir)).mode & 0o777, 0o600);
  assert.throws(() => confirmExternal({ cfgDir: dir, kiroFile: kiro, secret: K }, 'forge', { auto: true }), /external desk/);
});

test('layout never carries settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ext-layout-')), store = createWorldStore(dir);
  const { layout } = store.load();
  layout.objects.push({ id: 'desk-9', type: 'dept-desk', x: 880, y: 720, desk: 'desk-9', role: 'ext-codex-1', command: 'x' });
  const r = store.save(layout);
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(dir, 'layout.json')) || !fs.readFileSync(path.join(dir, 'layout.json'), 'utf8').includes('"command"'));
  layout.objects.at(-1).command = undefined; delete layout.objects.at(-1).command;
  assert.equal(store.save(layout).ok, true, 'the desk itself is fine');
  assert.ok(!fs.readFileSync(path.join(dir, 'layout.json'), 'utf8').includes('"command"'));
});

test('desktop: the confirm handler is sender-checked, asks natively, signs with the guard key; server never signs', () => {
  const main = fs.readFileSync(new URL('./desktop/main.mjs', import.meta.url), 'utf8');
  const h = main.slice(main.indexOf("ipcMain.handle('external:confirm'"), main.indexOf("ipcMain.handle('notch:get'"));
  assert.match(h, /if \(!fromOffice\(e\)/); assert.match(h, /dialog\.showMessageBox/); assert.match(h, /secret: GUARD_KEY/);
  assert.match(main, /for \(const k of \['agentNames', 'looks', 'graphics', 'external'\]\)/, 'savePrefs never overwrites desk settings');
  const srv = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(srv, /confirmExternal|signExternal/);
  assert.match(srv, /effectiveExternal\(readJsonSafe\(path\.join\(CFG_DIR, 'kiro\.json'\)\)\?\.external, readJsonSafe\(confirmedFile\(CFG_DIR\)\), GUARD_KEY \|\| null\)/);
});
