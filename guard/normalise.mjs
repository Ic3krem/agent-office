// Security Guard: normalisation. Everything a rule looks at passes through here first: text (NFKC, hidden characters, shell obfuscation),
// paths from every OS (Windows, WSL, Git Bash, Cygwin, UNC, \\?\ prefixes, ~ and %VAR% expansion, 8.3 names, symlinks and junctions) and
// shell command lines (quotes, pipes, && || ;, $( ), backticks, bash -c, powershell -EncodedCommand ...). Pure functions; the file system is
// only reached through the optional ctx.fs object, so every OS spelling can be tested on any host.
import path from 'node:path';

// ---------------------------------------------------------------- text
const HIDDEN = /[\u{E0000}-\u{E007F}\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u180E]/gu;
// NFKC (also folds full-width ASCII), hidden characters removed (the count is reported so the taint rules can see it).
export function normText(s) {
  const raw = String(s ?? '');
  let hidden = 0;
  const text = raw.normalize('NFKC').replace(HIDDEN, () => { hidden++; return ''; });
  return { text, hidden };
}
// Undo the usual shell obfuscations: cmd carets (c^url), PowerShell backticks (i`ex), ANSI-C quoting ($'\x63url'), and adjacent quotes
// ('cu''rl', "cu"rl). Returns { text, changed }. A rule that only matches after this is reported as U.obfuscated.
export function unshell(s) {
  let t = String(s ?? '');
  const orig = t;
  t = t.replace(/\$'((?:[^'\\]|\\.)*)'/g, (_m, body) => body.replace(/\\x([0-9a-fA-F]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\([0-7]{1,3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1'));
  t = t.replace(/\^(?=[A-Za-z0-9])/g, '');                              // cmd carets
  t = t.replace(/`(?=[A-Za-z])/g, '');                                  // PowerShell backticks before letters
  t = t.replace(/(["'])\1(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(["'])\2/g, ''); // cu''rl, cu""rl
  t = t.replace(/(?<=[A-Za-z0-9])['"]([A-Za-z0-9]+)['"](?=[A-Za-z0-9])/g, '$1');
  t = t.replace(/(?<=[A-Za-z0-9])["']\s*["'](?=[A-Za-z])/g, '');
  return { text: t, changed: t !== orig };
}
// -EncodedCommand payloads are UTF-16LE base64: decode so the hidden command can be scanned too.
export function decodeEncodedCommands(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(/\s-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\s+["']?([A-Za-z0-9+/=]{8,})["']?/gi)) {
    try { const t = Buffer.from(m[1], 'base64').toString('utf16le'); if (/^[\x09\x0a\x0d\x20-\x7e]{3,}$/.test(t.replace(/\u0000/g, ''))) out.push(t); } catch { /* not base64 */ }
  }
  return out;
}

// ---------------------------------------------------------------- paths
const ENV_RE = /%(userprofile|home|homepath|appdata|localappdata|temp|tmp|programdata|systemroot|windir|onedrive|onedrivecommercial|onedriveconsumer|programfiles|programfiles\(x86\)|public)%|\$\{?env:(userprofile|home|appdata|localappdata|temp|tmp|programdata|systemroot|windir|onedrive|onedrivecommercial|onedriveconsumer)\}?|\$\{?(home|userprofile|xdg_config_home|xdg_data_home|tmpdir|tmp|temp|onedrive)\}?/gi;
export function expandVars(s, ctx = {}) {
  const home = String(ctx.home || '').replace(/\\+/g, '/').replace(/\/$/, '');
  const env = ctx.env || {};
  const e = n => { const v = env[n] ?? env[n.toUpperCase()] ?? env[Object.keys(env).find(k => k.toLowerCase() === n)]; return v ? String(v).replace(/\\+/g, '/') : ''; };
  const table = { userprofile: home, home, homepath: home, appdata: e('appdata') || home + '/AppData/Roaming', localappdata: e('localappdata') || home + '/AppData/Local', temp: e('temp') || home + '/AppData/Local/Temp', tmp: e('tmp') || home + '/AppData/Local/Temp', tmpdir: e('tmpdir') || '/tmp',
    programdata: e('programdata') || 'C:/ProgramData', systemroot: 'C:/Windows', windir: 'C:/Windows', xdg_config_home: e('xdg_config_home') || home + '/.config', xdg_data_home: e('xdg_data_home') || home + '/.local/share',
    onedrive: e('onedrive') || home + '/OneDrive', onedrivecommercial: e('onedrivecommercial') || home + '/OneDrive', onedriveconsumer: e('onedriveconsumer') || home + '/OneDrive', public: 'C:/Users/Public', 'programfiles': 'C:/Program Files', 'programfiles(x86)': 'C:/Program Files (x86)' };
  let out = String(s ?? '');
  if (home && /^~(?=[\\/]|$)/.test(out)) out = home + out.slice(1);
  return out.replace(ENV_RE, (m, a, b, c) => table[String(a || b || c).toLowerCase()] ?? m);
}
// A path still holding a variable we cannot expand (used by egress/archive rules: the payload cannot be computed, so the Guard asks 'estimated').
export const hasUnknownVar = (s, ctx = {}) => /\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%|\$env:\w+/i.test(expandVars(s, ctx));

// Canonical form for every comparison: forward slashes, no \\?\ prefix, ., .. resolved, Git Bash (/c/..), Cygwin (/cygdrive/c/..) and WSL
// (/mnt/c/.., \\wsl$\distro\..) mapped to the Windows form, NTFS ':stream' suffix dropped, lower case on Windows and macOS.
// Returns { key, unc, host, wild }.
export function canon(p, ctx = {}) {
  let s = expandVars(String(p ?? '').trim().replace(/^["']|["']$/g, ''), ctx);
  s = s.replace(/^\\\\[?.]\\(?=[A-Za-z]:)/, '').replace(/^\\\\\?\\UNC\\/i, '\\\\');
  // a leading \\ (or JSON-doubled \\\\) is a UNC share; everywhere else runs of backslashes (JSON.stringify doubles them) are one separator
  { const lead = /^\\+/.exec(s); if (lead && (lead[0].length === 2 || lead[0].length === 4)) s = '//' + s.slice(lead[0].length); }
  s = s.replace(/\\+/g, '/').replace(/\/{3,}/g, '//');
  let unc = false, host = '', m;
  if ((m = /^\/\/(wsl\$|wsl\.localhost)\/([^/]+)(\/.*)?$/i.exec(s))) s = m[3] || '/';
  else if ((m = /^\/\/([^/]+)\/?(.*)$/.exec(s))) { unc = true; host = m[1].toLowerCase(); }
  if ((m = /^\/(?:mnt|cygdrive)\/([a-zA-Z])(\/.*)?$/.exec(s))) s = m[1] + ':' + (m[2] || '/');
  else if ((m = /^\/([a-zA-Z])(\/.*)?$/.exec(s)) && (ctx.os === 'win32' || /^\/[a-zA-Z]\/(users|windows|program|projects?|temp)\b/i.test(s))) s = m[1] + ':' + (m[2] || '/');
  s = s.replace(/^([a-zA-Z]:[^:]*?):[^/:]+$/, '$1');                      // alternate data stream: file.txt:secret is file.txt
  const drive = /^[a-zA-Z]:/.test(s) ? s.slice(0, 2).toLowerCase() : '';
  let rest = drive ? s.slice(2) : s;
  const abs = rest.startsWith('/') || unc;
  if (!abs) { const base = canon(ctx.cwd || ctx.home || '/', { ...ctx, cwd: undefined }); return canon(base.key.replace(/\/$/, '') + '/' + rest, { ...ctx, cwd: undefined }); }
  let key = unc ? '//' + path.posix.normalize(s.replace(/^\/\//, '/')).replace(/^\//, '') : drive + path.posix.normalize(rest || '/');
  key = key.length > 1 ? key.replace(/\/$/, '') : key;
  const lower = ctx.os === 'linux' ? false : true;                           // Windows and macOS file systems ignore case
  key = lower ? key.toLowerCase() : key;
  // 8.3 short names (JOHNSM~1): resolve against the home folder name, otherwise treat as a wildcard
  let wild = false;
  if (/\/[^/~]{1,6}~\d(\/|$)/.test(key)) {
    const homeName = ctx.home ? String(ctx.home).replace(/\\+/g, '/').replace(/\/$/, '').split('/').pop().toLowerCase() : '';
    key = key.replace(/\/([^/~]{1,6})~\d(?=\/|$)/g, (mm, pre) => { if (homeName && homeName.startsWith(pre.toLowerCase())) return '/' + homeName; wild = true; return mm; });
  }
  if (!unc && ctx.remoteDrives && /^[a-z]:\//i.test(key) && drivesHas(ctx.remoteDrives, key[0])) { unc = true; host = host || 'network drive ' + key[0].toUpperCase() + ':'; }   // R1: mapped network drive / DFS
  return { key, unc, host, wild };
}
const drivesHas = (set, letter) => { const l = String(letter).toLowerCase(); return set instanceof Set ? set.has(l) || set.has(l.toUpperCase()) : Array.isArray(set) && set.some(x => String(x).toLowerCase() === l); };
// true for UNC keys and for keys on a network drive: nothing may probe the file system there (it can hang for seconds)
export const isRemoteKey = (key, ctx = {}) => String(key).startsWith('//') || (!!ctx.remoteDrives && /^[a-z]:\//i.test(String(key)) && drivesHas(ctx.remoteDrives, String(key)[0]));
// requested path plus its symlink / junction / subst target when it can be resolved
export function pathKeys(p, ctx = {}) {
  const c = canon(p, ctx), keys = [c.key];
  if (c.unc || isRemoteKey(c.key, ctx)) return { keys, unc: c.unc, host: c.host, wild: c.wild };   // B3: never touch the network
  try {
    const real = ctx.fs?.realpath?.(c.key, expandVars(String(p), ctx));
    if (real) { const k = canon(real, ctx).key; if (!keys.includes(k)) keys.push(k); }
  } catch { /* cannot resolve: the requested path still counts */ }
  return { keys, unc: c.unc, host: c.host, wild: c.wild };
}
export const baseName = key => key.slice(key.lastIndexOf('/') + 1);
export const within = (key, dir) => key === dir || key.startsWith(dir.replace(/\/$/, '') + '/');
export const homeKey = ctx => (ctx.home ? canon(ctx.home, ctx).key : '');

// ---------------------------------------------------------------- shell tokenizer
// Splits Bash or PowerShell into simple commands: quotes, escapes, pipes, && || ;, background &, subshells, $( ), backticks, <( ), here-strings,
// heredocs and redirections. Each command: { argv, redirOut, redirIn, sep, subs, heredoc, pipeFromCmd }.
function newCmd() { return { argv: [], redirOut: [], redirIn: [], sep: ';', subs: [], heredoc: '', pipeFromCmd: null }; }
function matchClose(str, i, open, close) {
  let depth = 1, q = '';
  for (; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c; else if (c === open) depth++; else if (c === close && --depth === 0) return i;
  }
  return str.length;
}
export function scanShell(str, { ps = false } = {}, depth = 0) {
  const S = String(str ?? ''), cmds = []; let cur = newCmd(), word = '', has = false, redir = null, i = 0, prevIdx = -1;
  const flush = () => { if (!has) return; if (redir) { (redir === '<' ? cur.redirIn : cur.redirOut).push(word); redir = null; } else if (!(ps && cur.argv.length === 0 && word === '&')) cur.argv.push(word); word = ''; has = false; };
  const end = sep => { flush(); redir = null; const keep = cur.argv.length || cur.subs.length || cur.redirOut.length; if (keep) { cmds.push(cur); prevIdx = cmds.length - 1; } const wasPipe = sep === '|' && keep; cur = newCmd(); cur.sep = sep; if (wasPipe) cur.pipeFromCmd = cmds[prevIdx]; else if (sep === '|' && prevIdx >= 0) cur.pipeFromCmd = cmds[prevIdx]; };
  const sub = inner => { if (depth < 4) for (const c of scanShell(inner, { ps }, depth + 1)) cur.subs.push(c); word += '$(sub)'; has = true; };
  while (i < S.length) {
    const c = S[i], n = S[i + 1];
    if (c === "'") { let j = i + 1; while (j < S.length && !(S[j] === "'" && !(ps && S[j + 1] === "'"))) { if (ps && S[j] === "'" && S[j + 1] === "'") j++; j++; } word += S.slice(i + 1, j).replace(ps ? /''/g : /(?!)/g, "'"); has = true; i = j + 1; continue; }
    if (c === '"') {
      let j = i + 1, buf = '';
      while (j < S.length && S[j] !== '"') {
        if ((!ps && S[j] === '\\') || (ps && S[j] === '`')) { buf += S[j + 1] ?? ''; j += 2; continue; }
        if (ps && S[j] === '"' && S[j + 1] === '"') { buf += '"'; j += 2; continue; }
        if (S[j] === '$' && S[j + 1] === '(') { const e = matchClose(S, j + 2, '(', ')'); sub(S.slice(j + 2, e)); j = e + 1; continue; }
        if (!ps && S[j] === '`') { const e = S.indexOf('`', j + 1), en = e < 0 ? S.length : e; sub(S.slice(j + 1, en)); j = en + 1; continue; }
        buf += S[j++];
      }
      word += buf; has = true; i = j + 1; continue;
    }
    if (ps && c === '@' && (n === "'" || n === '"') && /^\r?\n/.test(S.slice(i + 2))) { const e = S.indexOf('\n' + n + '@', i + 2); word += '<here-string>'; has = true; i = e < 0 ? S.length : e + 3; continue; }
    if (!ps && c === '\\') { if (n === '\n') { i += 2; continue; } word += n ?? ''; has = true; i += 2; continue; }
    if (ps && c === '`') { if (n === '\n' || n === '\r') { i += 2; continue; } word += n ?? ''; has = true; i += 2; continue; }
    if (c === '$' && n === '(') { const e = matchClose(S, i + 2, '(', ')'); sub(S.slice(i + 2, e)); i = e + 1; continue; }
    if ((c === '<' || c === '>') && n === '(') { const e = matchClose(S, i + 2, '(', ')'); sub(S.slice(i + 2, e)); i = e + 1; continue; }
    if (!ps && c === '`') { const e = S.indexOf('`', i + 1), en = e < 0 ? S.length : e; sub(S.slice(i + 1, en)); i = en + 1; continue; }
    if (c === '#' && !has && (i === 0 || /[\s;|&(]/.test(S[i - 1]))) { while (i < S.length && S[i] !== '\n') i++; continue; }
    if (ps && c === '<' && n === '#') { const e = S.indexOf('#>', i + 2); i = e < 0 ? S.length : e + 2; continue; }
    if (!ps && c === '<' && n === '<' && S[i + 2] !== '<') {
      let j = i + 2; if (S[j] === '-') j++; while (S[j] === ' ') j++;
      const mm = /^(['"]?)([\w.-]+)\1/.exec(S.slice(j)), marker = mm ? mm[2] : ''; flush();
      const eol = S.indexOf('\n', j + (mm ? mm[0].length : 0)), after = eol < 0 ? S.length : eol + 1;
      const endRe = new RegExp('(^|\\n)[ \\t]*' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*(\\n|$)');
      const body = S.slice(after), em = marker ? endRe.exec(body) : null;
      cur.heredoc = em ? body.slice(0, em.index) : body;
      const restLine = S.slice(j + (mm ? mm[0].length : 0), eol < 0 ? S.length : eol), tail = S.slice(after + (em ? em.index + em[0].length : body.length));
      end(';'); for (const r of scanShell(restLine + '\n' + tail, { ps }, depth + 1)) cmds.push(r);
      return cmds;
    }
    if (!ps && c === '<' && n === '<' && S[i + 2] === '<') { flush(); redir = '<'; i += 3; continue; }   // here-string: the next word is stdin text, kept with this command
    if (c === '&' && n === '&') { end('&&'); i += 2; continue; }
    if (c === '|' && n === '|') { end('||'); i += 2; continue; }
    if (c === '|') { end('|'); i += n === '&' ? 2 : 1; continue; }
    if (c === ';' || c === '\n' || c === '\r') { end(';'); i++; continue; }
    if (c === '&') { if (ps && !has && cur.argv.length === 0) { i++; continue; } if (n === '>') { flush(); redir = '>'; i += S[i + 2] === '>' ? 3 : 2; continue; } end(';'); i++; continue; }
    if (c === '(' || c === ')') { if (!has) end(';'); else word += c; i++; continue; }
    if (c === '>' || c === '<') {
      if (has && /^\d{1,2}$/.test(word)) { word = ''; has = false; } else flush();
      redir = c === '<' ? '<' : '>'; i++; if (c === '>' && S[i] === '>') i++;
      if (c === '>' && S[i] === '&' && /[\d-]/.test(S[i + 1] || '')) { redir = null; i += 2; }
      continue;
    }
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    word += c; has = true; i++;
  }
  end(';');
  return cmds;
}

const WRAPPERS = new Set(['sudo', 'doas', 'nohup', 'time', 'command', 'builtin', 'exec', 'nice', 'ionice', 'setsid', 'stdbuf', 'env', 'timeout', 'start', 'call', 'unbuffer', 'caffeinate', 'runas', 'busybox', 'proxychains', 'torsocks']);
// wrapper options that take a separate value (so the value is not mistaken for the program)
const ARGOPT = { sudo: /^-[ughpCTrtU]$/, doas: /^-[ughpCTrtU]$/, ionice: /^-[cnpPt]$/, time: /^-[fo]$/, timeout: /^(-s|-k|--signal|--kill-after)$/, env: /^-[uCS]$/ };
const PLACEHOLDER = /\{[^{}\s]*\}/g;
// Tools that run another command once per input: xargs, find -exec/-execdir/-ok/-okdir, parallel (watch re-runs a shell string).
// Each inner command is returned as its own segment; templ says where the {} values come from (resolved later, with the file system, by the classifier).
function unwrapTool(c) {
  const a = c.args.map(String), p = c.prog;
  if (p === 'xargs') {
    let i = 0, repl = null, argFile = null;
    for (; i < a.length; i++) {
      const t = a[i]; if (t === '--') { i++; break; } if (!t.startsWith('-') || t === '-') break;
      if (/^-I./.test(t)) { repl = t.slice(2); continue; } if (t === '-I') { repl = a[++i]; continue; } if (t === '-i') { repl = '{}'; continue; } if (/^-i./.test(t)) { repl = t.slice(2); continue; }
      if (/^--replace(=.*)?$/.test(t)) { repl = t.includes('=') ? t.split('=')[1] : '{}'; continue; }
      if (t === '-a' || t === '--arg-file') { argFile = a[++i]; continue; } if (/^--arg-file=/.test(t)) { argFile = t.split('=')[1]; continue; }
      if (/^-[dEnLPsl]$/.test(t) || /^--(delimiter|eof|max-lines|max-args|max-procs|max-chars)$/.test(t)) i++;
    }
    let cmd = a.slice(i); if (!cmd.length) cmd = ['echo'];
    const ph = repl || '{}';
    return { inner: [{ argv: repl ? cmd : [...cmd, ph], keepPipe: true, templ: { ph, kind: 'xargs', argFile } }] };
  }
  if (p === 'find') {
    const roots = []; let i = 0; while (i < a.length && !/^[-(!]/.test(a[i])) roots.push(a[i++]);
    const names = [], inner = [];
    for (let j = i; j < a.length; j++) {
      const t = a[j];
      if (/^-(name|iname|path|ipath|wholename|regex)$/.test(t) && a[j + 1] != null) { names.push(a[j + 1]); j++; continue; }
      if (/^-(exec|execdir|ok|okdir)$/.test(t)) { const cmd = []; j++; while (j < a.length && a[j] !== ';' && a[j] !== '\\;' && a[j] !== '+') cmd.push(a[j++]); if (cmd.length) inner.push({ argv: cmd, keepPipe: false, templ: { ph: '{}', kind: 'find', roots: roots.length ? roots : ['.'], names } }); }
    }
    return { inner };
  }
  if (p === 'parallel') {
    let i = 0, argFile = null;
    for (; i < a.length; i++) {
      const t = a[i]; if (t === ':::' || t === '::::' || t === '--' || !t.startsWith('-')) break;
      if (/^--arg-file=/.test(t)) argFile = t.split('=')[1];
      if (/^(-j|-n|-N|-P|-S|-a|-d|-L|-X|-I|--jobs|--arg-file|--sshlogin|--delimiter|--colsep|--max-args|--max-lines|--results|--joblog|--retries|--timeout)$/.test(t)) { if (t === '-a' || t === '--arg-file') argFile = a[i + 1]; i++; }
    }
    let cmd = []; while (i < a.length && a[i] !== ':::' && a[i] !== '::::') cmd.push(a[i++]);
    const values = [], files = []; let mode = null;
    for (; i < a.length; i++) { if (a[i] === ':::') { mode = 'v'; continue; } if (a[i] === '::::') { mode = 'f'; continue; } (mode === 'f' ? files : values).push(a[i]); }
    if (argFile) files.push(argFile);
    if (cmd.length === 1 && /\s/.test(cmd[0])) cmd = scanShell(cmd[0])[0]?.argv || cmd;
    if (!cmd.length) return null;
    const hasPh = cmd.some(x => /\{[^{}\s]*\}/.test(x));
    return { inner: [{ argv: hasPh ? cmd : [...cmd, '{}'], keepPipe: true, templ: { ph: '{}', pat: PLACEHOLDER, kind: 'parallel', values, files } }] };
  }
  if (p === 'watch') {
    let i = 0; for (; i < a.length; i++) { const t = a[i]; if (t === '--') { i++; break; } if (!t.startsWith('-')) break; if (/^(-n|--interval)$/.test(t)) i++; }
    const rest = a.slice(i); return rest.length ? { shell: rest.join(' ') } : null;
  }
  return null;
}
export const progName = tok => String(tok ?? '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1|com|sh|bash)$/i, '').toLowerCase();

// Flatten to every simple command (including $( ), and command strings given to bash -c, sh -c, cmd /c, powershell -c, wsl ..., eval and
// decoded -EncodedCommand). Each gets prog, args, argvFull, depth, inlineCode.
export function parseShell(command, { ps = false } = {}) {
  const out = [];
  const visit = (cmds, depth) => {
    for (const c0 of cmds) {
      const c = c0; let argv = c.argv.slice();   // derived fields are set on the scanned command itself, so pipes and $( ) children see them too
      while (argv.length && /^[A-Za-z_]\w*=/.test(argv[0])) argv.shift();
      let g = 0;
      while (argv.length && WRAPPERS.has(progName(argv[0])) && g++ < 4) {
        const w = progName(argv[0]); argv.shift();
        if (w === 'env') while (argv.length && (/^[A-Za-z_]\w*=/.test(argv[0]) || /^-/.test(argv[0]))) { const o = argv.shift(); if (ARGOPT.env.test(o)) argv.shift(); }
        else if (w === 'timeout' || w === 'nice') { while (argv.length && /^-/.test(argv[0])) { const o = argv.shift(); if (ARGOPT[w]?.test(o) || (w === 'nice' && o === '-n')) argv.shift(); } if (argv.length && /^[\d.]+[smhd]?$/.test(argv[0])) argv.shift(); }
        else if (w !== 'start') while (argv.length && /^-[-\w]*$/.test(argv[0])) { const o = argv.shift(); if (ARGOPT[w]?.test(o)) argv.shift(); }
        while (argv.length && /^[A-Za-z_]\w*=/.test(argv[0])) argv.shift();
      }
      c.prog = progName(argv[0]); c.args = argv.slice(1); c.argvFull = argv; c.depth = depth; c.inlineCode = '';
      out.push(c);
      for (const s of c.subs || []) visit([s], depth + 1);
      const inner = [], p = c.prog;
      if (/^(bash|sh|zsh|dash|ksh|fish)$/.test(p)) { const k = argv.findIndex((a, j) => j > 0 && /^-[a-z]*c[a-z]*$/.test(a)); if (k > 0 && argv[k + 1] != null) inner.push([argv[k + 1], false]); }
      else if (/^(powershell|pwsh)$/.test(p)) {
        const k = argv.findIndex((a, j) => j > 0 && /^-(c|command)$/i.test(a)); if (k > 0) inner.push([argv.slice(k + 1).join(' '), true]);
        for (const dec of decodeEncodedCommands(' ' + argv.slice(1).join(' '))) inner.push([dec, true]);
      }
      else if (p === 'cmd') { const k = argv.findIndex((a, j) => j > 0 && /^\/[ck]$/i.test(a)); if (k > 0) inner.push([argv.slice(k + 1).join(' '), false]); }
      else if (p === 'wsl') { const rest = argv.slice(1).filter(a => !/^-(d|u|-distribution|-user|e|-exec|-)$/.test(a)); if (rest.length) inner.push([rest.join(' '), false]); }
      else if (p === 'eval' && argv[1]) inner.push([argv.slice(1).join(' '), ps]);
      else if (/^(python[\d.]*|py|node|nodejs|deno|bun|perl|ruby|php)$/.test(p)) { const k = argv.findIndex((a, j) => j > 0 && /^(-c|-e|--eval|-r|-p)$/.test(a)); c.inlineCode = k > 0 ? argv.slice(k + 1).join(' ') : ''; }
      const tw = unwrapTool(c);
      if (tw?.shell) inner.push([tw.shell, false]);
      if (tw?.inner && depth < 3) for (const w of tw.inner) visit([{ argv: w.argv, redirOut: c.redirOut, redirIn: [], sep: ';', subs: [], heredoc: '', pipeFromCmd: w.keepPipe ? c.pipeFromCmd : null, templ: w.templ }], depth + 1);
      if (depth < 3) for (const [txt, isPs] of inner) visit(scanShell(txt, { ps: isPs }), depth + 1);
    }
  };
  visit(scanShell(String(command ?? '').slice(0, 60000), { ps }), 0);
  return out;
}
