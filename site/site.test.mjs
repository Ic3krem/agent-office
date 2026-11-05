// node --test site/site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const { buildCsp, analyticsHosts } = await import(pathToFileURL(path.join(SITE, 'tools/layout.mjs')).href);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const all = walk(SITE);
const html = all.filter(f => f.endsWith('.html'));
const rd = f => fs.readFileSync(f, 'utf8');
const rs = p => rd(path.join(SITE, p));
const js = p => JSON.parse(rs(p));
const rel = f => path.relative(SITE, f).replaceAll('\\', '/');
const idsOf = t => [...t.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const release = js('release.json'), config = js('config.json'), stats = js('stats.json');
const textFiles = all.filter(f => /\.(html|css|js|json|svg|mjs|md|txt|xml)$/.test(f) && !f.endsWith('site.test.mjs'));

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
    for (const m of t.matchAll(/\s(?:href|src)="(https?:\/\/[^"]*)"/g)) assert.ok(/^https:\/\/claude\.com\//.test(m[1]) || okHref.has(m[1].replace(/&amp;/g, '&')) || /^https:\/\/github\.com\/Ic3krem\/agent-office(\/|$)/.test(m[1]), `${rel(f)} links to ${m[1]}`); // the project's own repository (open source)
    assert.doesNotMatch(t, /<link[^>]+href="https?:/i);
    assert.doesNotMatch(t, /<script(?![^>]*\ssrc=")[^>]*>/i, rel(f) + ' inline script');
    assert.doesNotMatch(t, /<style[\s>]/i); assert.doesNotMatch(t, /\sstyle="/i); assert.doesNotMatch(t, /\son[a-z]+="/i);
    assert.match(t, /name="referrer" content="no-referrer"/);
  }
  for (const f of all.filter(f => /\.(css|svg)$/.test(f))) assert.doesNotMatch(rd(f), /https?:\/\/(?!www\.w3\.org)/, rel(f));
  for (const f of all.filter(f => f.endsWith('.js'))) {
    const t = rd(f);
    assert.doesNotMatch(t, /\b(eval|new Function|innerHTML|document\.write|XMLHttpRequest|WebSocket)\b/, rel(f));
    const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]);
    if (rel(f) === 'assets/common.js') for (const h of hosts) assert.ok(['static.cloudflareinsights.com', 'gc.zgo.at'].includes(h) || h.endsWith('.goatcounter.com') || h === 'goatcounter.com', h);
    else assert.deepEqual(hosts, [], rel(f));
  }
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
});

test('config.json: analytics is off until configured, provider-neutral and cookieless', () => {
  assert.ok(['none', 'cloudflare', 'goatcounter'].includes(config.analytics.provider));
  if (config.analytics.provider === 'none') assert.doesNotMatch(buildCsp(), /https:/);
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
  assert.equal(r.asset, `Agent-Office-Setup-${r.version}.exe`);
  assert.equal(r.url, `https://github.com/Ic3krem/agent-office/releases/download/v${r.version}/${r.asset}`, 'url is the public release asset');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(r.size) && r.size > 0);
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof r.notes === 'string');
  assert.deepEqual(Object.keys(r.platforms).sort(), ['linux', 'macos', 'windows']);
  assert.equal(r.platforms.windows, 'available'); assert.ok(Array.isArray(r.previous));
  const allowed = new Set(['schema', 'version', 'asset', 'url', 'sha256', 'size', 'date', 'notes', 'releaseUrl', 'platforms', 'previous', 'checksumsUrl']);
  for (const k of Object.keys(r)) assert.ok(allowed.has(k), 'unknown key ' + k);
  const d = rs('download.html'), h = rs('index.html');
  for (const v of [r.sha256, r.asset, r.url, r.version, r.date]) assert.ok(d.includes(v), 'download.html lacks ' + v);
  assert.ok(h.includes(r.url) && h.includes(r.sha256.slice(0, 8) + '\u2026'), 'landing bakes url and short sha');
  assert.match(d, /Get-FileHash \.\\Agent-Office-Setup/);
});

