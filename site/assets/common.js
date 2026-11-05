// Runs on every page. Same-origin only. Copy buttons, stats strip, optional cookieless analytics (off until config.json enables it).
(function () {
  'use strict';
  var me = document.currentScript, base = me ? new URL('../', me.src) : new URL('./', location.href);
  function getJson(name) { return fetch(new URL(name, base), { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function copyText(text, done, fail) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  }

  // Copy buttons on code blocks
  document.querySelectorAll('pre').forEach(function (pre) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-small copy-code'; b.textContent = 'Copy';
    b.setAttribute('aria-label', 'Copy code');
    b.addEventListener('click', function () {
      copyText(pre.textContent, function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); }, function () { b.textContent = 'Select and copy'; });
    });
    var wrap = document.createElement('div'); wrap.className = 'pre-wrap';
    pre.parentNode.insertBefore(wrap, pre); wrap.appendChild(pre); wrap.appendChild(b);
  });

  // Stats strip (static snapshot, no live call)
  var strips = document.querySelectorAll('[data-stats]');
  if (strips.length) getJson('stats.json').then(function (s) {
    var txt = s.placeholder ? 'Public download statistics start after the first real snapshot.'
      : Number(s.total).toLocaleString('en-US') + ' downloads · as of ' + s.asOf;
    strips.forEach(function (e) { e.textContent = txt; });
  }).catch(function () {});

  // Optional analytics: cookieless providers only, honours Do Not Track and Global Privacy Control.
  if (navigator.doNotTrack === '1' || window.globalPrivacyControl) return;
  getJson('config.json').then(function (c) {
    var a = c.analytics || {}, s = document.createElement('script');
    if (a.provider === 'cloudflare' && a.cloudflare && a.cloudflare.token) {
      s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      s.setAttribute('data-cf-beacon', JSON.stringify({ token: a.cloudflare.token }));
    } else if (a.provider === 'goatcounter' && a.goatcounter && /^[a-z0-9-]+$/.test(a.goatcounter.code || '')) {
      s.src = 'https://gc.zgo.at/count.js';
      s.setAttribute('data-goatcounter', 'https://' + a.goatcounter.code + '.goatcounter.com/count');
    } else return;
    s.defer = true; document.head.appendChild(s);
  }).catch(function () {});
})();
