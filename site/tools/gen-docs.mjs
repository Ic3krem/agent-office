// Generates the site's HTML pages from the repo docs. Run: node site/tools/gen-docs.mjs
// The output is committed; hosting needs no build step. Re-run after editing README.md, docs/*.md or CHANGELOG.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePage } from './home.mjs';
import { downloadPage } from './download.mjs';
import { layout, esc } from './layout.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SITE, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

// ---------- markdown subset ----------
const slugify = t => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function pngSize(rel) {
  try {
    const b = fs.readFileSync(path.join(SITE, rel));
    if (b.readUInt32BE(12) === 0x49484452) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } catch { /* none */ }
  return null;
}

function inline(src, ctx) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, href) => {
    const url = ctx.img(href);
    const dim = pngSize(url.replace(/^(\.\.\/)+/, '')) ;
    return `<img src="${url}" alt="${alt}"${dim ? ` width="${dim[0]}" height="${dim[1]}"` : ''} loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const r = ctx.link(href.replace(/&amp;/g, '&'));
    return r ? `<a href="${esc(r)}"${/^https:/.test(r) ? ' rel="noopener noreferrer"' : ''}>${text}</a>` : text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

function renderMd(md, ctx, { shift = 0 } = {}) {
  const lines = md.split('\n');
  const out = [], ids = [];
  let i = 0;
  const flushPara = para => { if (para.length) out.push(`<p>${inline(para.join(' '), ctx)}</p>`); };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^```(\w*)/))) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre tabindex="0"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(6, Math.max(2, m[1].length + shift));
      const id = slugify(m[2]); ids.push({ id, text: m[2].replace(/[`*]/g, ''), lvl });
      out.push(`<h${lvl} id="${id}">${inline(m[2], ctx)}</h${lvl}>`); i++; continue;
    }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMd(buf.join('\n'), ctx, { shift }).html}</blockquote>`); continue;
    }
    if (l.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = r => r.replace(/^\||\|\s*$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap" role="region" aria-label="${esc((head[0] || 'Table') + ' table')}" tabindex="0"><table><thead><tr>${head.map(c => `<th scope="col">${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && (/^([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i].replace(/^([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
        // a blank line followed by a code fence belongs to the list item in the source; keep it simple and end the list
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t, ctx)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\||---+\s*$|([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    flushPara(para);
  }
  return { html: out.join('\n'), ids };
}

// ---------- section slicing ----------
function section(md, h2, { keepHeading = false } = {}) {
  const lines = md.split('\n');
  const start = lines.findIndex(l => l.trim() === '## ' + h2);
  if (start < 0) throw new Error('missing section: ' + h2);
  let end = lines.findIndex((l, k) => k > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(keepHeading ? start : start + 1, end).join('\n');
  return { md: body, shift: keepHeading ? 0 : -1 };
}
const body = md => ({ md: md.replace(/^# .*\n+/, ''), shift: 0 });

const README = read('README.md'), GUIDE = read('docs/GUIDE.md'), PERM = read('docs/permissions.md'),
  SCHED = read('docs/scheduler.md'), AGENTS = read('docs/agents-and-memory.md'), CHANGELOG = read('CHANGELOG.md');

const edit = (md, pairs) => pairs.reduce((s, [a, b]) => { if (typeof a === 'string' && !s.includes(a)) throw new Error('edit target missing: ' + a); return s.replace(a, b); }, md);

const installMd = edit(section(README, 'Install').md, [
  ['Windows 10 or later, macOS, or Linux.', 'Windows 10 or later. macOS and Linux builds are not published yet.'],
  [/> \*\*Release status:\*\*[^\n]*\n\n/, ''],
  ['Download `Agent-Office-Setup-<version>.exe` from [Releases](https://github.com/Ic3krem/agent-office/releases/latest) and run it.', 'Get `Agent-Office-Setup-<version>.exe` from the [download page](site:download.html) and run it.'],
  ['Both scripts download over https and', 'The script downloads over https and'],
  ['They stop, and install nothing,', 'It stops, and installs nothing,'],
  ['The Windows script installs silently', 'It installs silently'],
  [/ Other downloads are on the Releases page:[^\n]*\./, ''],
  [' The macOS script clears Gatekeeper\'s quarantine flag for you.', ''],
  ['```bash\ncurl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.sh | bash\n```\n\n', ''],
]);

// ---------- pages ----------
const PAGES = [
  { slug: 'install', title: 'Install', lead: 'Install Agent Office on Windows with the installer or a one-line script.', src: [{ md: installMd, shift: -1 }] },
  { slug: 'update', title: 'Update', lead: 'Check for and install a new version from the island.', src: [section(README, 'Update')] },
  { slug: 'uninstall', title: 'Uninstall', lead: 'Remove the app and decide what to do with your data.', src: [section(README, 'Uninstall')] },
  { slug: 'configuration', title: 'Configuration', lead: 'Preferences, environment variables, the scheduler job and the terminal bridge.', src: [section(README, 'Configuration'), section(GUIDE, 'Settings files', { keepHeading: true })] },
  { slug: 'permissions', title: 'Permissions and Claude Code parity', lead: 'Agent Office runs on your own Claude Code configuration. What is the same, what differs and what reaches you.', src: [body(PERM)] },
  { slug: 'security', title: 'Security', lead: 'How the local server, the windows, installs and approvals are protected.', src: [section(README, 'Security model', { keepHeading: true }), section(GUIDE, 'Security notes', { keepHeading: true })] },
  { slug: 'scheduler', title: 'Scheduler', lead: 'The scheduler station, the job and the inbox feed file.', src: [body(SCHED)] },
  { slug: 'agents-and-memory', title: 'Agents and memory', lead: 'The team, the hiring gate and per-agent memory and history.', src: [body(AGENTS)] },
  { slug: 'troubleshooting', title: 'Troubleshooting and FAQ', lead: 'Common problems and short answers.', src: [section(GUIDE, 'Troubleshooting', { keepHeading: true }), section(GUIDE, 'FAQ', { keepHeading: true })] },
  { slug: 'guide', title: 'Full user guide', lead: 'Every panel, the island, the tray, settings files and the API table.', src: [body(GUIDE)] },
];
const TITLES = Object.fromEntries(PAGES.map(p => [p.slug, p.title]));
const README_ANCHOR = { install: 'install', update: 'update', uninstall: 'uninstall', configuration: 'configuration', 'security-model': 'security' };
const FILE_PAGE = { 'permissions.md': 'permissions', 'scheduler.md': 'scheduler', 'agents-and-memory.md': 'agents-and-memory', 'GUIDE.md': 'guide' };

function makeCtx(page, anchorMap, root) {
  return {
    img(href) { return root + 'assets/img/' + href.split('/').pop(); },
    link(href) {
      if (href.startsWith('site:')) return root + href.slice(5);
      if (/^https?:/.test(href)) return /^https:\/\/claude\.com\//.test(href) ? href : null; // repo is private: no GitHub links
      const [file, hash = ''] = href.split('#');
      const base = file.split('/').pop();
      let slug = null;
      if (!file) slug = anchorMap.get(hash) && (anchorMap.get(hash).has(page.slug) ? page.slug : [...anchorMap.get(hash)][0]);
      else if (base === 'README.md') slug = hash ? README_ANCHOR[hash] : null;
      else if (FILE_PAGE[base]) slug = FILE_PAGE[base];
      else if (base === 'CHANGELOG.md') return root + 'changelog.html';
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

// pass 1 collects anchors, pass 2 resolves links
const anchorMap = new Map();
for (const p of PAGES) for (const h of build(p, new Map()).ids) { if (!anchorMap.has(h.id)) anchorMap.set(h.id, new Set()); anchorMap.get(h.id).add(p.slug); }

const write = (rel, html) => fs.writeFileSync(path.join(SITE, rel), html);

for (const p of PAGES) {
  const { html, ids } = build(p, anchorMap);
  const toc = ids.filter(h => h.lvl === 2);
  const tocHtml = toc.length > 2 ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${toc.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></nav>` : '';
  write(`docs/${p.slug}.html`, layout({
    root: '../', file: `docs/${p.slug}.html`, title: p.title + ' - Agent Office docs', desc: p.lead, nav: 'docs',
    main: `<div class="wrap docs-layout">${sidebar(p.slug)}<main id="main" class="doc"><p class="meta"><a href="index.html">Docs</a> / ${esc(p.title)}</p><h1>${esc(p.title)}</h1><p class="lead">${esc(p.lead)}</p>${tocHtml}${html}</main></div>`,
  }));
}

function sidebar(current) {
  const item = (href, label, slug) => `<li><a href="${href}"${slug === current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  return `<aside class="docs-side" aria-label="Documentation"><h2>Docs</h2><ul>${item('index.html', 'Overview', 'index')}${PAGES.map(p => item(p.slug + '.html', p.title, p.slug)).join('')}<li><a href="../changelog.html">Changelog</a></li><li><a href="../download.html">Download</a></li></ul></aside>`;
}

// docs hub
const hubBlurb = {
  install: 'Installer, one-line script and the SmartScreen note.', update: 'Update feed, verification and one-click install.', uninstall: 'Remove the app, keep or delete your data.',
  configuration: 'kiro.json, environment variables, settings files, bridge.', permissions: 'Same settings as plain Claude Code, and what is different.', security: 'Local-only server, CSP, hardened windows, verified installs.',
  scheduler: 'Inbox feed, classification, status panel.', 'agents-and-memory': 'Eight specialists, hire approvals, memory and history.', troubleshooting: 'Fixes for the usual problems, plus the FAQ.', guide: 'The complete walkthrough, including the API table.',
};
write('docs/index.html', layout({
  root: '../', file: 'docs/index.html', title: 'Documentation - Agent Office', desc: 'Install, update, configure and understand Agent Office.', nav: 'docs',
  main: `<div class="wrap docs-layout">${sidebar('index')}<main id="main" class="doc"><h1>Documentation</h1><p class="lead">Guides for Agent Office, generated from the project documentation. The pages describe the current release line and name only what the product does today.</p><div class="doc-grid">${PAGES.map(p => `<a class="card" href="${p.slug}.html"><h3>${esc(p.title)}</h3><p>${esc(hubBlurb[p.slug])}</p></a>`).join('')}<a class="card" href="../changelog.html"><h3>Changelog</h3><p>What changed, version by version.</p></a></div></main></div>`,
}));

// changelog
{
  const ctx = { img: h => h, link: h => (/^https:\/\/claude\.com\//.test(h) ? h : null) };
  const md = CHANGELOG.replace(/^# .*\n+/, '').replace(/`docs\/permissions\.md`/g, '[permissions](docs/permissions.html)');
  const ctx2 = { ...ctx, link: h => (h.startsWith('docs/') ? h : ctx.link(h)) };
  const { html } = renderMd(md, ctx2);
  write('changelog.html', layout({
    root: '', file: 'changelog.html', title: 'Changelog - Agent Office', desc: 'What changed in each Agent Office version.', nav: 'changelog',
    main: `<div class="wrap"><main id="main" class="doc changelog"><h1>Changelog</h1>${html}</main></div>`,
  }));
}

write('index.html', homePage());
write('download.html', downloadPage());
console.log('generated', PAGES.length + 4, 'pages');
