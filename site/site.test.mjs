// node --test site/site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const all = walk(SITE).filter(f => !f.includes(`${path.sep}tools${path.sep}`) || true);
const html = all.filter(f => f.endsWith('.html'));
const text = all.filter(f => /\.(html|css|js|json|svg|mjs|md)$/.test(f));
const rd = f => fs.readFileSync(f, 'utf8');
const rel = f => path.relative(SITE, f).replaceAll('\\', '/');

const idsOf = t => [...t.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const attrs = (t, re) => [...t.matchAll(re)].map(m => m[1]);

test('expected pages exist', () => {
  for (const p of ['index.html', 'download.html', 'changelog.html', 'docs/index.html', 'release.json', 'README.md',
    ...['install', 'update', 'uninstall', 'configuration', 'permissions', 'security', 'security-guard', 'scheduler', 'agents-and-memory', 'troubleshooting', 'guide'].map(s => `docs/${s}.html`)]) {
    assert.ok(fs.existsSync(path.join(SITE, p)), p);
  }
});

test('every local link, image, script and stylesheet resolves, and every #anchor exists', () => {
  for (const f of html) {
    const t = rd(f), ids = new Set(idsOf(t));
    assert.equal(ids.size, idsOf(t).length, rel(f) + ' has duplicate ids');
    for (const m of t.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const u = m[1];
      if (/^https:\/\/claude\.com\//.test(u)) continue;
      assert.doesNotMatch(u, /^[a-z][a-z0-9+.-]*:|^\/\//i, `${rel(f)} has non-local url ${u}`);
      const [file, hash] = u.split('#');
      const target = file ? path.resolve(path.dirname(f), file) : f;
      assert.ok(fs.existsSync(target), `${rel(f)} -> ${u} does not exist`);
      if (hash) {
        const tt = target === f ? t : (target.endsWith('.html') ? rd(target) : '');
        assert.ok(target === f ? ids.has(hash) : new Set(idsOf(tt)).has(hash), `${rel(f)} -> ${u} anchor missing`);
      }
    }
  }
});

test('local CSS font and image urls resolve', () => {
  for (const f of all.filter(f => f.endsWith('.css'))) {
    for (const u of attrs(rd(f), /url\(([^)]+)\)/g)) {
      const clean = u.replace(/['"]/g, '');
      assert.doesNotMatch(clean, /^[a-z][a-z0-9+.-]*:|^\/\//i, `${rel(f)} has remote url`);
      assert.ok(fs.existsSync(path.resolve(path.dirname(f), clean)), `${rel(f)} -> ${clean}`);
    }
  }
});

test('no remote hosts: no CDN, remote fonts, trackers, inline script or style', () => {
  for (const f of text.filter(f => !/[\\/]tools[\\/]|README\.md$|site\.test\.mjs$|release\.json$/.test(f))) {
    const t = rd(f);
    for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      // Allowed: the Claude Code link, and install one-liners shown as text in <code> (GitHub raw), XML namespaces.
      const inCode = new RegExp('<code>[^<]*' + host.replaceAll('.', '\\.')).test(t);
      const ok = host === 'claude.com' || host === 'www.w3.org' || (inCode && /^(raw\.githubusercontent\.com|api\.github\.com|github\.com)$/.test(host));
      assert.ok(ok, `${rel(f)} references ${host}`);
    }
    if (f.endsWith('.html')) {
      assert.doesNotMatch(t, /<script(?![^>]*\ssrc=")[^>]*>/i, rel(f) + ' has an inline script');
      assert.doesNotMatch(t, /<style[\s>]/i, rel(f) + ' has an inline style block');
      assert.doesNotMatch(t, /\sstyle="/i, rel(f) + ' has a style attribute');
      assert.doesNotMatch(t, /\son[a-z]+="/i, rel(f) + ' has an inline event handler');
      assert.match(t, /http-equiv="Content-Security-Policy"/);
      assert.doesNotMatch(t, /<link[^>]+href="https?:/i);
      assert.doesNotMatch(t, /(?:src|href)="https?:\/\/(?!claude\.com)/i);
    }
    if (f.endsWith('.js')) assert.doesNotMatch(t, /\b(eval|new Function|innerHTML|document\.write|XMLHttpRequest|sendBeacon|WebSocket)\b/, rel(f));
  }
});

test('fonts are local files with license texts', () => {
  const css = rd(path.join(SITE, 'assets/fonts/fonts.css'));
  assert.doesNotMatch(css, /https?:|@import/);
  for (const n of ['pixelifysans', 'ibmplexmono', 'instrumentsans']) assert.ok(fs.existsSync(path.join(SITE, `assets/fonts/OFL-${n}.txt`)));
  assert.ok(html.every(f => rd(f).includes('assets/fonts/fonts.css')));
});

test('accessibility basics: lang, title, skip link, main landmark, image alt, one h1', () => {
  for (const f of html) {
    const t = rd(f);
    assert.match(t, /<html lang="en">/); assert.match(t, /<title>[^<]+<\/title>/);
    assert.match(t, /class="skip" href="#main"/); assert.equal((t.match(/<main\b/g) || []).length, 1, rel(f));
    assert.equal((t.match(/<h1\b/g) || []).length, 1, rel(f) + ' h1 count');
    for (const img of t.match(/<img\b[^>]*>/g) || []) assert.match(img, /\salt="/, rel(f) + ' img without alt');
    assert.match(t, /name="viewport"/);
  }
});

test('the name of the owning company never appears anywhere in the site', () => {
  for (const f of text) assert.doesNotMatch(rd(f), new RegExp('Cic' + 'ero', 'i'), rel(f));
});

test('release.json has the schema the download page reads', () => {
  const r = JSON.parse(rd(path.join(SITE, 'release.json')));
  assert.equal(r.schema, 1);
  assert.match(r.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(r.asset, `Agent-Office-Setup-${r.version}.exe`);
  assert.ok(typeof r.url === 'string' && (/^https:\/\//.test(r.url) || !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(r.url)), 'url is https or a relative path');
  assert.ok(r.sha256 === '' || /^[0-9a-f]{64}$/.test(r.sha256), 'sha256 is 64 lowercase hex, or empty until published');
  assert.ok(r.size === null || (Number.isInteger(r.size) && r.size > 0));
  assert.ok(r.date === undefined || /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  assert.ok(r.notes === undefined || typeof r.notes === 'string');
  const allowed = new Set(['schema', 'version', 'asset', 'url', 'sha256', 'size', 'date', 'notes']);
  for (const k of Object.keys(r)) assert.ok(allowed.has(k), 'unknown key ' + k);
});

test('download page wires the ids download.js fills', () => {
  const t = rd(path.join(SITE, 'download.html')), js = rd(path.join(SITE, 'assets/download.js'));
  for (const id of attrs(js, /\$\('([a-z-]+)'\)/g)) assert.ok(t.includes(`id="${id}"`), 'missing #' + id);
  assert.match(t, /SmartScreen/); assert.match(t, /SHA-256/);
  assert.match(js, /release\.json/);
});

test('honest platform claims: Windows only, unsigned', () => {
  const d = rd(path.join(SITE, 'download.html')), h = rd(path.join(SITE, 'index.html'));
  assert.match(d, /macOS and Linux builds are not published yet/);
  assert.match(h, /not code-signed/);
  assert.match(h, /id="licence"/); assert.match(h, /All rights reserved/);
  assert.doesNotMatch(h + d, /Windows, macOS(,| and) Linux/);
});
