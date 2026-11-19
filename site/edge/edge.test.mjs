// node --test site/edge/edge.test.mjs   (uses node:sqlite as a stand-in for D1, so the real SQL runs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import worker, { handle, d1Store, SCHEMA, uaFamily, hashClient, regionOf } from './worker.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GH = 'https://github.com/Ic3krem/agent-office/releases/download/v2.1.0/';

// Minimal D1 shim over node:sqlite: prepare().bind().run()/first()/all()
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  return {
    sql,
    prepare(q) {
      const st = sql.prepare(q); let params = [];
      const o = {
        bind(...p) { params = p; return o; },
        async run() { const r = st.run(...params); return { meta: { changes: Number(r.changes) } }; },
        async first() { return st.get(...params) ?? null; },
        async all() { return { results: st.all(...params) }; },
      };
      return o;
    },
  };
}
async function setup(envOver = {}) {
  const db = fakeD1(); const store = d1Store(db); await store.init();
  const env = { DL_VERSION: '2.1.0', HASH_SALT: 's'.repeat(32), SITE_ORIGIN: 'https://site.example', LEGACY_WINDOWS: '14', LEGACY_MACOS: '18', LEGACY_LINUX: '10', ...envOver };
  return { db, store, env, call: (req, now) => handle(req, env, store, now) };
}
function dl(asset, ip = '203.0.113.1', o = {}) {
  const { ua = CHROME, method = 'GET' } = o;
  const country = 'country' in o ? o.country : 'DE', continent = 'continent' in o ? o.continent : 'EU';
  const r = new Request('https://edge.example/dl/' + asset, { method, headers: { 'cf-connecting-ip': ip, 'user-agent': ua } });
  Object.defineProperty(r, 'cf', { value: { country, continent } });
  return r;
}
const rows = db => db.sql.prepare('SELECT * FROM downloads').all();
const getStats = async call => (await call(new Request('https://edge.example/stats'))).json();
const DAY1 = new Date('2026-11-05T10:00:00Z'), DAY1b = new Date('2026-11-05T23:59:00Z'), DAY2 = new Date('2026-11-06T00:01:00Z');

test('each asset redirects 302 to its GitHub release file and is recorded', async () => {
  const { call, db } = await setup();
  const want = {
    windows: 'TiroAgents-Setup-2.1.0.exe', 'mac-arm64': 'TiroAgents-2.1.0-arm64.dmg', 'mac-x64': 'TiroAgents-2.1.0-x64.dmg',
    'linux-appimage': 'TiroAgents-2.1.0-x86_64.AppImage', 'linux-deb': 'TiroAgents-2.1.0-amd64.deb',
  };
  for (const [asset, file] of Object.entries(want)) {
    const r = await call(dl(asset), DAY1);
    assert.equal(r.status, 302, asset);
    assert.equal(r.headers.get('location'), GH + file);
  }
  assert.equal(rows(db).length, 5);
  const [row] = rows(db);
  assert.deepEqual({ ...row, hash: undefined }, { hash: undefined, asset: 'windows', day: '2026-11-05', country: 'DE', continent: 'EU', hits: 1 });
});

test('unknown assets and bad paths are 404; other methods 405; nothing recorded', async () => {
  const { call, db } = await setup();
  for (const p of ['/dl/android', '/dl/', '/dl', '/dl/windows/x', '/dl/WINDOWS', '/dl/..%2fstats', '/dl/__proto__', '/dl/constructor', '/', '/admin/stats', '/status']) {
    const r = await call(new Request('https://edge.example' + p, { headers: { 'cf-connecting-ip': '203.0.113.1', 'user-agent': CHROME } }));
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await call(dl('windows', '203.0.113.1', { method: m }))).status, 405, m);
  assert.equal(rows(db).length, 0);
});

test('HEAD and bots redirect without counting', async () => {
  const { call, db } = await setup();
  const h = await call(dl('windows', '203.0.113.1', { method: 'HEAD' }));
  assert.equal(h.status, 302); assert.equal(h.headers.get('location'), GH + 'TiroAgents-Setup-2.1.0.exe');
  for (const ua of ['Slackbot-LinkExpanding 1.0', 'curl/8.5.0', 'Googlebot/2.1']) {
    assert.equal((await call(dl('windows', '203.0.113.1', { ua }))).status, 302);
  }
  assert.equal(rows(db).length, 0);
});

