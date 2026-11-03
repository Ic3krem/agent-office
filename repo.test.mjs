import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const pkg = JSON.parse(read('./package.json'));

test('license is consistent: proprietary in LICENSE, package.json, README; third-party notice shipped', () => {
  assert.match(read('./LICENSE'), /^Proprietary License\. All rights reserved\.\s+Copyright \(c\) 20\d\d \S+/);
  assert.equal(pkg.license, 'UNLICENSED');
  assert.match(read('./README.md'), /Proprietary, all rights reserved/);
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
  assert.match(read('./auth.mjs'), /timingSafeEqual/); assert.match(s, /createAuth/);
});

test('no personal paths or credential-looking values in tracked source', () => {
  const files = ['server.mjs', 'company.mjs', 'scheduler-job.mjs', 'desktop/main.mjs', 'desktop/updater.mjs', 'install.ps1', 'install.sh', 'README.md', 'docs/island-spec.md', 'docs/office-spec.md'];
  for (const f of files) {
    const t = read('./' + f);
    assert.doesNotMatch(t, /C:\\Users\\[A-Za-z]+\\/, f + ' has a personal path');
    assert.doesNotMatch(t, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\S{20}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}/, f + ' has a secret');
  }
});

test('every external host the pages reference is allowed by the CSP, and scripts are all local', () => {
  const csp = read('./server.mjs').match(/'content-security-policy': "([^"]+)"/)[1];
  const dirs = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  const scriptSrc = dirs['script-src'] || [];
  assert.ok(!scriptSrc.some(v => /^https?:/.test(v) || v === '*'), 'script-src must stay local');
  const allowed = new Set(Object.values(dirs).flat().filter(v => /^https:/.test(v)).map(v => new URL(v).host));
  const dir = new URL('./public/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(n => /\.(js|html)$/.test(n))) {
    const t = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of t.matchAll(/https?:\/\/([a-z][a-z0-9.-]*\.[a-z]{2,})/gi)) {
      if (/^(www\.w3\.org|w3\.org)$/i.test(m[1])) continue; // XML namespaces, never fetched
      assert.ok(allowed.has(m[1]), f + ' references ' + m[1] + ' which the CSP does not allow');
    }
    assert.doesNotMatch(t, /<script[^>]+src="https?:/i, f + ' loads a remote script');
  }
});

test('React, ReactDOM and Babel are vendored and match the SRI hashes in support.js', async () => {
  const crypto = await import('node:crypto');
  const sup = read('./public/support.js');
  for (const [file, name] of [['react.production.min.js', 'REACT'], ['react-dom.production.min.js', 'REACT_DOM'], ['babel.min.js', 'BABEL']]) {
    assert.ok(sup.includes('"/vendor/' + file + '"'), name + ' url points at the local copy');
    const sri = sup.match(new RegExp(name + '_SRI = "sha384-([^"]+)"'))[1];
    const got = crypto.createHash('sha384').update(fs.readFileSync(new URL('./public/vendor/' + file, import.meta.url))).digest('base64');
    assert.equal(got, sri, file + ' hash');
    assert.ok(read('./server.mjs').includes("'/vendor/" + file + "'"), file + ' is served');
  }
});

test('SVG path data never builds a double minus, and company metadata names the owner', () => {
  assert.doesNotMatch(read('./public/kiro-art.js'), /[qQ ]-\$\{[^}]*\}\s*\d|\s-\$\{s \*/, 'negating a possibly negative number glues two minus signs');
  assert.equal(JSON.parse(read('./.claude-plugin/marketplace.json')).owner.name, 'Ic3krem');
  assert.doesNotMatch(read('./README.md') + read('./package.json') + read('./LICENSE'), /Example/i);
});

test('documentation: relative links and images resolve, images stay small, no personal data in docs', async () => {
  const path = await import('node:path');
  const docs = ['README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md', ...fs.readdirSync(new URL('./docs/', import.meta.url)).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];
  for (const f of docs) {
    const t = read('./' + f);
    for (const m of t.matchAll(/\]\(([^)\s]+)\)/g)) {
      const u = m[1].split('#')[0];
      if (!u || /^(https?:|mailto:)/.test(u)) continue;
      assert.ok(fs.existsSync(new URL(path.posix.join(path.posix.dirname(f), u), new URL('./', import.meta.url))), f + ' links to missing ' + u);
    }
    assert.doesNotMatch(t, /Example|Example|C:\\Users\\[A-Za-z]+\\/i, f + ' has company or personal data');
  }
  const dir = new URL('./docs/images/', import.meta.url), imgs = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  assert.ok(imgs.length >= 4);
  assert.ok(imgs.reduce((n, f) => n + fs.statSync(new URL(f, dir)).size, 0) <= 6 * 1024 * 1024, 'docs/images is over 6 MB');
  assert.ok(read('./.gitattributes').includes('docs/images/*.png binary'));
});
