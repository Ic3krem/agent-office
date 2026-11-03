import { layout } from './layout.mjs';

export function downloadPage() {
  const main = `<main id="main">
<div class="wrap download">
<h1>Download Agent Office</h1>
<p class="lead">The Windows installer. macOS and Linux builds are not published yet.</p>

<div class="dl-card">
<a id="dl-button" class="btn big" href="#install-steps" aria-disabled="true"><span id="dl-label">Download for Windows</span></a>
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
  return layout({ root: '', title: 'Download - Agent Office', desc: 'Download the Agent Office Windows installer, check its SHA-256 and follow the install steps.', nav: 'download', main, scripts: ['download.js'] });
}
