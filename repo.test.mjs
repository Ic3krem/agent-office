import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const pkg = JSON.parse(read('./package.json'));

test('license is consistent: MIT in LICENSE, package.json, README; third-party notice shipped', () => {
  assert.match(read('./LICENSE'), /^MIT License\s+Copyright \(c\) 20\d\d \S+/);
  assert.equal(pkg.license, 'MIT');
  assert.match(read('./README.md'), /MIT/);
  assert.ok(pkg.build.files.includes('LICENSE') && pkg.build.files.includes('THIRD_PARTY_NOTICES.md'));
  assert.match(read('./THIRD_PARTY_NOTICES.md'), /claude-agent-sdk/);
});

test('.gitignore keeps backups, build output, local state and secrets out', () => {
  const g = read('./.gitignore').split(/\r?\n/);
  for (const p of ['node_modules/', 'dist/', '*.bak-*', 'package.json.bak-*', 'release-feed/', '.env', '*.pem', 'bridge.json', 'scheduler*.json']) assert.ok(g.includes(p), p);
});

test('install scripts use https and verify sha256 before installing', () => {
  const ps = read('./install.ps1'), sh = read('./install.sh');
  assert.match(ps, /Get-FileHash[^\n]*SHA256/); assert.match(ps, /mismatch/); assert.match(ps, /\^https:\/\//);
  assert.match(sh, /fetch_verified/); assert.match(sh, /sha256sum|shasum -a 256/); assert.match(sh, /--proto '=https'/);
  assert.doesNotMatch(sh, /curl [^\n]*-o "\$TMP\/app\.dmg"/);
  assert.doesNotMatch(ps + sh, /http:\/\//);
});

test('electron windows are hardened and the server sends a CSP and binds loopback only', () => {
  const m = read('./desktop/main.mjs'), s = read('./server.mjs');
  assert.equal((m.match(/contextIsolation: true, sandbox: true, nodeIntegration: false/g) || []).length, 3);
  assert.match(m, /will-navigate/); assert.match(m, /setWindowOpenHandler/);
  assert.match(s, /content-security-policy/); assert.match(s, /object-src 'none'/); assert.match(s, /listen\(PORT, '127\.0\.0\.1'/);
  assert.match(s, /timingSafeEqual/);
});

test('no personal paths or credential-looking values in tracked source', () => {
  const files = ['server.mjs', 'company.mjs', 'scheduler-job.mjs', 'desktop/main.mjs', 'desktop/updater.mjs', 'install.ps1', 'install.sh', 'README.md', 'docs/island-spec.md', 'docs/office-spec.md'];
  for (const f of files) {
    const t = read('./' + f);
    assert.doesNotMatch(t, /C:\\Users\\[A-Za-z]+\\/, f + ' has a personal path');
    assert.doesNotMatch(t, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\S{20}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}/, f + ' has a secret');
  }
});
