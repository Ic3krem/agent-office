// Security Guard classifier: classify(tool, input, ctx, state) -> { level: 'none' | 'log' | 'ask', matches, cats, rules, reasons, files, host, exact, ... }.
// Pure: file system, git and npm come in through ctx; no network, no child processes. ASK-ONLY: a result can only ask the user (or just be logged);
// nothing here approves, denies or edits anything.
import crypto from 'node:crypto';
import { hasSecret } from '../redact.mjs';
import { launchesClaude } from '../permissions.mjs';
import * as R from './rules.mjs';
import { normText, unshell, decodeEncodedCommands, canon, pathKeys, parseShell, progName, expandVars, hasUnknownVar, within, homeKey, baseName } from './normalise.mjs';
import { scanText, classifyFile, secretByName, secretDirKind, maskText, sha256 } from './scan.mjs';
import { secretsIn, secretsInContents, walkRoot, dockerPayload, npmPackFiles } from './payload.mjs';
import { isTainted } from './taint.mjs';

const M = (cat, rule, reason, extra = {}) => ({ cat, rule: `${cat}.${rule}`, reason, ...extra });
const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const SECRETY_VAR = R.SECRETY_VAR;
const PATHY = a => /[\\/]/.test(a) || /^~/.test(a) || /^\.{1,2}($|[\\/])/.test(a) || /^\$/.test(a) || /^%/.test(a) || /^[a-z]:/i.test(a) || R.SECRET_NAME_RES.some(re => re.test(String(a).toLowerCase())) || /\.(zip|tgz|gz|tar|7z|json|ya?ml|txt|conf|cfg|ini|sqlite|db)$/i.test(a);

export function createState() {
  return { taint: { tainted: false, at: 0, source: '', rules: [], snippet: '', trusted: new Map() }, files: new Set(), dirs: new Set(), firstRead: 0, secretReads: new Set(), downloaded: new Set(), sensitiveFiles: new Set(), prompts: 0, askedIds: new Map() };
}

// ---- helpers over canonical keys ----
const syncKeys = ctx => [...(ctx.syncRoots || []), ...(ctx.vaultDir ? [ctx.vaultDir] : [])].map(p => canon(p, ctx).key);
function isSyncPath(key, ctx) {
  const k = key + '/';
  if (R.SYNC_FRAGMENTS.some(f => k.includes(f))) return true;
  if (R.MEMORY_VAULT_FRAGMENTS.some(f => k.includes(f))) return true;
  return syncKeys(ctx).some(r => within(key, r));
}
const projectKeys = ctx => (ctx.projectDirs?.length ? ctx.projectDirs : [ctx.cwd]).filter(Boolean).map(d => canon(d, ctx).key);
const outsideProject = (key, ctx) => !projectKeys(ctx).some(d => within(key, d)) && !(ctx.additionalDirs || []).some(d => within(key, canon(d, ctx).key)) && !/\/(node_modules|\.git|dist|build|out)\//.test(key + '/');
const cPath = key => R.C_PATH_RES.some(re => re.test(key));
const persistKind = key => { const k = key + '/'; return R.PERSIST_PATHS.find(f => (f.endsWith('/') || f.includes('.')) ? (k.includes(f) || key.endsWith(f)) : false) || null; };
const agentCfgKind = key => { const k = key + '/'; return R.AGENT_CFG_PATHS.find(f => k.includes(f) || key.endsWith(f.replace(/\/$/, ''))) || null; };

