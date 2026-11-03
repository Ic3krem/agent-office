import { layout } from './layout.mjs';

export function downloadPage() {
  const main = `<main id="main">
<div class="wrap download">
<h1>Download Agent Office</h1>
<p class="lead">The Windows installer. macOS and Linux builds are not published yet.</p>

<div class="dl-card">
<a id="dl-button" class="btn big" href="#install-steps" aria-disabled="true"><span id="dl-label">Download for Windows</span></a>
<p id="dl-status" class="status" role="status">Loading release information.</p>
<noscript><p class="notice">JavaScript is off, so the version and checksum cannot be shown here. Use the one-line installer below, which verifies the download itself.</p></noscript>
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
<h2>One-line install</h2>
<p>Downloads the latest release, verifies its SHA-256 against the digest GitHub publishes for the asset, installs it silently for the current user and adds a desktop shortcut. It stops and installs nothing if there is no published release, no digest, or the hash does not match.</p>
<pre tabindex="0"><code>irm https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.ps1 | iex</code></pre>
<p>Piping a script into your shell trusts whatever is on <code>main</code>. To review first or pin a release, download the script from a release tag, read it, then run it from disk.</p>
<h3>macOS and Linux</h3>
<p>Not available yet: no macOS or Linux build is published, so the install script finds nothing to download there.</p>
</div>
</div>

<h2>After installing</h2>
<p>Read the <a href="docs/install.html">install guide</a>, then the <a href="docs/guide.html">user guide</a>. To update later, open the island's Settings tab and use Updates, see <a href="docs/update.html">Update</a>. To remove the app, see <a href="docs/uninstall.html">Uninstall</a>.</p>
</div>
</main>`;
  return layout({ root: '', title: 'Download - Agent Office', desc: 'Download the Agent Office Windows installer, check its SHA-256 and follow the install steps.', nav: 'download', main, scripts: ['download.js'] });
}