test('de-dup: same visitor + asset + UTC day counts once; another asset or day counts again', async () => {
  const { call, db } = await setup();
  await call(dl('windows'), DAY1); await call(dl('windows'), DAY1b);
  assert.equal(rows(db).length, 1); assert.equal(rows(db)[0].hits, 2);
  await call(dl('linux-deb'), DAY1);
  await call(dl('windows'), DAY2);
  await call(dl('windows', '203.0.113.2'), DAY1);
  assert.equal(rows(db).length, 4);
  const s = await getStats(call);
  assert.equal(s.total, 42 + 4);
});

test('/stats shape, legacy baseline in total/byPlatform only, continent mapping incl. unknown and Antarctica', async () => {
  const { call } = await setup();
  const now = new Date('2026-11-07T12:00:00Z');
  await call(dl('windows', '198.51.100.1', { continent: 'NA', country: 'US' }), DAY1);
  await call(dl('mac-arm64', '198.51.100.2', { continent: 'as', country: 'JP' }), DAY1);
  await call(dl('mac-x64', '198.51.100.3', { continent: 'OC', country: 'AU' }), DAY1);
  await call(dl('linux-appimage', '198.51.100.4', { continent: 'AN', country: 'AQ' }), DAY1);
  await call(dl('linux-deb', '198.51.100.5', { continent: undefined, country: undefined }), DAY1);
  const r = await handle(new Request('https://edge.example/stats'), (await setup()).env, (await setup()).store, now); // empty store
  assert.deepEqual(await r.json(), { total: 42, byPlatform: { windows: 14, macos: 18, linux: 10 }, byRegion: { NA: 0, SA: 0, EU: 0, AF: 0, AS: 0, OC: 0 }, asOf: now.toISOString() });
  const s = await getStats(call);
  assert.deepEqual(Object.keys(s), ['total', 'byPlatform', 'byRegion', 'asOf']);
  assert.equal(s.total, 47);
  assert.deepEqual(s.byPlatform, { windows: 15, macos: 20, linux: 12 });
  assert.deepEqual(s.byRegion, { NA: 1, SA: 0, EU: 0, AF: 0, AS: 1, OC: 1 });
  assert.ok(!Number.isNaN(Date.parse(s.asOf)));
  assert.ok(!/US|JP|AU|AQ|XX|DE/.test(JSON.stringify(s.byRegion) + JSON.stringify(s.byPlatform)));
  assert.equal(regionOf('AN'), ''); assert.equal(regionOf(undefined), ''); assert.equal(regionOf('sa'), 'SA');
  const bad = await setup({ LEGACY_WINDOWS: 'abc', LEGACY_MACOS: '-5', LEGACY_LINUX: undefined });
  assert.equal((await getStats(bad.call)).total, 0);
});

test('CORS: /stats allows only SITE_ORIGIN, never reflects or wildcards; public 5-minute cache', async () => {
  const { call } = await setup();
  const r = await call(new Request('https://edge.example/stats', { headers: { origin: 'https://evil.example' } }));
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://site.example');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const pre = await call(new Request('https://edge.example/stats', { method: 'OPTIONS' }));
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://site.example');
  for (const o of [undefined, '*', 'http://site.example', 'https://a.example/path']) {
    const s = await setup({ SITE_ORIGIN: o });
    assert.equal((await s.call(new Request('https://edge.example/stats'))).headers.get('access-control-allow-origin'), null, String(o));
  }
});

test('no IP, user-agent string or header value is stored; hash is keyed', async () => {
  const { call, db } = await setup();
  const ip = '203.0.113.77';
  await call(dl('windows', ip));
  const dump = JSON.stringify(rows(db));
  assert.ok(!dump.includes(ip)); assert.ok(!dump.includes('203.0.113')); assert.ok(!dump.includes('Mozilla')); assert.ok(!dump.includes('Windows NT'));
  const [row] = rows(db);
  assert.match(row.hash, /^[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(row).sort(), ['asset', 'continent', 'country', 'day', 'hash', 'hits']);
  assert.equal(row.hash, await hashClient('s'.repeat(32), ip));
  assert.notEqual(await hashClient('x'.repeat(32), ip), row.hash);
  const plain = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))).toString('hex').slice(0, 32);
  assert.notEqual(plain, row.hash);
});

