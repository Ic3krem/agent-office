// Security Guard hooks. ONE implementation used in two places:
//   1. Agent Office sessions: createGuardHooks(...) gives programmatic PreToolUse / PostToolUse / UserPromptSubmit callbacks for the SDK
//      (they fire for hired agents too), registered in claudeSessionOptions().hooks.
//   2. Terminals: `node guard/hook.mjs` is a command hook (bridge plugin): reads the hook JSON on stdin, writes the answer on stdout, exits 0.
// CONTRACT (never broken): PreToolUse returns {} or { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason } }.
// Never allow, never deny, never updatedInput. PostToolUse may only add additionalContext. Any error or timeout returns {} and is logged as guard_error.
// Plain Node >= 18 and Electron-as-Node; no dependencies, no native modules, no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, createState } from './classify.mjs';
import { applyOutput, isScanned, isTainted, clearTaint, trustSource, sourceKey, textOfResponse } from './taint.mjs';
import { createAudit, auditEntry } from './audit.mjs';
import { effectiveConfig, normalizeGuardConfig } from './config.mjs';
import { CAT_NAMES, CATS, SEVERITY, GUARD_VERSION, REMEMBER_TTL_MS } from './rules.mjs';
import { maskText } from './scan.mjs';

export const SOFT_MS = 150, HARD_MS = 400;
export const askOutput = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } });
export const contextOutput = text => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });

// ---------------------------------------------------------------- default ctx providers (bounded: timeouts, entry caps)
export function makeFs(deadlineMs = 120) {
  const t0 = Date.now(), over = () => Date.now() - t0 > deadlineMs;
  const isLink = p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
  return {
    exists: p => { try { return fs.existsSync(p); } catch { return false; } },
    realpath: (key, orig) => { try { const r = fs.realpathSync.native(orig || key); return r && r !== orig ? r : null; } catch { return null; } },
    stat: p => { try { const s = fs.statSync(p); return { size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }; } catch { return null; } },
    sample: (p, n = 262144) => {
      let fd; try { fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(Math.min(n, 262144)); const got = fs.readSync(fd, buf, 0, buf.length, 0); const b = buf.subarray(0, got); if (b.subarray(0, 8192).includes(0)) return null; return b.toString('utf8'); } catch { return null; } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* ignore */ } }
    },
    list: d => { try { return fs.readdirSync(d); } catch { return []; } },
    walk: (root, cap = 500) => {
      const out = [], stack = [''];
      while (stack.length && out.length < cap && !over()) {
        const rel = stack.pop();
        let names; try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
        for (const e of names) {
          if (e.name === 'node_modules' || e.name === '.git') continue;
          const r = rel ? rel + '/' + e.name : e.name, full = path.join(root, r);
          if (e.isDirectory() && !isLink(full)) stack.push(r); else if (e.isFile()) out.push(r);
          if (out.length >= cap) break;
        }
      }
      return out;
    },
  };
}
const git = (cwd, args, ms = 100) => { try { return execFileSync('git', args, { cwd, timeout: ms, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 }); } catch { return null; } };
export function makeGit() {
  return {
    pushFiles(cwd, args) {
      const all = args.some(a => /^(--all|--mirror|--tags)$/.test(a));
      const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 80);
      const names = (all || !upstream) ? git(cwd, ['ls-files'], 120) : git(cwd, ['diff', '--name-only', upstream.trim() + '...HEAD'], 120);
      if (names == null) return null;
      return names.split('\n').filter(Boolean).slice(0, 400).map(p => ({ path: p, content: git(cwd, ['show', 'HEAD:' + p], 60) }));
    },
    ignoredFiles(cwd) { const r = git(cwd, ['ls-files', '-o', '-i', '--exclude-standard'], 100); return r ? r.split('\n').filter(Boolean) : []; },
    addCandidates(cwd) { const r = git(cwd, ['ls-files', '-o', '-m', '--exclude-standard'], 100); return r ? r.split('\n').filter(Boolean) : []; },
  };
}

