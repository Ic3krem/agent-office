// Security Guard: content scanning and masking. A file is scanned only when it is named in an S/Y/I operation (first 256 KB, text only,
// cached by path + size + mtime). Values are never shown or logged: only NAME=•••• (len N) and the id of the rule that matched.
import crypto from 'node:crypto';
import { redact, hasSecret, entropy } from '../redact.mjs';
import { CONTENT_RULES, HEX_NEAR_KEYNAME, PLACEHOLDER, SECRET_NAME_RES, CONDITIONAL_NAME_RES, EXCEPT_NAME_RES, SECRET_DIRS, SSH_PUBLIC_OK } from './rules.mjs';
import { baseName, isRemoteKey } from './normalise.mjs';

export const SCAN_CAP = 256 * 1024;
export const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const SECRETY = /(secret|token|passw(or)?d|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth|session|cookie|dsn|connection[_-]?string|conn[_-]?str|accountkey|sas)/i;

// Which content rules fire in this text? -> { hit, rules: [ids] }. Placeholders (changeme, xxx, <...>, your-key-here) do not count.
// Lines whose value is a placeholder (changeme, xxx, <...>, your-key-here, ...) are dropped before scanning.
const stripPlaceholders = t => t.split(/\r?\n/).filter(l => { const m = /^\s*(?:export\s+)?[\w.-]+\s*[:=]\s*["']?(.*?)["']?\s*$/.exec(l); return !(m && PLACEHOLDER.test(m[1].trim())); }).join('\n');
export function scanText(text) {
  const t = stripPlaceholders(String(text ?? '').slice(0, SCAN_CAP)), rules = [];
  if (!t) return { hit: false, rules };
  if (hasSecret(t)) rules.push('redact');
  for (const [id, re] of CONTENT_RULES) if (re.test(t)) { if (id === 'dotenv') { if (dotenvHit(t)) rules.push(id); } else rules.push(id); }
  if (HEX_NEAR_KEYNAME.test(t)) rules.push('hex-token');
  for (const tok of t.match(/[A-Za-z0-9_+/=-]{32,}/g) || []) { if (!/^[0-9a-f]+$/i.test(tok) && /[a-z]/.test(tok) && /[A-Z]/.test(tok) && /\d/.test(tok) && entropy(tok) >= 4.0 && !/^[A-Za-z]+(\/[A-Za-z.]+)+$/.test(tok)) { rules.push('entropy'); break; } }
  return { hit: rules.length > 0, rules: [...new Set(rules)] };
}
function dotenvHit(t) {
  for (const line of t.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|DSN|URL))\s*=\s*["']?(\S{8,}?)["']?\s*$/.exec(line);
    if (m && !PLACEHOLDER.test(m[2]) && !/^(https?:\/\/)?(localhost|127\.|example\.)/i.test(m[2])) return true;
  }
  return false;
}
export const contentLooksSecret = text => scanText(text).hit;

// NAME=•••• (len N): what a secret contains, without the value.
export function maskText(s) {
  const masked = String(s ?? '').replace(/\b([A-Za-z_][\w.-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|DSN)[\w.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s;&|]+))/gi,
    (_m, name, _v, a, b, c) => `${name}=•••• (len ${String(a ?? b ?? c ?? '').length})`);
  return redact(masked);
}
export function previewNames(text, max = 8) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]\s*["']?(.*?)["']?\s*$/.exec(line);
    if (m && m[2].trim() && SECRETY.test(m[1])) out.push(`${m[1]}=•••• (len ${m[2].trim().length})`);
    else if (/BEGIN [A-Z ]*PRIVATE KEY/.test(line)) out.push('PRIVATE KEY block ••••');
    if (out.length >= max) break;
  }
  return out;
}

// ---- secret classification of a canonical path ----
export function secretByName(key) {
  const b = baseName(key);
  if (EXCEPT_NAME_RES.some(re => re.test(b))) return { kind: null, exceptionApplies: true };
  if (SECRET_NAME_RES.some(re => re.test(b))) return { kind: 'secret-name' };
  if (CONDITIONAL_NAME_RES.some(re => re.test(b))) return { kind: 'conditional' };
  return { kind: null };
}
export function secretDirKind(key) {
  const k = key + '/';
  for (const d of SECRET_DIRS) {
    if (!(k.includes(d) || key.endsWith(d.replace(/\/$/, '')))) continue;
    if (d === '/.ssh/' && SSH_PUBLIC_OK.some(re => re.test(baseName(key)))) return null;
    return d;
  }
  return null;
}

// Scan a file through ctx.fs. Returns { secret, by: 'name'|'dir'|'content', rules, sha12, size } or { secret:false }.
const cache = new Map();
export function classifyFile(key, ctx, { content = true } = {}) {
  const name = secretByName(key), dir = secretDirKind(key);
  if (isRemoteKey(key, ctx)) {                       // B3: remote path, classify from the text only
    if (dir) return { secret: true, by: 'dir', rules: ['secret-dir'] };
    if (name.kind === 'secret-name') return { secret: true, by: 'name', rules: ['secret-name'] };
    return { secret: false };
  }
  let size = 0, mtime = 0; try { const st = ctx.fs?.stat?.(key); if (st) { size = st.size || 0; mtime = st.mtimeMs || 0; if (st.isDir) return dir ? { secret: true, by: 'dir', rules: ['secret-dir'] } : { secret: false }; } } catch { /* ignore */ }
  const ck = `${key}|${size}|${mtime}`;
  if (cache.has(ck) && content) return cache.get(ck);
  let res = { secret: false };
  if (dir) res = { secret: true, by: 'dir', rules: ['secret-dir'] };
  else if (name.kind === 'secret-name') res = { secret: true, by: 'name', rules: ['secret-name'] };
  if (content && ctx.fs?.sample && (name.kind === 'conditional' || name.kind === null || name.exceptionApplies || res.secret)) {
    try {
      const text = ctx.fs.sample(key, SCAN_CAP);   // null for binary files
      if (text != null) {
        const sc = scanText(text), pv = res.secret || sc.hit ? previewNames(text) : [];
        if (sc.hit && !res.secret) res = { secret: true, by: 'content', rules: sc.rules };
        else if (res.secret) res = { ...res, rules: [...res.rules, ...sc.rules] };
        res.sha12 = sha256(text).slice(0, 12); res.preview = pv; res.size = size;
        if (name.kind === 'conditional' && !sc.hit) res = { secret: false, sha12: res.sha12 };
        if (name.exceptionApplies && !sc.hit) res = { secret: false, sha12: res.sha12 };
      }
    } catch { /* unreadable: name rules still apply */ }
  } else if (name.kind === 'conditional') res = { secret: false };
  if (content) { cache.set(ck, res); if (cache.size > 500) cache.delete(cache.keys().next().value); }
  return res;
}
export const clearScanCache = () => cache.clear();
