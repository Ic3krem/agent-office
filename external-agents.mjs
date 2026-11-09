// External specialists: which agent CLIs are on this PC, the exact argv for a headless run, and reading their answer.
// Pure apart from small filesystem checks. Provider flags follow Dev-Labs' provider table and the PATH approach follows its
// shellEnv (MIT, github.com/jeffreycayao/Dev-Labs; see THIRD_PARTY_NOTICES.md). Nothing here ever uses a shell to run a prompt.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// promptVia 'stdin': the prompt is piped (never on the command line); 'arg': one argv element, safe because no shell is used.
// Codex: -a/--ask-for-approval is a global flag (not in the `codex exec` flag table), so Auto args go before `exec` (autoFirst).
// Gemini: with stdin piped and no -p, gemini-cli runs headless and takes stdin as the prompt.
export const PROVIDERS = {
  codex: { bin: 'codex', label: 'Codex CLI', baseArgs: ['exec', '--json', '--skip-git-repo-check'], autoArgs: ['-a', 'never', '-s', 'workspace-write'], autoFirst: true,
    modelFlag: '--model', promptVia: 'stdin', stdinArg: '-', parse: 'codex-jsonl', configHint: '~/.codex/config.toml', install: 'npm install -g @openai/codex' },
  gemini: { bin: 'gemini', label: 'Gemini CLI', baseArgs: ['--output-format', 'json'], autoArgs: ['--approval-mode=yolo'],
    modelFlag: '--model', promptVia: 'stdin', parse: 'gemini-json', configHint: '~/.gemini/settings.json', install: 'npm install -g @google/gemini-cli' },
  opencode: { bin: 'opencode', label: 'OpenCode', baseArgs: ['run'], autoArgs: [],
    modelFlag: '--model', promptVia: 'arg', parse: 'text', configHint: '~/.config/opencode/', install: 'npm install -g opencode-ai@latest' },
};
export const CUSTOM = { label: 'Custom command', parse: 'text', configHint: 'whatever that command reads' };
export const providerOf = cli => PROVIDERS[cli] || (cli === 'custom' ? CUSTOM : null);

const MODEL_RE = /^[\w.:\/@-]{1,80}$/;
export const isModel = m => MODEL_RE.test(m) && !m.startsWith('-');

// Shell-like split without a shell: "double" and 'single' quotes group, a backslash escapes only a quote. Throws on an open quote.
export function splitArgs(str) {
  const out = []; let cur = '', has = false, q = null;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === "'") && q !== "'") { cur += s[++i]; has = true; continue; }
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (q) throw new Error('Unbalanced quote in the command line');
  if (has) out.push(cur);
  return out;
}

// The user's PATH plus the folders CLIs usually install to. POSIX: the interactive login shell's PATH (fenced, cached), as Dev-Labs does.
let posixPath = null;
function loginShellPath(env) {
  if (posixPath !== null) return posixPath;
  const mark = '__TIRO_PATH__';
  try {
    const r = spawnSync(env.SHELL || '/bin/sh', ['-ilc', `printf %s ${mark}; printf %s "$PATH"; printf %s ${mark}`], { encoding: 'utf8', timeout: 3000 });
    const out = r.stdout || '', a = out.indexOf(mark), b = out.lastIndexOf(mark);
    const p = a >= 0 && b > a ? out.slice(a + mark.length, b).trim() : '';
    posixPath = p && !p.includes('\n') ? p : (env.PATH || '');
  } catch { posixPath = env.PATH || ''; }
  return posixPath;
}
export function shellPath(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const home = env.USERPROFILE || env.HOME || '';
    const extra = [env.APPDATA && env.APPDATA + '\\npm', env.LOCALAPPDATA && env.LOCALAPPDATA + '\\Programs', home && home + '\\.bun\\bin', home && home + '\\.local\\bin', home && home + '\\scoop\\shims'];
    return [env.PATH || env.Path || '', ...extra].filter(Boolean).join(';');
  }
  const home = env.HOME || '';
  return [loginShellPath(env), '/opt/homebrew/bin', '/usr/local/bin', home && home + '/.local/bin', home && home + '/.volta/bin', home && home + '/.bun/bin'].filter(Boolean).join(':');
}

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isExec = f => { try { fs.accessSync(f, fs.constants.X_OK); return isFile(f); } catch { return false; } };
// A plain command name on PATH. Windows tries .exe, .cmd, .bat (a .ps1 would need PowerShell, so it is ignored).
export function which(bin, pathStr, platform = process.platform) {
  if (!/^[A-Za-z0-9._+-]+$/.test(String(bin)) || bin === '.' || bin === '..') return null;
  const win = platform === 'win32';
  for (const dir of String(pathStr || '').split(win ? ';' : ':').filter(Boolean)) {
    if (win) { for (const ext of ['.exe', '.cmd', '.bat']) { const f = path.win32.join(dir, bin + ext); if (isFile(f)) return f; } }
    else { const f = path.posix.join(dir, bin); if (isExec(f)) return f; }
  }
  return null;
}

