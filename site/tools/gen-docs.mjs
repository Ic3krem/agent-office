// Generates every HTML page, the docs search index, llms.txt, per-page .md copies and the Atom releases feed.
// Run: node site/tools/gen-docs.mjs. Output is committed; hosting needs no build step.
// Re-run after editing README.md, docs/*.md, CHANGELOG.md, release.json, stats.json or config.json.
import fs from 'node:fs';
import path from 'node:path';
import { layout, esc, picture, release, config, SITE, pageUrl } from './layout.mjs';
import { renderMd, slugify } from './md.mjs';
import { homePage } from './home.mjs';
import { downloadPage, quickstartPage, statsPage, privacyPage } from './pages.mjs';

const REPO = path.resolve(SITE, '..');
const raw = f => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n').replace(/\bKiro\b/g, 'Tiro');
// The product is TiroAgents since 2.0: prose says so, while code spans (folder names such as `Agent Office Vault`) and
// mentions of the old 1.x name stay. The changelog is history and is read raw.
const rebrand = md => md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((p, i) => (i % 2 ? p : p.replace(/\bAgent Office\b(?! 1\.x| before 2)/g, 'TiroAgents'))).join('');
const read = f => (f === 'CHANGELOG.md' ? raw(f) : rebrand(raw(f)));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(SITE, rel)), { recursive: true }); fs.writeFileSync(path.join(SITE, rel), text); };

