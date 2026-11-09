// External desks' local settings: kiro.json "external" { <ext key>: { model, auto, args, command } }. Never in a layout, template,
// party payload or report. model applies as written; auto, args and command can weaken safety, so they apply only when they match
// external/confirmed.json, which the desktop app signs (HMAC, the Security Guard's key) after a native confirmation.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './guard/config.mjs';
import { readForWrite } from './prefs-file.mjs';

const KEY_RE = /^ext-(codex|gemini|opencode|custom)-[1-3]$/;
const MODEL_RE = /^[\w.:\/@-]{1,80}$/;
const WEAK = { auto: false, args: '', command: '' };
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

export function cleanExternal(obj) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!KEY_RE.test(k) || !isObj(v)) continue;
    const d = {};
    if (typeof v.model === 'string' && MODEL_RE.test(v.model) && !v.model.startsWith('-')) d.model = v.model;
    if (typeof v.auto === 'boolean') d.auto = v.auto;
    for (const f of ['args', 'command']) if (typeof v[f] === 'string' && v[f].length <= 500) d[f] = v[f];
    out[k] = d;
  }
  return out;
}
// Only the safety fields are signed, per key, in a fixed order (canonicalJson sorts one level, so each desk is canonicalised alone).
const safety = d => ({ auto: d?.auto === true, args: typeof d?.args === 'string' ? d.args : '', command: typeof d?.command === 'string' ? d.command : '' });
const canonical = cfg => { const c = cleanExternal(cfg); return JSON.stringify(Object.keys(c).sort().map(k => [k, canonicalJson(safety(c[k]))])); };
export const signExternal = (cfg, secret) => crypto.createHmac('sha256', String(secret)).update(canonical(cfg)).digest('hex');
function verified(confirmed, secret) {
  try {
    if (!secret || !isObj(confirmed) || typeof confirmed.hmac !== 'string') return null;
    const a = Buffer.from(signExternal(confirmed.config, secret)), b = Buffer.from(confirmed.hmac);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? cleanExternal(confirmed.config) : null;
  } catch { return null; }
}
// -> { [key]: { model, auto, args, command }, changedOutside: [key] } for every external key kiro.json names.
export function effectiveExternal(kiroExternal, confirmed, secret) {
  const want = cleanExternal(kiroExternal), ok = verified(confirmed, secret) || {}, out = { changedOutside: [] };
  for (const [k, d] of Object.entries(want)) {
    const w = safety(d), c = safety(ok[k]), eff = { model: d.model || '' };
    let outside = false;
    for (const f of Object.keys(WEAK)) { if (w[f] === c[f]) eff[f] = w[f]; else { eff[f] = WEAK[f]; if (w[f] !== WEAK[f]) outside = true; } }
    out[k] = eff;
    if (outside) out.changedOutside.push(k);
  }
  return out;
}
export const confirmedFile = cfgDir => path.join(cfgDir, 'external', 'confirmed.json');
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// Desktop only (it holds the key): store one desk's confirmed auto/args/command in kiro.json and the signed confirmed.json.
export function confirmExternal({ cfgDir, kiroFile, secret }, key, vals) {
  if (!KEY_RE.test(key)) throw new Error(key + ' is not an external desk');
  if (!secret) throw new Error('Open TiroAgents to change this.');
  const v = safety(cleanExternal({ [key]: vals })[key]);
  const kiro = readForWrite(kiroFile), ext = cleanExternal(kiro.external);
  ext[key] = { ...ext[key], ...v };
  kiro.external = ext;
  const prev = verified(readJ(confirmedFile(cfgDir)), secret) || {};
  const conf = { ...prev, [key]: v };
  fs.mkdirSync(path.dirname(confirmedFile(cfgDir)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(confirmedFile(cfgDir), JSON.stringify({ config: conf, hmac: signExternal(conf, secret) }), { mode: 0o600 });
  fs.writeFileSync(kiroFile, JSON.stringify(kiro));
  return ext[key];
}
// Server: save a desk's model (the only setting the page may change without the desktop app). '' clears it.
export function saveModel(kiroFile, key, model) {
  if (!KEY_RE.test(key)) throw new Error(key + ' is not an external desk');
  if (model && (!MODEL_RE.test(model) || model.startsWith('-'))) throw new Error('Invalid model name');
  const kiro = readForWrite(kiroFile), ext = cleanExternal(kiro.external);
  ext[key] = { ...ext[key] }; if (model) ext[key].model = model; else delete ext[key].model;
  kiro.external = ext; fs.writeFileSync(kiroFile, JSON.stringify(kiro));
  return ext[key];
}
