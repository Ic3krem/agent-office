import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compareVersions, isNewer, parseFeed, safeDownloadSource, checkForUpdate, downloadUpdate, integrityWarning, UNVERIFIED_WARNING } from './desktop/updater.mjs';

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.1.5', '1.1.5'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.5', '2.0.0'), -1);
});
test('pre-releases sort below the release; invalid yields null', () => {
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.10'), -1);
  assert.equal(compareVersions('1.2.0-alpha', '1.2.0-alpha.1'), -1);
  assert.equal(compareVersions('latest', '1.0.0'), null);
  assert.equal(isNewer('garbage', '1.0.0'), false);
  assert.equal(isNewer('1.1.6', '1.1.5'), true);
});
test('parseFeed: generic shape', () => {
  const h = 'a'.repeat(64);
  assert.deepEqual(parseFeed({ version: 'v1.2.0', url: 'https://x/y.exe', sha256: h.toUpperCase(), notes: 'hi' }), { version: '1.2.0', url: 'https://x/y.exe', sha256: h, notes: 'hi' });
  assert.equal(parseFeed({ version: '1.2.0' }).url, null);
  assert.throws(() => parseFeed({ version: 'x' }), /valid version/);
  assert.throws(() => parseFeed({ version: '1.2.0', sha256: 'zz' }), /sha256/);
  assert.throws(() => parseFeed([]), /JSON object/);
  assert.throws(() => parseFeed(null), /JSON object/);
});
test('parseFeed: GitHub release picks the platform installer and digest', () => {
  const rel = { tag_name: 'v1.3.0', body: 'notes', assets: [
    { name: 'latest.yml', browser_download_url: 'https://g/latest.yml' },
    { name: 'Agent-Office-Setup-1.3.0.exe', browser_download_url: 'https://g/setup.exe', digest: 'sha256:' + 'b'.repeat(64) },
    { name: 'Agent-Office-1.3.0-x64.dmg', browser_download_url: 'https://g/a.dmg' }] };
  const w = parseFeed(rel, 'win32');
  assert.equal(w.version, '1.3.0'); assert.equal(w.url, 'https://g/setup.exe'); assert.equal(w.sha256, 'b'.repeat(64));
  assert.equal(parseFeed(rel, 'darwin').url, 'https://g/a.dmg');
  assert.throws(() => parseFeed({ ...rel, prerelease: true }), /pre-release/);
});
test('safeDownloadSource allows https and absolute paths only', () => {
  assert.equal(safeDownloadSource('https://a/b.exe').kind, 'https');
  assert.equal(safeDownloadSource('http://a/b.exe'), null);
  assert.equal(safeDownloadSource('ftp://a/b.exe'), null);
  assert.equal(safeDownloadSource('relative/b.exe'), null);
  assert.equal(safeDownloadSource(path.resolve('b.exe')).kind, 'file');
  assert.equal(safeDownloadSource(''), null);
});
test('checkForUpdate states: unconfigured, available, current, error', async () => {
  assert.equal((await checkForUpdate({ feed: '  ', current: '1.1.5' })).state, 'unconfigured');
  const mk = v => ({ fetchJson: async () => ({ version: v, url: 'https://x/s.exe' }) });
  const a = await checkForUpdate({ feed: 'https://f/latest.json', current: '1.1.5', io: mk('1.2.0') });
  assert.equal(a.state, 'available'); assert.equal(a.available, '1.2.0'); assert.equal(a.current, '1.1.5');
  assert.equal((await checkForUpdate({ feed: 'https://f/l.json', current: '1.1.5', io: mk('1.1.5') })).state, 'current');
  assert.equal((await checkForUpdate({ feed: 'https://f/l.json', current: '1.1.5', io: mk('1.0.0') })).state, 'current');
  assert.equal((await checkForUpdate({ feed: 'http://f/l.json', current: '1.1.5' })).state, 'error');
  const bad = await checkForUpdate({ feed: 'https://f/l.json', current: '1.1.5', io: { fetchJson: async () => { throw new Error('boom'); } } });
  assert.equal(bad.state, 'error'); assert.match(bad.error, /boom/);
});
test('checkForUpdate reads a local folder feed (latest.json)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-feed-'));
  fs.writeFileSync(path.join(d, 'latest.json'), JSON.stringify({ version: '9.0.0', url: path.join(d, 's.exe') }));
  const r = await checkForUpdate({ feed: d, current: '1.1.5' });
  assert.equal(r.state, 'available'); assert.equal(r.available, '9.0.0');
  fs.rmSync(d, { recursive: true, force: true });
});
test('downloadUpdate copies a local file and enforces sha256', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-src-')), dst = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-dst-'));
  const f = path.join(src, 'Setup.exe'); fs.writeFileSync(f, 'payload');
  const good = crypto.createHash('sha256').update('payload').digest('hex');
  const ok = await downloadUpdate({ url: f, sha256: good, dir: dst });
  assert.equal(ok.verified, true); assert.equal(fs.readFileSync(ok.file, 'utf8'), 'payload');
  await assert.rejects(downloadUpdate({ url: f, sha256: '0'.repeat(64), dir: dst }), /SHA-256/);
  assert.equal(fs.existsSync(path.join(dst, 'Setup.exe')), false);
  await assert.rejects(downloadUpdate({ url: 'http://x/a.exe', dir: dst }), /https/);
  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(dst, { recursive: true, force: true });
});

test('integrityWarning: warns when a checked feed carries no sha256', async () => {
  const feed = sha => ({ fetchJson: async () => ({ version: '1.2.0', url: 'https://x/s.exe', ...(sha ? { sha256: sha } : {}) }) });
  const bare = await checkForUpdate({ feed: 'https://f/l.json', current: '1.1.5', io: feed() });
  assert.equal(integrityWarning(bare), UNVERIFIED_WARNING);
  assert.match(integrityWarning(bare), /cannot be verified/);
  assert.equal(integrityWarning(await checkForUpdate({ feed: 'https://f/l.json', current: '1.2.0', io: feed() })), UNVERIFIED_WARNING); // up to date but feed still unverified
  assert.equal(integrityWarning(await checkForUpdate({ feed: 'https://f/l.json', current: '1.1.5', io: feed('c'.repeat(64)) })), '');
  assert.equal(integrityWarning({ state: 'unconfigured' }), '');
  assert.equal(integrityWarning({ state: 'error', error: 'x' }), '');
  assert.equal(integrityWarning(null), '');
});

test('downloadUpdate refuses an https installer that has no sha256', async () => {
  const dir = path.join(os.tmpdir(), 'ao-nosha-' + Date.now());
  await assert.rejects(downloadUpdate({ url: 'https://example.invalid/Agent-Office-Setup.exe', sha256: null, dir }), /without a SHA-256/);
  assert.ok(!fs.existsSync(path.join(dir, 'Agent-Office-Setup.exe')));
});
