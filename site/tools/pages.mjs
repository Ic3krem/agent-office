import { layout, esc, release, config, readJson, buildCsp, analyticsHosts, edgeOrigin, dlHref, assetFile, PLATFORM_ASSETS } from './layout.mjs';
import { dlButton, fmtSize, osButtons } from './home.mjs';

const pageHead = (title, lede) => `<div class="page-head"><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;

export function downloadPage() {
  const r = release;
  const main = `<main id="main">
<div class="wrap page">
${pageHead('Download TiroAgents', `Version <span data-fill="version">${esc(r.version)}</span> for Windows, macOS and Linux, released <span data-fill="date">${esc(r.date || '-')}</span>. Free and open source.`)}

<div class="dl-card">
${osButtons()}
<p id="os-note" class="notice compact" hidden></p>
<p><button type="button" class="btn quiet small" id="copy-page" hidden>Copy this page's link</button></p>
<p id="dl-status" class="status" role="status" aria-live="polite"></p>
<p class="meta">You need Claude Code installed and signed in. <a data-release-link href="${esc(r.releaseUrl || r.url)}">Release page on GitHub</a>${r.checksumsUrl ? ` · <a data-checksums-link href="${esc(r.checksumsUrl)}">SHA256SUMS.txt</a>` : ''} · <a href="changelog.html">Changelog</a></p>
</div>

<h2 id="platforms">Every file</h2>
<div class="table-wrap" role="region" aria-label="Release files" tabindex="0"><table class="files"><thead><tr><th scope="col">System</th><th scope="col">File</th><th scope="col">Kind</th></tr></thead><tbody>
${PLATFORM_ASSETS.map(([key, , name, kind]) => `<tr><td>${name}</td><td><a href="${esc(dlHref(key))}"><code>${esc(assetFile(key))}</code></a></td><td>${esc(kind)}</td></tr>`).join('\n')}
</tbody></table></div>
<p>On macOS and Linux the install script downloads the right file and checks it for you: <code>curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/v${esc(r.version)}/install.sh | bash</code>.</p>

<div class="notice"><p><strong>Agent Office is now TiroAgents.</strong> Installing 2.x replaces Agent Office 1.x and keeps your settings, team, memory and reports. <a href="changelog.html#200-tiroagents-2026-11-17">See what changed</a>.</p></div>

<details id="dl-previous" class="plain" hidden><summary>Previous versions</summary><ul></ul></details>

<h2 id="verify">Verify the download</h2>
<dl class="dl-meta">
<dt>Windows file</dt><dd><code data-fill="asset">${esc(r.asset)}</code>, <span data-fill="size">${fmtSize(r.size)}</span></dd>
<dt>SHA-256</dt><dd><div class="hash-row"><div class="hash" id="dl-sha" tabindex="0" data-fill="sha">${esc(r.sha256 || 'Not published yet for this release. Do not install an installer you cannot verify.')}</div><button type="button" class="btn quiet small" data-copy-sha${r.sha256 ? '' : ' hidden'}>Copy</button></div></dd>
</dl>
<p>Open PowerShell in the folder where you saved the installer and run:</p>
<pre tabindex="0"><code data-fill="verify">Get-FileHash .\\${esc(r.asset)} -Algorithm SHA256</code></pre>
<p>The result must equal the SHA-256 above, letter for letter. If it does not, delete the file and do not run it. On macOS and Linux, the install script verifies the Ed25519 signature on the release manifest and the file's SHA-256 before it installs anything.</p>

<h2 id="smartscreen">Warnings when you install</h2>
<p>The installers are <strong>not code-signed</strong>, so your system may warn you. That is expected for an unsigned build. Check the SHA-256 first.</p>
<div class="notice"><p><strong>Windows SmartScreen.</strong> You may see "Windows protected your PC". If the SHA-256 matches, choose <strong>More info</strong>, then <strong>Run anyway</strong>.</p></div>
<div class="notice"><p><strong>Windows 11 Smart App Control.</strong> If Smart App Control is on, Windows may block an unsigned installer with no Run anyway option. You can look at the setting in Windows Security under App and browser control, Smart App Control settings. Turning it off can be permanent on some Windows 11 versions, so decide deliberately. If you cannot accept that, do not install the unsigned build. See also <a href="docs/troubleshooting.html">Troubleshooting</a>.</p></div>
<div class="notice"><p><strong>macOS Gatekeeper.</strong> The app is not signed by Apple, so macOS may refuse to open it. The install script clears the quarantine flag for you; after a manual install, use Open Anyway in System Settings, Privacy and Security.</p></div>