// Registry values (OneDrive account folders, known-folder redirection): Windows only, a bounded 'reg query', run at start-up and every 10 minutes (never per tool call).
export function makeReadReg() {
  if (process.platform !== 'win32') return null;
  return (key, name) => {
    try {
      const out = execFileSync('reg', ['query', key, '/s', '/v', name], { timeout: 400, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return [...out.matchAll(/^\s*\S+\s+REG_(?:EXPAND_)?SZ\s+(.+)$/gm)].map(m => m[1].trim());
    } catch { return []; }
  };
}

// ---------------------------------------------------------------- cloud-sync roots (resolved at start and every 10 minutes)
export function discoverSyncRoots({ os: osName = process.platform, home = os.homedir(), env = process.env, fsApi = fs, readReg = null } = {}) {
  const out = new Set(), has = p => { try { return fsApi.existsSync(p); } catch { return false; } };
  const readJson = f => { try { return JSON.parse(fsApi.readFileSync(f, 'utf8')); } catch { return null; } };
  const add = p => { if (p && typeof p === 'string') out.add(p); };
  for (const k of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) add(env[k]);
  for (const d of ['OneDrive', 'Dropbox', 'Google Drive', 'iCloudDrive', 'iCloud Drive', 'Box', 'Box Sync', 'Nextcloud', 'ownCloud', 'pCloudDrive', 'Insync', 'MEGA', 'Sync', 'Tresorit']) if (has(path.join(home, d))) add(path.join(home, d));
  if (osName === 'win32') {
    for (const f of [path.join(env.APPDATA || '', 'Dropbox', 'info.json'), path.join(env.LOCALAPPDATA || '', 'Dropbox', 'info.json')]) { const j = readJson(f); for (const a of Object.values(j || {})) add(a?.path); }
    const nc = path.join(env.APPDATA || '', 'Nextcloud', 'nextcloud.cfg'); try { const t = fsApi.readFileSync(nc, 'utf8'); for (const m of t.matchAll(/localPath=(.+)/g)) add(m[1].trim()); } catch { /* none */ }
    if (has('G:\\My Drive')) add('G:\\My Drive');
    if (readReg) { try { for (const v of readReg('HKCU\\Software\\Microsoft\\OneDrive\\Accounts', 'UserFolder') || []) add(v); for (const n of ['Desktop', 'Personal', 'My Pictures']) { const v = readReg('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', n)?.[0]; if (v && /onedrive/i.test(v)) add(v.replace(/%userprofile%/i, home)); } } catch { /* registry unavailable */ } }
  } else if (osName === 'darwin') {
    add(path.join(home, 'Library', 'Mobile Documents')); add(path.join(home, 'Library', 'CloudStorage'));
    const nc = path.join(home, 'Library', 'Preferences', 'Nextcloud', 'nextcloud.cfg'); try { for (const m of fsApi.readFileSync(nc, 'utf8').matchAll(/localPath=(.+)/g)) add(m[1].trim()); } catch { /* none */ }
  } else {
    const j = readJson(path.join(home, '.dropbox', 'info.json')); for (const a of Object.values(j || {})) add(a?.path);
    try { for (const m of fsApi.readFileSync(path.join(home, '.config', 'Nextcloud', 'nextcloud.cfg'), 'utf8').matchAll(/localPath=(.+)/g)) add(m[1].trim()); } catch { /* none */ }
  }
  const obs = osName === 'win32' ? path.join(env.APPDATA || '', 'obsidian', 'obsidian.json') : osName === 'darwin' ? path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json') : path.join(home, '.config', 'obsidian', 'obsidian.json');
  for (const v of Object.values(readJson(obs)?.vaults || {})) add(v?.path);
  return [...out];
}

// ---------------------------------------------------------------- the hooks
export function reasonText(res, ctx = {}) {
  const home = ctx.home ? String(ctx.home).replace(/\\+/g, '/').replace(/\/$/, '') : '';
  const rel = p => { const s = String(p).replace(/\\+/g, '/'); return home && s.toLowerCase().startsWith(home.toLowerCase() + '/') ? '~' + s.slice(home.length) : s; };
  const lines = [`Security Guard: ${res.cats.map(c => CAT_NAMES[c]).join('; ')} [${res.rules.join(', ')}].`, ...res.reasons];
  if (res.host) lines.push(`Destination: ${res.host}.`);
  if (res.files.length) lines.push('Files: ' + res.files.map(f => `${rel(f.path)} (${f.why}${f.preview?.length ? '; ' + f.preview.slice(0, 3).join(', ') : ''})`).join('; ') + '.');
  lines.push(res.exact ? 'Payload: exact.' : 'Payload: estimated (could not be listed exactly).');
  if (!res.rememberable) lines.push('This kind of request cannot be remembered.');
  return maskText(lines.join(' ')).slice(0, 1800);
}

// opts: getConfig() -> normalised effective config; getRemembered() -> [{ key, at }]; getBase(input) -> { os, home, cwd, env, vaultDir, projectDirs, additionalDirs, syncRoots };
//       audit: { write }; now; fsFactory/gitApi optional (tests inject virtual ones)
export function createGuardHooks({ getConfig, getRemembered = () => [], getBase = () => ({}), audit = { write() {} }, now = Date.now, fsFactory = makeFs, gitApi = makeGit(), agentOf = () => '' } = {}) {
  const sessions = new Map(), meta = new Map();
  const stateOf = id => { const k = String(id || 'default'); let s = sessions.get(k); if (!s) { s = createState(); sessions.set(k, s); if (sessions.size > 50) sessions.delete(sessions.keys().next().value); } return s; };
  const ctxOf = input => ({ os: process.platform, home: os.homedir(), env: process.env, cwd: input?.cwd || process.cwd(), ...getBase(input), fs: fsFactory(), git: gitApi, config: getConfig(), remembered: getRemembered(), now });
  const guardErr = (e, input, ms) => { try { audit.write(auditEntry({ now: now(), sessionId: input?.session_id, tool: input?.tool_name, category: '', decision: 'guard_error', command: String(e && e.message || e), extra: { ms } })); } catch { /* ignore */ } };
  const withBudget = async (fn, input) => {
    const t0 = Date.now();
    try {
      const r = await Promise.race([Promise.resolve().then(fn), new Promise(res => setTimeout(() => res('__timeout__'), HARD_MS).unref?.())]);
      const ms = Date.now() - t0;
      if (r === '__timeout__') { guardErr(new Error('timeout'), input, ms); return {}; }
      if (ms > SOFT_MS) try { audit.write(auditEntry({ now: now(), sessionId: input?.session_id, tool: input?.tool_name, decision: 'slow', extra: { ms } })); } catch { /* ignore */ }
      return r;
    } catch (e) { guardErr(e, input, Date.now() - t0); return {}; }
  };
  const api = {
    meta, sessions, stateOf,
    pre: input => withBudget(() => {
      const ctx = ctxOf(input), st = stateOf(input.session_id);
      const res = classify(input.tool_name, input.tool_input, ctx, st);
      const entry = category => auditEntry({ now: now(), sessionId: input.session_id, agent: agentOf(input), tool: input.tool_name, category, ruleIds: res.rules, destHost: res.host, paths: res.files.map(f => f.path), fileSha: res.files.map(f => f.sha12 || ''), exact: res.exact, command: input.tool_input?.command ?? input.tool_input?.url ?? input.tool_input?.file_path ?? '', remembered: res.remembered });
      if (res.remembered) { audit.write({ ...entry(res.cats[0] || ''), decision: 'remembered' }); return {}; }
      if (res.level === 'none') return {};
      if (res.level === 'log') { audit.write({ ...entry(res.cats[0] || ''), decision: 'log' }); return {}; }
      const reason = reasonText(res, ctx);
      const m = { cats: res.cats, rules: res.rules, files: res.files, host: res.host, exact: res.exact, rememberKey: res.rememberKey, rememberable: res.rememberable, reason, title: 'Security Guard: ' + res.cats.map(c => CAT_NAMES[c]).join('; '), source: res.matches.find(x => x.source)?.source || '', tool: input.tool_name, session: input.session_id };
      if (input.tool_use_id) { meta.set(input.tool_use_id, m); st.askedIds.set(input.tool_use_id, { cats: res.cats, rememberKey: res.rememberKey }); if (meta.size > 300) meta.delete(meta.keys().next().value); }
      audit.write({ ...entry(res.cats[0]), decision: 'ask', cats: res.cats });
      return askOutput(reason);
    }, input),
    post: input => withBudget(() => {
      const ctx = { config: getConfig() }, st = stateOf(input.session_id), cfg = ctx.config || {};
      const asked = st.askedIds.get(input.tool_use_id);
      if (asked) { st.askedIds.delete(input.tool_use_id); audit.write(auditEntry({ now: now(), sessionId: input.session_id, tool: input.tool_name, category: asked.cats[0], decision: 'ask', userAnswer: 'allowed' })); if (asked.cats.includes('P')) clearTaint(st.taint); }
      if ((cfg.P || 'ask') !== 'off' && isScanned(input.tool_name)) {
        const r = applyOutput(st.taint, input.tool_name, input.tool_input, input.tool_response, now());
        if (r.taint) audit.write(auditEntry({ now: now(), sessionId: input.session_id, tool: input.tool_name, category: 'P', ruleIds: st.taint.rules.map(x => 'P.' + x), decision: 'log', command: st.taint.source, extra: { snippet: st.taint.snippet } }));
        if (r.context && (cfg.P || 'ask') !== 'log') return contextOutput(r.context);
      }
      return {};
    }, input),
    prompt: async input => { try { stateOf(input?.session_id).prompts++; } catch { /* ignore */ } return {}; },
    // a person (not an automatic nudge) typed or approved something: the session is no longer waiting on untrusted instructions
    humanPrompt(sessionId) { clearTaint(stateOf(sessionId).taint); },
    trust(sessionId, tool, input) { trustSource(stateOf(sessionId).taint, sourceKey(tool, input)); },
    status() {
      let banner = '', at = 0;
      for (const s of sessions.values()) if (isTainted(s.taint, now()) && s.taint.at > at) { at = s.taint.at; banner = `Untrusted content from ${s.taint.source} contains text aimed at the AI (${s.taint.rules.slice(0, 3).join(', ')}). Actions that send, run or write outside the project will ask first.`; }
      return { banner, version: GUARD_VERSION };
    },
  };
  return api;
}

// ---------------------------------------------------------------- terminal command hook (node guard/hook.mjs)
const stateFile = (dir, id) => path.join(dir, 'sessions', crypto.createHash('sha256').update(String(id || 'default')).digest('hex').slice(0, 24) + '.json');
function loadSession(dir, id) { try { const j = JSON.parse(fs.readFileSync(stateFile(dir, id), 'utf8')); const s = createState(); Object.assign(s.taint, j.taint, { trusted: new Map(j.trusted || []) }); s.files = new Set(j.files || []); s.dirs = new Set(j.dirs || []); s.firstRead = j.firstRead || 0; s.secretReads = new Set(j.secretReads || []); s.downloaded = new Set(j.downloaded || []); s.sensitiveFiles = new Set(j.sensitiveFiles || []); return s; } catch { return createState(); } }
function saveSession(dir, id, s) { try { fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true, mode: 0o700 }); const f = stateFile(dir, id); fs.writeFileSync(f, JSON.stringify({ taint: { ...s.taint, trusted: undefined }, trusted: [...s.taint.trusted], files: [...s.files].slice(-400), dirs: [...s.dirs].slice(-100), firstRead: s.firstRead, secretReads: [...s.secretReads], downloaded: [...s.downloaded].slice(-50), sensitiveFiles: [...s.sensitiveFiles].slice(-50) }), { mode: 0o600 }); } catch { /* best effort */ } }

