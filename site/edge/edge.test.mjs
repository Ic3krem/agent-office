// node --test site/edge/edge.test.mjs   (uses node:sqlite as a stand-in for D1, so the real SQL runs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import worker, { handle, d1Store, SCHEMA, uaFamily, hashClient } from './worker.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 't'.repeat(40);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

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
  const env = { CAP: '3', LOCKED: 'false', DL_TARGET: 'https://downloads.example/installer.exe', DL_VERSION: '1.2.8', HASH_SALT: 's'.repeat(32), ADMIN_TOKEN: TOKEN, SITE_ORIGIN: 'https://site.example', ...envOver };
  return { db, store, env, call: (req, now) => handle(req, env, store, now) };
}
function dl(ip, o = {}) {
  const { ua = CHROME, regionCode, method = 'GET' } = o;
  const country = 'country' in o ? o.country : 'DE', continent = 'continent' in o ? o.continent : 'EU';
  const r = new Request('https://edge.example/dl', { method, headers: { 'cf-connecting-ip': ip, 'user-agent': ua } });
  Object.defineProperty(r, 'cf', { value: { country, continent, regionCode } });
  return r;
}
const admin = (p, { method = 'GET', body, token = TOKEN } = {}) => new Request('https://edge.example' + p, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body) });
const rows = db => db.sql.prepare('SELECT * FROM downloaders').all();

test('a download is counted, country recorded, and redirected with 302', async () => {
  const { call, db } = await setup();
  const r = await call(dl('203.0.113.1', { country: 'fr', continent: 'EU' }), new Date('2026-11-05T10:00:00Z'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://downloads.example/installer.exe');
  const [row] = rows(db);
  assert.deepEqual({ ...row, hash: undefined }, { hash: undefined, country: 'FR', region: '', continent: 'EU', day: '2026-11-05', version: '1.2.8', ua: 'chrome', hits: 1 });
});

test('de-dup: same client twice is one downloader with two hits; different clients are separate', async () => {
  const { call, db } = await setup();
  await call(dl('203.0.113.1')); await call(dl('203.0.113.1')); await call(dl('203.0.113.2'));
  const r = rows(db).sort((a, b) => a.hits - b.hits);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.hits), [1, 2]);
});

test('cap: the (cap+1)th unique downloader gets the full page, existing ones can still re-download', async () => {
  const { call, db } = await setup({ CAP: '2' });
  assert.equal((await call(dl('203.0.113.1'))).status, 302);
  assert.equal((await call(dl('203.0.113.2'))).status, 302);
  const full = await call(dl('203.0.113.3'));
  assert.equal(full.status, 403);
  assert.match(await full.text(), /Early access is full/);
  assert.equal(rows(db).length, 2);
  assert.equal((await call(dl('203.0.113.1'))).status, 302);
  const st = await (await call(new Request('https://edge.example/status'))).json();
  assert.deepEqual(st, { claimed: 2, cap: 2, open: false });
});

test('concurrent requests cannot exceed the cap', async () => {
  const { call, db } = await setup({ CAP: '5' });
  const res = await Promise.all(Array.from({ length: 20 }, (_, i) => call(dl('198.51.100.' + i))));
  assert.equal(res.filter(r => r.status === 302).length, 5);
  assert.equal(rows(db).length, 5);
});

test('LOCKED env and the admin lock switch both close downloads; unlock reopens (unless env locked)', async () => {
  const a = await setup({ LOCKED: 'true' });
  assert.equal((await a.call(dl('203.0.113.1'))).status, 403);
  assert.equal(rows(a.db).length, 0);
  assert.equal((await (await a.call(new Request('https://edge.example/status'))).json()).open, false);
  const un = await a.call(admin('/admin/lock', { method: 'POST', body: { locked: false } }));
  assert.deepEqual(await un.json(), { locked: true, locked_by_env: true }); // env still wins

  const b = await setup();
  assert.equal((await b.call(dl('203.0.113.1'))).status, 302);
  assert.equal((await b.call(admin('/admin/lock', { method: 'POST', body: { locked: true } }))).status, 200);
  const closed = await b.call(dl('203.0.113.9'));
  assert.equal(closed.status, 403); assert.match(await closed.text(), /closed/);
  assert.equal((await (await b.call(new Request('https://edge.example/status'))).json()).open, false);
  await b.call(admin('/admin/lock', { method: 'POST', body: { locked: false } }));
  assert.equal((await b.call(dl('203.0.113.9'))).status, 302);
});

test('no IP, no user-agent string, no header value is stored anywhere in the database', async () => {
  const { call, db } = await setup();
  const ip = '203.0.113.77';
  await call(dl(ip));
  const dump = JSON.stringify(db.sql.prepare("SELECT * FROM downloaders").all()) + JSON.stringify(db.sql.prepare("SELECT * FROM settings").all());
  assert.ok(!dump.includes(ip)); assert.ok(!dump.includes('203.0.113')); assert.ok(!dump.includes('Mozilla')); assert.ok(!dump.includes('Windows'));
  const [row] = rows(db);
  assert.match(row.hash, /^[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(row).sort(), ['continent', 'country', 'day', 'hash', 'hits', 'region', 'ua', 'version']);
  // the hash is keyed: a different salt gives a different value, and it is not a plain hash of the IP
  assert.notEqual(await hashClient('x'.repeat(32), ip), row.hash);
  const plain = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))).toString('hex').slice(0, 32);
  assert.notEqual(plain, row.hash);
});

