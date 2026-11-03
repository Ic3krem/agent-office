import fs from 'node:fs';
import { layout } from './layout.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
if (CONFIG.edgeOrigin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(CONFIG.edgeOrigin)) throw new Error('config.json edgeOrigin must be an https origin with no path');

export function downloadPage() {
  const main = `<main id="main">
<div class="wrap download">
<h1>Download Agent Office</h1>
<p class="lead">The Windows installer. macOS and Linux builds are not published yet.</p>

<div class="dl-card">
<a id="dl-button" class="btn big" href="#install-steps" aria-disabled="true"><span id="dl-label">Download for Windows</span></a>
<p id="dl-spots" class="spots" hidden></p>
<p id="dl-status" class="status" role="status">Loading release information.</p>
<noscript><p class="notice">JavaScript is off, so the version and checksum cannot be shown here. Use the install guide for the SHA-256 check.</p></noscript>
<dl class="dl-meta">
<dt>Version</dt><dd data-fill="version">-</dd>
<dt>File</dt><dd><code data-fill="asset">-</code></dd>
<dt>Released</dt><dd id="dl-date">-</dd>
<dt>Size</dt><dd id="dl-size">-</dd>
<dt>SHA-256</dt><dd><div class="hash-row"><div class="hash" id="dl-sha" tabindex="0">-</div><button type="button" class="btn-small" id="dl-copy" hidden>Copy</button></div></dd>
</dl>
<p id="dl-notes" class="meta"></p>
</div>

<div id="dl-closed" class="notice" hidden><p><strong>Early access is full.</strong> All of the early-access spots have been taken, or downloads are closed for now. The installer is not available from this page at the moment. There is no sign-up list here: check this page again later.</p></div>

<div id="privacy" class="privacy">
<h2>Privacy: what a download records</h2>
<p>This site has no cookies, no analytics and no trackers. Pressing the download button goes through a small counter that records only: your <strong>country</strong> (and continent), the <strong>date</strong> (UTC), the <strong>app version</strong>, and your <strong>browser family</strong> (for example Chrome or Firefox). To count each person once it keeps a keyed, one-way hash made from your network address. <strong>Your IP address itself is not stored or logged</strong>, and neither is your full browser string. The numbers are used to count early-access downloads by region and to enforce the limit of <span data-fill="cap">500</span> early-access downloads. Because a hash made from an IP address can still count as personal data in some countries, it is kept only for that purpose. If you would rather not be counted, do not use the download button.</p>
</div>

<div class="notice"><p><strong>Windows SmartScreen.</strong> The build is not code-signed, so Windows may show "Windows protected your PC". Check the SHA-256 below first. If it matches, choose <strong>More info</strong>, then <strong>Run anyway</strong>.</p></div>

<div class="two-col">
<div>
<h2 id="install-steps">Install steps</h2>
<ol class="dl-steps">
<li>Install <a href="https://claude.com/claude-code" rel="noopener noreferrer">Claude Code</a> and run <code>claude</code> once to log in. Agent Office uses your own install and plan.</li>
<li>Download the installer with the button above.</li>
<li>Verify it. In PowerShell, from the folder you saved it in, run <code id="dl-verify">Get-FileHash .\\Agent-Office-Setup-VERSION.exe -Algorithm SHA256</code> and compare the result with the SHA-256 shown above.</li>
<li>Run the installer. It is a normal setup wizard where you pick the folder, and it adds a Start menu entry and a desktop shortcut.</li>
<li>Open Agent Office from the shortcut. Double-click Tiro, or use the tray menu and choose Open office.</li>
</ol>
<p>Requirements: Windows 10 or later, and Claude Code installed and logged in.</p>
</div>
<div>
<h2>How it is distributed</h2>
<p>While the source repository is private, a release page may need access you do not have. Installers sent to you directly can be checked with the SHA-256 shown above. The in-app updater and the install scripts verify an Ed25519 signature on the release manifest as well as the installer's SHA-256, and stop if either check fails. See <a href="docs/install.html">Install</a> and <a href="docs/update.html">Update</a>.</p>
<h3>macOS and Linux</h3>
<p>Not available yet: macOS and Linux builds are not published.</p>
</div>
</div>

<h2>After installing</h2>
<p>Read the <a href="docs/install.html">install guide</a>, then the <a href="docs/guide.html">user guide</a>. To update later, open the island's Settings tab and use Updates, see <a href="docs/update.html">Update</a>. To remove the app, see <a href="docs/uninstall.html">Uninstall</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download - Agent Office', desc: 'Download the Agent Office Windows installer, check its SHA-256 and follow the install steps.', nav: 'download', main, scripts: ['download.js'], connect: CONFIG.edgeOrigin });
}
