// Fills version, size, date and SHA-256 from release.json and points the download buttons at the visitor's OS.
// Every link is baked into the page (Windows by default), so downloading works without JavaScript.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SHA = /^[0-9a-f]{64}$/;
  var me = document.currentScript, base = me ? new URL('../', me.src) : new URL('./', location.href);

  function detect() {
    var ua = navigator.userAgent || '', p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile)) return 'mobile';
    if (/Win/i.test(p) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) return 'macos';
    if (/Linux|X11|CrOS/i.test(p + ua)) return 'linux';
    return 'unknown';
  }
  function size(n) { return typeof n === 'number' && n > 0 ? (n / 1048576).toFixed(1) + ' MB' : ''; }
  function validUrl(u) { return typeof u === 'string' && (/^https:\/\//i.test(u) || (!/^[a-z][a-z0-9+.-]*:/i.test(u) && u.indexOf('//') !== 0 && u !== '')); }
  function each(sel, fn) { document.querySelectorAll(sel).forEach(fn); }

  function fill(r) {
    if (!r || typeof r.version !== 'string' || typeof r.asset !== 'string' || !validUrl(r.url)) return;
    var sha = typeof r.sha256 === 'string' ? r.sha256.toLowerCase() : '';
    each('[data-fill="version"]', function (e) { e.textContent = r.version; });
    each('[data-fill="asset"]', function (e) { e.textContent = r.asset; });
    each('[data-fill="size"]', function (e) { e.textContent = size(r.size) || '-'; });
    each('[data-fill="date"]', function (e) { e.textContent = r.date || '-'; });
    each('[data-fill="sha"]', function (e) { e.textContent = SHA.test(sha) ? sha : 'Not published yet for this release. Do not install an installer you cannot verify.'; });
    each('[data-fill="verify"]', function (e) { e.textContent = 'Get-FileHash .\\' + r.asset + ' -Algorithm SHA256'; });
    each('[data-fill="notes"]', function (e) { e.textContent = r.notes || ''; });
    each('[data-copy-sha]', function (e) { e.hidden = !SHA.test(sha); });
    if (r.releaseUrl && validUrl(r.releaseUrl)) each('[data-release-link]', function (e) { e.href = r.releaseUrl; });
    if (r.checksumsUrl && validUrl(r.checksumsUrl)) each('[data-checksums-link]', function (e) { e.href = r.checksumsUrl; e.hidden = false; });
    var prev = $('dl-previous');
    if (prev && Array.isArray(r.previous) && r.previous.length) {
      var ul = prev.querySelector('ul'); ul.textContent = '';
      r.previous.forEach(function (p) {
        if (!p || typeof p.version !== 'string' || !validUrl(p.url)) return;
        var li = document.createElement('li'), a = document.createElement('a');
        a.href = p.url; a.textContent = 'v' + p.version + (p.date ? ' (' + p.date + ')' : '');
        li.appendChild(a); ul.appendChild(li);
      });
      prev.hidden = !ul.children.length;
    }
  }

  var NAME = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  function osUi() {
    var os = detect(), note = $('os-note'), cp = $('copy-page');
    if (NAME[os]) {
      each('[data-dl-main]', function (a) {
        var h = a.getAttribute('data-href-' + os), l = a.querySelector('[data-dl-label]');
        if (h) a.href = h;
        if (l) l.textContent = 'Download for ' + NAME[os];
      });
      each('[data-dl-other]', function (a) { var l = a.getAttribute('data-label-' + os); if (l) a.textContent = l; });
      each('[data-os-row]', function (row) {
        row.querySelectorAll('[data-os-btn]').forEach(function (b) {
          var mine = b.getAttribute('data-os-btn') === os, n = NAME[b.getAttribute('data-os-btn')];
          b.className = 'btn ' + (mine ? 'primary' : 'quiet');
          b.textContent = mine ? 'Download for ' + n : n;
          if (mine) row.insertBefore(b, row.firstChild);
        });
      });
    } else if (os === 'mobile' && note) {
      note.textContent = 'TiroAgents is a desktop app for Windows, macOS and Linux. Open this page on your computer to install it.';
      if (cp) cp.hidden = false;
    }
    if (note) note.hidden = !note.textContent;
  }

  var cp = $('copy-page');
  if (cp) cp.addEventListener('click', function () {
    var s = $('dl-status');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(function () { s.textContent = 'Link copied.'; }, function () { s.textContent = 'Copy the address from your browser.'; });
  });
  each('[data-copy-sha]', function (b) {
    b.addEventListener('click', function () {
      var t = ($('dl-sha') || {}).textContent, s = $('dl-status');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { s.textContent = 'SHA-256 copied.'; }, function () { s.textContent = 'Select the hash and copy it by hand.'; });
    });
  });

  osUi();
  fetch(new URL('release.json', base), { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(fill)
    .catch(function () { var s = $('dl-status'); if (s) s.textContent = 'Could not refresh release.json; showing the values this page was built with.'; });
})();