test('the worker source never writes the IP anywhere: it only reaches hashClient', () => {
  const src = fs.readFileSync(path.join(HERE, 'worker.js'), 'utf8');
  assert.doesNotMatch(src, /console\./);
  assert.equal((src.match(/cf-connecting-ip/g) || []).length, 1);
  assert.doesNotMatch(src, /\b(bind|run)\([^)]*\bip\b/);
  assert.doesNotMatch(src, /\$\{[^}]*\b(path|asset|country|continent)\b[^}]*\}[^`]*(SELECT|INSERT|UPDATE)/); // no interpolated SQL
});

test('missing salt or bad DL_VERSION fails closed; missing client IP redirects without counting', async () => {
  for (const bad of [{ HASH_SALT: 'short' }, { HASH_SALT: undefined }, { DL_VERSION: '' }, { DL_VERSION: '../x' }, { DL_VERSION: 'v2.1.0' }]) {
    const s = await setup(bad);
    assert.equal((await s.call(dl('windows'))).status, 503);
    assert.equal(rows(s.db).length, 0);
  }
  const { call, db } = await setup();
  const r = await call(new Request('https://edge.example/dl/windows', { headers: { 'user-agent': CHROME } }));
  assert.equal(r.status, 302); assert.equal(rows(db).length, 0);
});

test('default export wires env.DB and turns internal errors into a bare 500', async () => {
  const db = fakeD1(); await d1Store(db).init();
  const env = { DB: db, DL_VERSION: '2.1.0', HASH_SALT: 's'.repeat(32) };
  assert.equal((await worker.fetch(dl('windows'), env)).status, 302);
  const broken = await worker.fetch(dl('windows'), { ...env, DB: { prepare() { throw new Error('secret detail 203.0.113.1'); } } });
  assert.equal(broken.status, 500); assert.equal(await broken.text(), 'Service error.');
  assert.equal((await worker.fetch(new Request('https://edge.example/nope'), env)).status, 404);
});

test('uaFamily buckets coarsely', () => {
  assert.equal(uaFamily(CHROME), 'chrome');
  assert.equal(uaFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0'), 'edge');
  assert.equal(uaFamily('Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0'), 'firefox');
  assert.equal(uaFamily(''), 'unknown');
});

test('schema.sql matches SCHEMA in worker.js, and wrangler.toml holds placeholders and no secrets', () => {
  const a = new DatabaseSync(':memory:'), b = new DatabaseSync(':memory:');
  a.exec(fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8')); for (const s of SCHEMA) b.exec(s);
  const tables = d => d.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  assert.deepEqual(tables(a), tables(b));
  for (const t of tables(a)) {
    assert.deepEqual(a.prepare(`PRAGMA table_info(${t})`).all(), b.prepare(`PRAGMA table_info(${t})`).all());
    assert.deepEqual(a.prepare(`PRAGMA index_list(${t})`).all(), b.prepare(`PRAGMA index_list(${t})`).all());
  }
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^name = "tiroagents-dl"$/m);
  assert.match(toml, /database_id = "(REPLACE_WITH_[^"]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/); // a D1 id is an identifier, not a secret
  assert.match(toml, /SITE_ORIGIN = "https:\/\/ic3krem\.github\.io"/);
  assert.match(toml, /DL_VERSION = "2\.1\.0"/);
  assert.doesNotMatch(toml, /^\s*(ADMIN_TOKEN|HASH_SALT)\s*=/m);
  assert.match(toml, /enabled = false/);
});

test('front proxy: a valid PROXY_KEY lets x-client-ip/x-client-country through; a wrong or missing key is ignored', async () => {
  const KEY = 'k'.repeat(40);
  const viaProxy = (key, ip = '198.51.100.9', cc = 'jp') => {
    const h = { 'user-agent': CHROME, 'x-client-ip': ip, 'x-client-country': cc }; if (key) h['x-proxy-key'] = key;
    return new Request('https://edge.example/dl/windows', { headers: h }); // no cf-connecting-ip, no request.cf
  };
  const ok = await setup({ PROXY_KEY: KEY });
  assert.equal((await ok.call(viaProxy(KEY), DAY1)).status, 302);
  const [row] = rows(ok.db);
  assert.equal(row.country, 'JP'); assert.equal(row.continent, 'AS');
  assert.equal(row.hash, await hashClient('s'.repeat(32), '198.51.100.9'));
  assert.equal((await getStats(ok.call)).byRegion.AS, 1);
  for (const [env, key] of [[{ PROXY_KEY: KEY }, 'k'.repeat(39) + 'x'], [{ PROXY_KEY: KEY }, null], [{ PROXY_KEY: 'short' }, 'short'], [{}, KEY]]) {
    const s = await setup(env);
    assert.equal((await s.call(viaProxy(key), DAY1)).status, 302);
    assert.equal(rows(s.db).length, 0, 'spoofed headers without a valid key are not counted');
  }
  const bad = await setup({ PROXY_KEY: KEY });
  await bad.call(viaProxy(KEY, '198.51.100.10', 'zz9'), DAY1);
  assert.equal(rows(bad.db)[0].country, 'XX'); assert.equal(rows(bad.db)[0].continent, '');
});
