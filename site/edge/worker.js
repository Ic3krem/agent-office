// TiroAgents download counter. Cloudflare Worker + D1, plain JS, no dependencies.
//
// Routes
//   GET  /dl/<asset>   count one download, 302 to the GitHub release file for DL_VERSION
//                      (asset: windows | mac-arm64 | mac-x64 | linux-appimage | linux-deb). HEAD redirects without counting.
//   GET  /stats        {"total","byPlatform","byRegion","asOf"}  (public, counts only, continent level at most)
//
// Privacy: the client IP is used only as an input to a keyed hash (HMAC-SHA-256 with the secret HASH_SALT)
// that is truncated to 128 bits and stored for de-duplication (same hash + asset + UTC day counts once).
// The IP, the full user-agent string and any header are never stored or logged. Stored per row: hash, asset,
// UTC day, country, continent, hit count. Per-country numbers are never served; the owner can query D1 directly.

const VERSION_RE = /^[0-9][0-9A-Za-z.+-]{0,31}$/;
const RELEASES = 'https://github.com/Ic3krem/agent-office/releases/download';

export const ASSETS = {
  windows: { platform: 'windows', file: v => `TiroAgents-Setup-${v}.exe` },
  'mac-arm64': { platform: 'macos', file: v => `TiroAgents-${v}-arm64.dmg` },
  'mac-x64': { platform: 'macos', file: v => `TiroAgents-${v}-x64.dmg` },
  'linux-appimage': { platform: 'linux', file: v => `TiroAgents-${v}-x86_64.AppImage` },
  'linux-deb': { platform: 'linux', file: v => `TiroAgents-${v}-amd64.deb` },
};
const REGIONS = ['NA', 'SA', 'EU', 'AF', 'AS', 'OC']; // Antarctica (AN) and unknown get no region

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS downloads (
    hash TEXT NOT NULL,
    asset TEXT NOT NULL,
    day TEXT NOT NULL,
    country TEXT NOT NULL,
    continent TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (hash, asset, day)
  )`,
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

export const regionOf = c => (REGIONS.includes(String(c || '').toUpperCase()) ? String(c).toUpperCase() : '');

// Continent of a country code, for requests that arrive through the trusted front proxy (no request.cf there).
const CONTINENT_OF = {};
for (const [c, list] of Object.entries({
  NA: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI UM',
  SA: 'AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE',
  EU: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  AS: 'AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  OC: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
})) for (const k of list.split(' ')) CONTINENT_OF[k] = c;
export const continentOfCountry = cc => CONTINENT_OF[String(cc || '').toUpperCase()] || '';

// Equal-length constant-time string compare (the proxy key check must not leak timing).
function sameSecret(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Who downloaded: from Cloudflare itself, or, for the custom domain, from the front proxy (Vercel) that passes the
// visitor's IP and country it saw, signed with the shared PROXY_KEY. Without a valid key those headers are ignored.
export function clientOf(request, env) {
  const key = request.headers.get('x-proxy-key');
  if (key && typeof env.PROXY_KEY === 'string' && env.PROXY_KEY.length >= 32 && sameSecret(key, env.PROXY_KEY)) {
    const cc = (request.headers.get('x-client-country') || '').toUpperCase();
    const country = /^[A-Z]{2}$/.test(cc) ? cc : 'XX';
    return { ip: (request.headers.get('x-client-ip') || '').slice(0, 64), country, continent: continentOfCountry(country) };
  }
  const cf = request.cf || {};
  return { ip: request.headers.get('cf-connecting-ip') || '', country: /^[A-Za-z]{2}$/.test(cf.country || '') ? cf.country.toUpperCase() : 'XX', continent: regionOf(cf.continent) };
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

export async function hashClient(salt, ip) {
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(String(ip)))).slice(0, 32);
}

const legacy = v => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : 0; };

function cors(env) {
  const o = env.SITE_ORIGIN;
  return typeof o === 'string' && /^https:\/\/[^\s/]+$/.test(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : {};
}

function json(env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(env), ...extra },
  });
}

// ---- storage (D1) --------------------------------------------------------------------------------------

export function d1Store(db) {
  return {
    async init() { for (const s of SCHEMA) await db.prepare(s).run(); },
    // One statement: a repeat of the same hash + asset + day only bumps hits, so it is counted once.
    async record(r) {
      await db.prepare(
        `INSERT INTO downloads (hash,asset,day,country,continent,hits) VALUES (?,?,?,?,?,1)
         ON CONFLICT(hash,asset,day) DO UPDATE SET hits = hits + 1`)
        .bind(r.hash, r.asset, r.day, r.country, r.continent).run();
    },
    async counts() {
      return (await db.prepare(`SELECT asset, continent, COUNT(*) AS n FROM downloads GROUP BY asset, continent`).bind().all()).results || [];
    },
  };
}

export async function stats(env, store, now) {
  const byPlatform = { windows: legacy(env.LEGACY_WINDOWS), macos: legacy(env.LEGACY_MACOS), linux: legacy(env.LEGACY_LINUX) };
  const byRegion = Object.fromEntries(REGIONS.map(r => [r, 0]));
  for (const { asset, continent, n } of await store.counts()) {
    const a = Object.hasOwn(ASSETS, asset) ? ASSETS[asset] : null;
    if (!a) continue;
    byPlatform[a.platform] += n;
    if (Object.hasOwn(byRegion, continent)) byRegion[continent] += n;
  }
  return { total: byPlatform.windows + byPlatform.macos + byPlatform.linux, byPlatform, byRegion, asOf: now.toISOString() };
}

// ---- request handling ----------------------------------------------------------------------------------

export async function handle(request, env, store, now = new Date()) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(env), 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '600' } });
  if (method !== 'GET' && method !== 'HEAD') return json(env, { error: 'method not allowed' }, 405, { allow: 'GET, HEAD, OPTIONS' });

  if (path === '/stats') return json(env, await stats(env, store, now), 200, { 'cache-control': 'public, max-age=300' });

  const m = /^\/dl\/([a-z0-9-]{1,32})$/.exec(path);
  if (!m || !Object.hasOwn(ASSETS, m[1])) return json(env, { error: 'not found' }, 404);
  const asset = m[1];
  const version = env.DL_VERSION;
  if (typeof version !== 'string' || !VERSION_RE.test(version) || typeof env.HASH_SALT !== 'string' || env.HASH_SALT.length < 16) {
    return json(env, { error: 'download is not configured' }, 503);
  }
  const redirect = new Response(null, {
    status: 302,
    headers: { location: `${RELEASES}/v${version}/${ASSETS[asset].file(version)}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
  });
  if (method === 'HEAD' || uaFamily(request.headers.get('user-agent')) === 'bot') return redirect; // never counted

  // The IP is read once, only to feed the keyed hash. It is not stored, logged or forwarded.
  const { ip, country, continent } = clientOf(request, env);
  if (!ip) return redirect; // cannot de-duplicate, so do not count
  await store.record({ hash: await hashClient(env.HASH_SALT, ip), asset, day: now.toISOString().slice(0, 10), country, continent });
  return redirect;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env, d1Store(env.DB));
    } catch {
      return new Response('Service error.', { status: 500, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); // no error detail, no logging of request data
    }
  },
};
