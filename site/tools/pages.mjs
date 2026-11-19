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

<div class="notice"><p><strong>Agent Office is now TiroAgents.</strong> Installing 2.0 replaces Agent Office 1.x and keeps your settings, team, memory and reports. <a href="changelog.html#200-tiroagents-2026-11-17">See what's new</a>.</p></div>

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
<div class="card"><h3>macOS</h3><p>Apple Silicon and Intel <code>.dmg</code> on the <a href="${esc(r.releaseUrl)}">release page</a>, or the install script, which checks the signed manifest: <code>curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/v${esc(r.version)}/install.sh | bash</code>. The app is not signed by Apple.</p></div>
<div class="card"><h3>Linux</h3><p>x64 <code>.AppImage</code> and <code>.deb</code> on the <a href="${esc(r.releaseUrl)}">release page</a>, or the same install script.</p></div>
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
  const n = v => Number(v || 0).toLocaleString('en-US');
  const plat = s.byPlatform || {}, releases = s.byRelease || [];
  const max = Math.max(1, ...releases.map(r => Number(r.downloads) || 0));
  const tiles = v => '<span class="tile"></span>'.repeat(Math.max(v > 0 ? 1 : 0, Math.round((v / max) * 40)));
  const main = `<main id="main">
<div class="wrap doc narrow">
<h1>Download statistics</h1>
${ph ? '<div class="notice"><p><strong>No snapshot yet.</strong> The first scheduled update after the repository goes public replaces this.</p></div>' : ''}
<p class="lead">Installer downloads as counted by GitHub, as of <strong>${esc(s.asOf || '')}</strong>. Updated every six hours; no live calls are made from this page.</p>
<ul class="stat-cards">
<li class="card"><span class="big-num">${n(s.total)}</span> downloads</li>
<li class="card"><span class="big-num">${n(plat.windows)}</span> Windows</li>
<li class="card"><span class="big-num">${n(plat.macos)}</span> macOS</li>
<li class="card"><span class="big-num">${n(plat.linux)}</span> Linux</li>
</ul>
<h2>By release</h2>
<ul class="tile-rows">${releases.map(r => `<li><span class="tile-label">${esc(r.version)} <span class="meta">${esc(r.date)}</span></span><span class="tiles" aria-hidden="true">${tiles(Number(r.downloads) || 0)}</span><span class="tile-n">${n(r.downloads)}</span></li>`).join('')}</ul>
<h2>Method</h2>
<p>A scheduled job reads GitHub's own download count for each release file and rebuilds this page. Only installers count (<code>.exe</code>, <code>.dmg</code>, <code>.AppImage</code>, <code>.deb</code>); update metadata and block maps do not. The app's built-in updater downloads the same installer, so updates are included, and one person who downloads twice counts twice. GitHub publishes no location or visitor data, and this site collects none.</p>
<p>Who is responsible for this page and how to reach them are on the <a href="privacy.html">privacy page</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download statistics - Agent Office', desc: 'Installer downloads per release and platform, from GitHub\'s own counts.', nav: 'stats', main });
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
<p>The <a href="stats.html">statistics page</a> shows GitHub's own installer download counts per release. Nothing about visitors is collected or stored. See the method note there.</p>
<h2>Who is responsible</h2>
<dl class="dl-meta"><dt>Controller</dt><dd>${esc(p.controller || '')}</dd><dt>Contact</dt><dd>${esc(p.contact || '')}</dd><dt>Retention</dt><dd>${esc(p.retention || '')}</dd></dl>
<h2>The app itself</h2>
<p>Agent Office keeps its state on your machine. Model calls go to Anthropic through your own Claude Code install, as in the terminal. Other network use includes the signed update check and, if you turn it on, synced lyrics lookups (title, artist, album and duration only). In a party's meeting room, voice goes directly between the apps in the room: nothing is recorded, the party server only passes connection setup messages, and the people in the room and the public STUN servers (<code>stun.l.google.com</code>, <code>stun.cloudflare.com</code>) can see your IP address. Listen only never opens your microphone; an optional relay (TURN) server you set yourself carries the call when a network blocks direct ones. See the <a href="docs/party.html">party page</a> and the <a href="docs/security.html">security page</a>.</p>
<p class="meta">Content Security Policy of every page of this site: <code>${esc(buildCsp())}</code></p>
</div>
</main>`;
  return layout({ root: '', title: 'Privacy - Agent Office', desc: 'This site sets no cookies. What it loads, who is responsible and how long data is kept.', nav: 'privacy', main });
}