<h2 id="install-steps">Install steps</h2>
<ol class="dl-steps">
<li>Install <a href="https://claude.com/claude-code" rel="noopener noreferrer">Claude Code</a> and run <code>claude</code> once to sign in. TiroAgents uses your own install and plan.</li>
<li>Download the file for your system and verify it as shown above.</li>
<li>Windows: run the setup wizard, which adds a Start menu entry and a desktop shortcut. macOS: open the <code>.dmg</code> and drag TiroAgents to Applications. Linux: make the AppImage executable and run it, or install the <code>.deb</code>.</li>
<li>Open TiroAgents. Double-click Tiro, or use the tray menu and choose Open office. Then follow the <a href="quickstart.html">quickstart</a>.</li>
</ol>
<p>To hear about new releases, subscribe to the <a href="releases.xml">releases feed (Atom)</a>. See also <a href="docs/install.html">Install and verify</a>, <a href="docs/update.html">Update</a> and <a href="docs/uninstall.html">Uninstall</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download - TiroAgents', desc: 'Download TiroAgents for Windows, macOS or Linux, check its SHA-256 and follow the install steps.', nav: 'download', main, scripts: ['release.js'] });
}

export function quickstartPage() {
  const steps = [
    ['Get Claude Code ready', 'Install <a href="https://claude.com/claude-code" rel="noopener noreferrer">Claude Code</a> and run <code>claude</code> once so you are signed in. TiroAgents runs on your own install and plan. The office itself costs no tokens.'],
    ['Download and verify', 'Get the file for your system from the <a href="download.html">download page</a> and check its SHA-256. The builds are not code-signed, so read the <a href="download.html#smartscreen">notes on install warnings</a> first.'],
    ['Install and start', 'Install it and open TiroAgents. Tiro appears on your desktop. Double-click Tiro, or use the tray menu and choose Open office.'],
    ['Give Tiro a task', 'Type a task in the dispatch box, for example "Review the README and list any wrong claims". It is added to today\'s board as a goal.'],
    ['Approve the hire', 'Tiro asks to hire a specialist. A card shows the goal and the reason. Choose Approve hire or Deny. One approval buys one hire and expires after 10 minutes.'],
    ['Answer prompts, read the report', 'Prompts that Claude Code would show you appear in the office and the notch. When the work is done, Tiro files a report you can open and export to PDF or Excel.'],
  ];
  const main = `<main id="main">
<div class="wrap page narrow">
${pageHead('Quickstart', 'From download to your first finished task. About ten minutes.')}
<ol class="qs">${steps.map(([t, d]) => `<li><h2>${t}</h2><p>${d}</p></li>`).join('\n')}</ol>
<h2>Next</h2>
<ul class="link-list">
<li><a href="docs/guide.html">The full user guide</a></li>
<li><a href="docs/approvals.html">Hiring and approvals</a></li>
<li><a href="docs/configuration.html">Configuration</a></li>
<li><a href="docs/troubleshooting.html">Troubleshooting</a></li>
</ul>
<div class="cta-row">${dlButton()}<a class="btn quiet" href="download.html#platforms">Every file</a></div>
</div>
</main>`;
  return layout({ root: '', title: 'Quickstart - TiroAgents', desc: 'Install TiroAgents and finish your first task with Tiro in about ten minutes.', nav: 'quickstart', main, scripts: ['release.js'] });
}

export function statsPage() {
  const s = readJson('stats.json');
  const ph = !!s.placeholder, edge = edgeOrigin();
  const n = v => Number(v || 0).toLocaleString('en-US');
  const plat = s.byPlatform || {}, releases = s.byRelease || [], legacy = s.legacy || null;
  const legacyN = legacy ? Object.values(legacy).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const max = Math.max(1, ...releases.map(r => Number(r.downloads) || 0));
  const tiles = v => '<span class="tile-sq"></span>'.repeat(Math.max(v > 0 ? 1 : 0, Math.round((v / max) * 40)));
  const main = `<main id="main">
<div class="wrap page narrow">
${pageHead('Download statistics', `Installer downloads as of <strong>${esc(s.asOf || '')}</strong>.`)}
${ph ? '<div class="notice"><p><strong>No snapshot yet.</strong> The first scheduled update after the repository goes public replaces this.</p></div>' : ''}
<div class="dl-counts">
<div class="total"><b>${n(s.total)}</b><span>downloads</span></div>
<div><b>${n(plat.windows)}</b><span>Windows</span></div>
<div><b>${n(plat.macos)}</b><span>macOS</span></div>
<div><b>${n(plat.linux)}</b><span>Linux</span></div>
</div>
<h2>By release</h2>
<ul class="tile-rows">${releases.map(r => `<li><span class="tile-label">${esc(r.version)} <span class="meta">${esc(r.date)}</span></span><span class="tiles" aria-hidden="true">${tiles(Number(r.downloads) || 0)}</span><span class="tile-n">${n(r.downloads)}</span></li>`).join('')}</ul>
<h2>Method</h2>
<p>A scheduled job reads GitHub's own download count for each release file and rebuilds this page every six hours. Only installers count (<code>.exe</code>, <code>.dmg</code>, <code>.AppImage</code>, <code>.deb</code>); update metadata and block maps do not. The app's built-in updater downloads the same installer, so updates are included, and one person who downloads twice counts twice.${legacyN ? ` The totals include ${n(legacyN)} downloads from the project's earlier repository, frozen when it closed.` : ''} GitHub publishes no location or visitor data, and this page collects none.${edge ? ' The map on the home page uses the site\'s own download counter, which keeps a count per region only; see the <a href="privacy.html#counter">privacy page</a>.' : ''}</p>
<p>Who is responsible for this page and how to reach them are on the <a href="privacy.html">privacy page</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download statistics - TiroAgents', desc: 'Installer downloads per release and platform, from GitHub\'s own counts.', nav: 'stats', main });
}

