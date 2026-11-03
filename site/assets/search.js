// Local docs search over search-index.json. No remote service.
(function () {
  'use strict';
  var input = document.getElementById('doc-search'), out = document.getElementById('doc-results'), status = document.getElementById('doc-search-status');
  if (!input) return;
  var me = document.currentScript, base = new URL('../', me.src), index = null, loading = null;
  function load() {
    if (!loading) loading = fetch(new URL('search-index.json', base)).then(function (r) { return r.json(); }).then(function (j) { index = j; });
    return loading;
  }
  function score(e, terms) {
    var t = e.t.toLowerCase(), x = e.x.toLowerCase(), s = 0;
    for (var i = 0; i < terms.length; i++) {
      var w = terms[i], a = t.indexOf(w) >= 0, b = x.indexOf(w) >= 0;
      if (!a && !b) return 0;
      s += (a ? 5 : 0) + (b ? 1 : 0);
    }
    return s;
  }
  function run() {
    var q = input.value.trim().toLowerCase();
    out.textContent = '';
    if (q.length < 2) { status.textContent = ''; return; }
    var terms = q.split(/\s+/);
    var hits = index.map(function (e) { return { e: e, s: score(e, terms) }; }).filter(function (h) { return h.s; })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
    hits.forEach(function (h) {
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = new URL(h.e.u, base).href; a.textContent = h.e.t;
      li.appendChild(a); out.appendChild(li);
    });
    status.textContent = hits.length ? hits.length + ' result' + (hits.length === 1 ? '' : 's') : 'No results.';
  }
  input.addEventListener('focus', load);
  input.addEventListener('input', function () { load().then(run); });
})();
