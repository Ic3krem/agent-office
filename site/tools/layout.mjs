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

// The download counter (site/edge). Only a bare https origin counts; anything else leaves the site on GitHub links and stats.json.
export function edgeOrigin(cfg = config) {
  const o = String((cfg.edge && cfg.edge.origin) || '').trim().replace(/\/+$/, '');
  try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o ? o : ''; } catch { return ''; }
}

// Release files by the counter's asset key. release.json `assets` names each file; it sits next to `url` on GitHub.
export const PLATFORM_ASSETS = [['windows', 'windows', 'Windows', 'Installer (.exe), Windows 10 or later'], ['mac-arm64', 'macos', 'macOS', 'Apple silicon (.dmg)'], ['mac-x64', 'macos', 'macOS', 'Intel (.dmg)'], ['linux-appimage', 'linux', 'Linux', 'AppImage, x64'], ['linux-deb', 'linux', 'Linux', 'Debian and Ubuntu (.deb), x64']];
export const assetFile = (key, r = release) => (r.assets && r.assets[key]) || (key === 'windows' ? r.asset : '');
export const assetUrl = (key, r = release) => r.url.replace(/[^/]+$/, assetFile(key, r));
export const dlHref = (key, cfg = config, r = release) => (edgeOrigin(cfg) ? `${edgeOrigin(cfg)}/dl/${key}` : assetUrl(key, r));
// The main download per OS: Apple silicon for macOS (Intel is listed next to it), the AppImage for Linux.
export const OS_MAIN = { windows: 'windows', macos: 'mac-arm64', linux: 'linux-appimage' };
export const OS_NAME = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function buildCsp(cfg = config) {
  const h = analyticsHosts(cfg), edge = edgeOrigin(cfg);
  if (edge) h.connect = [...h.connect, edge];
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

export function layout({ root, title, desc, nav, main, scripts = [], modules = [], bodyClass = '' }) {
  const link = (href, label, key, cls = '') => `<a href="${root}${href}"${nav === key ? ' aria-current="page"' : ''}${cls ? ` class="${cls}"` : ''}>${label}</a>`;
  const allScripts = ['common.js', ...scripts];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${buildCsp()}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f2f5fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#10142a" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="TiroAgents releases" href="${root}releases.xml">
<link rel="stylesheet" href="${root}assets/fonts/fonts.css">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap">
<a class="brand" href="${root}index.html">${picture(root, 'tiro-idle', '', { plain: true, loading: 'eager' })}TiroAgents</a>
<nav class="site-nav" aria-label="Main">
${link('index.html#features', 'Features', 'features', 'wide-only')}
${link('index.html#security', 'Security', 'security', 'wide-only')}
${link('quickstart.html', 'Quickstart', 'quickstart', 'wide-only')}
${link('docs/index.html', 'Docs', 'docs')}
${link('changelog.html', 'Changelog', 'changelog', 'wide-only')}
${link('download.html', 'Download', 'download', 'btn primary small')}
</nav>
</div>
</header>
${main}
<footer class="site-footer">
<div class="wrap">
<nav aria-label="Footer"><a href="${root}docs/index.html">Docs</a><a href="${root}quickstart.html">Quickstart</a><a href="${root}download.html">Download</a><a href="${root}changelog.html">Changelog</a><a href="${root}docs/security.html">Security</a><a href="${root}privacy.html">Privacy</a><a href="${root}stats.html">Download statistics</a><a href="${root}releases.xml">Releases feed</a><a href="${root}llms.txt">llms.txt</a></nav>
<p class="legal">Open source under the <a href="https://github.com/Ic3krem/agent-office/blob/main/LICENSE">Apache License 2.0</a>. Not affiliated with Anthropic: Claude and Claude Code are Anthropic products, and TiroAgents runs on your own Claude Code install and plan. Installers are not code-signed. This site sets no cookies.</p>
</div>
</footer>
${allScripts.map(s => `<script src="${root}assets/${s}" defer></script>`).join('\n')}${modules.map(s => `\n<script type="module" src="${root}assets/${s}"></script>`).join('')}
</body>
</html>
`;
}