export function privacyPage() {
  const a = config.analytics || {};
  const h = analyticsHosts();
  const on = h.script.length > 0, edge = edgeOrigin();
  const prov = a.provider === 'cloudflare' ? 'Cloudflare Web Analytics' : a.provider === 'goatcounter' ? 'GoatCounter' : '';
  const p = config.privacy || {};
  const main = `<main id="main">
<div class="wrap page narrow">
${pageHead('Privacy', 'This site sets no cookies and shows no consent banner, because it does not need one.')}
<h2>What this site does</h2>
<ul>
<li>It sets no cookies and stores nothing in your browser.</li>
<li>It loads no remote fonts, scripts, images or trackers. Everything comes from this site's own files, including the 3D library on the home page.</li>
<li>${on ? `It uses <strong>${esc(prov)}</strong>, a cookieless analytics service, to count page views without identifying you. It is switched off if your browser sends Do Not Track or Global Privacy Control. Hosts contacted: ${[...h.script, ...h.connect].map(x => `<code>${esc(x.replace('https://', ''))}</code>`).join(', ')}.` : 'No analytics are enabled right now.'}</li>
<li>${edge ? `The download buttons go through this site's download counter at <code>${esc(edge.replace('https://', ''))}</code>, which then sends you to the file on GitHub. GitHub receives that request under its own privacy terms.` : 'The download buttons go straight to the files on GitHub. GitHub receives your request under its own privacy terms, and shows a download count per file.'}</li>
</ul>
${edge ? `<h2 id="counter">The download counter</h2>
<ul>
<li>Each download is recorded as one row: a keyed hash of your IP address, the file, the UTC day, your country and its world region (North America, South America, Europe, Africa, Asia or Oceania), as reported by the network edge.</li>
<li>Your IP address is used only as the input to that keyed hash (HMAC-SHA-256 with a secret key, shortened to 128 bits), so that the same file downloaded again on the same day counts once. The address itself is never stored or logged, and the hash cannot be turned back into it without the key.</li>
<li>Only totals per system and per region are published. Per-country numbers are never shown.</li>
<li>No cookies, no identifiers in the link and nothing about the page you came from are kept.</li>
<li>The home page reads the totals from <code>${esc(edge.replace('https://', ''))}/stats</code>; that request carries no data about you beyond what any web request does.</li>
</ul>` : ''}
<h2>Download statistics</h2>
<p>The <a href="stats.html">statistics page</a> shows GitHub's own installer download counts per release. Nothing about visitors is collected or stored there. See the method note on that page.</p>
<h2>Who is responsible</h2>
<dl class="dl-meta"><dt>Controller</dt><dd>${esc(p.controller || '')}</dd><dt>Contact</dt><dd>${esc(p.contact || '')}</dd><dt>Retention</dt><dd>${esc(p.retention || '')}</dd></dl>
<h2>The app itself</h2>
<p>TiroAgents keeps its state on your computer. Model calls go to Anthropic through your own Claude Code install, as in the terminal. Other network use includes the signed update check and, if you turn it on, synced lyrics lookups (title, artist, album and duration only). In a party's meeting room, voice goes directly between the apps in the room: nothing is recorded, the party server only passes connection setup messages, and the people in the room and the public STUN servers (<code>stun.l.google.com</code>, <code>stun.cloudflare.com</code>) can see your IP address. Listen only never opens your microphone; an optional relay (TURN) server you set yourself carries the call when a network blocks direct ones. See the <a href="docs/party.html">party page</a> and the <a href="docs/security.html">security page</a>.</p>
<p class="meta">Content Security Policy of every page of this site: <code>${esc(buildCsp())}</code></p>
</div>
</main>`;
  return layout({ root: '', title: 'Privacy - TiroAgents', desc: 'This site sets no cookies. What it loads, who is responsible and how long data is kept.', nav: 'privacy', main });
}