// How to start a found CLI without cmd.exe: an npm .cmd shim becomes node + its entry script; anything else runs as is.
// null = a .cmd/.bat we do not recognise (running it would need cmd.exe, which would parse the prompt).
export function resolveLaunch(file, platform = process.platform, readFile = fs.readFileSync, pathStr = shellPath(process.env, platform)) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { cmd: file, pre: [] };
  let text; try { text = String(readFile(file, 'utf8')); } catch { return null; }
  const m = /"%~?dp0%?\\?([^"%]+\.(?:[cm]?js|exe))"\s+%\*/i.exec(text);
  if (!m) return null;
  const dir = path.win32.dirname(file), entry = path.win32.join(dir, m[1]);
  if (/\.exe$/i.test(entry)) return { cmd: entry, pre: [] }; // a native binary behind the shim (opencode-ai)
  const local = path.win32.join(dir, 'node.exe');
  const node = isFile(local) ? local : which('node', pathStr, 'win32');
  return node ? { cmd: node, pre: [entry] } : null;
}

// The argv for one run. launch = resolveLaunch(...) for the CLI (for Custom: for the command's first word).
// Order: launch.pre, base args, model, auto args (Codex: before exec), extra args, then the prompt (arg) or '-' (stdin marker).
export function buildCommand(cli, { prompt = '', model = '', auto = false, extraArgs = '', command = '' } = {}, launch) {
  if (model && !isModel(model)) throw new Error('Invalid model name');
  const extra = splitArgs(extraArgs);
  if (cli === 'custom') {
    const words = splitArgs(command);
    if (!words.length) throw new Error('This desk has no confirmed command; set it in the Agents panel.');
    let used = false;
    const rest = words.slice(1).map(w => w.includes('{prompt}') ? (used = true, w.split('{prompt}').join(prompt)) : w);
    return { cmd: launch?.cmd || words[0], args: [...(launch?.pre || []), ...rest, ...extra], stdin: used ? '' : prompt };
  }
  const p = PROVIDERS[cli]; if (!p) throw new Error('Unknown external CLI ' + cli);
  const autoArgs = auto ? p.autoArgs : [];
  const args = [...launch.pre, ...(p.autoFirst ? autoArgs : []), ...p.baseArgs, ...(model ? [p.modelFlag, model] : []), ...(p.autoFirst ? [] : autoArgs), ...extra,
    ...(p.promptVia === 'arg' ? [prompt] : p.stdinArg ? [p.stdinArg] : [])];
  return { cmd: launch.cmd, args, stdin: p.promptVia === 'stdin' ? prompt : '' };
}

const tryJson = s => { try { return JSON.parse(s); } catch { return undefined; } };
// The CLI's final answer from the end of its stdout: { text } (may be '') or { error }.
export function parseOutput(kind, tail) {
  const s = String(tail ?? '');
  if (kind === 'codex-jsonl') {
    let text = null, error = null;
    for (const line of s.split(/\r?\n/)) {
      const e = line.trim().startsWith('{') && tryJson(line.trim()); if (!e) continue;
      if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string') text = e.item.text;
      else if (e.type === 'turn.failed' || e.type === 'error') error = e.error?.message || e.message || error;
    }
    return text !== null ? { text } : error ? { error: String(error) } : { text: '' };
  }
  if (kind === 'gemini-json') {
    const t = s.trim(), i = t.search(/^\{/m);
    const o = tryJson(t) ?? (i >= 0 ? tryJson(t.slice(i)) : undefined);
    if (o && typeof o === 'object') {
      if (o.error) return { error: String(o.error.message || o.error) };
      return { text: typeof o.response === 'string' ? o.response.trim() : '' };
    }
    return { text: t };
  }
  return { text: s.trim() };
}

// One row per known CLI: found on PATH or not, and `<bin> --version` (5 s) when found. run = runExternal (external-run.mjs).
export async function detect({ pathStr = shellPath(), platform = process.platform, run } = {}) {
  run ||= (o) => import('./external-run.mjs').then(m => m.runExternal(o));
  return Promise.all(Object.entries(PROVIDERS).map(async ([cli, p]) => {
    const row = { cli, label: p.label, path: null, installed: false, version: null, configHint: p.configHint, install: p.install };
    const file = which(p.bin, pathStr, platform); if (!file) return row;
    Object.assign(row, { path: file, installed: true });
    const launch = resolveLaunch(file, platform, undefined, pathStr);
    if (!launch) { row.error = 'Cannot run this CLI safely from TiroAgents (unrecognised launcher)'; return row; }
    try {
      const r = await run({ cmd: launch.cmd, args: [...launch.pre, '--version'], stdin: '', timeoutMs: 5000 });
      row.version = String(r.stdoutTail || '').trim().split(/\r?\n/)[0].slice(0, 80) || null;
    } catch {}
    return row;
  }));
}
