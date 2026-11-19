// Sign-in state of the agent CLIs and Claude Code, and how to open their own login in a terminal window.
// Read-only probes: nothing here prints, stores or returns a token. The opener's argv comes only from resolved paths and
// the fixed LOGIN args below, so no user text ever reaches a shell.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LOGIN = { codex: ['login'], gemini: [], opencode: ['auth', 'login'], claude: ['auth', 'login'], 'claude-console': ['auth', 'login', '--console'] };
const GEMINI_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA'];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// -> {state: 'yes'|'no'|'unknown', note}. run = runExternal; launch = resolveLaunch(...) of the CLI (null: not installed).
export async function probeSignin(cli, { run, env = process.env, home, launch } = {}) {
  if (cli === 'gemini') {
    if (GEMINI_ENV.some(k => env[k])) return { state: 'yes', note: 'API key in the environment' };
    const s = readJson(path.join(home, '.gemini', 'settings.json'));
    return s && (s.security?.auth?.selectedType || s.selectedAuthType) ? { state: 'yes', note: '' } : { state: 'no', note: '' };
  }
  const args = { codex: ['login', 'status'], opencode: ['auth', 'list'] }[cli];
  if (!args || !launch) return { state: 'unknown', note: '' };
  try {
    const r = await run({ cmd: launch.cmd, args: [...launch.pre, ...args], stdin: '', timeoutMs: 5000, env });
    if (cli === 'codex') return { state: r.code === 0 ? 'yes' : 'no', note: '' };
    const out = String(r.stdoutTail || ''), n = /(\d+)\s+credentials?/i.exec(out);
    return { state: (n ? +n[1] > 0 : /●/.test(out)) && r.code === 0 ? 'yes' : 'no', note: '' };
  } catch { return { state: 'unknown', note: cli === 'opencode' ? 'uses its own config' : '' }; }
}

// `claude auth status` JSON -> only what the panel shows.
export function parseClaudeStatus(text) {
  let j; try { j = JSON.parse(String(text)); } catch { return { loggedIn: false, method: '', email: '', expires: '', unknown: true }; } // not JSON: an old Claude Code without `auth`
  if (!j || j.loggedIn !== true) return { loggedIn: false, method: '', email: '', expires: '' };
  const m = String(j.authMethod || '');
  return { loggedIn: true, method: m === 'claude.ai' ? 'subscription' : /console|api/i.test(m) ? 'console' : 'other', email: typeof j.email === 'string' ? j.email.slice(0, 120) : '', expires: typeof j.loginExpiresAt === 'string' ? j.loginExpiresAt.slice(0, 40) : '' };
}

const sq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
// How to show a terminal running launch + args: {cmd, args} to spawn (detached), plus {file, text} to write first (macOS),
// or {copy} when there is no way (the page shows the command).
export function terminalPlan(platform, launch, args, { exists = f => fs.existsSync(f), comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', tmpdir = '/tmp', copyAs } = {}) {
  if (!launch) return { copy: copyAs || '' };
  const words = [launch.cmd, ...launch.pre, ...args];
  if (platform === 'win32') {
    // A titled console that runs the login, then waits for a key, so its messages and URL stay readable. The outer cmd sees the
    // paths outside quotes and cmd expands %VAR% even inside them, so a path with a cmd metacharacter (a user named R&D) gets
    // the command to copy instead. verbatim: spawn with windowsVerbatimArguments.
    if (words.some(w => /[%"\r\n&|<>^!]/.test(w))) return { copy: copyAs || '' };
    const line = '"' + words.map(w => '"' + w + '"').join(' ') + ' & pause"'; // the inner cmd /c strips the outer quote pair
    return { cmd: comspec, verbatim: true, args: ['/d /c start "TiroAgents sign-in" "' + comspec + '" /d /c ' + line] };
  }
  if (platform === 'darwin') {
    const file = path.posix.join(tmpdir, 'tiroagents-login-' + crypto.randomBytes(6).toString('hex') + '.command');
    return { file, text: '#!/bin/sh\n' + words.map(sq).join(' ') + '\n', cmd: '/usr/bin/open', args: ['-a', 'Terminal', file] };
  }
  const term = ['/usr/bin/x-terminal-emulator', '/usr/bin/gnome-terminal', '/usr/bin/konsole'].find(exists);
  if (!term) return { copy: copyAs || words.join(' ') };
  return { cmd: term, args: [/gnome-terminal$/.test(term) ? '--' : '-e', ...words] };
}