// ---------- section slicing ----------
function section(md, h2, { keepHeading = false } = {}) {
  const lines = md.split('\n');
  const start = lines.findIndex(l => l.trim() === '## ' + h2);
  if (start < 0) throw new Error('missing section: ' + h2);
  let end = lines.findIndex((l, k) => k > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { md: lines.slice(keepHeading ? start : start + 1, end).join('\n'), shift: keepHeading ? 0 : -1 };
}
const body = md => ({ md: md.replace(/^# .*\n+/, ''), shift: 0 });
const hand = md => ({ md, shift: 0 });
const edit = (md, pairs) => pairs.reduce((s, [a, b]) => { if (typeof a === 'string' && !s.includes(a)) throw new Error('edit target missing: ' + a); return s.replace(a, b); }, md);

const README = read('README.md'), GUIDE = read('docs/GUIDE.md'), PERM = read('docs/permissions.md'), SCHED = read('docs/scheduler.md'),
  AGENTS = read('docs/agents-and-memory.md'), PARTY = read('docs/party.md'), CHANGELOG = read('CHANGELOG.md');
const GUARD = read('docs/security-guard.md').split(/\n## For maintainers/)[0];

const installMd = section(README, 'Install').md;
const breakerLine = (GUIDE.match(/^- \*\*Breaker box switches:\*\*.*$/m) || [''])[0].replace(/^- /, '');
if (!breakerLine) throw new Error('breaker box line not found in GUIDE.md');

const requirementsMd = `TiroAgents needs:

- **Windows 10 or later, macOS (Apple silicon or Intel) or Linux (x64, AppImage or .deb).**
- **Claude Code** installed and logged in (run \`claude\` once). TiroAgents uses your own Claude Code install and plan.
- Disk space for the installer (about ${(release.size / 1048576).toFixed(0)} MB) and your notes and reports.

Nothing else is required. The office uses no tokens. Models only run while an agent works, through your own Claude Code plan.

The builds are **not code-signed**, so Windows may show a SmartScreen warning, Windows 11 Smart App Control may block the installer and macOS may refuse to open the app until you allow it. See [Troubleshooting](troubleshooting.html#smartscreen-and-smart-app-control).`;

const smartAppMd = `## SmartScreen and Smart App Control

The installer is not code-signed. Compare its SHA-256 with the one on the [download page](site:download.html#verify) before you run it.

- **SmartScreen** may show "Windows protected your PC". If the SHA-256 matches, choose **More info**, then **Run anyway**.
- **Smart App Control (Windows 11)** can block an unsigned installer and offer no Run anyway option. It is a Windows setting under Windows Security, App and browser control, Smart App Control settings. Turning it off can be permanent on some Windows 11 versions, so decide deliberately. If you cannot accept that, do not install the unsigned build.
`;

const breakerMd = `The breaker box in the office holds hard switches. They are real: they gate what Tiro can do.

${breakerLine}

Switches are stored in \`~/.claude/agent-office/switches.json\`. See [Configuration](configuration.html) and [Hiring and approvals](approvals.html).`;

// ---------- information architecture ----------
const GROUPS = [
  { name: 'Get started', pages: [
    { slug: 'requirements', title: 'Requirements', lead: 'What you need before installing TiroAgents: a supported system and Claude Code, signed in.', src: [hand(requirementsMd)] },
    { slug: 'install', title: 'Install and verify', lead: 'Install TiroAgents on Windows, macOS or Linux and check the download.', src: [{ md: installMd, shift: -1 }] },
    { slug: 'first-task', title: 'First task with Tiro', lead: 'Open the office and give Tiro its first goal, then approve the hire and read the report.', src: [section(GUIDE, 'Starting', { keepHeading: true }), section(GUIDE, 'Giving work', { keepHeading: true })] },
    { slug: 'update', title: 'Update', lead: 'Check for and install a new version from the island.', src: [section(README, 'Update')] },
    { slug: 'uninstall', title: 'Uninstall', lead: 'Remove the app and decide what to do with your data.', src: [section(README, 'Uninstall')] },
  ] },
  { name: 'Using the office', pages: [
    { slug: 'office', title: 'The dashboard and the office', lead: 'The panels, the world, the objects and the agent history.', src: [section(GUIDE, 'The dashboard', { keepHeading: true }), section(GUIDE, 'The office', { keepHeading: true }), section(GUIDE, 'Agent history', { keepHeading: true })] },
    { slug: 'approvals', title: 'Hiring and approvals', lead: 'The strict hiring gate and Claude Code tool approvals.', src: [section(GUIDE, 'Approvals')] },
    { slug: 'team', title: 'The team', lead: 'Tiro\x27s eight specialists, how to rename them, and the SOPs that guide their work.', src: [section(GUIDE, 'The team')] },
    { slug: 'agents-and-memory', title: 'Agents and memory', lead: 'The team, the hiring gate and per-agent memory and history.', src: [body(AGENTS)] },
    { slug: 'goals-and-reports', title: 'Goals, reports and the vault', lead: 'The Today board, reports with PDF and Excel export, and the memory corkboard.', src: [section(GUIDE, 'Goals, Today and Reports')] },
    { slug: 'island', title: 'The island, Tiro and the tray', lead: 'The notch-style overlay, the desktop character, the tray menu and keyboard use.', src: [section(GUIDE, 'The island', { keepHeading: true }), section(GUIDE, 'Tiro on your desktop', { keepHeading: true }), section(GUIDE, 'Tray', { keepHeading: true }), section(GUIDE, 'Keyboard and accessibility', { keepHeading: true })] },
    { slug: 'party', title: 'Party and the meeting room', lead: 'Play together, and talk by voice in the meeting room: what others see and how listen only works.', src: [body(PARTY)] },
    { slug: 'scheduler', title: 'Scheduler', lead: 'The scheduler station, the job and the inbox feed file.', src: [body(SCHED)] },
  ] },
  { name: 'Safety', pages: [
    { slug: 'permissions', title: 'Permissions and Claude Code parity', lead: 'TiroAgents runs on your own Claude Code configuration. What is the same, what differs and what reaches you.', src: [body(PERM)] },
    { slug: 'security', title: 'Security model', lead: 'How the local server, the windows, installs and approvals are protected.', src: [section(README, 'Security model', { keepHeading: true }), section(GUIDE, 'Security notes', { keepHeading: true })] },
    { slug: 'security-guard', title: 'Security Guard', lead: 'An ask-only safety net for secrets, downloaded scripts and untrusted instructions.', src: [body(GUARD)] },
    { slug: 'breaker-box', title: 'Breaker box and subscription guard', lead: 'Hard switches, and the guard that stops at your plan limit.', src: [hand(breakerMd)] },
  ] },
  { name: 'Reference', pages: [
    { slug: 'configuration', title: 'Configuration', lead: 'Preferences, environment variables, settings files, the scheduler job and the terminal bridge.', src: [section(README, 'Configuration'), section(GUIDE, 'Settings files', { keepHeading: true })] },
    { slug: 'troubleshooting', title: 'Troubleshooting', lead: 'Windows install warnings and fixes for common problems with TiroAgents.', src: [hand(smartAppMd), section(GUIDE, 'Troubleshooting', { keepHeading: true })] },
    { slug: 'faq', title: 'FAQ', lead: 'Short answers to common questions about TiroAgents: tokens, hiring, your data and installing.', src: [section(GUIDE, 'FAQ')] },
    { slug: 'api', title: 'API reference', lead: 'The local HTTP API that the TiroAgents dashboard and the island use, route by route.', src: [section(GUIDE, 'API reference')] },
    { slug: 'guide', title: 'Full user guide', lead: 'Every panel, the island, the tray, settings files and the API table.', src: [body(GUIDE)] },
  ] },
];
const PAGES = GROUPS.flatMap(g => g.pages.map(p => ({ ...p, group: g.name })));
const ORDER = [{ slug: 'index', title: 'Overview', href: 'index.html' }, ...PAGES.map(p => ({ slug: p.slug, title: p.title, href: p.slug + '.html' }))];

const README_ANCHOR = { install: 'install', update: 'update', uninstall: 'uninstall', configuration: 'configuration', 'security-model': 'security' };
const FILE_PAGE = { 'permissions.md': 'permissions', 'scheduler.md': 'scheduler', 'agents-and-memory.md': 'agents-and-memory', 'GUIDE.md': 'guide', 'security-guard.md': 'security-guard' };
const ALL_SLUGS = new Set(PAGES.map(p => p.slug));

function makeCtx(page, anchorMap, root) {
  return {
    titleOf(n) { const f = { 'permissions': 'permissions', 'scheduler': 'scheduler', 'agents-and-memory': 'agents-and-memory', 'GUIDE': 'guide', 'security-guard': 'security-guard' }[n]; const q = PAGES.find(x => x.slug === f); return q ? q.title : null; },
    picture(href, alt) { return picture(root, href.split('/').pop(), alt, { sizes: '(min-width: 1200px) 760px, 100vw' }); },
    link(href) {
      if (href.startsWith('site:')) return root + href.slice(5);
      if (/^https?:/.test(href)) return /^https:\/\/claude\.com\//.test(href) ? href : null; // GitHub links are plain text
      const [file, hash = ''] = href.split('#');
      const base = file.split('/').pop();
      let slug = null;
      if (!file) { const set = anchorMap.get(hash); slug = set && (set.has(page.slug) ? page.slug : [...set][0]); }
      else if (base === 'README.md') slug = hash ? README_ANCHOR[hash] : null;
      else if (FILE_PAGE[base]) slug = FILE_PAGE[base];
      else if (base === 'CHANGELOG.md') return root + 'changelog.html';
      else if (base.endsWith('.html') && ALL_SLUGS.has(base.slice(0, -5))) slug = base.slice(0, -5);
      if (!slug) return null;
      if (hash && anchorMap.size && !(anchorMap.get(hash) || new Set()).has(slug)) return slug === page.slug ? null : slug + '.html';
      return (slug === page.slug ? '' : slug + '.html') + (hash ? '#' + hash : '');
    },
  };
}
function build(page, anchorMap) {
  const ctx = makeCtx(page, anchorMap, '../');
  const parts = page.src.map(s => renderMd(s.md, ctx, { shift: s.shift }));
  return { html: parts.map(p => p.html).join('\n'), ids: parts.flatMap(p => p.ids) };
}

const anchorMap = new Map();
for (const p of PAGES) for (const h of build(p, new Map()).ids) { if (!anchorMap.has(h.id)) anchorMap.set(h.id, new Set()); anchorMap.get(h.id).add(p.slug); }

// ---------- helpers ----------
const plain = html => html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const searchIndex = [];
const stamp = `Written for v${release.version} &middot; updated ${esc(release.date)}`;

function sidebar(current) {
  const item = (href, label, slug) => `<li><a href="${href}"${slug === current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  return `<aside class="docs-side" aria-label="Documentation">
<div role="search" class="doc-search"><label for="doc-search">Search the docs</label><input id="doc-search" type="search" autocomplete="off" placeholder="Search"><p id="doc-search-status" class="meta" role="status" aria-live="polite"></p><ul id="doc-results"></ul></div>
<nav aria-label="Docs sections"><ul class="top">${item('index.html', 'Overview', 'index')}</ul>${GROUPS.map(g => `<h2>${esc(g.name)}</h2><ul>${g.pages.map(p => item(p.slug + '.html', p.title, p.slug)).join('')}${g.name === 'Reference' ? '<li><a href="../changelog.html">Changelog</a></li>' : ''}</ul>`).join('')}</nav>
</aside>`;
}

// Breadcrumbs for search results: Home > Docs > page.
function docLd(slug, title, lead, group) {
  const items = [['TiroAgents', 'index.html'], ['Docs', 'docs/index.html']];
  if (slug !== 'index') items.push([title, `docs/${slug}.html`]);
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: pageUrl(p) })) };
}

function docPage(slug, title, lead, htmlBody, tocItems, group) {
  const i = ORDER.findIndex(o => o.slug === slug);
  const prev = ORDER[i - 1], next = ORDER[i + 1];
  const toc = tocItems.filter(h => h.lvl === 2);
  const tocHtml = toc.length > 1 ? `<nav class="page-toc" aria-label="On this page"><h2>On this page</h2><ul>${toc.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></nav>` : '';
  const pn = `<nav class="prev-next" aria-label="Previous and next page">${prev ? `<a class="prev" href="${prev.href}"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.href}"><span>Next</span>${esc(next.title)}</a>` : '<span></span>'}</nav>`;
  return layout({
    root: '../', title: (slug === 'index' ? 'Documentation' : title) + ' - TiroAgents docs', desc: lead, nav: 'docs', scripts: ['search.js'], page: 'docs/' + slug + '.html', jsonLd: docLd(slug, title, lead, group),
    main: `<div class="wrap docs-layout">${sidebar(slug)}<main id="main" class="doc"><p class="meta"><a href="index.html">Docs</a>${group ? ' / ' + esc(group) : ''}${slug === 'index' ? '' : ' / ' + esc(title)}</p><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p><p class="meta">${stamp}</p>${htmlBody}${slug === 'index' ? '' : pn}</main>${tocHtml}</div>`,
  });
}

const mdCopy = (p, srcs) => `# ${p.title}\n\n${p.lead}\n\n(TiroAgents v${release.version}, ${release.date})\n\n` + srcs.map(s => s.md.replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '').replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(https:\/\/github\.com[^)]*\)/g, '$1')).join('\n\n') + '\n';

for (const p of PAGES) {
  const { html, ids } = build(p, anchorMap);
  write(`docs/${p.slug}.html`, docPage(p.slug, p.title, p.lead, html, ids, p.group));
  write(`docs/${p.slug}.md`, mdCopy(p, p.src));
  // search index: one entry per h2 section
  const chunks = html.split(/(?=<h2 id=")/);
  chunks.forEach((c, k) => {
    const m = c.match(/^<h2 id="([^"]+)">(.*?)<\/h2>/);
    const text = plain(c).slice(0, 600);
    if (!text) return;
    searchIndex.push({ t: m ? `${p.title}: ${plain(m[2])}` : p.title, u: `docs/${p.slug}.html${m ? '#' + m[1] : ''}`, x: text });
  });
}

// docs hub
{
  const start = [['quickstart', 'Quickstart', 'Install and finish your first task in ten minutes.', '../quickstart.html'], ['install', 'Install and verify', 'Installers, the SHA-256 check and install warnings.', 'install.html'], ['approvals', 'Hiring and approvals', 'How Tiro asks before it hires.', 'approvals.html'], ['troubleshooting', 'Troubleshooting', 'SmartScreen, Smart App Control and common fixes.', 'troubleshooting.html']];
  const html = `<h2>Start here</h2><div class="doc-grid">${start.map(([, t, d, h]) => `<a class="card" href="${h}"><h3>${esc(t)}</h3><p>${esc(d)}</p></a>`).join('')}</div>${GROUPS.map(g => `<h2>${esc(g.name)}</h2><ul class="hub-list">${g.pages.map(p => `<li><a href="${p.slug}.html">${esc(p.title)}</a> <span class="meta">${esc(p.lead)}</span></li>`).join('')}${g.name === 'Reference' ? '<li><a href="../changelog.html">Changelog</a> <span class="meta">What changed, version by version.</span></li>' : ''}</ul>`).join('')}`;
  write('docs/index.html', docPage('index', 'Documentation', 'Guides for TiroAgents, generated from the project documentation.', html, [], ''));
  searchIndex.push({ t: 'Documentation', u: 'docs/index.html', x: 'Guides for TiroAgents: get started, using the office, safety and reference.' });
}

// changelog
const clMd = CHANGELOG.replace(/^# .*\n+/, '').replace(/`docs\/permissions\.md`/g, '[permissions](docs/permissions.html)').replace(/`docs\/security-guard\.md`/g, '[Security Guard](docs/security-guard.html)');
{
  const ctx = { picture: (h, a) => '', link: h => (h.startsWith('docs/') || /^https:\/\/claude\.com\//.test(h) ? h : null) };
  const { html, ids } = renderMd(clMd, ctx);
  write('changelog.html', layout({
    root: '', title: 'Changelog - TiroAgents', desc: 'What changed in each version of TiroAgents (Agent Office before 2.0).', nav: 'changelog', page: 'changelog.html',
    main: `<div class="wrap page"><main id="main" class="doc changelog"><h1>Changelog</h1><p class="meta">Subscribe with the <a href="releases.xml">Atom feed</a>.</p>${html}</main></div>`,
  }));
  searchIndex.push({ t: 'Changelog', u: 'changelog.html', x: plain(html).slice(0, 600) });
}

// root pages
write('index.html', homePage());
write('download.html', downloadPage());
write('quickstart.html', quickstartPage());
write('stats.html', statsPage());
write('privacy.html', privacyPage());
searchIndex.push({ t: 'Quickstart', u: 'quickstart.html', x: 'Install Claude Code, download and verify, install, give Tiro a task, approve the hire, read the report.' });
write('search-index.json', JSON.stringify(searchIndex));

// sitemap.xml + robots.txt: every HTML page, newest release date as lastmod. A project site's robots.txt is not read at
// the host root, so the sitemap is also linked from robots.txt for hosts that do, and is submitted in Search Console.
{
  const pages = [];
  const walk = d => { for (const f of fs.readdirSync(path.join(SITE, d), { withFileTypes: true })) { const rel = d ? d + '/' + f.name : f.name;
    if (f.isDirectory()) { if (!['assets', 'tools', 'edge', 'docs-internal', 'node_modules'].includes(f.name)) walk(rel); } else if (f.name.endsWith('.html')) pages.push(rel); } };
  walk('');
  const prio = p => (p === 'index.html' ? '1.0' : ['download.html', 'quickstart.html', 'docs/index.html'].includes(p) ? '0.8' : '0.5');
  pages.sort((a, b) => prio(b) - prio(a) || a.localeCompare(b));
  const urls = pages.map(p => `  <url><loc>${esc(pageUrl(p))}</loc><lastmod>${release.date}</lastmod><priority>${prio(p)}</priority></url>`);
  write('sitemap.xml', ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join(String.fromCharCode(10)));
  write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${pageUrl('sitemap.xml')}
`);
}

// llms.txt
{
  const b = config.baseUrl.replace(/\/?$/, '/');
  write('llms.txt', `# TiroAgents

> A pixel office for your own Claude Code agents. Tiro, an orange cube-crab office manager, plans work and asks before it hires specialist agents. The office itself spends no tokens. Version ${release.version} for Windows, macOS and Linux (named Agent Office before 2.0). Builds are not code-signed. Open source, Apache-2.0.

## Start

- [Quickstart](${b}quickstart.html): install and finish a first task
- [Download](${b}download.html): files for every system, SHA-256 and install warnings
- [Changelog](${b}changelog.html): what changed in each version

## Docs (Markdown copies)

${GROUPS.map(g => `### ${g.name}\n\n${g.pages.map(p => `- [${p.title}](${b}docs/${p.slug}.md): ${p.lead}`).join('\n')}`).join('\n\n')}

## Optional

- [Releases feed](${b}releases.xml)
- [Privacy](${b}privacy.html)
- [Download statistics](${b}stats.html)
`);
}

// Atom feed from CHANGELOG
{
  const b = config.baseUrl.replace(/\/?$/, '/');
  const entries = [];
  const parts = clMd.split(/^## /m).slice(1);
  for (const part of parts) {
    const head = part.split('\n')[0];
    const m = head.match(/^(\d+\.\d+\.\d+)(?:\s+—\s+[^(]+?)?\s+\((\d{4}-\d{2}-\d{2})\)/);
    if (!m) continue;
    const rest = part.split('\n').slice(1).join('\n');
    const firstPara = (rest.trim().split(/\n\n/)[0] || '').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    entries.push({ v: m[1], d: m[2], id: slugify(head), s: firstPara });
  }
  const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const updated = entries.length ? entries[0].d : release.date;
  write('releases.xml', `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>TiroAgents releases</title>
<subtitle>New versions of TiroAgents (Agent Office before 2.0), from the changelog.</subtitle>
<link href="${b}releases.xml" rel="self" type="application/atom+xml"/>
<link href="${b}changelog.html" rel="alternate" type="text/html"/>
<id>${b}</id>
<updated>${updated}T00:00:00Z</updated>
${entries.map(e => `<entry>
<title>${+e.v.split('.')[0] >= 2 ? 'TiroAgents' : 'Agent Office'} ${e.v}</title>
<link href="${b}changelog.html#${e.id}"/>
<id>${b}changelog.html#${e.id}</id>
<updated>${e.d}T00:00:00Z</updated>
<summary>${x(e.s)}</summary>
</entry>`).join('\n')}
</feed>
`);
}
console.log('generated', PAGES.length + 1 + 5, 'html pages;', searchIndex.length, 'search entries');
