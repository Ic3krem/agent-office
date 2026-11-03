// Fills the download page from release.json and config.json (same origin). When config.json names an early-access
// edge origin, the download button goes through its /dl route and the page shows the public /status counter.
// The edge origin is the only remote host used, and it is the one allowed by connect-src in this page's CSP.
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
  function fill(r, edge) {
    if (!r || typeof r.version !== 'string' || typeof r.asset !== 'string' || !validUrl(r.url)) {
      return fail('The release information is incomplete. Check the releases page for the installer.');
    }
    var sha = typeof r.sha256 === 'string' ? r.sha256.toLowerCase() : '';
    document.querySelectorAll('[data-fill="version"]').forEach(function (e) { e.textContent = r.version; });
    document.querySelectorAll('[data-fill="asset"]').forEach(function (e) { e.textContent = r.asset; });
    var btn = $('dl-button');
    var st = $('dl-status'); if (st) st.textContent = '';
    btn.href = edge ? edge + '/dl' : r.url;
    btn.removeAttribute('aria-disabled');
    if (!edge) btn.setAttribute('download', r.asset);
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

  function closeDownloads() {
    var b = $('dl-button');
    b.href = '#install-steps'; b.setAttribute('aria-disabled', 'true');
    $('dl-label').textContent = 'Early access is full';
    $('dl-closed').hidden = false;
  }
  function spots(edge, cap) {
    var el = $('dl-spots');
    return fetch(edge + '/status', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
      .then(function (s) {
        if (!s || !Number.isInteger(s.claimed) || !Number.isInteger(s.cap) || s.claimed < 0 || s.cap < 1) throw new Error('bad status');
        el.textContent = s.claimed + ' of ' + s.cap + ' early-access spots taken';
        el.hidden = false;
        if (!s.open) closeDownloads();
      })
      .catch(function () { el.textContent = 'The early-access counter is not reachable right now. The download button still works while spots remain.'; el.hidden = false; });
  }

  var copy = $('dl-copy');
  if (copy) copy.addEventListener('click', function () {
    var t = $('dl-sha').textContent, s = $('dl-status');
    function ok() { s.className = 'status'; s.textContent = 'SHA-256 copied.'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { s.textContent = 'Select the hash and copy it by hand.'; });
    else { var r = document.createRange(); r.selectNodeContents($('dl-sha')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); s.textContent = 'Hash selected. Press Ctrl+C.'; }
  });

  function getJson(u) { return fetch(u, { cache: 'no-cache' }).then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.json(); }); }
  // config.json is optional: without it (or with an empty edgeOrigin) the page behaves as a plain download page.
  function edgeOf(c) { return c && typeof c.edgeOrigin === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(c.edgeOrigin) ? c.edgeOrigin : ''; }
  Promise.all([getJson('release.json'), getJson('config.json').catch(function () { return null; })])
    .then(function (v) {
      var edge = edgeOf(v[1]);
      if (v[1] && v[1].closed === true) { fill(v[0], ''); closeDownloads(); return; } // site-level lock: no edge call at all
      fill(v[0], edge);
      document.querySelectorAll('[data-fill="cap"]').forEach(function (e) { if (v[1] && Number.isInteger(v[1].cap)) e.textContent = v[1].cap; });
      if (edge) return spots(edge, v[1].cap);
    })
    .catch(function () { fail('Could not load release.json (browsers block this when the page is opened as a file). Serve the site over http, or see the releases page.'); });
})();
