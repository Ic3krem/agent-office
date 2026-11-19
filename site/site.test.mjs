// node --test site/site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const { buildCsp, analyticsHosts, edgeOrigin, dlHref, assetUrl, PLATFORM_ASSETS } = await import(pathToFileURL(path.join(SITE, 'tools/layout.mjs')).href);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const all = walk(SITE).filter(f => !path.relative(SITE, f).startsWith('edge' + path.sep)); // edge/: the download counter's own code and tests, not part of this site's pages
const html = all.filter(f => f.endsWith('.html'));
const rd = f => fs.readFileSync(f, 'utf8');
const rs = p => rd(path.join(SITE, p));
const js = p => JSON.parse(rs(p));
const rel = f => path.relative(SITE, f).replaceAll('\\', '/');
const idsOf = t => [...t.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const release = js('release.json'), config = js('config.json'), stats = js('stats.json');
const textFiles = all.filter(f => /\.(html|css|js|json|svg|mjs|md|txt|xml)$/.test(f) && !f.endsWith('site.test.mjs'));
const vendored = f => rel(f).startsWith('assets/vendor/');
const edge = edgeOrigin(config);
const noCode = t => t.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');

test('expected pages and files exist', () => {
  const docs = ['requirements', 'install', 'first-task', 'update', 'uninstall', 'office', 'approvals', 'team', 'agents-and-memory', 'goals-and-reports', 'island', 'scheduler', 'permissions', 'security', 'security-guard', 'breaker-box', 'configuration', 'troubleshooting', 'faq', 'api', 'guide'];
  for (const p of ['index.html', 'download.html', 'quickstart.html', 'stats.html', 'privacy.html', 'changelog.html', 'docs/index.html', 'release.json', 'stats.json', 'config.json', 'search-index.json', 'llms.txt', 'releases.xml', 'README.md',
    ...docs.flatMap(s => [`docs/${s}.html`, `docs/${s}.md`])]) assert.ok(fs.existsSync(path.join(SITE, p)), p);
});

test('every local link, image, script, stylesheet and srcset resolves, and every #anchor exists', () => {
  for (const f of html) {
    const t = rd(f), ids = new Set(idsOf(t));
    assert.equal(ids.size, idsOf(t).length, rel(f) + ' has duplicate ids');
    const urls = [...t.matchAll(/\s(?:href|src)="([^"]*)"/g)].map(m => m[1]);
    for (const m of t.matchAll(/\ssrcset="([^"]*)"/g)) urls.push(...m[1].split(',').map(s => s.trim().split(/\s+/)[0]));
    for (const u of urls) {
      if (/^https:\/\//.test(u)) continue; // checked by the remote-host test
      assert.doesNotMatch(u, /^[a-z][a-z0-9+.-]*:|^\/\//i, `${rel(f)} has non-local url ${u}`);
      const [file, hash] = u.split('#');
      const target = file ? path.resolve(path.dirname(f), file) : f;
      assert.ok(fs.existsSync(target), `${rel(f)} -> ${u} does not exist`);
      if (hash) assert.ok(new Set(idsOf(target === f ? t : rd(target))).has(hash), `${rel(f)} -> ${u} anchor missing`);
    }
  }
});

test('remote hosts: only claude.com and the public release URLs appear in pages; none in CSS or app scripts', () => {
  const okHref = new Set([release.url, release.releaseUrl]);
  for (const f of html) {
    const t = rd(f);
    for (const m of t.matchAll(/\s(?:href|src)="(https?:\/\/[^"]*)"/g)) assert.ok(/^https:\/\/claude\.com\//.test(m[1]) || okHref.has(m[1].replace(/&amp;/g, '&')) || /^https:\/\/github\.com\/Ic3krem\/agent-office(\/|$)/.test(m[1]) || (edge && m[1].startsWith(edge + '/dl/')), `${rel(f)} links to ${m[1]}`); // the project's own repository (open source), or the download counter
    assert.doesNotMatch(t, /<link[^>]+href="https?:/i);
    assert.doesNotMatch(t, /<script(?![^>]*\ssrc=")[^>]*>/i, rel(f) + ' inline script');
    assert.doesNotMatch(t, /<style[\s>]/i); assert.doesNotMatch(t, /\sstyle="/i); assert.doesNotMatch(t, /\son[a-z]+="/i);
    assert.match(t, /name="referrer" content="no-referrer"/);
  }
  for (const f of all.filter(f => /\.(css|svg)$/.test(f))) assert.doesNotMatch(rd(f), /https?:\/\/(?!www\.w3\.org)/, rel(f));
  for (const f of all.filter(f => f.endsWith('.js') && !vendored(f))) {
    const t = rd(f);
    assert.doesNotMatch(t, /\b(eval|new Function|innerHTML|document\.write|XMLHttpRequest|WebSocket)\b/, rel(f));
    const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]);
    if (rel(f) === 'assets/common.js') for (const h of hosts) assert.ok(['static.cloudflareinsights.com', 'gc.zgo.at'].includes(h) || h.endsWith('.goatcounter.com') || h === 'goatcounter.com', h);
    else assert.deepEqual(hosts, [], rel(f));
  }
});

test('vendored three.js: unmodified MIT build with its licence, loaded as a module on the home page only', () => {
  const v = all.filter(vendored).map(rel).sort();
  assert.deepEqual(v, ['assets/vendor/three/LICENSE.txt', 'assets/vendor/three/three.core.min.js', 'assets/vendor/three/three.module.min.js']);
  assert.match(rs('assets/vendor/three/LICENSE.txt'), /The MIT License/);
  assert.match(rs('assets/vendor/three/three.core.min.js'), /SPDX-License-Identifier: MIT/);
  assert.match(rs('assets/vendor/three/three.module.min.js'), /from"\.\/three\.core\.min\.js"/);
  for (const f of all.filter(vendored).filter(f => f.endsWith('.js'))) assert.doesNotMatch(rd(f), /\b(eval|new Function|WebSocket)\b/, rel(f));
  for (const f of html) {
    const t = rd(f), home = rel(f) === 'index.html';
    assert.equal(/assets\/home\.js/.test(t), home, rel(f) + ' home.js');
    assert.doesNotMatch(t, /three\.(module|core)/, rel(f) + ' must load three.js only through home.js');
    if (home) assert.match(t, /<script type="module" src="assets\/home\.js"><\/script>/);
  }
  assert.match(rs('assets/home.js'), /^import \* as T from '\.\/vendor\/three\/three\.module\.min\.js';$/m);
  assert.match(rs('README.md'), /three\.js/);
});

test('CSP is built in one place from config.json and is identical on every page', () => {
  const csp = buildCsp();
  for (const f of html) assert.ok(rd(f).includes(`content="${csp}"`), rel(f));
  const none = analyticsHosts({ analytics: { provider: 'none' } });
  assert.deepEqual(none, { script: [], connect: [], img: [] });
  assert.doesNotMatch(buildCsp({ analytics: { provider: 'none' } }), /https:/);
  assert.match(buildCsp({ analytics: { provider: 'cloudflare', cloudflare: { token: 'x' } } }), /script-src 'self' https:\/\/static\.cloudflareinsights\.com/);
  assert.match(buildCsp({ analytics: { provider: 'goatcounter', goatcounter: { code: 'demo' } } }), /connect-src 'self' https:\/\/demo\.goatcounter\.com/);
  assert.doesNotMatch(buildCsp({ analytics: { provider: 'cloudflare', cloudflare: { token: '' } } }), /https:/, 'provider without token stays off');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  // the download counter: exactly its origin in connect-src, and nothing for a bad value
  const withEdge = buildCsp({ analytics: { provider: 'none' }, edge: { origin: 'https://dl.example.workers.dev' } });
  assert.match(withEdge, /connect-src 'self' https:\/\/dl\.example\.workers\.dev;/);
  assert.equal((withEdge.match(/https:/g) || []).length, 1);
  for (const bad of ['http://dl.example.dev', 'https://dl.example.dev/x', 'javascript:alert(1)', '*']) assert.doesNotMatch(buildCsp({ analytics: { provider: 'none' }, edge: { origin: bad } }), /connect-src 'self' \S/, bad);
  if (!edge && config.analytics.provider === 'none') assert.doesNotMatch(csp, /https?:/, 'no external host while edge.origin is empty');
  if (edge) assert.ok(csp.includes(`connect-src 'self' ${edge}`));
});

test('download links: GitHub files while edge.origin is empty, the counter\'s /dl/<asset> when set', () => {
  for (const [key] of PLATFORM_ASSETS) {
    assert.match(dlHref(key, { edge: { origin: '' } }), /^https:\/\/github\.com\/Ic3krem\/agent-office\/releases\/download\/v/);
    assert.equal(dlHref(key, { edge: { origin: 'https://dl.example.dev' } }), 'https://dl.example.dev/dl/' + key);
  }
  const h = rs('index.html'), d = rs('download.html');
  for (const [key] of PLATFORM_ASSETS) assert.ok(d.includes(`href="${dlHref(key)}"`), 'download.html lacks ' + key);
  for (const os of ['windows', 'macos', 'linux']) { assert.match(h, new RegExp(`data-href-${os}="https://`)); assert.match(h, new RegExp(`data-os-btn="${os}"`)); }
  assert.match(h, /id="dl-button" class="btn primary" href="[^"]+"[^>]*data-dl-main/);
});

test('home downloads section: numbers and labels only; land-only map while edge.origin is empty', () => {
  const h = rs('index.html');
  const sec = h.slice(h.indexOf('id="downloads"'), h.indexOf('</section>', h.indexOf('id="downloads"')));
  assert.ok(sec.length > 100);
  assert.match(sec, new RegExp(`data-count="total">${stats.total.toLocaleString('en-US')}<`));
  for (const k of ['windows', 'macos', 'linux']) assert.match(sec, new RegExp(`data-count="${k}">${stats.byPlatform[k].toLocaleString('en-US')}<`));
  const words = sec.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ' ').replace(/[\d,]+/g, ' ').split(/\s+/).filter(Boolean);
  assert.deepEqual(words, ['Downloads', 'downloads', 'Windows', 'macOS', 'Linux'], 'no explanation text near the counts');
  assert.doesNotMatch(h, /sample|placeholder|as of \d/i);
  assert.match(sec, new RegExp(`data-edge="${edge}"`));
  const js_ = rs('assets/home.js');
  assert.match(js_, /if \(towers && \/\^https:/, 'towers only once an https counter origin is set');
  assert.match(js_, /getJson\(new URL\('\.\.\/stats\.json', import\.meta\.url\)\)\.then\(fillCounts\)/, 'the numbers come from GitHub counts (stats.json), never from the counter');
  assert.doesNotMatch(js_, /edge \+ '\/stats'\)\.then\(s => \{ if \(!fillCounts/, 'the counter never sets the numbers');
  assert.match(js_, /prefers-reduced-motion: reduce/); assert.match(js_, /IntersectionObserver/);
  assert.doesNotMatch(js_, /innerHTML|insertAdjacentHTML/);
});

test('brand: TiroAgents everywhere; Agent Office only as history', () => {
  for (const f of html.filter(f => rel(f) !== 'changelog.html')) {
    const t = noCode(rd(f));
    const left = (t.match(/.{0,30}Agent Office(?! 1\.x| before 2\.0| is now TiroAgents).{0,30}/g) || []);
    assert.deepEqual(left, [], rel(f));
    assert.match(t, /<a class="brand" href="[^"]*index\.html"><img[^>]*>TiroAgents<\/a>/, rel(f) + ' brand');
    assert.match(t, /<title>[^<]*TiroAgents[^<]*<\/title>/, rel(f) + ' title');
  }
  assert.match(rs('llms.txt'), /^# TiroAgents/);
});

test('all three systems ship: no "coming" or "not published" claims', () => {
  for (const f of [...html.filter(f => rel(f) !== 'changelog.html'), path.join(SITE, 'llms.txt'), path.join(SITE, 'assets/release.js'), ...all.filter(f => /tools[\\/].*\.mjs$/.test(f)), ...all.filter(f => /docs[\\/].*\.md$/.test(f))]) {
    const t = rd(f);
    assert.doesNotMatch(t, /coming, not published|(macOS|Linux)[^.<]*not published|Windows-only for now|builds are not published/i, rel(f));
  }
  assert.deepEqual(release.platforms, { windows: 'available', macos: 'available', linux: 'available' });
});

test('config.json: analytics is off until configured, provider-neutral and cookieless', () => {
  assert.ok(['none', 'cloudflare', 'goatcounter'].includes(config.analytics.provider));
  if (config.analytics.provider === 'none' && !edge) assert.doesNotMatch(buildCsp(), /https:/);
  assert.match(config.baseUrl, /^https:\/\/.+\/$/);
  const priv = rs('privacy.html');
  assert.match(priv, /sets no cookies/);
  assert.match(priv, config.analytics.provider === 'none' ? /No analytics are enabled/ : /cookieless/);
  const c = rs('assets/common.js');
  assert.match(c, /doNotTrack/); assert.match(c, /globalPrivacyControl/);
  assert.doesNotMatch(c, /document\.cookie|localStorage|sessionStorage/);
  for (const k of ['controller', 'contact', 'retention']) assert.ok(config.privacy[k], k);
});

test('images: AVIF and WebP with PNG fallback, sized, alt text, Tiro naming', () => {
  for (const f of html) {
    const t = rd(f);
    for (const img of t.match(/<img\b[^>]*>/g) || []) {
      assert.match(img, /\salt="/, rel(f) + ' img without alt');
      const src = img.match(/src="([^"]+)"/)[1];
      if (src.endsWith('.svg')) continue;
      assert.match(img, /width="\d+" height="\d+"/, rel(f) + ' ' + src + ' no size');
      for (const ext of ['avif', 'webp']) assert.ok(fs.existsSync(path.resolve(path.dirname(f), src.replace(/\.png$/, '.' + ext))), `${rel(f)} ${src} lacks ${ext}`);
    }
    assert.ok(!/kiro/i.test(t.replace(/<code>[\s\S]*?<\/code>/g, '')), rel(f) + ' says Kiro outside code');
  }
  for (const f of all.filter(f => rel(f).startsWith('assets/img/'))) assert.doesNotMatch(path.basename(f), /kiro/i);
  assert.ok(fs.existsSync(path.join(SITE, 'assets/img/tiro-moods.png')));
  assert.match(rs('index.html'), /fetchpriority="high"/);
});

test('fonts are local files with license texts', () => {
  const css = rs('assets/fonts/fonts.css');
  assert.doesNotMatch(css, /https?:|@import/);
  for (const n of ['pixelifysans', 'ibmplexmono', 'instrumentsans']) assert.ok(fs.existsSync(path.join(SITE, `assets/fonts/OFL-${n}.txt`)));
  assert.ok(html.every(f => rd(f).includes('assets/fonts/fonts.css')));
});

test('accessibility basics: lang, title, skip link, one main and one h1, labelled nav, 3px focus ring', () => {
  for (const f of html) {
    const t = rd(f);
    assert.match(t, /<html lang="en">/); assert.match(t, /<title>[^<]+<\/title>/); assert.match(t, /name="viewport"/);
    assert.match(t, /class="skip" href="#main"/); assert.equal((t.match(/<main\b/g) || []).length, 1, rel(f));
    assert.equal((t.match(/<h1\b/g) || []).length, 1, rel(f) + ' h1 count');
    assert.match(t, /<nav class="site-nav" aria-label="Main">/);
  }
  const css = rs('assets/site.css');
  assert.match(css, /:focus-visible \{ outline: 3px solid/); assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /min-height: 44px/);
});

test('no company name anywhere; Tiro only', () => {
  for (const f of textFiles) assert.doesNotMatch(rd(f), new RegExp('Cic' + 'ero', 'i'), rel(f));
  for (const f of html) assert.doesNotMatch(rd(f).replace(/<code>[\s\S]*?<\/code>/g, ''), /\bKiro\b/, rel(f));
});

test('release.json schema, and the pages bake the same values', () => {
  const r = release;
  assert.equal(r.schema, 1);
  assert.match(r.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(r.asset, +r.version.split('.')[0] >= 2 ? `TiroAgents-Setup-${r.version}.exe` : `Agent-Office-Setup-${r.version}.exe`);
  assert.equal(r.url, `https://github.com/Ic3krem/agent-office/releases/download/v${r.version}/${r.asset}`, 'url is the public release asset');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(r.size) && r.size > 0);
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof r.notes === 'string');
  assert.deepEqual(Object.keys(r.platforms).sort(), ['linux', 'macos', 'windows']);
  assert.equal(r.platforms.windows, 'available'); assert.ok(Array.isArray(r.previous));
  const allowed = new Set(['schema', 'version', 'asset', 'url', 'assets', 'sha256', 'size', 'date', 'notes', 'releaseUrl', 'platforms', 'previous', 'checksumsUrl']);
  assert.deepEqual(Object.keys(r.assets).sort(), ['linux-appimage', 'linux-deb', 'mac-arm64', 'mac-x64', 'windows']);
  assert.equal(r.assets.windows, r.asset);
  const pat = { 'mac-arm64': /-arm64\.dmg$/, 'mac-x64': /-x64\.dmg$/, 'linux-appimage': /\.AppImage$/, 'linux-deb': /\.deb$/, windows: /\.exe$/ };
  for (const [k, f] of Object.entries(r.assets)) { assert.match(f, pat[k], k); assert.ok(f.includes(r.version), k + ' version'); assert.equal(assetUrl(k, r), `https://github.com/Ic3krem/agent-office/releases/download/v${r.version}/${f}`); }
  for (const k of Object.keys(r)) assert.ok(allowed.has(k), 'unknown key ' + k);
  const d = rs('download.html'), h = rs('index.html');
  for (const v of [r.sha256, r.asset, r.version, r.date, edge ? edge + '/dl/windows' : r.url]) assert.ok(d.includes(v), 'download.html lacks ' + v);
  if (!edge) assert.ok(h.includes(r.url), 'landing bakes the Windows url');
  assert.match(d, /Get-FileHash \.\\(TiroAgents|Agent-Office)-Setup/);
});

test('download page: install warnings, every platform, no-JS links, wired ids', () => {
  const d = rs('download.html'), js_ = rs('assets/release.js');
  assert.match(d, /SmartScreen/); assert.match(d, /Smart App Control/); assert.match(d, /More info/); assert.match(d, /Run anyway/); assert.match(d, /Gatekeeper/);
  assert.match(d, /install\.sh/); assert.match(d, /releases\.xml/);
  for (const f of Object.values(release.assets)) assert.ok(d.includes(f), 'download.html lists ' + f);
  if (!edge) assert.match(d, /href="https:\/\/github\.com\/Ic3krem\/agent-office\/releases\/download\/[^"]+" data-os-btn="windows"/);
  for (const id of [...js_.matchAll(/\$\('([a-z-]+)'\)/g)].map(m => m[1])) assert.ok(d.includes(`id="${id}"`), 'download.html missing #' + id);
  assert.match(rs('docs/troubleshooting.html'), /Smart App Control/);
  assert.match(rs('docs/requirements.html'), /Windows 10 or later/);
});

test('OS detection in release.js (run in a stub browser): buttons follow the visitor\'s OS', async () => {
  const code = rs('assets/release.js');
  const run = (ua, platform = '', mobile = false) => {
    const label = { textContent: 'Download for Windows' };
    const main = { href: 'win', attrs: { 'data-href-windows': 'win', 'data-href-macos': 'mac', 'data-href-linux': 'lin' }, getAttribute(k) { return this.attrs[k]; }, querySelector: () => label };
    const other = { textContent: 'macOS and Linux', getAttribute: k => ({ 'data-label-windows': 'macOS and Linux', 'data-label-macos': 'Windows and Linux', 'data-label-linux': 'Windows and macOS' })[k] };
    const btn = os => ({ os, className: 'btn', textContent: '', getAttribute: () => os });
    const btns = [btn('windows'), btn('macos'), btn('linux')];
    const row = { kids: btns.slice(), firstChild: null, querySelectorAll: () => btns, insertBefore(b) { this.kids = [b, ...this.kids.filter(x => x !== b)]; } };
    const els = { 'os-note': { textContent: '', hidden: true }, 'copy-page': { hidden: true, addEventListener() {} } };
    const q = { '[data-dl-main]': [main], '[data-dl-other]': [other], '[data-os-row]': [row] };
    const ctx = { document: { currentScript: null, getElementById: id => els[id] || null, querySelectorAll: sel => q[sel] || [] }, location: { href: 'https://x/' }, navigator: { userAgent: ua, platform, userAgentData: platform ? { platform, mobile } : undefined }, fetch: () => Promise.reject(new Error('offline')), URL, console };
    vm.runInNewContext(code, ctx);
    return { main, label, other, row, note: els['os-note'], copy: els['copy-page'] };
  };
  let e = run('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows');
  assert.equal(e.main.href, 'win'); assert.equal(e.label.textContent, 'Download for Windows'); assert.equal(e.note.textContent, ''); assert.equal(e.row.kids[0].os, 'windows');
  e = run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macOS');
  assert.equal(e.main.href, 'mac'); assert.equal(e.label.textContent, 'Download for macOS'); assert.equal(e.other.textContent, 'Windows and Linux');
  assert.equal(e.row.kids[0].os, 'macos'); assert.match(e.row.kids[0].className, /primary/); assert.match(e.row.kids[1].className, /quiet/); assert.equal(e.note.textContent, '');
  e = run('Mozilla/5.0 (X11; Linux x86_64)', 'Linux');
  assert.equal(e.main.href, 'lin'); assert.equal(e.label.textContent, 'Download for Linux'); assert.equal(e.row.kids[0].textContent, 'Download for Linux');
  e = run('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
  assert.match(e.note.textContent, /on your computer/); assert.equal(e.copy.hidden, false); assert.equal(e.main.href, 'win');
  e = run('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Android', true);
  assert.match(e.note.textContent, /on your computer/);
});

test('fetch-stats counts installers only, per platform and release, skipping drafts', async () => {
  const { summarise, LEGACY } = await import('./tools/fetch-stats.mjs');
  const none = { windows: 0, macos: 0, linux: 0 };
  const s = summarise([
    { tag_name: 'v1.2.0', published_at: '2026-11-01T00:00:00Z', assets: [{ name: 'Agent-Office-Setup-1.2.0.exe', download_count: 5 }, { name: 'Agent-Office-Setup-1.2.0.exe.blockmap', download_count: 9 }, { name: 'latest.yml', download_count: 40 }, { name: 'Agent-Office-1.2.0-arm64.dmg', download_count: 2 }, { name: 'Agent-Office-1.2.0-arm64.zip', download_count: 7 }, { name: 'Agent-Office-1.2.0-x86_64.AppImage', download_count: 1 }, { name: 'Agent-Office-1.2.0-amd64.deb', download_count: 1 }] },
    { tag_name: 'v1.3.0', published_at: '2026-11-05T00:00:00Z', assets: [{ name: 'Agent-Office-Setup-1.3.0.exe', download_count: 3 }] },
    { tag_name: 'v9.9.9', draft: true, assets: [{ name: 'x.exe', download_count: 100 }] },
  ], '2026-11-05', none);
  assert.deepEqual(s.byPlatform, { windows: 8, macos: 2, linux: 2 });
  assert.equal(s.total, 12);
  assert.deepEqual(s.byRelease.map(r => [r.version, r.downloads]), [['1.3.0', 3], ['1.2.0', 9]], 'newest first, drafts skipped');
  assert.deepEqual(LEGACY, { windows: 14, macos: 18, linux: 10 });
  const withLegacy = summarise([{ tag_name: 'v2.1.0', published_at: '2026-11-19T00:00:00Z', assets: [{ name: 'TiroAgents-Setup-2.1.0.exe', download_count: 3 }] }], '2026-11-20');
  assert.deepEqual(withLegacy.byPlatform, { windows: 17, macos: 18, linux: 10 }, 'the frozen counts of the earlier repository are always included');
  assert.equal(withLegacy.total, 45); assert.deepEqual(withLegacy.byRelease, [{ version: '2.1.0', date: '2026-11-19', downloads: 3 }]);
});

test('stats.json holds GitHub installer counts only (no visitor data), and the stats page shows it', () => {
  assert.equal(stats.schema, 2); assert.equal(typeof stats.placeholder, 'boolean');
  assert.match(stats.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(stats.total) && stats.total >= 0);
  assert.deepEqual(Object.keys(stats.byPlatform).sort(), ['linux', 'macos', 'windows']);
  assert.equal(stats.total, Object.values(stats.byPlatform).reduce((a, b) => a + b, 0));
  for (const r of stats.byRelease) { assert.match(r.version, /^\d+\.\d+\.\d+/); assert.ok(Number.isInteger(r.downloads) && r.downloads >= 0); }
  for (const k of ['byCountry', 'byContinent', 'unique', 'countries']) assert.ok(!(k in stats), 'no visitor-derived field ' + k);
  const t = rs('stats.html');
  if (stats.placeholder) assert.match(t, /No snapshot yet/);
  for (const r of stats.byRelease) assert.ok(t.includes(r.version));
  assert.match(t, /Only installers count/); assert.match(t, /updates are included/); assert.match(t, /collects none/);
  for (const k of ['windows', 'macos', 'linux']) assert.ok(stats.byPlatform[k] >= stats.legacy[k], 'legacy baseline included: ' + k);
  assert.doesNotMatch(rs('index.html'), /1,234/, 'landing must not show placeholder numbers');
});

test('docs: groups, sidebar, prev/next, version stamp, search index, copy buttons', () => {
  for (const g of ['Get started', 'Using the office', 'Safety', 'Reference']) assert.match(rs('docs/index.html'), new RegExp('<h2>' + g + '</h2>'));
  for (const f of html.filter(f => rel(f).startsWith('docs/') && !rel(f).endsWith('index.html'))) {
    const t = rd(f);
    assert.match(t, /class="prev-next"/, rel(f)); assert.match(t, /aria-current="page"/); assert.match(t, new RegExp(`Written for v${release.version.replaceAll('.', '\\.')}`));
    assert.match(t, /id="doc-search"/); assert.match(t, /search\.js/);
  }
  const idx = js('search-index.json');
  assert.ok(idx.length > 40);
  for (const e of idx) {
    assert.ok(e.t && e.x && e.u);
    const [file, hash] = e.u.split('#'); const p = path.join(SITE, file);
    assert.ok(fs.existsSync(p), e.u); if (hash) assert.ok(rd(p).includes(`id="${hash}"`), e.u);
  }
  assert.match(rs('assets/common.js'), /copy-code/);
  assert.ok(fs.statSync(path.join(SITE, 'search-index.json')).size < 200_000);
});

test('llms.txt links to existing Markdown copies; releases.xml is a valid Atom feed with the current version', () => {
  const base = config.baseUrl.replace(/\/?$/, '/');
  const l = rs('llms.txt');
  assert.match(l, /^# TiroAgents/);
  const links = [...l.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(m => m[1]);
  assert.ok(links.length > 20);
  for (const u of links) { assert.ok(u.startsWith(base), u); assert.ok(fs.existsSync(path.join(SITE, u.slice(base.length))), u); }
  const x = rs('releases.xml');
  assert.match(x, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.equal((x.match(/<entry>/g) || []).length, (x.match(/<\/entry>/g) || []).length);
  assert.ok((x.match(/<entry>/g) || []).length >= 4);
  assert.match(x, new RegExp(`<title>${+release.version.split('.')[0] >= 2 ? 'TiroAgents' : 'Agent Office'} ${release.version.replaceAll('.', '\\.')}</title>`));
  for (const id of [...x.matchAll(/<id>([^<]+)<\/id>/g)].map(m => m[1])) assert.ok(id.startsWith(base), id);
  assert.doesNotMatch(x, /<entry>[\s\S]*<updated>(?!\d{4}-\d{2}-\d{2}T)/);
});

test('performance budget: landing HTML, CSS and JS are small', () => {
  const size = p => fs.statSync(path.join(SITE, p)).size;
  const jsBytes = size('assets/common.js') + size('assets/release.js');
  assert.ok(jsBytes < 10_240, 'landing JS ' + jsBytes);
  assert.ok(size('assets/home.js') < 20_480, 'home.js ' + size('assets/home.js'));
  const critical = size('index.html') + size('assets/site.css') + jsBytes + size('assets/img/hero-640.avif') + size('assets/favicon.svg');
  assert.ok(critical < 150_000, 'critical bytes ' + critical);
  assert.ok(size('assets/img/hero-640.avif') < 40_000 && size('assets/img/hero.avif') < size('assets/img/hero.png'));
});

test('honest claims: three systems, unsigned, licence in the footer, no fake numbers', () => {
  const d = rs('download.html'), h = rs('index.html');
  assert.match(h, /3 systems/); assert.match(h, /Windows, macOS and Linux/); assert.match(d, /Windows, macOS and Linux/);
  assert.match(d, /not code-signed/); assert.match(h, /code-signed/);
  for (const f of html) { const t = rd(f); assert.match(t, /<p class="legal">Open source under the <a href="https:\/\/github\.com\/Ic3krem\/agent-office\/blob\/main\/LICENSE">Apache License 2\.0<\/a>/, rel(f)); if (rel(f) !== 'changelog.html') assert.doesNotMatch(t, /All rights reserved|proprietary software/i, rel(f)); }
  assert.doesNotMatch(h, /id="licence"/, 'no licence essay mid-page');
  assert.doesNotMatch(h, /class="mascot/, 'no floating mascot box');
  assert.match(rs('privacy.html'), /Content Security Policy/);
  assert.match(rs('quickstart.html'), /Approve the hire/);
  for (const f of [...html, path.join(SITE, 'assets/site.css')]) assert.doesNotMatch(rd(f), /dashed|class="placeholder/i, rel(f) + ' placeholder');
});

test('privacy text follows edge.origin', () => {
  const p = rs('privacy.html');
  if (edge) { assert.match(p, /id="counter"/); assert.match(p, /keyed hash/); assert.match(p, /never stored/); }
  else { assert.doesNotMatch(p, /id="counter"/); assert.match(p, /go straight to the files on GitHub/); }
  assert.match(rs('tools/pages.mjs'), /keyed hash of your IP address/);
});
