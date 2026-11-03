// Fills the download page from release.json. No remote calls: only same-origin fetch of release.json.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SHA = /^[0-9a-f]{64}$/;

  function fmtSize(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fail(msg) {
    var s = $('dl-status'); if (s) { s.textContent = msg; s.className = 'status notice'; }
  }
  function validUrl(u) {
    if (typeof u !== 'string' || !u) return false;
    if (/^https:\/\//i.test(u)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(u) && u.indexOf('//') !== 0; // relative path
  }
  function fill(r) {
    if (!r || typeof r.version !== 'string' || typeof r.asset !== 'string' || !validUrl(r.url)) {
      return fail('The release information is incomplete. Check the releases page for the installer.');
    }
    var sha = typeof r.sha256 === 'string' ? r.sha256.toLowerCase() : '';
    document.querySelectorAll('[data-fill="version"]').forEach(function (e) { e.textContent = r.version; });
    document.querySelectorAll('[data-fill="asset"]').forEach(function (e) { e.textContent = r.asset; });
    var btn = $('dl-button');
    var st = $('dl-status'); if (st) st.textContent = '';
    btn.href = r.url;
    btn.removeAttribute('aria-disabled');
    btn.setAttribute('download', r.asset);
    $('dl-label').textContent = 'Download for Windows (v' + r.version + ')';
    var size = fmtSize(r.size); if (size) $('dl-size').textContent = size;
    if (r.date) $('dl-date').textContent = r.date;
    $('dl-notes').textContent = r.notes || '';
    var hash = $('dl-sha');
    if (SHA.test(sha)) {
      hash.textContent = sha;
      $('dl-copy').hidden = false;
      document.querySelectorAll('[data-fill="sha"]').forEach(function (e) { e.textContent = sha; });
    } else {
      hash.textContent = 'Not published yet for this release. Do not install an installer you cannot verify.';
    }
    var vcmd = $('dl-verify');
    if (vcmd) vcmd.textContent = 'Get-FileHash .\\' + r.asset + ' -Algorithm SHA256';
  }

  var copy = $('dl-copy');
  if (copy) copy.addEventListener('click', function () {
    var t = $('dl-sha').textContent, s = $('dl-status');
    function ok() { s.className = 'status'; s.textContent = 'SHA-256 copied.'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { s.textContent = 'Select the hash and copy it by hand.'; });
    else { var r = document.createRange(); r.selectNodeContents($('dl-sha')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); s.textContent = 'Hash selected. Press Ctrl+C.'; }
  });

  fetch('release.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
    .then(fill)
    .catch(function () { fail('Could not load release.json (browsers block this when the page is opened as a file). Serve the site over http, or see the releases page.'); });
})();
