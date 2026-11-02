// Update mechanism: pure helpers (version compare, feed parsing) plus check/download with injectable I/O so it is testable.
// Feed = an https JSON URL, a local file path, or a folder holding latest.json. Two shapes are understood:
//   generic : { "version": "1.2.0", "url": "https://.../Agent-Office-Setup-1.2.0.exe", "sha256": "<hex, optional>", "notes": "..." }
//   GitHub  : the /releases/latest API response (tag_name + assets[].browser_download_url / digest)
// Nothing here stores credentials; feeds are plain unauthenticated reads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

const winInstaller = n => /\.exe$/i.test(n) && /setup|install/i.test(n);
const platformAsset = (names, platform) => {
  const ext = platform === 'win32' ? winInstaller : platform === 'darwin' ? n => /\.(dmg|zip)$/i.test(n) : n => /\.(AppImage|deb)$/i.test(n);
  return names.find(ext);
};
// Normalise a feed document to { version, url, sha256, notes } or throw a readable Error.
export function parseFeed(doc, platform = process.platform) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Update feed is not a JSON object.');
  let version, url, sha256, notes;
  if (typeof doc.tag_name === 'string') { // GitHub release
    if (doc.draft || doc.prerelease) throw new Error('Latest release is a draft or pre-release.');
    version = doc.tag_name;
    const assets = Array.isArray(doc.assets) ? doc.assets.filter(a => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string') : [];
    const name = platformAsset(assets.map(a => a.name), platform), a = assets.find(x => x.name === name);
    if (a) { url = a.browser_download_url; if (/^sha256:[0-9a-f]{64}$/i.test(a.digest || '')) sha256 = a.digest.slice(7); }
    notes = doc.body;
  } else { ({ version, url, sha256, notes } = doc); }
  if (!parseVersion(version)) throw new Error(`Update feed has no valid version (got ${JSON.stringify(version ?? null)}).`);
  if (url != null && typeof url !== 'string') throw new Error('Update feed "url" must be a string.');
  if (sha256 != null && !/^[0-9a-f]{64}$/i.test(String(sha256))) throw new Error('Update feed "sha256" must be 64 hex characters.');
  return { version: String(version).trim().replace(/^v/, ''), url: url || null, sha256: sha256 ? String(sha256).toLowerCase() : null, notes: typeof notes === 'string' ? notes.slice(0, 600) : '' };
}
// A download URL must be https, or a local file path (a folder/share feed); never plain http or other schemes.
export function safeDownloadSource(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return { kind: 'https', value: s };
  if (/^file:\/\//i.test(s)) { try { return { kind: 'file', value: decodeURIComponent(new URL(s).pathname).replace(/^\/(?=[A-Za-z]:)/, '') }; } catch { return null; } }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  return path.isAbsolute(s) ? { kind: 'file', value: s } : null;
}
const feedKind = f => /^https:\/\//i.test(f) ? 'https' : /^[a-z][a-z0-9+.-]*:\/\//i.test(f) && !/^file:\/\//i.test(f) ? null : 'file';

// Read + parse the feed. io = { fetchJson(url), readFile(path), stat(path) } (defaults use fetch / fs).
export async function checkForUpdate({ feed, current, platform = process.platform, io = {} }) {
  const out = { current, feed: feed || '' };
  if (!feed || !String(feed).trim()) return { ...out, state: 'unconfigured' };
  const f = String(feed).trim(), kind = feedKind(f);
  if (!kind) return { ...out, state: 'error', error: 'Feed must be an https:// URL or a local path.' };
  try {
    let doc;
    if (kind === 'https') {
      const fetchJson = io.fetchJson || (async u => { const r = await fetch(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`Feed returned HTTP ${r.status}`); return r.json(); });
      doc = await fetchJson(f);
    } else {
      let p = f.startsWith('file:') ? safeDownloadSource(f)?.value : f;
      if (!p) throw new Error('Bad file:// feed.');
      if ((io.stat || (x => fs.statSync(x)))(p).isDirectory()) p = path.join(p, 'latest.json');
      doc = JSON.parse((io.readFile || (x => fs.readFileSync(x, 'utf8')))(p));
    }
    const info = parseFeed(doc, platform);
    return { ...out, state: isNewer(info.version, current) ? 'available' : 'current', available: info.version, url: info.url, sha256: info.sha256, notes: info.notes, checkedAt: Date.now() };
  } catch (e) { return { ...out, state: 'error', error: String(e.message || e).slice(0, 200) }; }
}

export const UNVERIFIED_WARNING = 'This feed provides no SHA-256, so the installer cannot be verified before it runs. Only install from a source you trust.';
// Warning text for the Updates panel: set when a successful check found no sha256 in the feed, else ''.
export const integrityWarning = u => (u && (u.state === 'available' || u.state === 'current') && !u.sha256 ? UNVERIFIED_WARNING : '');

export const sha256File = p => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

// Download the installer into dir (a fresh, dedicated folder), verify sha256 when the feed gave one. Returns { file, verified }.
export async function downloadUpdate({ url, sha256, dir }) {
  const src = safeDownloadSource(url);
  if (!src) throw new Error('Update download must be an https:// URL or a local path.');
  if (src.kind === 'https' && !sha256) throw new Error('Refusing to download an installer over the network without a SHA-256 in the update feed.');
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(src.kind === 'https' ? new URL(src.value).pathname : src.value).replace(/[^\w.\- ]/g, '_') || 'update.bin';
  const file = path.join(dir, name);
  if (src.kind === 'file') fs.copyFileSync(src.value, file);
  else {
    const r = await fetch(src.value, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok || !r.body) throw new Error(`Download returned HTTP ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  if (sha256 && (await sha256File(file)) !== sha256) { fs.rmSync(file, { force: true }); throw new Error('Downloaded file failed its SHA-256 check; discarded.'); }
  return { file, verified: !!sha256 };
}