// A path argument inspected from every angle (requested + symlink/junction target).
function inspect(orig, ctx, opts = {}) {
  const { keys, unc, host, wild } = pathKeys(orig, ctx), r = { orig, keys, unc, host, wild, secret: null, c: false, sync: false, persist: null, agentCfg: null };
  for (const k of keys) {
    const f = classifyFile(k, ctx, { content: opts.content !== false });
    if (f.secret && !r.secret) r.secret = f;
    r.c ||= cPath(k) || (!!secretDirKind(k) && outsideProject(k, ctx));
    r.sync ||= isSyncPath(k, ctx); r.persist ||= persistKind(k); r.agentCfg ||= agentCfgKind(k);
  }
  return r;
}
function pathArgs(c) {
  const out = [];
  for (const a0 of [...c.args, ...c.redirIn]) {
    let t = String(a0);
    if (/^-/.test(t) && !/[=@]/.test(t)) continue;
    const kv = /^(?:--?[\w-]+|[\w.-]+)=@?(.+)$/.exec(t); if (kv) t = kv[1];
    const at = /^(?:--?[\w-]+)?@(.+)$/.exec(t); if (at) t = at[1];
    if (/^[\w.-]+@[\w.-]+:/.test(t)) continue;                       // remote side of scp/rsync
    if (PATHY(t)) out.push(t);
  }
  return out;
}
const descendants = c => { const out = []; const rec = x => { for (const s of x.subs || []) { out.push(s); rec(s); } }; rec(c); return out; };
const feedersOf = c => { const out = []; let x = c, g = 0; while (x?.pipeFromCmd && g++ < 8) { out.push(x.pipeFromCmd); x = x.pipeFromCmd; } return out; };
const hostOf = texts => {
  for (const t of texts) {
    const m = /\b([a-z][a-z0-9+.-]*):\/\/(?:[^/\s@'"]+@)?([^/\s:?#'"]+)/i.exec(String(t));
    if (m && !/^(file|data|javascript)$/i.test(m[1])) return m[2].toLowerCase();
    const s = /^(?:[\w.-]+@)?([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):[^\\/\d]/.exec(String(t)); if (s) return s[1].toLowerCase();
    const r = /^([\w.-]+):(?!\/\/|[\\/])/.exec(String(t)); if (r && !/^[a-z]$/i.test(r[1])) return r[1].toLowerCase();
  }
  return '';
};
const secretEnvRefs = texts => { const hit = new Set(); for (const t of texts) for (const m of String(t).matchAll(/(?:\$\{?|%|\$env:)([A-Za-z_]\w*)\}?%?/g)) if (SECRETY_VAR.test(m[1]) && !/^(path|home|pwd|oldpwd|user|username)$/i.test(m[1])) hit.add(m[1]); return [...hit]; };

// Is this command a sender of data? Returns a label, or null.
function egressOf(c, ctx) {
  const p = c.prog, a = c.args, low = a.map(x => String(x).toLowerCase()), sub = low.find(x => !x.startsWith('-')) || '';
  if (R.TUNNELS.has(p)) return p + ' tunnel';
  if (R.NET_PROGS.has(p)) {
    if (p === 'certutil') return /http/.test(low.join(' ')) ? 'certutil download' : null;
    if (p === 'bitsadmin') return /\/transfer|\/addfile/.test(low.join(' ')) ? 'bitsadmin' : null;
    if (p === 'ssh') return c.pipeFromCmd || c.redirIn.length ? 'ssh (stdin piped in)' : null;
    if (p === 'rsync' || p === 'scp' || p === 'sftp') return a.some(x => /^(?:[\w.-]+@)?[\w.-]+:[^\\/\d]|^(rsync|scp|sftp|ssh):\/\//.test(String(x)) && !/^[a-z]:[\\/]/i.test(String(x))) ? p : null;
    if (p === 'rclone') return /^(copy|sync|move|copyto|moveto|bisync|mount)$/.test(sub) ? 'rclone ' + sub : null;
    if (p === 'curl' || p === 'wget' || p === 'iwr' || p === 'irm' || p === 'invoke-webrequest' || p === 'invoke-restmethod' || p === 'http' || p === 'https' || p === 'xh' || p === 'httpie') return p;
    return p;
  }
  const re = R.CODE_PUSH[p];
  if (re && re.test(sub || '')) {
    if (p === 'git') return sub === 'push' ? 'git push' : sub === 'send-email' ? 'git send-email' : null;
    if (p === 'gh') { const j = low.join(' '); if (sub === 'gist' && /create|edit/.test(j)) return 'gh gist'; if (sub === 'release' && /upload|create/.test(j)) return 'gh release'; if (sub === 'repo' && /create/.test(j) && /--push/.test(j)) return 'gh repo create --push'; if (sub === 'secret' && /\bset\b/.test(j)) return 'gh secret set'; if (sub === 'api' && /(-x|--method)\s+(post|put|patch)|\s-[fF]\s|--input/.test(' ' + j)) return 'gh api upload'; return null; }
    if (p === 'docker' || p === 'podman') return sub === 'push' ? p + ' push' : (sub === 'build' || (sub === 'buildx' && low.includes('build'))) ? p + ' build' : null;
    if (p === 'aws') return /^(cp|sync|mv)$/.test(low[low.indexOf(sub) + 1] || '') || /^put-/.test(low.find(x => /^put-/.test(x)) || '') ? 'aws ' + sub : null;
    if (p === 'az' || p === 'gcloud') return low.some(x => /^(upload|upload-batch|copy|sync|cp|rsync)$/.test(x)) ? p + ' ' + sub : null;
    if (p === 'dotnet') return low.includes('push') ? 'dotnet nuget push' : null;
    if (p === 'yarn') return sub === 'publish' ? 'yarn publish' : null;
    return p + ' ' + sub;
  }
  if (p === 'gsutil' && low.some(x => /^(cp|rsync|mv)$/.test(x))) return 'gsutil';
  if (p === 'npx' && /^(np|release-it)$/.test(sub)) return 'npx ' + sub;
  if (/^(python[\d.]*|py|node|nodejs|deno|bun|perl|ruby|php)$/.test(p) && c.inlineCode && /(requests\.(post|put)|urllib|urlopen|httpx|aiohttp|fetch\(|https?\.request|net::http|axios|socket\.|net\.connect|webclient|httpclient|xmlhttprequest|lwp)/i.test(c.inlineCode)) return p + ' inline network code';
  const raw = c.argvFull.join(' ');
  if (/\b(invoke-restmethod|invoke-webrequest|iwr|irm)\b[^\n]*(-infile|-body|-form)\b|\[net\.webclient\]|new-object\s+(system\.)?net\.webclient|\.upload(file|string|data)\(|\[system\.net\.http\.httpclient\]|new-object\s+(system\.)?net\.sockets\.tcpclient|invoke-command[^\n]*-computername|copy-item[^\n]*-tosession/i.test(raw)) return 'PowerShell upload';
  if (/\/dev\/(tcp|udp)\//.test(raw) || c.redirOut.some(r => /^\/dev\/(tcp|udp)\//.test(r))) return '/dev/tcp';
  if (R.BROWSER_UPLOAD.test(raw) || (/playwright|puppeteer/.test(p) && /setinputfiles/i.test(raw))) return 'browser file upload';
  return null;
}

// ================================================================================== shell
function analyzeShell(tool, command, ctx, state, out) {
  const ps = tool === 'PowerShell';
  const raw = String(command ?? '');
  const { text: norm, hidden } = normText(raw);
  const { text: deobf, changed } = unshell(norm);
  const decoded = decodeEncodedCommands(norm);
  const texts = [norm, ...(changed ? [deobf] : []), ...decoded].map(t => t.replace(/\r?\n/g, ' ').slice(0, 60000));
  const test = (re, which = null) => { for (let i = 0; i < texts.length; i++) if (re.test(texts[i])) return i === 0 ? 'orig' : (i <= (changed ? 1 : 0) ? 'deobf' : 'decoded'); return null; };
  const cmds = parseShell(norm, { ps });
  if (changed) { const cmdsD = parseShell(deobf, { ps }); for (const c of cmdsD) if (!cmds.some(x => x.argvFull.join(' ') === c.argvFull.join(' '))) cmds.push(c); }
  for (const dec of decoded) for (const c of parseShell(dec, { ps: true })) cmds.push(c);
  const flatPaths = [];
  // ---------- U: unwanted scripts, persistence
  const uHits = [];
  for (const [id, re] of R.U_RES) { const w = test(re); if (w) { uHits.push([id, w]); out.push(M('U', id, uReason(id), { obf: w })); } }
  if (uHits.some(([, w]) => w === 'deobf')) out.push(M('U', 'obfuscated', 'The command is written with carets, backticks or split quotes to hide what it runs.'));
  if (hidden >= 3) out.push(M('U', 'hidden-chars', `The command contains ${hidden} hidden characters that a person cannot see.`));
  if (launchesClaude(norm)) out.push(M('U', 'claude-launch', 'Starts Claude outside the hiring approval.'));
  // ---------- C / X / H by text
  for (const [id, re] of R.C_CMD_RES) if (test(re)) out.push(M('C', id, cReason(id)));
  for (const re of R.ENV_DUMP_RES) if (test(re)) { out.push(M('C', 'env-dump', 'Dumps the environment variables, which often hold secrets.')); break; }
  for (const [id, re] of R.X_RES) if (test(re)) out.push(M('X', id, `Captures the screen, clipboard, keystrokes or a debugging port (${id}).`));
  const hHit = R.H_RES.some(re => texts.some(t => re.test(t)));
  if (hHit && texts.some(t => R.ROOTED_SEARCH.test(t))) out.push(M('H', 'recursive-hunt', 'Searches the whole home folder or drive for passwords, tokens or key files.'));
  if (HOOK_BYPASS_TEST(texts)) out.push(M('I', 'hook-bypass', 'Skips git hooks or changes the file-tracking flags (--no-verify, core.hooksPath, update-index).'));
  // ---------- per command
  const archivesOut = new Set();
  for (const c of cmds) {
    const p = c.prog; if (!p) continue;
    const args = pathArgs(c), ins = args.map(o => inspect(o, ctx));
    const kids = descendants(c), feeders = feedersOf(c);
    const upstream = [...kids, ...feeders];
    const upIns = upstream.flatMap(u => pathArgs(u).map(o => inspect(o, ctx)));
    const upSecrets = [...ins, ...upIns].filter(x => x.secret);
    flatPaths.push(...args);
    const readLike = !/^(ls|dir|pwd|cd|echo|mkdir|test|true|false|git|npm|node)$/.test(p);
    // C: credential stores and secret dirs read outside the project
    if (readLike) for (const x of ins) if (x.c) { out.push(M('C', 'store-read', `Reads a credential store or credential file: ${x.orig}.`, { files: [{ path: x.orig, why: 'credential store' }] })); }
    if (/^(printenv|echo|write-output|write-host)$/.test(p) && c.args.some(a => /^\$?\{?[A-Za-z_]\w*\}?$/.test(a) && SECRETY_VAR.test(a)) && (p !== 'echo' || c.args.some(a => /^\$\{?[A-Za-z_]/.test(a)))) out.push(M('C', 'env-secret', 'Prints a secret environment variable.'));
    // reads for the H volume counters
    if (readLike) noteReads(args, ctx, state, out);
    // download tracking (for "run what was just downloaded")
    if (/^(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|start-bitstransfer)$/.test(p)) {
      const o = c.args.findIndex(a => /^(-o|--output|-outfile|--out-file|-destination)$/i.test(a)); if (o >= 0 && c.args[o + 1]) state?.downloaded.add(canon(c.args[o + 1], ctx).key);
      for (const r of c.redirOut) state?.downloaded.add(canon(r, ctx).key);
    }
    // U: run something from Downloads/Temp, run something downloaded in this session
    const target = (/^(sh|bash|zsh|python[\d.]*|node|perl|ruby|pwsh|powershell|source|\.|start-process|start|invoke-item|ii)$/.test(p) ? c.args.find(a => !a.startsWith('-')) : (PATHY(String(c.argvFull[0])) ? c.argvFull[0] : '')) || '';
    if (target) {
      const tk = canon(target, ctx).key;
      if (R.RUN_DL_EXT.test(tk) && R.RUN_DL_DIRS.some(d => (tk + '/').includes(d))) out.push(M('U', 'run-download', `Runs a program from a download or temp folder: ${target}.`, { files: [{ path: target, why: 'downloaded or temp program' }] }));
      else if (state?.downloaded.has(tk)) out.push(M('U', 'run-downloaded', `Runs a file that was downloaded earlier in this session: ${target}.`));
    }
    // U: persistence by path (redirect, tee, copy, sed -i, Set-Content ...)
    const writes = writeTargets(c, args);
    for (const d of writes) { const x = inspect(d, ctx, { content: false }); const pk = x.persist || (/\$profile/i.test(d) ? 'powershell profile' : null); if (pk) out.push(M('U', 'persist-path', `Writes to a place that makes things run again later (${pk}): ${d}.`, { files: [{ path: d, why: 'startup or profile file' }] })); if (x.agentCfg) out.push(M('U', 'agent-config', `Changes agent configuration (${x.agentCfg}): ${d}.`, { files: [{ path: d, why: 'agent configuration' }] })); }
    // npx / supply chain
    if (p === 'npx') { const pkg = c.args.find(a => !a.startsWith('-')); if (pkg && !ctx.config?.trustedNpx?.includes(pkg) && !inPackageJson(ctx, pkg)) out.push(M('U', 'npx-unknown', `Runs an npx package that is not in this project: ${pkg}.`)); }
    // I: copies of secrets under a non-secret name, archives of secret trees, ignore-override flags
    if (R.COPIERS.has(p) || (p === 'git' && c.args[0] === 'mv')) {
      const srcs = (p === 'git' ? c.args.slice(1) : c.args).filter(a => !a.startsWith('-') && PATHY(a)); const dest = srcs.length >= 2 ? srcs[srcs.length - 1] : null;
      const secretSrc = srcs.slice(0, -1).map(o => inspect(o, ctx)).filter(x => x.secret);
      if (dest && secretSrc.length) {
        const dk = canon(dest, ctx).key;
        if (!secretByName(dk).kind && !classifyFileNameOnly(dk)) out.push(M('I', 'disguised-copy', `Copies a secret file under a name that does not look secret: ${secretSrc[0].orig} -> ${dest}.`, { files: [{ path: secretSrc[0].orig, why: 'secret file' }] }));
        const di = inspect(dest, ctx, { content: false });
        if (di.sync) out.push(M('Y', 'secret-to-sync', `Copies a secret into a cloud-synced folder (${dest}), which uploads it.`, { files: secretSrc.map(x => ({ path: x.orig, why: 'secret file' })), dest: dest }));
        if (di.unc) out.push(M('S', 'unc-copy', `Copies a secret to a network location (${dest}).`, { host: di.host, files: secretSrc.map(x => ({ path: x.orig, why: 'secret file' })) }));
      }
    }
    if (R.ARCHIVERS.has(p)) {
      const inputs = c.args.filter(a => !a.startsWith('-') && PATHY(a) || a === '.' || a === '*'), found = [];
      for (const o of inputs) { const x = inspect(o, ctx); if (x.secret) found.push({ path: o, why: 'secret file' }); else { const k = canon(o, ctx).key; const w = walkRoot(ctx, k); if (w) for (const s of secretsIn(ctx, k, w.files)) found.push({ path: s.path, why: s.by === 'content' ? 'secret content' : 'secret file' }); } }
      const wholeHome = inputs.some(o => { const k = canon(o, ctx).key; const h = homeKey(ctx); return k === h || ['/documents', '/.ssh', '/library', '/appdata'].some(s => k === h + s); });
      if (found.length) { out.push(M('I', 'archive-secrets', `Packs secret files into an archive (${found.slice(0, 3).map(f => f.path).join(', ')}), a way around ignore rules and scanners.`, { files: found.slice(0, 8) })); const o = outputOf(c); if (o) { archivesOut.add(canon(o, ctx).key); state?.sensitiveFiles.add(canon(o, ctx).key); } }
      else if (wholeHome) out.push(M('I', 'archive-home', 'Archives the home folder or a large part of it, which sweeps up credentials.'));
      const o = outputOf(c); if (o) { const oi = inspect(o, ctx, { content: false }); if (oi.sync && (found.length || wholeHome)) out.push(M('Y', 'archive-to-sync', `Writes an archive of sensitive files into a cloud-synced folder (${o}).`)); }
    }
    if (p === 'git' && c.args[0] === 'add') gitAdd(c, ctx, out);
    // Y: redirect/tee of secret content into a sync root
    for (const d of writes) { const x = inspect(d, ctx, { content: false }); if (x.sync) { const fromSecret = upSecrets.length || upstreamEnv(upstream) || (ENV_DUMP(norm) && c.redirOut.length) || [...(state?.sensitiveFiles || [])].some(s => args.some(o => canon(o, ctx).key === s)); if (fromSecret) out.push(M('Y', 'secret-to-sync', `Writes secrets into a cloud-synced folder (${d}), which uploads them.`, { dest: d, files: upSecrets.slice(0, 4).map(x2 => ({ path: x2.orig, why: 'secret file' })) })); if (x.secret && !fromSecret) out.push(M('Y', 'secret-name-in-sync', `Creates a secret-named file in a cloud-synced folder (${d}).`, { dest: d })); } }
    // S: egress
    const eg = egressOf(c, ctx);
    const clip = R.CLIPBOARD_SET.test(c.argvFull.join(' '));
    if (eg || clip) egress(c, eg || 'clipboard', clip && !eg, { ctx, state, out, upstream, ins, upIns, texts, norm, archivesOut });
  }
  return { flatPaths };
}
const ENV_DUMP = t => R.ENV_DUMP_RES.some(re => re.test(t));
const upstreamEnv = up => up.some(u => ENV_DUMP(u.argvFull.join(' ')));
const HOOK_BYPASS_TEST = texts => texts.some(t => R.HOOK_BYPASS.test(t));
const classifyFileNameOnly = key => R.SECRET_NAME_RES.some(re => re.test(baseName(key)));
const outputOf = c => { const a = c.args; const i = a.findIndex(x => /^-?-?(destinationpath|dest|o|f|file)$/i.test(x)); if (c.prog === 'tar') { const k = a.findIndex(x => /^-?[a-z]*f$/.test(x)); return a[k + 1]; } if (c.prog === 'compress-archive') { const k = a.findIndex(x => /^-destinationpath$/i.test(x)); return a[k + 1] || a.filter(x => !x.startsWith('-'))[1]; } if (i >= 0 && a[i + 1]) return a[i + 1]; return a.filter(x => !x.startsWith('-') && PATHY(x))[0]; };
const writeTargets = (c, args) => {
  const w = [...c.redirOut]; const p = c.prog;
  if (/^(tee|set-content|add-content|out-file|sc|ac|new-item|ni|touch|install|ln|chmod|echo|printf)$/.test(p) && p !== 'echo' && p !== 'printf') w.push(...args);
  if (R.COPIERS.has(p) && args.length >= 2) w.push(args[args.length - 1]);
  if (/^(sed|perl)$/.test(p) && c.args.some(a => /^-\w*i/.test(a))) w.push(...args);
  if (p === 'git' && c.args[0] === 'config' && c.args.some(a => /^--(global|system)$/.test(a))) w.push('~/.gitconfig');
  return w;
};
const inPackageJson = (ctx, pkg) => { try { const t = ctx.fs?.sample?.(canon(ctx.cwd || '.', ctx).key + '/package.json', 65536); return !!t && t.includes(`"${String(pkg).replace(/@[^/]+$/, '')}"`); } catch { return false; } };
function uReason(id) { return ({ 'pipe-exec': 'Downloads text and runs it straight away.', iex: 'Downloads and runs code with Invoke-Expression or a process substitution.', encoded: 'Runs an encoded PowerShell command that hides what it does.', 'b64-exec': 'Decodes hidden text and runs it.', eval: 'Evaluates a string as code.', unblock: 'Removes a safety check (execution policy, quarantine flag) or runs a remote installer.', schtasks: 'Creates a scheduled task, so something runs again later.', 'reg-run': 'Adds a Windows startup entry, service or WMI subscription.', cron: 'Changes cron jobs or system startup scripts.', launchd: 'Adds a launchd job.', systemd: 'Adds a systemd unit or autostart entry.', 'hooks-cfg': 'Changes git hook configuration.', 'supply-url': 'Installs a package straight from a URL or git source.', 'curl-sh': 'Downloads a file and runs it.' })[id] || 'Runs or installs something that may run again later.'; }
function cReason(id) { return ({ cmdkey: 'Lists saved Windows credentials.', vaultcmd: 'Lists the Windows credential vault.', keymgr: 'Opens the Windows credential manager.', 'ps-cred': 'Reads stored credentials with PowerShell.', 'netsh-wifi': 'Reveals saved Wi-Fi passwords.', 'reg-creds': 'Reads credential-bearing registry hives.', lsass: 'Dumps credentials from memory or the domain database.', 'mac-security': 'Reads the macOS Keychain.', 'mac-sqlite': 'Opens a browser database with saved logins or cookies.', 'mac-defaults': 'Reads a stored password from macOS defaults.', 'secret-tool': 'Reads the Linux keyring.', pass: 'Reads the password store or secret keys.', memory: 'Reads another process\'s memory.' })[id] || 'Reads a credential store.'; }

function noteReads(paths, ctx, state, out) {
  if (!state) return;
  const now = ctx.now ? ctx.now() : Date.now(), win = 10 * 60e3;
  if (!state.firstRead || now - state.firstRead > win) { state.files = new Set(); state.dirs = new Set(); state.secretReads = new Set(); state.firstRead = now; }
  for (const p of paths) {
    const k = canon(p, ctx).key; if (!outsideProject(k, ctx)) { if (classifyFile(k, ctx, { content: false }).secret) state.secretReads.add(k); continue; }
    state.files.add(k); const h = homeKey(ctx), rel = h && within(k, h) ? k.slice(h.length + 1) : k.replace(/^[a-z]:/, '').slice(1); state.dirs.add(rel.split('/')[0] || '/');
    if (classifyFile(k, ctx, { content: false }).secret) state.secretReads.add(k);
  }
  if (state.files.size > 200 || state.dirs.size > 8 || state.secretReads.size > 5) {
    out.push(M('H', 'volume', `Has read ${state.files.size} files in ${state.dirs.size} top-level folders outside the project (${state.secretReads.size} look like secrets) in a short time, which looks like bulk harvesting.`));
    state.files = new Set(); state.dirs = new Set(); state.secretReads = new Set(); state.firstRead = 0;
  }
}

function gitAdd(c, ctx, out) {
  const args = c.args.slice(1), force = args.some(a => a === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)), all = args.some(a => /^(-A|--all|\.|\*|-u|:\/)$/.test(a));
  const named = args.filter(a => !a.startsWith('-') && !/^(\.|\*|:\/)$/.test(a)).map(o => inspect(o, ctx)).filter(x => x.secret);
  const cwd = canon(ctx.cwd || '.', ctx).key; let cand = [];
  try { cand = (force ? ctx.git?.ignoredFiles?.(cwd) : null) || []; cand = [...cand, ...(ctx.git?.addCandidates?.(cwd, args) || [])]; } catch { cand = []; }
  const fromList = cand.filter(r => R.SECRET_NAME_RES.some(re => re.test(baseName(String(r).toLowerCase()))) || classifyFile(cwd + '/' + String(r).toLowerCase(), ctx).secret);
  const hits = [...named.map(x => x.orig), ...(all || force ? fromList : [])];
  if (hits.length) out.push(M('I', 'git-add-secret', `Stages secret files for a commit${force ? ' with --force (which overrides .gitignore)' : ''}: ${hits.slice(0, 4).join(', ')}. Ignore files are not trusted.`, { files: hits.slice(0, 6).map(path => ({ path, why: 'secret file' })) }));
  else if (force && !named.length && !all && args.some(a => !a.startsWith('-'))) { /* force-adding a non-secret path */ }
}

// Egress analysis of one command.
function egress(c, label, clipboardOnly, k) {
  const { ctx, state, out, upstream, ins, upIns, texts, norm, archivesOut } = k;
  const cwd = canon(ctx.cwd || '.', ctx).key, p = c.prog, a = c.args;
  const host = hostOf([...a, ...c.redirOut, ...texts]);
  const local = host && R.LOCAL_HOST.test(host) && !R.TUNNELS.has(p);
  if (local) return;
  const found = [], why = []; let exact = true;
  const addFiles = list => { for (const s of list) if (!found.some(f => f.path === s.path)) found.push({ path: s.path, why: s.by === 'content' ? `secret content (${(s.rules || []).slice(0, 2).join(', ')})` : 'secret file', sha12: s.sha12, preview: s.preview }); };
  // files named in the command, files feeding it, and files inside $( )
  for (const x of [...ins, ...upIns]) if (x.secret) addFiles([{ path: x.orig, by: x.secret.by, rules: x.secret.rules, sha12: x.secret.sha12, preview: x.secret.preview }]);
  // directories named as sources: walk them
  const srcDirs = [...a, ...c.redirIn].filter(PATHY).map(o => canon(o, ctx).key);
  const sub = a.find(x => !String(x).startsWith('-')) || '';
  const scopeCmd = p === 'git' || p === 'npm' || p === 'pnpm' || p === 'yarn' || p === 'twine' || p === 'cargo' || p === 'gem' || p === 'docker' || p === 'podman' || /^(vercel|netlify|wrangler|firebase|fly|flyctl|heroku|railway|helm)$/.test(p);
  // ---- payload by kind (ignore files are not trusted; Docker's own .dockerignore is applied for docker)
  if (p === 'git' && sub === 'push') {
    const files = ctx.git?.pushFiles ? safe(() => ctx.git.pushFiles(cwd, a)) : null;
    if (files) addFiles(secretsInContents(files, ctx, cwd)); else { exact = false; const top = safe(() => ctx.fs?.list?.(cwd)) || []; const s = top.filter(n => R.SECRET_NAME_RES.some(re => re.test(String(n).toLowerCase()))); if (s.length) { addFiles(s.map(n => ({ path: cwd + '/' + n, by: 'name', rules: ['secret-name'] }))); why.push('(estimated: the pushed files could not be listed)'); } }
  } else if ((p === 'npm' || p === 'pnpm' || p === 'yarn') && sub === 'publish') {
    const r = npmPackFiles(ctx, cwd); if (r) { addFiles(secretsIn(ctx, cwd, r.files)); exact = r.computed; } else exact = false;
  } else if ((p === 'docker' || p === 'podman') && /^(build|buildx)$/.test(sub)) {
    const d = dockerPayload(ctx, a.filter(x => !/^(build|buildx)$/.test(x)), cwd); addFiles(d.found); if (d.inlineSecrets.length) why.push('a secret passed as --build-arg'); if (!d.computed) exact = false;
    if (d.inlineSecrets.length) found.push({ path: '--build-arg', why: 'secret value' });
  } else if (/^(vercel|netlify|wrangler|firebase|fly|flyctl|heroku|railway)$/.test(p)) {
    const w = walkRoot(ctx, cwd); if (w) { addFiles(secretsIn(ctx, cwd, w.files)); exact = false; }
  } else if (p === 'twine' || p === 'cargo' || p === 'gem') {
    const w = walkRoot(ctx, cwd + '/dist'); if (w) addFiles(secretsIn(ctx, cwd + '/dist', w.files));
  } else if (/^(rsync|scp|rclone|aws|gsutil|az|azcopy|gcloud|sftp)$/.test(p) || /^rclone/.test(label)) {
    for (const o of srcDirs) { const w = walkRoot(ctx, o); if (w && w.files.length) { addFiles(secretsIn(ctx, o, w.files)); if (w.truncated) exact = false; } }
  }
  // current folder goes out with no explicit file (git add -A style scopes were handled at add time)
  if (scopeCmd && !found.length && ctx.fs?.list && /^(npm|pnpm|yarn|twine|cargo|gem)$/.test(p) === false && /^(vercel|netlify|wrangler|firebase|fly|flyctl|heroku|railway)$/.test(p)) { /* handled above */ }
  // env, inline secrets, secret-named variables, archives
  const envRefs = secretEnvRefs([...a, ...c.redirIn, c.heredoc, ...upstream.flatMap(u => u.args)]);
  const feederEnv = upstream.some(u => ENV_DUMP(u.argvFull.join(' ')));
  const inline = scanText(a.join(' ') + ' ' + c.heredoc).hit || hasSecret(a.join(' '));
  const viaArchive = [...(archivesOut || []), ...(state?.sensitiveFiles || [])].some(ar => [...a, ...c.redirIn].some(o => canon(o, ctx).key === ar)) || upstream.some(u => R.ARCHIVERS.has(u.prog) && pathArgs(u).some(o => inspect(o, ctx).secret));
  // unknown variable in a path: the payload cannot be computed
  const unknownVar = [...a].some(x => PATHY(String(x)) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(x).replace(/^@/, '')) && hasUnknownVar(String(x), ctx));
  if (envRefs.length) why.push('secret variables: ' + envRefs.slice(0, 3).join(', '));
  if (feederEnv) why.push('the environment variables');
  if (inline) why.push('what looks like a secret typed into the command');
  if (viaArchive) why.push('an archive made from sensitive files');
  if (found.length) why.unshift('secret files: ' + found.slice(0, 3).map(f => f.path).join(', '));
  const dest = host || (clipboardOnly ? 'the clipboard' : '');
  const uncDest = [...a, ...c.redirOut].map(o => String(o)).find(o => /^\\\\[^?.]|^\/\/[^/]/.test(o));
  if (found.length || envRefs.length || feederEnv || inline || viaArchive) out.push(M('S', clipboardOnly ? 'clipboard' : 'egress', clipboardOnly ? `Puts ${why.join('; ')} on the clipboard.` : `Sends data off this computer (${label}${dest ? ' to ' + dest : ''}) that includes ${why.join('; ')}.`, { host: host || (uncDest ? canon(uncDest, ctx).host : ''), files: found.slice(0, 8), exact }));
  else if (unknownVar && !clipboardOnly) out.push(M('S', 'estimated', `Sends data off this computer (${label}${dest ? ' to ' + dest : ''}) from a path that contains a variable the Guard cannot expand, so it cannot tell what is being sent.`, { host, exact: false }));
  else if (!clipboardOnly) out.push(M('S', 'egress-plain', `Sends data off this computer (${label}${dest ? ' to ' + dest : ''}); no secrets found in it.`, { host, log: true }));
}
const safe = f => { try { return f(); } catch { return null; } };

// ================================================================================== other tools
function analyzeRead(tool, input, ctx, state, out) {
  const p = input?.file_path ?? input?.notebook_path ?? input?.path ?? ''; if (!p) return;
  const x = inspect(p, ctx);
  if (x.c) out.push(M('C', 'store-read', `Reads a credential store or credential file: ${p}.`, { files: [{ path: p, why: 'credential store' }] }));
  noteReads([p], ctx, state, out);
  if (x.secret && !x.c) { /* a secret file inside the project: only S/Y/I apply (spec 6), nothing to ask here */ }
}
function analyzeSearch(tool, input, ctx, state, out) {
  const root = input?.path ?? input?.directory ?? '', pattern = String(input?.pattern ?? input?.glob ?? input?.query ?? '');
  if (root) {
    const x = inspect(root, ctx, { content: false }); if (x.c) out.push(M('C', 'store-search', `Searches a credential store: ${root}.`, { files: [{ path: root, why: 'credential store' }] }));
    const k = canon(root, ctx).key, h = homeKey(ctx), broad = k === '/' || /^[a-z]:\/?$/.test(k) || k === '/users' || k === '/home' || (h && (k === h || h.startsWith(k + '/')));
    if (broad && /(passw|secret|token|api.?key|begin .*private)/i.test(pattern)) out.push(M('H', 'recursive-hunt', `Searches ${root} and everything under it for credentials.`));
    noteReads([root], ctx, state, out);
  } else if (tool === 'Glob' && /(\.env|\*\.pem|id_rsa|\*\.kdbx|\*\.pfx|credentials)/i.test(pattern) && /^(~|\/|[a-z]:|\\)/i.test(pattern)) out.push(M('H', 'glob-hunt', `Looks for secret files across a wide area (${pattern}).`));
}
function analyzeWrite(tool, input, ctx, state, out) {
  const p = input?.file_path ?? input?.notebook_path ?? ''; if (!p) return;
  const x = inspect(p, ctx, { content: false }), key = x.keys[0];
  const edits = Array.isArray(input?.edits) ? input.edits : [{ old_string: input?.old_string, new_string: input?.new_string }];
  const content = String(input?.content ?? edits.map(e => e?.new_string ?? '').join('\n'));
  const oldText = edits.map(e => e?.old_string ?? '').join('\n');
  const sc = scanText(content);
  if (x.persist || /\.(bashrc|zshrc|profile)$/.test(key)) out.push(M('U', 'persist-path', `Writes to a place that makes things run again later (${x.persist || 'shell profile'}): ${p}.`, { files: [{ path: p, why: 'startup or profile file' }] }));
  if (x.agentCfg) out.push(M('U', 'agent-config', `Changes agent configuration (${x.agentCfg}): ${p}.`, { files: [{ path: p, why: 'agent configuration' }] }));
  if (/(^|\/)package\.json$/.test(key) && /"(preinstall|postinstall|install|prepare|prepublish)"\s*:/.test(content) && !/"(preinstall|postinstall|install|prepare|prepublish)"\s*:/.test(oldText)) out.push(M('U', 'package-script', 'Adds an install or prepare script to package.json, which runs on every install.'));
  if (/(^|\/)\.vscode\/tasks\.json$/.test(key) && /runOn"\s*:\s*"folderOpen/.test(content)) out.push(M('U', 'vscode-task', 'Adds a VS Code task that runs when the folder is opened.'));
  if (x.sync && (sc.hit || x.secret || classifyFile(key, ctx, { content: false }).secret)) out.push(M('Y', 'secret-write', `Writes secrets into a cloud-synced folder (${p}), which uploads them.`, { dest: p, files: [{ path: p, why: sc.hit ? `secret content (${sc.rules.slice(0, 2).join(', ')})` : 'secret-named file' }] }));
  if (R.IGNORE_FILES.test(key)) {
    const removed = oldText.split(/\r?\n/).filter(l => l.trim() && R.SECRET_NAME_RES.some(re => re.test(l.trim().replace(/^[!/]+|\/+$/g, '').toLowerCase()))) , negs = content.split(/\r?\n/).filter(l => /^!/.test(l.trim()) && R.SECRET_NAME_RES.some(re => re.test(l.trim().slice(1).replace(/^\/+|\/+$/g, '').toLowerCase())));
    let gone = removed.filter(l => !content.includes(l));
    if (tool === 'Write' && ctx.fs?.sample) { const prev = safe(() => ctx.fs.sample(key, 65536)); if (prev) gone = prev.split(/\r?\n/).filter(l => l.trim() && R.SECRET_NAME_RES.some(re => re.test(l.trim().replace(/^[!/]+|\/+$/g, '').toLowerCase())) && !content.split(/\r?\n/).includes(l)); }
    if (gone.length || negs.length) out.push(M('I', 'ignore-edit', `Edits an ignore file so a secret pattern is no longer ignored (${[...gone, ...negs].slice(0, 3).join(', ')}).`, { files: [{ path: p, why: 'ignore file' }] }));
  }
  if (sc.hit && !x.sync && !R.SECRET_NAME_RES.some(re => re.test(baseName(key))) && !x.secret && tool === 'Write' && !/\.(md|txt|test\.\w+|spec\.\w+)$/.test(key) === false) { /* secret content written to a plain-named file */ }
  if (sc.hit && tool === 'Write' && !R.SECRET_NAME_RES.some(re => re.test(baseName(key))) && !/\/(node_modules)\//.test(key) && /(\.(ya?ml|json|txt|conf|cfg|ini|toml|properties)|config|settings)$/.test(key) && !x.sync) out.push(M('I', 'disguised-write', `Writes secret content into a file whose name does not look secret (${p}), which hides it from ignore rules and scanners.`, { files: [{ path: p, why: `secret content (${sc.rules.slice(0, 2).join(', ')})` }] }));
}
function analyzeWeb(tool, input, ctx, out) {
  const url = String(input?.url ?? input?.query ?? '');
  let host = ''; try { host = new URL(String(input?.url ?? '')).hostname.toLowerCase(); } catch { /* WebSearch: no URL */ }
  if (host && R.LOCAL_HOST.test(host)) return;
  if (tool === 'WebFetch' && (scanText(url).hit || hasSecret(url) || /[?&](token|key|api[_-]?key|secret|password|auth|access_token|sig|signature)=[^&\s]{8,}/i.test(url) || /\/\/[^/@\s]+:[^/@\s]+@/.test(url))) out.push(M('S', 'webfetch', `Fetches a URL that carries what looks like a secret${host ? ' (to ' + host + ')' : ''}.`, { host }));
  else if (tool === 'WebSearch' && (scanText(url).hit || hasSecret(url))) out.push(M('S', 'websearch', 'Searches the web for text that contains what looks like a secret.', {}));
  else if (tool === 'WebFetch' && /[?&][\w-]+=[A-Za-z0-9+/=_-]{60,}/.test(url)) out.push(M('S', 'webfetch-blob', `Fetches a URL with a long encoded payload in it${host ? ' (to ' + host + ')' : ''}, a way to leak data.`, { host }));
}
function analyzeMcp(tool, input, ctx, out) {
  let raw = ''; try { raw = JSON.stringify(input ?? {}); } catch { raw = ''; }
  const last = tool.split('__').pop(), outbound = R.OUTBOUND_MCP.test(tool) || R.BROWSER_UPLOAD.test(tool) || R.BROWSER_UPLOAD.test(raw);
  const secrets = [], files = [];
  if (scanText(raw).hit || hasSecret(raw)) secrets.push('text that looks like a secret');
  for (const m of raw.matchAll(/"((?:[A-Za-z]:)?(?:\\\\|[\\/])[^"]{2,240}|~(?:\\\\|[\\/])[^"]{1,240})"/g)) { let v = m[1]; try { v = JSON.parse('"' + m[1] + '"'); } catch { /* keep */ } const x = inspect(v, ctx); if (x.secret || x.c) { secrets.push('the file ' + v); files.push({ path: v, why: 'secret file' }); } }
  if ((outbound || !R.READ_ONLY_MCP.test(last)) && secrets.length) out.push(M('S', 'mcp', `Sends ${secrets.slice(0, 2).join(' and ')} through the tool ${last}.`, { files }));
  return outbound;
}

// ================================================================================== entry point
export function classify(tool, input, ctx = {}, state = null) {
  const cfg = ctx.config || {}, res = { level: 'none', matches: [], cats: [], rules: [], reasons: [], files: [], host: '', exact: true, remembered: false, rememberKey: '', rememberable: false, tainted: false };
  const matches = [];
  tool = String(tool ?? '');
  let mcpOutbound = false, shellInfo = null;
  try {
    if (tool === 'Bash' || tool === 'PowerShell') shellInfo = analyzeShell(tool, input?.command, ctx, state, matches);
    else if (tool === 'Read' || tool === 'NotebookRead') analyzeRead(tool, input, ctx, state, matches);
    else if (tool === 'Grep' || tool === 'Glob' || tool === 'LS') analyzeSearch(tool, input, ctx, state, matches);
    else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) analyzeWrite(tool, input, ctx, state, matches);
    else if (tool === 'WebFetch' || tool === 'WebSearch') analyzeWeb(tool, input, ctx, matches);
    else if (tool.startsWith('mcp__')) mcpOutbound = analyzeMcp(tool, input, ctx, matches);
  } catch (e) { res.error = String(e && e.message || e); }
  // P: while the session is tainted, things that send, run, spawn or write outside the project are asked about
  const now = ctx.now ? ctx.now() : Date.now();
  if (state && isTainted(state.taint, now)) {
    const wrote = /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) && (() => { const k = canon(input?.file_path ?? input?.notebook_path ?? '.', ctx).key; return outsideProject(k, ctx); })();
    const sends = matches.some(m => m.cat === 'S') || matches.some(m => m.cat === 'U');
    const hire = tool === 'Agent' || tool === 'Task' || /request_hire$/.test(tool);
    const mcpOut = tool.startsWith('mcp__') && (mcpOutbound || (!R.READ_ONLY_MCP.test(tool.split('__').pop()) && !/^mcp__office__/.test(tool)));
    if (sends || wrote || hire || mcpOut || tool === 'WebFetch') matches.push(M('P', 'tainted', `The session read untrusted instructions from ${state.taint.source}${state.taint.snippet ? ' ("' + state.taint.snippet + '")' : ''}. Check that this action is what you asked for.`, { source: state.taint.source }));
  }
  const active = matches.filter(m => (cfg[m.cat] || 'ask') !== 'off');
  if (!active.length) return res;
  const asks = active.filter(m => !m.log && (cfg[m.cat] || 'ask') === 'ask');
  res.level = asks.length ? 'ask' : 'log';
  const use = asks.length ? asks : active;
  res.matches = use; res.cats = [...new Set(use.map(m => m.cat))].sort((x, y) => R.SEVERITY[x] - R.SEVERITY[y]); res.rules = [...new Set(use.map(m => m.rule))]; res.reasons = [...new Set(use.map(m => m.reason))];
  res.host = use.find(m => m.host)?.host || ''; res.exact = use.every(m => m.exact !== false);
  const seen = new Set(); res.files = use.flatMap(m => m.files || []).filter(f => !seen.has(f.path) && seen.add(f.path)).slice(0, 8);
  res.tainted = res.cats.includes('P');
  res.rememberable = res.level === 'ask' && !res.cats.some(c => R.NEVER_REMEMBER.has(c)) && !(state && isTainted(state.taint, now));
  const commandHash = tool === 'Bash' || tool === 'PowerShell' ? sha(String(input?.command ?? '').trim()) : sha(JSON.stringify([input?.file_path, input?.url]));
  const fileHashes = res.files.map(f => { const k = canon(f.path, ctx).key; return k + ':' + (f.sha12 || safe(() => { const t = ctx.fs?.sample?.(k, 262144); return t != null ? sha256(t).slice(0, 12) : ''; }) || ''); }).sort();
  res.rememberKey = res.level === 'ask' ? sha([res.cats.join(''), res.rules.slice().sort().join(','), tool, fileHashes.join(';'), res.host, commandHash].join('|')) : '';
  if (res.rememberable) { const hit = (ctx.remembered || []).find(r => r.key === res.rememberKey && (res.cats.includes('U') || now - (r.at || 0) < R.REMEMBER_TTL_MS)); if (hit) { res.level = 'none'; res.remembered = true; } }
  void shellInfo; void maskText; void expandVars; void progName;
  return res;
}
