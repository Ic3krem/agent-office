// Update mechanism. Authenticity first: a release is described by a manifest (latest.json) that is signed offline with an Ed25519 key
// whose PUBLIC half is pinned in this app (update-key.mjs). Integrity second: the manifest carries the SHA-256 of the installer, and
// the installer is hashed again immediately before it is launched. A manifest without a valid signature is never used, whichever
// transport delivered it (https, file or UNC share), so a hijacked feed, mirror or share cannot make the app run an arbitrary file.
//
// Manifest (latest.json), signature in latest.json.sig = base64 of Ed25519(manifest bytes exactly as published):
//   { "schema": 1, "version": "1.2.6", "publishedAt": "...", "notes": "...",
//     "assets": [ { "platform": "win32", "name": "Agent-Office-Setup-1.2.6.exe", "url": "https://github.com/Ic3krem/agent-office/releases/download/v1.2.6/...exe", "sha256": "<64 hex>", "size": 123 } ] }
// The feed location is a constant in the main process (DEFAULT_FEED). It is never taken from the page, kiro.json or any file the page can write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RELEASE_PUBLIC_KEY } from './update-key.mjs';

export const DEFAULT_FEED = 'https://github.com/Ic3krem/agent-office/releases/latest/download/latest.json';
const GITHUB_ASSET_PREFIX = 'https://github.com/Ic3krem/agent-office/releases/download/';
const MAX_MANIFEST = 256 * 1024, MAX_INSTALLER = 600 * 1024 * 1024;

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseVersion(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}
// -1 / 0 / 1, or null when either side is not a valid version. Pre-releases sort below the release (semver 2.0).
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
export const isNewer = (candidate, current) => compareVersions(candidate, current) === 1;

// ---------- signature ----------
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const keyFromRaw = rawB64 => {
  const raw = Buffer.from(String(rawB64), 'base64');
  if (raw.length !== 32) throw new Error('Pinned update key is malformed.');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
};
export const keyFingerprint = rawB64 => crypto.createHash('sha256').update(Buffer.from(String(rawB64), 'base64')).digest('hex');
// Throws unless sigB64 is a valid Ed25519 signature of exactly these bytes under the pinned key.
export function verifyManifestSignature(bytes, sigB64, pubKeyB64 = RELEASE_PUBLIC_KEY) {
  const sig = Buffer.from(String(sigB64 || '').trim(), 'base64');
  if (sig.length !== 64) throw new Error('Update manifest has no valid signature file; refusing it.');
  if (!Buffer.isBuffer(bytes) || !crypto.verify(null, bytes, keyFromRaw(pubKeyB64), sig)) throw new Error('Update manifest signature is invalid; refusing it.');
}

// ---------- manifest ----------
// Which asset locations are acceptable. GitHub release downloads by default; an enterprise mirror adds its own https prefix or local folder.
export function makeAssetPolicy(feed = DEFAULT_FEED) {
  const f = String(feed || '');
  if (f === DEFAULT_FEED) return { https: [GITHUB_ASSET_PREFIX], dir: null };
  if (/^https:\/\//i.test(f)) return { https: [f.slice(0, f.lastIndexOf('/') + 1)], dir: null };
  return { https: [], dir: path.dirname(feedFilePath(f)) };
}
const inPolicy = (u, policy) => {
  if (/^https:\/\//i.test(u)) { try { const n = new URL(u); return n.protocol === 'https:' && !n.username && !n.password && policy.https.some(p => n.href.startsWith(p)); } catch { return false; } }
  return !!policy.dir && /^[\w][\w.\- ]*$/.test(u) && !u.includes('..'); // local feeds: a bare file name next to the manifest, nothing else
};
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
// Normalise a VERIFIED manifest to { version, url, sha256, name, size, notes } for this platform or throw a readable Error.
export function parseManifest(doc, platform = process.platform, policy = makeAssetPolicy()) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schema !== 1) throw new Error('Update manifest is not a recognised schema-1 document.');
  if (!parseVersion(doc.version)) throw new Error(`Update manifest has no valid version (got ${JSON.stringify(doc.version ?? null)}).`);
  const assets = Array.isArray(doc.assets) ? doc.assets.filter(a => a && typeof a === 'object' && a.platform === platform) : [];
  const a = assets[0];
  const version = String(doc.version).trim().replace(/^v/, ''), notes = typeof doc.notes === 'string' ? doc.notes.slice(0, 600) : '';
  if (!a) return { version, url: null, sha256: null, name: null, size: 0, notes };
  if (!sha(a.sha256)) throw new Error('Update asset has no valid SHA-256; refusing it.');
  if (typeof a.url !== 'string' || !inPolicy(a.url, policy)) throw new Error('Update asset location is not an allowed source; refusing it.');
  const size = Number.isFinite(a.size) && a.size > 0 && a.size <= MAX_INSTALLER ? Math.floor(a.size) : 0;
  return { version, url: a.url, sha256: a.sha256.toLowerCase(), name: String(a.name || path.basename(a.url)).replace(/[^\w.\- ]/g, '_').slice(0, 120), size, notes };
}

