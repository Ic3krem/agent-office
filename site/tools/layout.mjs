// Shared page shell. Strict CSP: everything is same-origin, no inline script or style.
// The CSP is built here, in one place, from config.json (analytics provider hosts are added only when enabled).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const readJson = f => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));
export const config = readJson('config.json');
export const release = readJson('release.json');

export function analyticsHosts(cfg = config) {
  const a = cfg.analytics || {};
  if (a.provider === 'cloudflare' && a.cloudflare && a.cloudflare.token) {
    return { script: ['https://static.cloudflareinsights.com'], connect: ['https://cloudflareinsights.com'], img: [] };
  }
  if (a.provider === 'goatcounter' && a.goatcounter && /^[a-z0-9-]+$/.test(a.goatcounter.code || '')) {
    const ep = `https://${a.goatcounter.code}.goatcounter.com`;
    return { script: ['https://gc.zgo.at'], connect: [ep], img: [ep] };
  }
  return { script: [], connect: [], img: [] };
}

export function buildCsp(cfg = config) {
  const h = analyticsHosts(cfg);
  return [
    "default-src 'none'",
    `script-src 'self'${h.script.map(x => ' ' + x).join('')}`,
    "style-src 'self'",
    `img-src 'self'${h.img.map(x => ' ' + x).join('')}`,
    "font-src 'self'",
    `connect-src 'self'${h.connect.map(x => ' ' + x).join('')}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

// <picture> with AVIF, WebP and PNG fallback. `alt` must already be HTML-escaped.
export function picture(root, name, alt, { loading = 'lazy', priority = false, cls = '', sizes = '100vw', plain = false } = {}) {
  const dir = path.join(SITE, 'assets', 'img');
  const base = name.replace(/\.png$/, '').replace(/kiro/g, 'tiro');
  const has = f => fs.existsSync(path.join(dir, f));
  const png = fs.readFileSync(path.join(dir, base + '.png'));
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const small = has(base + '-640.avif');
  const set = ext => (small ? `${root}assets/img/${base}-640.${ext} 640w, ` : '') + `${root}assets/img/${base}.${ext} ${w}w`;
  const img = `<img src="${root}assets/img/${base}.png" width="${w}" height="${h}" alt="${alt}"${cls ? ` class="${cls}"` : ''} decoding="async"${priority ? ' fetchpriority="high"' : ` loading="${loading}"`}>`;
  if (plain) return img;
  return `<picture><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}"><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">${img}</picture>`;
}

export function layout({ root, title, desc, nav, main, scripts = [], bodyClass = '' }) {
  const link = (href, label, key) => `<a href="${root}${href}"${nav === key ? ' aria-current="page"' : ''}${key === 'download' ? ' class="nav-cta"' : ''}>${label}</a>`;
  const allScripts = ['common.js', ...scripts];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${buildCsp()}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#16110e">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="Agent Office releases" href="${root}releases.xml">
<link rel="stylesheet" href="${root}assets/fonts/fonts.css">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap">
<a class="brand" href="${root}index.html"><img src="${root}assets/favicon.svg" width="34" height="34" alt="">Agent Office</a>
<nav class="site-nav" aria-label="Main">
${link('quickstart.html', 'Quickstart', 'quickstart')}
${link('docs/index.html', 'Docs', 'docs')}
${link('changelog.html', 'Changelog', 'changelog')}
${link('stats.html', 'Stats', 'stats')}
${link('download.html', 'Download', 'download')}
</nav>
</div>
</header>
${main}
<footer class="site-footer">
<div class="wrap">
<div class="cols">
<div><h2>Agent Office</h2><p>A pixel office for your own Claude Code agents.</p><p class="meta">This site sets no cookies.</p></div>
<div><h2>Get it</h2><ul><li><a href="${root}download.html">Download for Windows</a></li><li><a href="${root}quickstart.html">Quickstart</a></li><li><a href="${root}changelog.html">Changelog</a></li><li><a href="${root}releases.xml">Releases feed (Atom)</a></li></ul></div>
<div><h2>Learn</h2><ul><li><a href="${root}docs/index.html">Documentation</a></li><li><a href="${root}docs/security.html">Security</a></li><li><a href="${root}docs/troubleshooting.html">Troubleshooting</a></li><li><a href="${root}llms.txt">llms.txt</a></li></ul></div>
<div><h2>Legal</h2><ul><li><a href="${root}index.html#licence">Licence: Apache-2.0</a></li><li><a href="${root}privacy.html">Privacy</a></li><li><a href="${root}stats.html">Download statistics</a></li></ul></div>
</div>
<small>Open source under the Apache License 2.0. Not affiliated with Anthropic: Claude and Claude Code are Anthropic products, and Agent Office runs on your own Claude Code install and plan. Builds are not code-signed.</small>
</div>
</footer>
${allScripts.map(s => `<script src="${root}assets/${s}" defer></script>`).join('\n')}
</body>
</html>
`;
}