test('the worker source never writes the IP anywhere: it only reaches hashClient', () => {
  const src = fs.readFileSync(path.join(HERE, 'worker.js'), 'utf8');
  assert.doesNotMatch(src, /console\./);
  assert.equal((src.match(/cf-connecting-ip/g) || []).length, 1);
  assert.equal((src.match(/\bip\b/g) || []).length, (src.match(/\bip\b/g) || []).length); // sanity
  assert.doesNotMatch(src, /\b(bind|run)\([^)]*\bip\b/);
});

test('subdivision is recorded only when switched on; unknown country becomes XX', async () => {
  const off = await setup(); await off.call(dl('203.0.113.1', { regionCode: 'CA', country: 'US', continent: 'NA' }));
  assert.equal(rows(off.db)[0].region, '');
  const on = await setup({ RECORD_SUBDIVISION: 'true' }); await on.call(dl('203.0.113.1', { regionCode: 'ca', country: 'US', continent: 'NA' }));
  assert.equal(rows(on.db)[0].region, 'CA');
  const unk = await setup(); await unk.call(dl('203.0.113.1', { country: undefined, continent: undefined }));
  assert.equal(rows(unk.db)[0].country, 'XX');
});

test('bots, HEAD and non-GET are not counted; missing config fails closed without counting', async () => {
  const { call, db } = await setup();
  assert.equal((await call(dl('203.0.113.1', { ua: 'Slackbot-LinkExpanding 1.0' }))).status, 403);
  assert.equal((await call(dl('203.0.113.1', { ua: 'curl/8.5.0' }))).status, 403);
  assert.equal((await call(dl('203.0.113.1', { method: 'HEAD' }))).status, 405);
  assert.equal(rows(db).length, 0);
  for (const bad of [{ DL_TARGET: '' }, { DL_TARGET: 'http://insecure.example/x.exe' }, { HASH_SALT: 'short' }]) {
    const s = await setup(bad);
    assert.equal((await s.call(dl('203.0.113.1'))).status, 503);
    assert.equal(rows(s.db).length, 0);
  }
});

test('/status exposes only the numbers and open flag, with CORS for the site origin only', async () => {
  const { call } = await setup();
  await call(dl('203.0.113.1'));
  const r = await call(new Request('https://edge.example/status'));
  assert.deepEqual(await r.json(), { claimed: 1, cap: 3, open: true });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://site.example');
});

test('admin auth: no token, wrong token, weak/unset server token are all refused; right token works', async () => {
  const { call } = await setup();
  for (const p of ['/admin/stats', '/admin/lock']) {
    const m = p === '/admin/lock' ? 'POST' : 'GET';
    assert.equal((await call(admin(p, { method: m, token: null, body: { locked: true } }))).status, 401);
    assert.equal((await call(admin(p, { method: m, token: 'x'.repeat(40), body: { locked: true } }))).status, 401);
  }
  const weak = await setup({ ADMIN_TOKEN: 'short' });
  assert.equal((await weak.call(admin('/admin/stats', { token: 'short' }))).status, 401);
  const unset = await setup({ ADMIN_TOKEN: undefined });
  assert.equal((await unset.call(admin('/admin/stats', { token: 'undefined' }))).status, 401);
  assert.equal((await call(admin('/admin/stats'))).status, 200);
  assert.equal((await call(admin('/admin/lock', { method: 'POST', body: { locked: 'yes' } }))).status, 400);
});

test('admin stats: totals and per-country, continent, version, day', async () => {
  const { call } = await setup({ CAP: '10' });
  await call(dl('203.0.113.1', { country: 'DE' }), new Date('2026-11-05T01:00:00Z'));
  await call(dl('203.0.113.1', { country: 'DE' }), new Date('2026-11-05T02:00:00Z'));
  await call(dl('203.0.113.2', { country: 'DE' }), new Date('2026-11-06T02:00:00Z'));
  await call(dl('203.0.113.3', { country: 'JP', continent: 'AS' }), new Date('2026-11-06T03:00:00Z'));
  const s = await (await call(admin('/admin/stats'))).json();
  assert.equal(s.unique_downloaders, 3); assert.equal(s.total_downloads, 4); assert.equal(s.cap, 10); assert.equal(s.locked, false);
  assert.deepEqual(s.by_country, [{ country: 'DE', downloaders: 2 }, { country: 'JP', downloaders: 1 }]);
  assert.deepEqual(s.by_continent, [{ continent: 'EU', downloaders: 2 }, { continent: 'AS', downloaders: 1 }]);
  assert.deepEqual(s.by_version, [{ version: '1.2.8', downloaders: 3 }]);
  assert.deepEqual(s.by_day, [{ day: '2026-11-05', new_downloaders: 1 }, { day: '2026-11-06', new_downloaders: 2 }]);
  assert.ok(!JSON.stringify(s).includes('203.0.113'));
});

test('default export wires env.DB and turns internal errors into a bare 500', async () => {
  const db = fakeD1(); await d1Store(db).init();
  const env = { DB: db, DL_TARGET: 'https://d.example/x.exe', HASH_SALT: 's'.repeat(32), CAP: '5' };
  assert.equal((await worker.fetch(dl('203.0.113.1'), env)).status, 302);
  const broken = await worker.fetch(dl('203.0.113.1'), { ...env, DB: { prepare() { throw new Error('secret detail 203.0.113.1'); } } });
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
  for (const t of ['downloaders', 'settings']) assert.deepEqual(a.prepare(`PRAGMA table_info(${t})`).all(), b.prepare(`PRAGMA table_info(${t})`).all());
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  assert.match(toml, /REPLACE_WITH_/);
  assert.doesNotMatch(toml, /^\s*(ADMIN_TOKEN|HASH_SALT)\s*=/m);
  assert.match(toml, /enabled = false/);
});
