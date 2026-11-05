import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isNewer, parseManifest, makeAssetPolicy, verifyManifestSignature, checkForUpdate, downloadUpdate, verifyBeforeLaunch, makeUpdateDir, applyUpdatePatch, resolveFeed, keyFingerprint, DEFAULT_FEED } from './desktop/updater.mjs';
import { RELEASE_PUBLIC_KEY, RELEASE_KEY_FINGERPRINT } from './desktop/update-key.mjs';
import { createRestartPolicy, restartLogLine } from './desktop/restart-policy.mjs';

const kp = crypto.generateKeyPairSync('ed25519');
const rawPub = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const other = crypto.generateKeyPairSync('ed25519');
const sign = (bytes, key = kp.privateKey) => crypto.sign(null, Buffer.from(bytes), key).toString('base64');
const GH = 'https://github.com/Ic3krem/agent-office/releases/download/v2.0.0/Agent-Office-Setup-2.0.0.exe';
const manifest = (over = {}, asset = {}) => JSON.stringify({ schema: 1, version: '2.0.0', notes: 'n', assets: [{ platform: 'win32', name: 'Agent-Office-Setup-2.0.0.exe', url: GH, sha256: 'a'.repeat(64), size: 10, ...asset }], ...over });
// io.readBytes serving a manifest and its detached signature
const feedIo = (body, sig) => ({ readBytes: async loc => { if (loc.endsWith('.sig')) { if (sig == null) throw new Error('ENOENT: no signature file'); return Buffer.from(sig); } return Buffer.from(body); } });
const run = (body, sig, extra = {}) => checkForUpdate({ feed: DEFAULT_FEED, current: '1.2.5', platform: 'win32', pubKey: rawPub, io: feedIo(body, sig), ...extra });
const mainSrc = () => fs.readFileSync(new URL('./desktop/main.mjs', import.meta.url), 'utf8');

