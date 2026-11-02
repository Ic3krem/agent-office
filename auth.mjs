// Credentials for the local server.
//   bridge key : lives in ~/.claude/agent-office/bridge.json so Claude Code terminals can use /bridge/* ONLY.
//   UI key     : random per server start, held in memory (Electron main hands it over in an env var and sets an HttpOnly
//                SameSite=Strict cookie; standalone runs print a one-time bootstrap URL). Never written to disk or logs.
//   nonce      : per-server-session value the real UI echoes on decisions (double-submit, defence in depth).
// An agent can read bridge.json (it runs as the same user) but can never see the UI key, so it cannot approve its own requests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = s => crypto.createHash('sha256').update(String(s ?? ''), 'utf8').digest();
// Hash both sides first: equal length always, any characters (including non-ASCII), no throw, constant time.
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
export const rand = (n = 24) => crypto.randomBytes(n).toString('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

// Config folder 0700, files 0600 (also repairs existing ones). On Windows the mode bits are advisory; the folder is in the user profile.
export function lockDown(dir, files = []) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  for (const f of files) { try { if (fs.existsSync(f)) fs.chmodSync(f, 0o600); } catch {} }
}
export function writePrivate(file, text) { fs.writeFileSync(file, text, { mode: 0o600 }); try { fs.chmodSync(file, 0o600); } catch {} }

// bridge.json holds only { port, key, v: 2 }. A file without v:2 predates key separation (its key may have been logged or
// used as the UI key), so it is replaced.
export function loadBridgeKey(file, port) {
  let key;
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.v === 2 && typeof j.key === 'string' && j.key.length >= 32) key = j.key; } catch {}
  const fresh = !key;
  key ||= rand(24);
  writePrivate(file, JSON.stringify({ port, key, v: 2 }));
  return { key, rotated: fresh };
}

export function createAuth({ bridgeKey, uiKey = rand(24), bootToken = rand(16), now = Date.now, bootTtl = 5 * 60e3 } = {}) {
  const nonce = rand(12), born = now();
  let bootUsed = false;
  const cookieOf = req => parseCookies(req.headers?.cookie);
  const isUi = req => { const c = cookieOf(req).ao_ui; return !!c && safeEqual(c, uiKey); };
  return {
    uiKey, bootToken, nonce,
    isUi,
    isBridge: req => { const k = req.headers?.['x-key']; return typeof k === 'string' && k.length > 0 && safeEqual(k, bridgeKey); },
    nonceOk: req => { const n = req.headers?.['x-nonce']; return typeof n === 'string' && safeEqual(n, nonce); },
    // One-time bootstrap for standalone runs: valid once, for a few minutes.
    redeemBoot(t) {
      if (bootUsed || now() - born > bootTtl || !t || !safeEqual(t, bootToken)) return false;
      bootUsed = true; return true;
    },
    uiCookie: () => `ao_ui=${uiKey}; HttpOnly; SameSite=Strict; Path=/`,
    nonceCookie: () => `ao_nonce=${nonce}; SameSite=Strict; Path=/`,
  };
}

// Only same-site absolute paths are valid redirect targets after bootstrap.
export const safeLocal = to => (typeof to === 'string' && /^\/[A-Za-z0-9_\-./]*$/.test(to) && !to.startsWith('//') ? to : '/');
