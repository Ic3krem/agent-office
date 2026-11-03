// Agent Office early-access download counter. Cloudflare Worker + D1, plain JS, no dependencies.
//
// Routes
//   GET  /dl            count, record country, enforce the cap, 302 to DL_TARGET (or the "full" page)
//   GET  /status        {"claimed":N,"cap":500,"open":true|false}  (public, numbers only)
//   GET  /admin/stats   totals and per-country counts          (Authorization: Bearer ADMIN_TOKEN)
//   POST /admin/lock    {"locked":true|false}                  (Authorization: Bearer ADMIN_TOKEN)
//
// Privacy: the client IP is used only as an input to a keyed hash (HMAC-SHA-256 with the secret HASH_SALT)
// that is truncated to 128 bits and stored for de-duplication. The IP, the full user-agent string and any
// header are never stored or logged. Stored per downloader: hash, country, continent, UTC day, app version,
// browser family, hit count.

const DEFAULT_CAP = 500;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS downloaders (
    hash TEXT PRIMARY KEY,
    country TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    continent TEXT NOT NULL,
    day TEXT NOT NULL,
    version TEXT NOT NULL,
    ua TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

// ---- helpers -------------------------------------------------------------------------------------------

export function uaFamily(ua) {
  const s = String(ua || '');
  if (!s) return 'unknown';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python-requests|httpclient|headless/i.test(s)) return 'bot';
  if (/Edg(e|A|iOS)?\//.test(s)) return 'edge';
  if (/OPR\/|Opera/.test(s)) return 'opera';
  if (/Firefox\/|FxiOS\//.test(s)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(s)) return 'chrome';
  if (/Safari\//.test(s)) return 'safari';
  return 'other';
}

export function capOf(env) {
  const n = Number.parseInt(env.CAP, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CAP;
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

export async function hashClient(salt, ip) {
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(String(ip)))).slice(0, 32);
}

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const A = new Uint8Array(x), B = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < A.length; i++) d |= A[i] ^ B[i];
  return d === 0;
}

async function isAdmin(request, env) {
  const tok = env.ADMIN_TOKEN;
  if (typeof tok !== 'string' || tok.length < 24) return false; // unset or weak token: admin stays closed
  const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
  return !!m && safeEqual(m[1], tok);
}

function cors(env) {
  const o = env.SITE_ORIGIN;
  return o ? { 'access-control-allow-origin': o, vary: 'Origin' } : {};
}

function json(env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(env), ...extra },
  });
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
};