test('download page: Windows notes, platforms, no-JS link, wired ids', () => {
  const d = rs('download.html'), js_ = rs('assets/release.js');
  assert.match(d, /SmartScreen/); assert.match(d, /Smart App Control/); assert.match(d, /More info/); assert.match(d, /Run anyway/);
  assert.match(d, /Coming soon/); assert.match(d, /releases\.xml/);
  assert.match(d, /id="dl-button"[^>]*href="https:\/\/github\.com\/Ic3krem\/agent-office\/releases\/download\//);
  for (const id of [...js_.matchAll(/\$\('([a-z-]+)'\)/g)].map(m => m[1])) assert.ok(d.includes(`id="${id}"`), 'download.html missing #' + id);
  assert.match(rs('docs/troubleshooting.html'), /Smart App Control/);
  assert.match(rs('docs/requirements.html'), /Windows 10 or later/);
});

test('OS detection in release.js (run in a stub browser)', async () => {
  const code = rs('assets/release.js');
  const run = (ua, platform = '', mobile = false) => {
    const els = { 'os-note': { textContent: '', hidden: true }, 'dl-button': { classList: { add() { this.added = true; }, added: false } }, 'dl-label': { textContent: 'Download for Windows' }, 'copy-page': { hidden: true, addEventListener() {} } };
    const ctx = { document: { currentScript: null, getElementById: id => els[id] || null, querySelectorAll: () => [] }, location: { href: 'https://x/' }, navigator: { userAgent: ua, platform, userAgentData: platform ? { platform, mobile } : undefined }, fetch: () => Promise.reject(new Error('offline')), URL, console };
    vm.runInNewContext(code, ctx);
    return els;
  };
  let e = run('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows');
  assert.equal(e['dl-label'].textContent, 'Download for Windows'); assert.equal(e['os-note'].textContent, '');
  e = run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macOS');
  assert.match(e['os-note'].textContent, /Windows-only for now/); assert.match(e['dl-label'].textContent, /anyway/);
  e = run('Mozilla/5.0 (X11; Linux x86_64)', 'Linux');
  assert.match(e['os-note'].textContent, /Windows-only/);
  e = run('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
  assert.match(e['os-note'].textContent, /on your PC/); assert.equal(e['copy-page'].hidden, false);
  e = run('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Android', true);
  assert.match(e['os-note'].textContent, /on your PC/);
});

test('fetch-stats counts installers only, per platform and release, skipping drafts', async () => {
  const { summarise } = await import('./tools/fetch-stats.mjs');
  const s = summarise([
    { tag_name: 'v1.2.0', published_at: '2026-11-01T00:00:00Z', assets: [{ name: 'Agent-Office-Setup-1.2.0.exe', download_count: 5 }, { name: 'Agent-Office-Setup-1.2.0.exe.blockmap', download_count: 9 }, { name: 'latest.yml', download_count: 40 }, { name: 'Agent-Office-1.2.0-arm64.dmg', download_count: 2 }, { name: 'Agent-Office-1.2.0-arm64.zip', download_count: 7 }, { name: 'Agent-Office-1.2.0-x86_64.AppImage', download_count: 1 }, { name: 'Agent-Office-1.2.0-amd64.deb', download_count: 1 }] },
    { tag_name: 'v1.3.0', published_at: '2026-11-05T00:00:00Z', assets: [{ name: 'Agent-Office-Setup-1.3.0.exe', download_count: 3 }] },
    { tag_name: 'v9.9.9', draft: true, assets: [{ name: 'x.exe', download_count: 100 }] },
  ], '2026-11-05');
  assert.deepEqual(s.byPlatform, { windows: 8, macos: 2, linux: 2 });
  assert.equal(s.total, 12);
  assert.deepEqual(s.byRelease.map(r => [r.version, r.downloads]), [['1.3.0', 3], ['1.2.0', 9]], 'newest first, drafts skipped');
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
  assert.match(rs('index.html'), /data-stats/); assert.match(rs('assets/common.js'), /stats\.json/);
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
  assert.match(l, /^# Agent Office/);
  const links = [...l.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(m => m[1]);
  assert.ok(links.length > 20);
  for (const u of links) { assert.ok(u.startsWith(base), u); assert.ok(fs.existsSync(path.join(SITE, u.slice(base.length))), u); }
  const x = rs('releases.xml');
  assert.match(x, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.equal((x.match(/<entry>/g) || []).length, (x.match(/<\/entry>/g) || []).length);
  assert.ok((x.match(/<entry>/g) || []).length >= 4);
  assert.match(x, new RegExp(`<title>Agent Office ${release.version.replaceAll('.', '\\.')}</title>`));
  for (const id of [...x.matchAll(/<id>([^<]+)<\/id>/g)].map(m => m[1])) assert.ok(id.startsWith(base), id);
  assert.doesNotMatch(x, /<entry>[\s\S]*<updated>(?!\d{4}-\d{2}-\d{2}T)/);
});

test('performance budget: landing HTML, CSS and JS are small', () => {
  const size = p => fs.statSync(path.join(SITE, p)).size;
  const jsBytes = size('assets/common.js') + size('assets/release.js');
  assert.ok(jsBytes < 10_240, 'landing JS ' + jsBytes);
  const critical = size('index.html') + size('assets/site.css') + jsBytes + size('assets/img/hero-640.avif') + size('assets/favicon.svg');
  assert.ok(critical < 150_000, 'critical bytes ' + critical);
  assert.ok(size('assets/img/hero-640.avif') < 40_000 && size('assets/img/hero.avif') < size('assets/img/hero.png'));
});

test('honest claims: Windows only, unsigned, licence, no fake numbers', () => {
  const d = rs('download.html'), h = rs('index.html');
  assert.match(d, /macOS and Linux builds are not published yet/);
  assert.match(h, /not code-signed/); assert.match(h, /id="licence"/); assert.match(h, /Apache License 2\.0/); assert.doesNotMatch(h, /All rights reserved|proprietary software/i);
  assert.match(rs('privacy.html'), /Content Security Policy/);
  assert.doesNotMatch(h + d, /Windows, macOS(,| and) Linux/);
  assert.match(rs('quickstart.html'), /Approve the hire/);
});