function feedFilePath(f) {
  const p = /^file:\/\//i.test(f) ? decodeURIComponent(new URL(f).pathname).replace(/^\/(?=[A-Za-z]:)/, '') : f;
  return /\.json$/i.test(p) ? p : path.join(p, 'latest.json');
}
const feedKind = f => /^https:\/\//i.test(f) ? 'https' : /^[a-z][a-z0-9+.-]{1,}:\/\//i.test(f) && !/^file:\/\//i.test(f) ? null : 'file';
const defaultReadBytes = async loc => {
  if (/^https:\/\//i.test(loc)) {
    const r = await fetch(loc, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Feed returned HTTP ${r.status}`);
    if (!String(r.url || loc).startsWith('https://')) throw new Error('Feed redirected to a non-https address.');
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > MAX_MANIFEST) throw new Error('Feed is unreasonably large.');
    return b;
  }
  const b = fs.readFileSync(loc);
  if (b.length > MAX_MANIFEST) throw new Error('Feed is unreasonably large.');
  return b;
};

// Fetch manifest + signature, verify, then compare versions. io = { readBytes(location) } (defaults use fetch / fs).
// States: available | current | error. A manifest that is older than (or equal to) the running version is 'current': no downgrade offer, ever.
export async function checkForUpdate({ feed = DEFAULT_FEED, current, platform = process.platform, pubKey = RELEASE_PUBLIC_KEY, io = {} }) {
  const f = String(feed || '').trim(), out = { current, feed: f };
  const kind = feedKind(f);
  if (!f || !kind) return { ...out, state: 'error', error: 'Update feed must be an https:// URL or a local path.' };
  try {
    const readBytes = io.readBytes || defaultReadBytes;
    const loc = kind === 'https' ? f : feedFilePath(f);
    const bytes = await readBytes(loc);
    const sigB64 = Buffer.from(await readBytes(loc + '.sig')).toString('utf8'); // a missing signature file throws -> error state
    verifyManifestSignature(bytes, sigB64, pubKey);
    let doc; try { doc = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Update manifest is not valid JSON.'); }
    const info = parseManifest(doc, platform, makeAssetPolicy(f));
    const newer = isNewer(info.version, current);
    return { ...out, state: newer ? 'available' : 'current', available: info.version, url: newer ? info.url : null, sha256: newer ? info.sha256 : null, name: info.name, size: info.size, notes: info.notes, checkedAt: Date.now() };
  } catch (e) { return { ...out, state: 'error', error: String(e.message || e).slice(0, 200) }; }
}

// The island page may only toggle auto-check. Anything else it sends (feed, url, hash...) is ignored: the feed cannot be changed from the page.
export function applyUpdatePatch(prefs, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  if (typeof patch.auto === 'boolean') { prefs.updateAuto = patch.auto; return true; }
  return false;
}
// The enterprise override comes from the main process environment only (never from IPC or kiro.json). Returns the feed to use.
export const resolveFeed = (env = process.env) => (env.AGENT_OFFICE_UPDATE_FEED && String(env.AGENT_OFFICE_UPDATE_FEED).trim()) || DEFAULT_FEED;

// ---------- download ----------
export const sha256File = p => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

// A fresh, unpredictable, user-only directory for one download. Windows: inheritance removed and only the current user granted.
export function makeUpdateDir(base, { exec = execFileSync, platform = process.platform } = {}) {
  const dir = path.join(base, 'u-' + crypto.randomBytes(16).toString('hex'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform === 'win32') {
    const who = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : os.userInfo().username;
    exec('icacls', [dir, '/inheritance:r', '/grant:r', `${who}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true });
  } else fs.chmodSync(dir, 0o700);
  return dir;
}

// Download into dir and verify SHA-256 (required). Local assets are copied; https assets are streamed with a size cap. Returns { file, sha256 }.
export async function downloadUpdate({ url, sha256, name, dir, policy = makeAssetPolicy(), localDir = null }) {
  if (!sha(sha256)) throw new Error('Refusing to fetch an installer without a SHA-256 from a signed manifest.');
  if (typeof url !== 'string' || !inPolicy(url, policy)) throw new Error('Update download is not from an allowed source.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = String(name || (/^https:/i.test(url) ? path.basename(new URL(url).pathname) : url)).replace(/[^\w.\- ]/g, '_') || 'update.bin';
  const file = path.join(dir, base);
  if (!/^https:/i.test(url)) fs.copyFileSync(path.join(policy.dir || localDir, url), file);
  else {
    const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok || !r.body) throw new Error(`Download returned HTTP ${r.status}`);
    if (!String(r.url || url).startsWith('https://')) throw new Error('Download redirected to a non-https address.');
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_INSTALLER) throw new Error('Installer is unreasonably large.');
    const ws = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let n = 0;
    try { for await (const c of r.body) { n += c.length; if (n > MAX_INSTALLER) throw new Error('Installer is unreasonably large.'); if (!ws.write(c)) await new Promise(res => ws.once('drain', res)); } }
    catch (e) { ws.destroy(); fs.rmSync(file, { force: true }); throw e; }
    await new Promise((res, rej) => ws.end(e => e ? rej(e) : res()));
  }
  if ((await sha256File(file)) !== sha256.toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('Downloaded file failed its SHA-256 check; discarded.'); }
  return { file, sha256: sha256.toLowerCase() };
}

// Last gate, called immediately before the installer is launched: same file, same hash as the signed manifest, still newer than what runs.
export async function verifyBeforeLaunch({ file, sha256, version, current }) {
  if (!isNewer(version, current)) throw new Error('Refusing to launch an installer that is not newer than the running version.');
  if (!sha(sha256) || (await sha256File(file)) !== sha256.toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('Installer changed after verification; discarded.'); }
}
