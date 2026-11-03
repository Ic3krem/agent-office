// Shared page shell. Strict CSP: everything is same-origin, no inline script or style.
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

export function layout({ root, title, desc, nav, main, scripts = [], bodyClass = '' }) {
  const link = (href, label, key) => `<a href="${root}${href}"${nav === key ? ' aria-current="page"' : ''}${key === 'download' ? ' class="nav-cta"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#16110e">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}assets/fonts/fonts.css">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap">
<a class="brand" href="${root}index.html"><img src="${root}assets/favicon.svg" width="34" height="34" alt="">Agent Office</a>
<nav class="site-nav" aria-label="Main">
${link('index.html', 'Home', 'home')}
${link('index.html#features', 'Features', 'x-features').replace(' aria-current="page"', '')}
${link('docs/index.html', 'Docs', 'docs')}
${link('changelog.html', 'Changelog', 'changelog')}
${link('download.html', 'Download', 'download')}
</nav>
</div>
</header>
${main}
<footer class="site-footer">
<div class="wrap">
<div class="cols">
<div><h2>Agent Office</h2><p>A pixel office for your own Claude Code agents.</p></div>
<div><h2>Get it</h2><ul><li><a href="${root}download.html">Download for Windows</a></li><li><a href="${root}docs/install.html">Install guide</a></li><li><a href="${root}changelog.html">Changelog</a></li></ul></div>
<div><h2>Learn</h2><ul><li><a href="${root}docs/guide.html">User guide</a></li><li><a href="${root}docs/security.html">Security</a></li><li><a href="${root}docs/troubleshooting.html">Troubleshooting and FAQ</a></li></ul></div>
</div>
<small>Proprietary software, all rights reserved. Not affiliated with Anthropic: Claude and Claude Code are Anthropic products, and Agent Office runs on your own Claude Code install and plan. Builds are not code-signed.</small>
</div>
</footer>
${scripts.map(s => `<script src="${root}assets/${s}"></script>`).join('\n')}
</body>
</html>
`;
}
