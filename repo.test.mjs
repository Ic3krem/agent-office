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

test('install scripts: pinned tag, signed manifest, sha256, https only, no execution-policy bypass', () => {
  const ps = read('./install.ps1'), sh = read('./install.sh');
  for (const t of [ps, sh]) {
    assert.match(t, /releases\/download\/\$/); // manifest fetched from a tag URL, not "latest"
    assert.match(t, /latest\.json\.sig/); assert.match(t, /v1\.\d+\.\d+/);
    assert.doesNotMatch(t, /api\.github\.com|releases\/latest/);
    assert.doesNotMatch(t, /http:\/\//);
    assert.doesNotMatch(t, /ExecutionPolicy|-Scope Process Bypass|Set-ExecutionPolicy/i);
  }
  assert.match(ps, /Get-FileHash[^\n]*SHA256/); assert.match(ps, /SHA-256 mismatch/); assert.match(ps, /Test-Ed25519/); assert.match(ps, /StartsWith\(\$base\)/);
  assert.match(sh, /sha256sum|shasum -a 256/); assert.match(sh, /--proto '=https'/); assert.match(sh, /pkeyutl -verify/); assert.match(sh, /SHA-256 mismatch/);
  assert.doesNotMatch(sh, /curl [^\n]*-o "\$TMP\/app\.dmg"/);
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

test('open-source files exist and have the right content', () => {
  for (const f of ['SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'docs/RELEASING.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/dependabot.yml', 'scripts/sign-release.mjs']) {
    assert.ok(fs.existsSync(new URL('./' + f, import.meta.url)), f + ' is missing');
  }
  const sec = read('./SECURITY.md');
  assert.match(sec, /Security Advisories/); assert.match(sec, /Supported versions/i); assert.match(sec, /Ic3krem/);
  assert.match(sec, new RegExp(read('./desktop/update-key.mjs').match(/RELEASE_KEY_FINGERPRINT = '([0-9a-f]{64})'/)[1]), 'SECURITY.md shows the pinned key fingerprint');
  assert.match(read('./CODE_OF_CONDUCT.md'), /Contributor Covenant/); assert.match(read('./CODE_OF_CONDUCT.md'), /version 2\.1/);
  assert.match(read('./CONTRIBUTING.md'), /npm ci/); assert.match(read('./CONTRIBUTING.md'), /npm test/);
  const rel = read('./docs/RELEASING.md');
  for (const w of ['Key custody', 'Rotating the key', 'Authenticode', 'CSC_LINK', 'sign-release.mjs']) assert.ok(rel.includes(w), 'RELEASING.md covers ' + w);
  assert.match(read('./.github/dependabot.yml'), /package-ecosystem: npm/); assert.match(read('./.github/dependabot.yml'), /package-ecosystem: github-actions/);
  assert.match(read('./.github/dependabot.yml'), /interval: weekly/);
  for (const f of ['SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'docs/RELEASING.md', '.github/PULL_REQUEST_TEMPLATE.md']) {
    assert.doesNotMatch(read('./' + f), /Example|Example|C:\\Users\\[A-Za-z]+\\|@[a-z0-9-]+\.(com|org|net)\b/i, f + ' has company, personal or contact data');
  }
});

test('workflows: every uses: is pinned to a 40-hex SHA, permissions are minimal, release is manual-only', () => {
  const dir = new URL('./.github/workflows/', import.meta.url), files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  for (const needed of ['ci.yml', 'security.yml', 'codeql.yml', 'release.yml']) assert.ok(files.includes(needed), needed);
  let uses = 0;
  for (const f of files) {
    const t = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of t.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)) {
      uses++;
      assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, f + ': ' + m[1] + ' is not pinned to a full commit SHA');
      assert.match(m[2], /#\s*v\d/, f + ': ' + m[1] + ' lacks a version comment');
    }
    assert.match(t, /^permissions:/m, f + ' sets top-level permissions');
    assert.doesNotMatch(t, /permissions:\s*write-all|pull_request_target/, f);
    assert.doesNotMatch(t, /secrets\.(?!GITHUB_TOKEN)/, f + ' uses a secret other than the built-in token');
  }
  assert.ok(uses >= 8);
  const rel = fs.readFileSync(new URL('release.yml', dir), 'utf8');
  assert.match(rel, /on:\s*\n\s*workflow_dispatch:/); assert.doesNotMatch(rel, /^\s+push:|tags:/m);
  assert.equal((rel.match(/contents: write/g) || []).length, 1, 'contents: write only on the release build job');
  assert.match(rel, /^permissions: \{\}/m);
  for (const f of files.filter(x => x !== 'release.yml')) assert.doesNotMatch(fs.readFileSync(new URL(f, dir), 'utf8'), /contents: write/, f);
  assert.match(fs.readFileSync(new URL('security.yml', dir), 'utf8'), /dependency-review-action/);
  assert.match(fs.readFileSync(new URL('security.yml', dir), 'utf8'), /npm audit/);
  assert.match(fs.readFileSync(new URL('codeql.yml', dir), 'utf8'), /codeql-action\/analyze/);
  assert.match(fs.readFileSync(new URL('ci.yml', dir), 'utf8'), /npm ci/);
});

test('supply chain: direct dependencies are exact versions, build is asar with integrity fuses', () => {
  for (const [n, v] of [...Object.entries(pkg.dependencies), ...Object.entries(pkg.devDependencies)]) assert.match(v, /^\d+\.\d+\.\d+$/, n + ' must be pinned exactly, got ' + v);
  const lock = JSON.parse(read('./package-lock.json'));
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  for (const [n, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.equal(lock.packages['node_modules/' + n].version, v, n + ' matches the lockfile');
  assert.equal(pkg.build.asar, true);
  assert.ok(pkg.build.asarUnpack.includes('desktop/nowplaying.ps1'));
  const f = pkg.build.electronFuses;
  assert.equal(f.enableEmbeddedAsarIntegrityValidation, true); assert.equal(f.onlyLoadAppFromAsar, true);
  assert.equal(f.runAsNode, true, 'the desktop shell starts the server with ELECTRON_RUN_AS_NODE');
  assert.equal(f.enableNodeOptionsEnvironmentVariable, false); assert.equal(f.enableNodeCliInspectArguments, false);
  assert.match(read('./desktop/nowplaying.mjs'), /app\.asar\\\.unpacked|app\.asar\.unpacked/);
});

test('the pinned release public key is identical in the app and both install scripts', () => {
  const raw = read('./desktop/update-key.mjs').match(/RELEASE_PUBLIC_KEY = '([^']+)'/)[1];
  assert.equal(Buffer.from(raw, 'base64').length, 32);
  assert.ok(read('./install.ps1').includes(`$PublicKeyBase64 = '${raw}'`));
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw, 'base64')]).toString('base64');
  assert.ok(read('./install.sh').includes(spki), 'install.sh PEM matches the pinned key');
});

test('sign-release builds, signs and verifies a manifest; the signing key is never in the repo', async () => {
  const os = await import('node:os'), path = await import('node:path'), crypto = await import('node:crypto');
  const { buildManifest, signManifest } = await import('./scripts/sign-release.mjs');
  const { verifyManifestSignature, parseManifest } = await import('./desktop/updater.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-sign-')), exe = path.join(d, 'Agent-Office-Setup-3.0.0.exe');
  fs.writeFileSync(exe, 'installer bytes');
  const kp = crypto.generateKeyPairSync('ed25519'), raw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const m = buildManifest({ version: '3.0.0', assets: [{ platform: 'win32', file: exe }], notes: 'n' });
  assert.equal(m.assets[0].sha256, crypto.createHash('sha256').update('installer bytes').digest('hex'));
  assert.equal(m.assets[0].url, 'https://github.com/Ic3krem/agent-office/releases/download/v3.0.0/Agent-Office-Setup-3.0.0.exe');
  const { json, sig } = signManifest(m, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  verifyManifestSignature(Buffer.from(json), sig, raw);
  assert.throws(() => verifyManifestSignature(Buffer.from(json.replace('3.0.0', '3.0.1')), sig, raw), /invalid/);
  assert.equal(parseManifest(JSON.parse(json), 'win32').version, '3.0.0');
  assert.throws(() => buildManifest({ version: 'x', assets: [{ platform: 'win32', file: exe }] }), /version/);
  assert.throws(() => buildManifest({ version: '3.0.0', assets: [] }), /asset/);
  fs.rmSync(d, { recursive: true, force: true });
  const tracked = fs.readdirSync(new URL('./', import.meta.url));
  assert.ok(!tracked.some(f => /ed25519\.key$|\.key$/.test(f)));
  assert.ok(read('./.gitignore').split(/\r?\n/).some(l => l === '*.key' || l === '*.pem'), '.gitignore keeps key files out');
  for (const f of ['scripts/sign-release.mjs', 'desktop/update-key.mjs', 'desktop/updater.mjs']) assert.doesNotMatch(read('./' + f), /BEGIN (PRIVATE|[A-Z ]*PRIVATE) KEY/);
});
