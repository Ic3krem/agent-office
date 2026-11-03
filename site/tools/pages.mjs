import { layout, esc, release, config, readJson, buildCsp, analyticsHosts } from './layout.mjs';
import { dlButton, fmtSize } from './home.mjs';

export function downloadPage() {
  const r = release;
  const main = `<main id="main">
<div class="wrap download">
<h1>Download Agent Office</h1>
<p class="lead">The Windows installer. macOS and Linux builds are not published yet.</p>

<div class="dl-card">
<p><span class="badge">Latest</span> <span class="meta">v<span data-fill="version">${esc(r.version)}</span> &middot; <span data-fill="date">${esc(r.date || '-')}</span></span></p>
<div class="cta-row">${dlButton()}<div class="mascot mascot-work" role="img" aria-label="Tiro with a headset, working"></div></div>
<p id="os-note" class="notice compact" hidden></p>
<p><button type="button" class="btn-small" id="copy-page" hidden>Copy this page's link</button></p>
<p id="dl-status" class="status" role="status" aria-live="polite"></p>
<dl class="dl-meta">
<dt>File</dt><dd><code data-fill="asset">${esc(r.asset)}</code></dd>
<dt>Size</dt><dd data-fill="size">${fmtSize(r.size)}</dd>
<dt>Requires</dt><dd>Windows 10 or later, and Claude Code installed and logged in</dd>
<dt>SHA-256</dt><dd><div class="hash-row"><div class="hash" id="dl-sha" tabindex="0" data-fill="sha">${esc(r.sha256 || 'Not published yet for this release. Do not install an installer you cannot verify.')}</div><button type="button" class="btn-small" data-copy-sha${r.sha256 ? '' : ' hidden'}>Copy</button></div></dd>
</dl>
<p class="meta" data-fill="notes">${esc(r.notes || '')}</p>
<p class="meta"><a data-release-link href="${esc(r.releaseUrl || r.url)}">Release page on GitHub</a>${r.checksumsUrl ? ` &middot; <a data-checksums-link href="${esc(r.checksumsUrl)}">SHA256SUMS.txt</a>` : ''} &middot; <a href="changelog.html">Changelog</a></p>
</div>

<details id="dl-previous" class="faq-like" hidden><summary>Previous versions</summary><ul></ul></details>

<h2 id="verify">Verify the download</h2>
<p>Open PowerShell in the folder where you saved the installer and run:</p>
<pre tabindex="0"><code data-fill="verify">Get-FileHash .\\${esc(r.asset)} -Algorithm SHA256</code></pre>
<p>The result must equal the SHA-256 above, letter for letter. If it does not, delete the file and do not run it.</p>

<h2 id="smartscreen">Windows warnings</h2>
<p>The installer is <strong>not code-signed</strong>, so Windows may warn you. That is expected for an unsigned build. Check the SHA-256 first.</p>
<div class="notice"><p><strong>SmartScreen.</strong> You may see "Windows protected your PC". If the SHA-256 matches, choose <strong>More info</strong>, then <strong>Run anyway</strong>.</p></div>
<div class="notice"><p><strong>Windows 11 Smart App Control.</strong> If Smart App Control is on, Windows may block an unsigned installer with no Run anyway option. You can look at the setting in Windows Security under App and browser control, Smart App Control settings. Turning it off can be permanent on some Windows 11 versions, so decide deliberately. If you cannot accept that, do not install the unsigned build. See also <a href="docs/troubleshooting.html">Troubleshooting</a>.</p></div>

<h2 id="install-steps">Install steps</h2>
<ol class="dl-steps">
<li>Install <a href="https://claude.com/claude-code" rel="noopener noreferrer">Claude Code</a> and run <code>claude</code> once to log in. Agent Office uses your own install and plan.</li>
<li>Download the installer with the button above.</li>
<li>Verify its SHA-256 as shown above.</li>
<li>Run the installer. It is a normal setup wizard where you pick the folder, and it adds a Start menu entry and a desktop shortcut.</li>
<li>Open Agent Office from the shortcut. Double-click Tiro, or use the tray menu and choose Open office. Then follow the <a href="quickstart.html">quickstart</a>.</li>
</ol>

<h2 id="platforms">Other platforms</h2>
<div class="grid">
<div class="card muted"><h3>macOS</h3><p>Coming soon. No build is published yet.</p></div>
<div class="card muted"><h3>Linux</h3><p>Coming soon. No build is published yet.</p></div>
</div>
<p>To hear about new releases, subscribe to the <a href="releases.xml">releases feed (Atom)</a> or use Watch, then Releases, on the GitHub repository.</p>
<p>The updater and the install scripts verify an Ed25519 signature on the release manifest as well as the installer's SHA-256. See <a href="docs/install.html">Install and verify</a>, <a href="docs/update.html">Update</a> and <a href="docs/uninstall.html">Uninstall</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download - Agent Office', desc: 'Download the Agent Office Windows installer, check its SHA-256 and follow the install steps.', nav: 'download', main, scripts: ['release.js'] });
}

export function quickstartPage() {
  const main = `<main id="main">
<div class="wrap doc narrow">
<h1>Quickstart</h1>
<p class="lead">From download to your first finished task. About ten minutes.</p>
<ol class="qs">
<li><h2>Get Claude Code ready</h2><p>Install <a href="https://claude.com/claude-code" rel="noopener noreferrer">Claude Code</a> and run <code>claude</code> once so you are logged in. Agent Office runs on your own install and plan. The office itself costs no tokens.</p></li>
<li><h2>Download and verify</h2><p>Get the installer from the <a href="download.html">download page</a>, then compare its SHA-256 with the one shown there. The build is not code-signed, so read the <a href="download.html#smartscreen">Windows warning notes</a> first.</p></li>
<li><h2>Install and start</h2><p>Run the setup wizard. Open Agent Office from the desktop shortcut. Tiro appears on your desktop. Double-click Tiro, or use the tray menu and choose Open office.</p></li>
<li><h2>Give Tiro a task</h2><p>Type a task in the dispatch box, for example "Review the README and list any wrong claims". It is added to today's board as a goal.</p></li>
<li><h2>Approve the hire</h2><p>Tiro asks to hire a specialist. A card shows the goal and the reason. Choose Approve hire or Deny. One approval buys one hire and expires after 10 minutes.</p></li>
<li><h2>Answer prompts, read the report</h2><p>Prompts that Claude Code would show you appear in the dashboard and the island. When the work is done, Tiro files a report you can open and export to PDF or Excel.</p></li>
</ol>
<h2>Next</h2>
<ul>
<li><a href="docs/guide.html">The full user guide</a></li>
<li><a href="docs/approvals.html">Hiring and approvals</a></li>
<li><a href="docs/configuration.html">Configuration</a></li>
<li><a href="docs/troubleshooting.html">Troubleshooting</a></li>
</ul>
<div class="btn-row">${dlButton({ id: '' })}</div>
</div>
</main>`;
  return layout({ root: '', title: 'Quickstart - Agent Office', desc: 'Install Agent Office and finish your first task with Tiro in about ten minutes.', nav: 'quickstart', main, scripts: ['release.js'] });
}

export function statsPage() {
  const s = readJson('stats.json');
  const ph = !!s.placeholder;
  const total = Number(s.total) || 0;
  const cont = Object.entries(s.byContinent || {}).sort((a, b) => b[1] - a[1]);
  const country = Object.entries(s.byCountry || {}).filter(([k, v]) => k === 'Other' || v >= 10).sort((a, b) => (a[0] === 'Other') - (b[0] === 'Other') || b[1] - a[1]);
  const tiles = n => '<span class="tile"></span>'.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / (total || 1)) * 50)));
  const main = `<main id="main">
<div class="wrap doc narrow">
<h1>Download statistics</h1>
${ph ? `<div class="notice"><p><strong>Sample data.</strong> ${esc((s.note || 'The numbers below are placeholders, not real downloads.').replace(/^SAMPLE DATA\.\s*/, ''))}</p></div>` : ''}
<p class="lead">A static snapshot as of <strong>${esc(s.asOf)}</strong>. No live calls are made from this page.</p>
<ul class="stat-cards">
<li class="card"><span class="big-num">${total.toLocaleString('en-US')}</span> downloads${ph ? ' (sample)' : ''}</li>
<li class="card"><span class="big-num">${Number(s.unique || 0).toLocaleString('en-US')}</span> unique${ph ? ' (sample)' : ''}</li>
<li class="card"><span class="big-num">${Number(s.countries || 0)}</span> countries${ph ? ' (sample)' : ''}</li>
</ul>
<h2>By continent</h2>
<ul class="tile-rows">${cont.map(([k, v]) => `<li><span class="tile-label">${esc(k)}</span><span class="tiles" aria-hidden="true">${tiles(v)}</span><span class="tile-n">${Number(v).toLocaleString('en-US')}</span></li>`).join('')}</ul>
<p class="meta">Each tile is about 2% of all downloads.</p>
<h2>By country</h2>
<div class="table-wrap" role="region" aria-label="Downloads by country" tabindex="0"><table><thead><tr><th scope="col">Country</th><th scope="col">Downloads</th></tr></thead><tbody>${country.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${Number(v).toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table></div>
<p class="meta">A country is listed only when it has at least 10 downloads. Everything else is grouped as Other. Nothing finer than a country is ever published.</p>
<h2>Method</h2>
<p>Planned method, not yet running: a download is counted when the Download button is used, not when the page loads. Unique means unique by a hash of the visitor's network, so no IP address is stored. Bots and HEAD requests are excluded. A scheduled job writes <code>stats.json</code>, and this page is rebuilt from it. Until a real snapshot exists the file is marked as sample data.</p>
<p>As a fallback with no regional data, GitHub shows an installer download count for each release asset on the <a href="download.html">release page</a>, labelled there as GitHub's own count.</p>
<p>Who is responsible for this data, how to reach them and how long it is kept are on the <a href="privacy.html">privacy page</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download statistics - Agent Office', desc: 'Public download totals by region, as a static snapshot.', nav: 'stats', main });
}

export function privacyPage() {
  const a = config.analytics || {};
  const h = analyticsHosts();
  const on = h.script.length > 0;
  const prov = a.provider === 'cloudflare' ? 'Cloudflare Web Analytics' : a.provider === 'goatcounter' ? 'GoatCounter' : '';
  const p = config.privacy || {};
  const main = `<main id="main">
<div class="wrap doc narrow">
<h1>Privacy</h1>
<p class="lead">This site sets no cookies and shows no consent banner, because it does not need one.</p>
<h2>What this site does</h2>
<ul>
<li>It sets no cookies and stores nothing in your browser.</li>
<li>It loads no remote fonts, scripts, images or trackers. Everything comes from this site's own files.</li>
<li>${on ? `It uses <strong>${esc(prov)}</strong>, a cookieless analytics service, to count page views without identifying you. It is switched off if your browser sends Do Not Track or Global Privacy Control. Hosts contacted: ${[...h.script, ...h.connect].map(x => `<code>${esc(x.replace('https://', ''))}</code>`).join(', ')}.` : 'No analytics are enabled right now.'}</li>
<li>The download link goes to GitHub. GitHub receives your request under its own privacy terms, and shows an installer download count per release.</li>
</ul>
<h2>Download statistics</h2>
<p>The <a href="stats.html">statistics page</a> publishes only a country-level snapshot. No IP addresses are stored. See the method note there.</p>
<h2>Who is responsible</h2>
<dl class="dl-meta"><dt>Controller</dt><dd>${esc(p.controller || '')}</dd><dt>Contact</dt><dd>${esc(p.contact || '')}</dd><dt>Retention</dt><dd>${esc(p.retention || '')}</dd></dl>
<h2>The app itself</h2>
<p>Agent Office keeps its state on your machine. Model calls go to Anthropic through your own Claude Code install, as in the terminal. Other network use includes the signed update check and, if you turn it on, synced lyrics lookups (title, artist, album and duration only). See the <a href="docs/security.html">security page</a>.</p>
<p class="meta">Content Security Policy of every page of this site: <code>${esc(buildCsp())}</code></p>
</div>
</main>`;
  return layout({ root: '', title: 'Privacy - Agent Office', desc: 'This site sets no cookies. What it loads, who is responsible and how long data is kept.', nav: 'privacy', main });
}