export async function runCommandHook(stdinText, env = process.env, home = os.homedir()) {
  let input; try { input = JSON.parse(stdinText || '{}'); } catch { return {}; }
  const base = path.join(home, '.claude', 'agent-office'), dir = path.join(base, 'guard');
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const kiro = readJson(path.join(base, 'kiro.json')) || {}, confirmed = readJson(path.join(dir, 'confirmed.json'));
  const secret = env.AGENT_OFFICE_GUARD_KEY || null;           // only a terminal started by the app can verify the HMAC; otherwise the strictest settings apply
  const eff = effectiveConfig(kiro.guard, confirmed, secret);
  if (eff.config.hooksInTerminals === false && secret) return {};
  const audit = createAudit({ dir });
  if (eff.notices.length) audit.write(auditEntry({ sessionId: input.session_id, decision: 'log', category: '', command: 'Guard setting changed outside the app; kept ' + eff.notices.map(n => `${n.what}:${n.kept}`).join(', ') }));
  const remembered = (readJson(path.join(dir, 'remember.json'))?.entries) || [];
  const st = loadSession(dir, input.session_id);
  const hooks = createGuardHooks({ getConfig: () => eff.config, getRemembered: () => remembered, getBase: () => ({ home, env, cwd: input.cwd || process.cwd(), os: process.platform, syncRoots: [...(eff.config.syncRoots || []), ...discoverSyncRoots({ home, env })], vaultDir: '' }), audit });
  hooks.sessions.set(String(input.session_id || 'default'), st);
  const ev = input.hook_event_name;
  const out = ev === 'PostToolUse' ? await hooks.post(input) : ev === 'PreToolUse' ? await hooks.pre(input) : {};
  saveSession(dir, input.session_id, hooks.stateOf(input.session_id));
  return out;
}
const thisFile = (() => { try { return fileURLToPath(import.meta.url); } catch { return ''; } })();
if (process.argv[1] && thisFile && path.resolve(process.argv[1]) === thisFile) {
  let buf = ''; process.stdin.setEncoding('utf8');
  const kill = setTimeout(() => { process.stdout.write('{}'); process.exit(0); }, HARD_MS + 200); kill.unref?.();
  process.stdin.on('data', d => { buf += d; if (buf.length > 4e6) buf = buf.slice(0, 4e6); });
  process.stdin.on('end', async () => { let out = {}; try { out = await runCommandHook(buf); } catch { out = {}; } process.stdout.write(JSON.stringify(out)); process.exit(0); });
}
void pathToFileURL; void CATS; void SEVERITY; void REMEMBER_TTL_MS; void normalizeGuardConfig; void textOfResponse;