test('pinned release key: well-formed and fingerprint matches', () => {
  assert.equal(Buffer.from(RELEASE_PUBLIC_KEY, 'base64').length, 32);
  assert.equal(keyFingerprint(RELEASE_PUBLIC_KEY), RELEASE_KEY_FINGERPRINT);
});
test('signed manifest from the feed is accepted: available, with url and sha256', async () => {
  const body = manifest();
  const r = await run(body, sign(body));
  assert.equal(r.state, 'available'); assert.equal(r.available, '2.0.0'); assert.equal(r.url, GH); assert.equal(r.sha256, 'a'.repeat(64));
});
test('signature is required: missing signature file is rejected', async () => {
  const r = await run(manifest(), null);
  assert.equal(r.state, 'error'); assert.equal(r.url, undefined);
});
test('signature is required: empty, garbage and wrong-key signatures are rejected', async () => {
  const body = manifest();
  for (const sig of ['', 'not base64 at all!!', Buffer.alloc(64).toString('base64'), sign(body, other.privateKey)]) {
    const r = await run(body, sig);
    assert.equal(r.state, 'error', 'sig ' + sig.slice(0, 10)); assert.match(r.error, /signature/i);
  }
});
test('tampered manifest is rejected (version, url, sha256 or one byte)', async () => {
  const body = manifest(), sig = sign(body);
  for (const t of [body.replace('2.0.0', '9.9.9'), body.replace('a'.repeat(64), 'b'.repeat(64)), body.replace('/v2.0.0/', '/evil/'), body + ' ']) {
    const r = await run(t, sig);
    assert.equal(r.state, 'error'); assert.match(r.error, /signature is invalid/);
  }
});
test('a manifest signed by a different key is refused even if well-formed', () => {
  const body = Buffer.from(manifest());
  assert.throws(() => verifyManifestSignature(body, sign(body, other.privateKey), rawPub), /invalid/);
  verifyManifestSignature(body, sign(body), rawPub);
});
test('downgrade and same-version are never offered', async () => {
  for (const v of ['1.2.5', '1.2.4', '0.1.0']) {
    const body = manifest({ version: v }), r = await run(body, sign(body));
    assert.equal(r.state, 'current'); assert.equal(r.url, null); assert.equal(r.sha256, null);
  }
  assert.equal(isNewer('1.2.4', '1.2.5'), false);
});
test('asset must carry a sha256 and an allowed source', async () => {
  const bad = [{ sha256: undefined }, { sha256: 'zz' }, { url: 'http://github.com/Ic3krem/agent-office/releases/download/v2/x.exe' }, { url: 'https://evil.example/Setup.exe' }, { url: 'https://github.com/other/repo/releases/download/v2/x.exe' }, { url: 'https://github.com.evil.example/Ic3krem/agent-office/releases/download/x.exe' }, { url: 'file:///C:/x.exe' }, { url: '\\\\server\\share\\x.exe' }, { url: 'https://user:pw@github.com/Ic3krem/agent-office/releases/download/v2/x.exe' }];
  for (const asset of bad) {
    const body = manifest({}, asset), r = await run(body, sign(body));
    assert.equal(r.state, 'error', JSON.stringify(asset).slice(0, 60));
  }
  assert.throws(() => parseManifest({ schema: 2, version: '2.0.0', assets: [] }), /schema/);
  assert.throws(() => parseManifest({ schema: 1, version: 'x', assets: [] }), /version/);
});
test('no asset for this platform: available version but nothing to install', async () => {
  const body = manifest(), r = await run(body, sign(body), { platform: 'linux' });
  assert.equal(r.state, 'available'); assert.equal(r.url, null);
});
test('non-https and unknown-scheme feeds are refused before any read', async () => {
  let reads = 0; const io = { readBytes: async () => { reads++; return Buffer.alloc(0); } };
  for (const feed of ['http://f/latest.json', 'ftp://f/latest.json', 'javascript://x']) assert.equal((await checkForUpdate({ feed, current: '1.2.5', pubKey: rawPub, io })).state, 'error');
  assert.equal(reads, 0);
});
test('local folder / UNC-style feed needs a valid signature and a bare file name asset', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-feed-'));
  const body = manifest({}, { url: 'Setup.exe' });
  fs.writeFileSync(path.join(d, 'latest.json'), body);
  const chk = () => checkForUpdate({ feed: d, current: '1.2.5', platform: 'win32', pubKey: rawPub });
  assert.equal((await chk()).state, 'error'); // no signature file
  fs.writeFileSync(path.join(d, 'latest.json.sig'), sign(body, other.privateKey));
  assert.match((await chk()).error, /signature/i); // wrong key
  fs.writeFileSync(path.join(d, 'latest.json.sig'), sign(body));
  const ok = await chk();
  assert.equal(ok.state, 'available'); assert.equal(ok.url, 'Setup.exe');
  // even when signed, a local feed may not point the asset at an arbitrary path
  for (const url of ['C:\\Windows\\system32\\calc.exe', '..\\evil.exe', '\\\\host\\share\\x.exe', '/etc/passwd']) {
    const b = manifest({}, { url }); fs.writeFileSync(path.join(d, 'latest.json'), b); fs.writeFileSync(path.join(d, 'latest.json.sig'), sign(b));
    assert.equal((await chk()).state, 'error', url);
  }
  fs.rmSync(d, { recursive: true, force: true });
});
test('the feed cannot be changed from the page: update:set patch ignores feed/url/hash', () => {
  const prefs = {};
  assert.equal(applyUpdatePatch(prefs, { feed: 'https://evil.example/latest.json' }), false);
  assert.equal(applyUpdatePatch(prefs, { feed: 'C:\\evil', url: 'x', sha256: 'y' }), false);
  assert.deepEqual(prefs, {});
  assert.equal(applyUpdatePatch(prefs, { auto: false, feed: 'https://evil.example' }), true);
  assert.deepEqual(prefs, { updateAuto: false });
  assert.equal(applyUpdatePatch(prefs, null), false); assert.equal(applyUpdatePatch(prefs, []), false);
  assert.equal(resolveFeed({}), DEFAULT_FEED);
  assert.equal(resolveFeed({ AGENT_OFFICE_UPDATE_FEED: ' https://mirror.example/x/latest.json ' }), 'https://mirror.example/x/latest.json');
  const m = mainSrc();
  assert.doesNotMatch(m, /prefs\.updateFeed/); assert.doesNotMatch(m, /patch\.feed/);
  assert.match(m, /resolveFeed\(\)/);
});
test('main process asks for confirmation before downloading, and re-verifies before launching', () => {
  const m = mainSrc(), i = m.indexOf('async function runInstall');
  const body = m.slice(i, m.indexOf("ipcMain.handle('update:get'", i));
  assert.ok(body.indexOf('dialog.showMessageBox') > 0 && body.indexOf('dialog.showMessageBox') < body.indexOf('downloadUpdate('));
  assert.ok(body.indexOf('downloadUpdate(') < body.indexOf('verifyBeforeLaunch(') && body.indexOf('verifyBeforeLaunch(') < body.indexOf('spawn(file'));
  assert.match(body, /makeUpdateDir/);
});
test('downloadUpdate: sha256 mandatory, local copy only from the manifest folder, mismatch discarded', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-src-')), dst = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-dst-'));
  fs.writeFileSync(path.join(src, 'Setup.exe'), 'payload');
  const good = crypto.createHash('sha256').update('payload').digest('hex');
  const policy = makeAssetPolicy(path.join(src, 'latest.json'));
  const ok = await downloadUpdate({ url: 'Setup.exe', sha256: good, dir: dst, policy });
  assert.equal(fs.readFileSync(ok.file, 'utf8'), 'payload');
  await assert.rejects(downloadUpdate({ url: 'Setup.exe', sha256: '0'.repeat(64), dir: dst, policy }), /SHA-256/);
  assert.equal(fs.existsSync(path.join(dst, 'Setup.exe')), false);
  await assert.rejects(downloadUpdate({ url: 'Setup.exe', sha256: null, dir: dst, policy }), /without a SHA-256/);
  await assert.rejects(downloadUpdate({ url: 'https://example.invalid/Setup.exe', sha256: good, dir: dst }), /allowed source/);
  await assert.rejects(downloadUpdate({ url: 'C:\\x\\Setup.exe', sha256: good, dir: dst, policy }), /allowed source/);
  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(dst, { recursive: true, force: true });
});
test('verifyBeforeLaunch closes the swap window: changed file or non-newer version is refused', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-tocto-')), f = path.join(d, 'Setup.exe');
  fs.writeFileSync(f, 'good');
  const h = crypto.createHash('sha256').update('good').digest('hex');
  await verifyBeforeLaunch({ file: f, sha256: h, version: '2.0.0', current: '1.2.5' });
  await assert.rejects(verifyBeforeLaunch({ file: f, sha256: h, version: '1.2.5', current: '1.2.5' }), /not newer/);
  fs.writeFileSync(f, 'swapped by another process');
  await assert.rejects(verifyBeforeLaunch({ file: f, sha256: h, version: '2.0.0', current: '1.2.5' }), /changed after verification/);
  assert.equal(fs.existsSync(f), false);
  fs.rmSync(d, { recursive: true, force: true });
});
test('makeUpdateDir: unpredictable name, user-only (icacls on Windows, 0700 elsewhere)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-upd-')), calls = [];
  const a = makeUpdateDir(base, { exec: (...c) => calls.push(c), platform: 'win32' }), b = makeUpdateDir(base, { exec: () => {}, platform: 'win32' });
  assert.notEqual(a, b); assert.match(path.basename(a), /^u-[0-9a-f]{32}$/);
  assert.equal(calls[0][0], 'icacls'); assert.ok(calls[0][1].includes('/inheritance:r')); assert.ok(calls[0][1].includes('/grant:r'));
  fs.rmSync(base, { recursive: true, force: true });
});
test('restart policy: exponential backoff, capped retries, stable run resets', () => {
  const p = createRestartPolicy({ maxTries: 3, baseMs: 100, capMs: 250, stableMs: 1000 });
  assert.deepEqual(p.onExit(10), { retry: true, delayMs: 100, attempt: 1 });
  assert.deepEqual(p.onExit(10), { retry: true, delayMs: 200, attempt: 2 });
  assert.deepEqual(p.onExit(10), { retry: true, delayMs: 250, attempt: 3 });
  assert.equal(p.onExit(10).retry, false);
  assert.equal(p.onExit(5000).retry, true); assert.equal(p.tries, 1); // it ran long enough: counter restarted
});
test('restart log lines carry no secrets, only event data; main wires the policy', () => {
  const line = restartLogLine(0, { event: 'exited', code: 1, signal: 'SIGTERM', attempt: 2, delayMs: 2000, key: 'SECRET', env: 'x' });
  assert.equal(line, '1970-01-01T00:00:00.000Z server exited code=1 signal=SIGTERM attempt=2 retryInMs=2000');
  const m = mainSrc();
  assert.match(m, /createRestartPolicy/); assert.match(m, /child\.on\('exit'/); assert.match(m, /quitting = true/);
});
test('spawn errors name their code, sanitised; packaged server never runs with a cwd inside app.asar', () => {
  assert.equal(restartLogLine(0, { event: 'spawn-error', error: 'ENOENT' }), '1970-01-01T00:00:00.000Z server spawn-error error=ENOENT');
  assert.equal(restartLogLine(0, { event: 'spawn-error', error: 'E/../x y' }), '1970-01-01T00:00:00.000Z server spawn-error error=Exy');
  const m = mainSrc();
  assert.doesNotMatch(m, /cwd: ROOT[,\s}]/, 'ROOT is inside app.asar when packaged; the OS cannot chdir into it');
  assert.match(m, /cwd: app\.isPackaged \? process\.resourcesPath : ROOT/);
});
