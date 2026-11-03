// Security Guard settings (kiro.json "guard") and the rule that keeps an agent from switching the Guard off:
//   * every category is 'ask' | 'log' | 'off' (default 'ask');
//   * a STRICTER value applies at once; a WEAKER value (ask -> log/off, new sync exclusions, trusted hosts that lower S) takes effect only
//     when it carries a matching HMAC written by the Electron main process after a confirmation dialog (guard/confirmed.json);
//   * a weaker kiro.json value without that HMAC is ignored (the last confirmed value stays) and reported as "changed outside the app".
import crypto from 'node:crypto';
import { CATS } from './rules.mjs';

const MODES = ['off', 'log', 'ask'];                         // weakest to strictest
export const DEFAULT_GUARD = { S: 'ask', Y: 'ask', I: 'ask', C: 'ask', H: 'ask', X: 'ask', U: 'ask', P: 'ask', syncRoots: [], trustedNpx: [], trustedHosts: [], hooksInTerminals: true };
const strs = (a, n, len) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && x.trim() && x.length <= len).map(x => x.trim()).slice(0, n);
export function normalizeGuardConfig(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, out = {};
  for (const c of CATS) out[c] = MODES.includes(r[c]) ? r[c] : DEFAULT_GUARD[c];
  out.syncRoots = [...new Set(strs(r.syncRoots, 40, 300))]; out.trustedNpx = [...new Set(strs(r.trustedNpx, 40, 100))]; out.trustedHosts = [...new Set(strs(r.trustedHosts, 40, 120).map(h => h.toLowerCase()))];
  out.hooksInTerminals = typeof r.hooksInTerminals === 'boolean' ? r.hooksInTerminals : DEFAULT_GUARD.hooksInTerminals;
  return out;
}
const rank = m => MODES.indexOf(m);
// What a change would weaken (each item needs the user's confirmation): [{ what, from, to }]
export function weakenings(cur, next) {
  const a = normalizeGuardConfig(cur), b = normalizeGuardConfig(next), out = [];
  for (const c of CATS) if (rank(b[c]) < rank(a[c])) out.push({ what: c, from: a[c], to: b[c] });
  for (const k of ['trustedHosts', 'trustedNpx']) { const added = b[k].filter(x => !a[k].includes(x)); if (added.length) out.push({ what: k, from: '', to: added.join(', ') }); }
  if (a.hooksInTerminals && !b.hooksInTerminals) out.push({ what: 'hooksInTerminals', from: 'on', to: 'off' });
  return out;
}
export const canonicalJson = o => JSON.stringify(o, Object.keys(o).sort());
export const signConfig = (cfg, secret) => crypto.createHmac('sha256', String(secret)).update(canonicalJson(normalizeGuardConfig(cfg))).digest('hex');
export function verifyConfirmed(obj, secret) {
  try {
    if (!obj || typeof obj.hmac !== 'string' || !secret) return null;
    const want = signConfig(obj.config, secret);
    const a = Buffer.from(want), b = Buffer.from(obj.hmac);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? normalizeGuardConfig(obj.config) : null;
  } catch { return null; }
}
// The settings the Guard actually enforces.
//   kiro: the "guard" object in kiro.json (anyone may have written it); confirmed: parsed guard/confirmed.json; secret: the HMAC key (null where the
//   host cannot verify, for instance a terminal started outside the app: then the strictest setting is used, never a weaker unverifiable one).
// Returns { config, notices: [{ what, kept, wanted }] }.
export function effectiveConfig(kiro, confirmed, secret) {
  const want = normalizeGuardConfig(kiro), base = verifyConfirmed(confirmed, secret) || (secret ? DEFAULT_GUARD : null);
  const strictest = normalizeGuardConfig({});
  const floor = base || strictest, notices = [];
  const out = normalizeGuardConfig(want);
  for (const c of CATS) if (rank(want[c]) < rank(floor[c])) { out[c] = floor[c]; notices.push({ what: c, kept: floor[c], wanted: want[c] }); }
  for (const k of ['trustedHosts', 'trustedNpx']) { const added = want[k].filter(x => !floor[k].includes(x)); if (added.length) { out[k] = floor[k]; notices.push({ what: k, kept: floor[k].join(', ') || '(none)', wanted: added.join(', ') }); } }
  if (!want.hooksInTerminals && floor.hooksInTerminals) { out.hooksInTerminals = true; notices.push({ what: 'hooksInTerminals', kept: 'on', wanted: 'off' }); }
  if (base == null) { /* no way to verify: unverifiable exemptions are left out entirely */ out.trustedHosts = []; out.trustedNpx = []; }
  return { config: out, notices };
}
