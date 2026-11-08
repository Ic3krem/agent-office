// Host a party from the app (no Docker): the party server (party/server.mjs, the same code as the Docker image) runs as
// a child process on 127.0.0.1, and Cloudflare's quick-tunnel program gives it a public share link. cloudflared is
// downloaded once from Cloudflare's GitHub release and checked against the pinned SHA-256 below before it is ever run.
// Both children exit with this server (their stdin is a pipe from it). The party listens on 127.0.0.1 only: friends come
// in through the share link.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLOUDFLARED = {
  version: '2026.10.7',
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848', tgz: true },
  'win32-arm64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' }, // x64 emulation
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd', tgz: true },
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const inviteCode = (n = 6) => Array.from(crypto.randomBytes(n), b => ALPHABET[b % ALPHABET.length]).join('');
// A port free on every interface from `from` up (null when none of `count` is), so it never lands on a port another
// program (e.g. a Docker party on 0.0.0.0:4880) already holds.
const bindable = (p, host) => new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(host ? { port: p, host } : { port: p }, () => s.close(() => res(true))); });
export async function freePort(from, count = 10) {
  for (let p = from; p < from + count; p++) if (await bindable(p) && await bindable(p, '127.0.0.1') && await bindable(p, '0.0.0.0')) return p;
  return null;
}
// The SHA-256 (hex) of a file.
export const sha256File = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });

// cloudflared for this machine in binDir, downloaded and checked once. -> its path, or null (no build for this platform).
export async function ensureCloudflared(binDir, { fetchImpl = fetch, platform = process.platform, arch = process.arch } = {}) {
  const pin = CLOUDFLARED[platform + '-' + arch];
  if (!pin) return null;
  const exe = path.join(binDir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'), stamp = exe + '.sha256';
  try { if (fs.readFileSync(stamp, 'utf8').trim() === pin.sha256 && fs.statSync(exe).size > 0) return exe; } catch {}
  fs.mkdirSync(binDir, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED.version}/${pin.file}`;
  const r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error('Could not download the share-link program (HTTP ' + r.status + ').');
  const tmp = path.join(binDir, pin.file + '.part');
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  const got = await sha256File(tmp);
  if (got !== pin.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('The downloaded share-link program failed its checksum; it was deleted.'); }
  if (pin.tgz) {
    const t = spawn('tar', ['-xzf', tmp, '-C', binDir], { stdio: 'ignore' });
    await new Promise((res, rej) => t.on('exit', c => c === 0 ? res() : rej(new Error('Could not unpack the share-link program.'))).on('error', rej));
    fs.rmSync(tmp, { force: true });
  } else fs.renameSync(tmp, exe);
  if (platform !== 'win32') fs.chmodSync(exe, 0o755);
  fs.writeFileSync(stamp, pin.sha256);
  return exe;
}

// state: off -> starting -> on (link or LAN only) | error. start(name) resolves once the party answers locally; the share
// link arrives later (status().link). join(url, code, name, hostKey) is the app's party client join.
export function createPartyHost({ dir, join, leave, onChange = () => {}, log = () => {}, fetchImpl = fetch }) {
  let st = { state: 'off' }, kids = [];
  const set = p => { st = { ...st, ...p }; onChange(); };
  const kill = () => { for (const k of kids) try { k.kill(); } catch {} kids = []; };
  const child = (cmd, args, env) => {
    const c = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    c.stdin.on('error', () => {}); c.on('error', e => log('party host: ' + path.basename(cmd) + ' ' + (e.code || e.message)));
    kids.push(c); return c;
  };
  async function start(name) {
    if (st.state === 'starting' || st.state === 'on') return status();
    set({ state: 'starting', link: null, error: '' });
    try {
      const port = await freePort(4880), mport = await freePort(4890);
      if (!port || !mport) throw new Error('No free port for the party (4880-4899 are taken).');
      const code = inviteCode(), hostKey = crypto.randomBytes(24).toString('hex');
      const party = child(process.execPath, [path.join(HERE, 'party', 'server.mjs')], {
        ELECTRON_RUN_AS_NODE: '1', PARTY_PORT: String(port), PARTY_BIND: '127.0.0.1', PARTY_CODE: code, PARTY_ADMIN_KEY: hostKey,
        PARTY_NAME: (name ? name + "'s party" : 'TiroAgents party'), PARTY_TRUST_PROXY: '127.0.0.1', PARTY_TUNNEL_METRICS: 'http://127.0.0.1:' + mport, PARTY_PARENT_PIPE: '1' });
      let out = '', up = null; const ready = new Promise(r => { up = r; });
      party.stdout.on('data', d => {
        out = (out + d).slice(-4000);
        if (out.includes('Party server on port ' + port + '.')) up(true); // our own server, not whatever else answers there
        const m = /Share this link: (https:\/\/\S+)/.exec(out); if (m && st.link !== m[1]) set({ link: m[1] });
      });
      party.on('exit', () => { if (st.state === 'on' || st.state === 'starting') { kill(); set({ state: 'error', error: 'The party server stopped.' }); } });
      const local = 'http://127.0.0.1:' + port;
      if (!(await Promise.race([ready, new Promise(r => setTimeout(r, 15000, false))]))) throw new Error('The party server did not start.');
      await join(local, code, name, hostKey);
      set({ state: 'on', code, port, key: hostKey });
      if (process.env.AGENT_OFFICE_NO_TUNNEL === '1') return status(); // live checks: no public tunnel from a test run
      // the share link: in the background (a first host downloads cloudflared, ~40-55 MB)
      ensureCloudflared(path.join(dir, 'bin'), { fetchImpl }).then(exe => {
        if (st.state !== 'on' || st.port !== port) return;
        if (!exe) return set({ error: 'Cloudflare has no share-link program for this computer, so friends cannot join from outside.' });
        child(exe, ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:' + mport, '--url', local], {});
      }).catch(e => { if (st.state === 'on') set({ error: e.message }); });
      return status();
    } catch (e) { kill(); set({ state: 'error', error: e.message }); throw e; }
  }
  async function stop() {
    const was = st.state;
    // tell everyone first, so guests leave at once instead of retrying a party that is gone
    if (st.port && st.key) try { await fetchImpl('http://127.0.0.1:' + st.port + '/admin/end', { method: 'POST', headers: { 'x-admin-key': st.key }, signal: AbortSignal.timeout(2000) }); await new Promise(r => setTimeout(r, 400)); } catch {}
    kill(); if (was !== 'off') { try { await leave(); } catch {} } set({ state: 'off', link: null, code: null, port: null, key: null, error: '' }); }
  const status = () => ({ state: st.state, link: st.link || null, code: st.code || null, error: st.error || '' });
  process.on('exit', kill);
  return { start, stop, status };
}