function closedPage(env, locked) {
  const base = String(env.SITE_URL || env.SITE_ORIGIN || '').replace(/\/+$/, '');
  const back = /^https:\/\/[^\s"<>]+$/.test(base) ? `${base}/download.html` : '';
  const why = locked ? 'Downloads are closed for now.' : 'Early access is full: all of the early-access spots have been taken.';
  const link = back ? `<p><a href="${back}">Back to the download page</a></p>` : '';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Early access is full - Agent Office</title>` +
    `<style>body{font:16px/1.5 system-ui,sans-serif;background:#16110e;color:#f3e9dc;max-width:34rem;margin:4rem auto;padding:0 1rem}a{color:#ffb454}</style></head>` +
    `<body><h1>Early access is full</h1><p>${why}</p><p>Nothing was recorded about this visit.</p>${link}</body></html>`,
    { status: 403, headers: PAGE_HEADERS });
}

// ---- storage (D1) --------------------------------------------------------------------------------------

export function d1Store(db) {
  const one = async (sql, ...p) => db.prepare(sql).bind(...p).first();
  const all = async (sql, ...p) => (await db.prepare(sql).bind(...p).all()).results || [];
  const changes = r => (r && r.meta && r.meta.changes) || 0;
  return {
    async init() { for (const s of SCHEMA) await db.prepare(s).run(); },
    async isLocked() { const r = await one(`SELECT value FROM settings WHERE key='locked'`); return !!r && r.value === '1'; },
    async setLocked(v) { await db.prepare(`INSERT INTO settings(key,value) VALUES('locked',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(v ? '1' : '0').run(); },
    async claimed() { const r = await one(`SELECT COUNT(*) AS n FROM downloaders`); return r ? r.n : 0; },
    // Returns 'existing' | 'new' | 'full'. The cap check and insert are one SQL statement, so concurrent
    // requests cannot push the count past the cap.
    async register(rec, cap) {
      const bump = () => db.prepare(`UPDATE downloaders SET hits = hits + 1 WHERE hash = ?`).bind(rec.hash).run();
      if (changes(await bump())) return 'existing';
      const ins = await db.prepare(
        `INSERT OR IGNORE INTO downloaders (hash,country,region,continent,day,version,ua,hits)
         SELECT ?,?,?,?,?,?,?,1 WHERE (SELECT COUNT(*) FROM downloaders) < ?`)
        .bind(rec.hash, rec.country, rec.region, rec.continent, rec.day, rec.version, rec.ua, cap).run();
      if (changes(ins)) return 'new';
      return changes(await bump()) ? 'existing' : 'full'; // lost a race to the same hash, or genuinely full
    },
    async stats() {
      const tot = await one(`SELECT COUNT(*) AS unique_downloaders, COALESCE(SUM(hits),0) AS total_downloads FROM downloaders`);
      return {
        unique_downloaders: tot.unique_downloaders,
        total_downloads: tot.total_downloads,
        by_country: await all(`SELECT country, COUNT(*) AS downloaders FROM downloaders GROUP BY country ORDER BY downloaders DESC, country`),
        by_continent: await all(`SELECT continent, COUNT(*) AS downloaders FROM downloaders GROUP BY continent ORDER BY downloaders DESC, continent`),
        by_region: await all(`SELECT country, region, COUNT(*) AS downloaders FROM downloaders WHERE region <> '' GROUP BY country, region ORDER BY downloaders DESC, country, region`),
        by_version: await all(`SELECT version, COUNT(*) AS downloaders FROM downloaders GROUP BY version ORDER BY version`),
        by_browser: await all(`SELECT ua, COUNT(*) AS downloaders FROM downloaders GROUP BY ua ORDER BY downloaders DESC, ua`),
        by_day: await all(`SELECT day, COUNT(*) AS new_downloaders FROM downloaders GROUP BY day ORDER BY day`),
      };
    },
  };
}

// ---- request handling ----------------------------------------------------------------------------------

export async function handle(request, env, store, now = new Date()) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(env), 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } });

  const cap = capOf(env);
  const locked = async () => env.LOCKED === 'true' || (await store.isLocked());

  if (path === '/status' && method === 'GET') {
    const claimed = await store.claimed();
    const isLocked = await locked();
    return json(env, { claimed: Math.min(claimed, cap), cap, open: !isLocked && claimed < cap }, 200, { 'cache-control': 'public, max-age=30' });
  }

  if (path === '/dl') {
    if (method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } }); // HEAD and link-preview fetchers never count
    const target = env.DL_TARGET;
    if (typeof target !== 'string' || !/^https:\/\//.test(target) || typeof env.HASH_SALT !== 'string' || env.HASH_SALT.length < 16) {
      return new Response('Download is not configured.', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    const ua = uaFamily(request.headers.get('user-agent'));
    if (ua === 'bot') return new Response('Not available to automated clients.', { status: 403, headers: { 'cache-control': 'no-store' } });
    if (await locked()) return closedPage(env, true);

    const cf = request.cf || {};
    const country = /^[A-Za-z]{2}$/.test(cf.country || '') ? cf.country.toUpperCase() : 'XX';
    const continent = /^[A-Za-z]{2}$/.test(cf.continent || '') ? cf.continent.toUpperCase() : 'XX';
    const region = env.RECORD_SUBDIVISION === 'true' && /^[A-Za-z0-9-]{1,6}$/.test(cf.regionCode || '') ? cf.regionCode.toUpperCase() : '';
    const version = VERSION_RE.test(env.DL_VERSION || '') ? env.DL_VERSION : 'unknown';
    // The IP is read once, only to feed the keyed hash. It is not stored, logged or forwarded.
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (!ip) return new Response('Download is not available from this network.', { status: 400, headers: { 'cache-control': 'no-store' } });
    const hash = await hashClient(env.HASH_SALT, ip);

    const res = await store.register({ hash, country, region, continent, day: now.toISOString().slice(0, 10), version, ua }, cap);
    if (res === 'full') return closedPage(env, false);
    return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }

  if (path === '/admin/stats' || path === '/admin/lock') {
    if (!(await isAdmin(request, env))) return json(env, { error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer' });
    if (path === '/admin/stats') {
      if (method !== 'GET') return json(env, { error: 'method not allowed' }, 405);
      const s = await store.stats();
      return json(env, { cap, locked: await locked(), locked_by_env: env.LOCKED === 'true', ...s });
    }
    if (method !== 'POST') return json(env, { error: 'method not allowed' }, 405);
    let body;
    try { body = await request.json(); } catch { return json(env, { error: 'body must be JSON' }, 400); }
    if (!body || typeof body.locked !== 'boolean') return json(env, { error: 'expected {"locked": true|false}' }, 400);
    await store.setLocked(body.locked);
    return json(env, { locked: await locked(), locked_by_env: env.LOCKED === 'true' });
  }

  return json(env, { error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const store = d1Store(env.DB);
      return await handle(request, env, store);
    } catch {
      return new Response('Service error.', { status: 500, headers: { 'cache-control': 'no-store' } }); // no error detail, no logging of request data
    }
  },
};
