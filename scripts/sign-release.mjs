#!/usr/bin/env node
// Build and sign the release manifest (latest.json + latest.json.sig) for the installers of one release.
//
//   node scripts/sign-release.mjs --version 1.2.6 --out release-out \
//        --asset win32=dist/Agent-Office-Setup-1.2.6.exe [--asset darwin/arm64=dist/Agent-Office-1.2.6-arm64.dmg] [--asset linux/x64=dist/Agent-Office-1.2.6-x64.AppImage] [--notes "text"]
//   node scripts/sign-release.mjs --verify release-out        (checks an existing manifest + signature against the pinned public key)
//
// The private key is read from AGENT_OFFICE_SIGNING_KEY (a path) or ~/.agent-office-signing/release-ed25519.key. It is never printed,
// never copied and must never live inside the repository. See docs/RELEASING.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyManifestSignature, parseManifest } from '../desktop/updater.mjs';
import { RELEASE_PUBLIC_KEY } from '../desktop/update-key.mjs';

const REPO_URL = 'https://github.com/Ic3krem/agent-office/releases/download/';
export const defaultKeyPath = () => process.env.AGENT_OFFICE_SIGNING_KEY || path.join(os.homedir(), '.agent-office-signing', 'release-ed25519.key');

export function sha256OfFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// assets: [{ platform, file }]. Returns the manifest object (url points at the GitHub release for tag v<version>).
export function buildManifest({ version, assets, notes = '', publishedAt = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error('--version must look like 1.2.6');
  if (!assets?.length) throw new Error('at least one --asset platform=path is required');
  const seen = new Set();
  return {
    schema: 1, version, publishedAt, notes: String(notes).slice(0, 600),
    assets: assets.map(({ platform, arch, file }) => {
      if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('platform must be win32, darwin or linux');
      const k = platform + '/' + (arch || ''); if (seen.has(k)) throw new Error('one asset per platform/arch');
      seen.add(k);
      const name = path.basename(file);
      return { platform, ...(arch ? { arch } : {}), name, url: `${REPO_URL}v${version}/${encodeURIComponent(name)}`, sha256: sha256OfFile(file), size: fs.statSync(file).size };
    }),
  };
}
// Sign the exact bytes that will be published. Returns { json, sig }.
export function signManifest(manifest, privateKeyPem) {
  const json = JSON.stringify(manifest, null, 2) + '\n';
  const sig = crypto.sign(null, Buffer.from(json), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { json, sig };
}

function args(argv) {
  const o = { asset: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--asset') o.asset.push(argv[++i]);
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  return o;
}
function main() {
  const o = args(process.argv.slice(2));
  if (o.verify) {
    const dir = o.verify, bytes = fs.readFileSync(path.join(dir, 'latest.json')), sig = fs.readFileSync(path.join(dir, 'latest.json.sig'), 'utf8');
    verifyManifestSignature(bytes, sig, RELEASE_PUBLIC_KEY);
    for (const p of ['win32', 'darwin', 'linux']) { try { const m = parseManifest(JSON.parse(bytes.toString('utf8')), p); if (m.url) console.log(`ok ${p}: ${m.name} ${m.sha256}`); } catch (e) { throw new Error(`${p}: ${e.message}`); } }
    console.log('Signature verifies against the pinned public key.');
    return;
  }
  const assets = o.asset.map(s => { const i = s.indexOf('='), [platform, arch] = s.slice(0, i).split('/'); return { platform, arch, file: s.slice(i + 1) }; });
  const manifest = buildManifest({ version: o.version, assets, notes: o.notes });
  const keyPath = defaultKeyPath();
  if (!fs.existsSync(keyPath)) throw new Error('signing key not found (set AGENT_OFFICE_SIGNING_KEY or create ~/.agent-office-signing/release-ed25519.key)');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (path.resolve(keyPath).toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)) throw new Error('refusing to use a signing key stored inside the repository');
  const { json, sig } = signManifest(manifest, fs.readFileSync(keyPath, 'utf8'));
  const out = o.out || 'release-out'; fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'latest.json'), json); fs.writeFileSync(path.join(out, 'latest.json.sig'), sig + '\n');
  // Verify with the pinned public key before anyone uploads: catches a key/app mismatch immediately.
  verifyManifestSignature(fs.readFileSync(path.join(out, 'latest.json')), sig, RELEASE_PUBLIC_KEY);
  console.log(`Wrote ${path.join(out, 'latest.json')} and latest.json.sig (verified against the pinned public key).`);
  for (const a of manifest.assets) console.log(`  ${a.platform}: ${a.name} sha256 ${a.sha256}`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { try { main(); } catch (e) { console.error('error: ' + e.message); process.exit(1); } }
