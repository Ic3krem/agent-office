// The manager approves permission prompts in your place, but only for what is clearly harmless: read-only tools, a short list of
// known-safe commands, and edits inside folders you trusted. Everything else waits for you. This is an allowlist; the blocklist
// below only adds a plain-language reason for common dangerous cases and is checked first.
import os from 'node:os';
import path from 'node:path';

// ---- path normalisation -----------------------------------------------------------------------------------------------
// Lower case, forward slashes, runs of backslashes collapsed (JSON.stringify doubles them), ~ and common env vars expanded,
// and "." / ".." segments resolved, so C:\\Users\\Me\\.CLAUDE\\x, ~/.claude/../.claude/x and %USERPROFILE%\.claude all look alike.
export function flat(text, home = os.homedir()) {
  const h = String(home).replace(/\\+/g, '/').toLowerCase().replace(/\/$/, '');
  let s = String(text ?? '').replace(/\\+/g, '/').toLowerCase();
  s = s.replace(/%userprofile%|\$env:userprofile|\$\{?home\}?|\$env:home/g, h)
       .replace(/%appdata%|\$env:appdata/g, h + '/appdata/roaming')
       .replace(/%localappdata%|\$env:localappdata/g, h + '/appdata/local')
       .replace(/(^|[\s"'=(])~(?=\/|$|\s)/g, '$1' + h);
  return s.replace(/[^\s"'`;|&<>()=,]+/g, t => (t.includes('/') ? path.posix.normalize(t).replace(/^\.\//, '') : t));
}

// ---- always escalate: configuration, persistence and the app itself ----------------------------------------------------
const PROTECTED = [
  ['Agent Office or Claude Code configuration (~/.claude)', /(^|[\/\s"'=:])\.claude(\/|\s|$|["'])|\.claude\.json|(^|[\/\s"'=])claude\.md(\s|$|["'])|\/\.claude[\w.-]*\/|\.(c|cl|cla|clau|claud)[*?\[]/],
  ['Windows startup folder', /start menu\/programs\/startup|\/startup\/[^\s"']*\.(lnk|bat|cmd|ps1|vbs|exe)/],
  ['PowerShell profile', /\$profile\b|(microsoft\.)?powershell_profile\.ps1|\/(windows)?powershell\/(microsoft\.)?(powershell_)?profile\.ps1|\bprofile\.ps1\b/],
  ['the installed Agent Office app', /\/programs\/agent office(\/|\s|$|["'])/],
  ['shell startup or scheduled tasks', /\.(bashrc|zshrc|bash_profile|profile)(\s|$|["'])|\/(crontab|cron\.d)\b|taskschd|\/system32\/tasks\//],
];

// ---- readable reasons for common dangerous commands (all escalate) -----------------------------------------------------
export const RULES = [
  ['claude, Anthropic SDK or agent launch from a command (a sub-agent would skip the hiring gate)', /(^|[^\w.-])(claude(\.exe|\.cmd|\.ps1)?|claude-code|claude-agent-sdk|anthropic-ai|@anthropic-ai\/[\w.-]+)([^\w-]|$)|\bagent-sdk\b/i],
  ['remote shell or file copy (ssh/scp/sftp/rsync)', /\b(ssh|scp|sftp|plink|putty|rsync|ftp|telnet)\b|Enter-PSSession|New-PSSession|Invoke-Command/i],
  ['network download or upload (curl, wget, Invoke-WebRequest, nc ...)', /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|nc|ncat|netcat|certutil|bitsadmin|start-bitstransfer|test-netconnection|socat)\b/i],
  ['inline, encoded or nested interpreter', /\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-(e|ec|enc|encodedcommand|c|command|f|file)\b|\bnode(\.exe)?\s+(-e|--eval|-p|--print)\b|\bpython[\d.]*(\.exe)?\s+-c\b|\b(perl|ruby|php)\s+-e\b|\bcmd(\.exe)?\s+\/[ck]\b|\b(ba|z|da)?sh\s+-c\b|\b(iex|invoke-expression|start-process|invoke-item|mshta|wscript|cscript|rundll32|regsvr32)\b|\bbase64\b[^\n]*-d|frombase64string/i],
  ['recursive or forced delete', /\brm\s+(-\w*[rf]\w*\s+)+|\bRemove-Item\b[^\n]*-(Recurse|Force)|\b(del|erase)\s+\/[sq]|\brmdir\s+\/s|\brd\s+\/s|\bformat\s+[a-z]:|\bdiskpart\b|\bmkfs\b/i],
  ['history-rewriting, publishing or remote git', /\bgit\s+(push|remote|clone|fetch|pull|reset\s+--hard|clean\s+-\w*f|filter-branch|rebase|submodule|config)\b|\bgh\s+(repo|api|auth|release|pr|issue|secret|workflow|gist)\b/i],
  ['database destruction', /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*(;|$))/i],
  ['secrets or keys', /\.ssh[\\/]|\bid_(rsa|ed25519|ecdsa)\b|\.env\b|\.pem\b|\.pfx\b|\.kdbx\b|credentials|\bpasswords?\b|\bsecrets?\b|\btoken\b|bridge\.json|\bop\s+(read|item|signin)\b|\.aws[\\/]|\.azure[\\/]|\.kube[\\/]/i],
  ['system or account change', /\b(sudo|runas|reg\s+(add|delete)|Set-ExecutionPolicy|schtasks|sc(\.exe)?\s+(create|config|delete)|net\s+(user|localgroup)|shutdown|Restart-Computer|Stop-Computer|chmod\s+777|netsh|New-NetFirewallRule|Set-MpPreference|Set-ItemProperty|New-ItemProperty|setx)\b/i],
  ['package publish or global install', /\b(npm|pnpm|yarn)\s+(publish|login|adduser|i(nstall)?\s+-g|install|add|i\b)|\bpip\d?\s+install\b|\bwinget\s+install\b|\bchoco\s+install\b|\bdocker\s+(push|run|exec)\b/i],
];

// MCP tools that act outside this PC (send mail, delete, pay, publish) always go to you.
const OUTBOUND_TOOL = /^mcp__.*(send|delete|trash|remove|publish|transfer|payment|create|forward|reply|update|write|post|put|move|share|invite|upload|run|execute)/i;
const READISH_MCP = /(^|_)(search|list|get|read|find|fetch|query|describe|show|view|lookup)(_|$)/i; // tested on the last name segment

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'WebSearch', 'ExitPlanMode']);
const ORCHESTRATION = new Set(['Agent', 'Task', 'SendMessage', 'TaskStop', 'TaskOutput', 'TaskList', 'TaskGet']); // gated by the hiring rules, not here
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELLS = new Set(['Bash', 'PowerShell']);

// Documentation sites a fetch may reach without asking. Plain URLs only (no query string, fragment or credentials).
export const WEB_ALLOW = ['docs.anthropic.com', 'code.claude.com', 'developer.mozilla.org', 'nodejs.org', 'learn.microsoft.com', 'en.wikipedia.org', 'docs.python.org', 'electronjs.org', 'www.electronjs.org', 'typescriptlang.org', 'www.typescriptlang.org'];

// ---- known-safe shell commands ----------------------------------------------------------------------------------------
const SAFE_SEGMENT = /^[\w ./:=,@'"~+\\-]+$/;   // no $ ` % ^ * ? [ ] { } ( ) < > ! # in a command that is auto-approved
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'describe', 'blame', 'shortlog', '--version', 'version']);
const PLAIN_READ = new Set(['ls', 'dir', 'pwd', 'echo', 'cat', 'type', 'head', 'tail', 'wc', 'sort', 'uniq', 'grep', 'findstr', 'select-string', 'get-content', 'get-childitem', 'get-location', 'test-path', 'resolve-path', 'get-item', 'measure-object', 'where', 'which', 'true', 'cd', 'set-location', 'basename', 'dirname', 'date', 'get-date']);
function safeSegment(seg) {
  const t = seg.trim(); if (!t) return true;
  if (!SAFE_SEGMENT.test(t)) return false;
  const words = t.split(/\s+/), prog = words[0].replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|ps1)$/i, '').toLowerCase();
  if (prog === 'git') return GIT_READ.has((words[1] || '').toLowerCase()) && !/--output|--ext-diff|--textconv|-c\b/.test(t);
  if (prog === 'npm') return /^npm\s+(test|t|run\s+test|run\s+lint)\s*$/i.test(t);
  if (prog === 'node') return /^node\s+--check\s+[\w./\\:~-]+\s*$/i.test(t) || /^node\s+--test(\s+[\w./\\:~-]+)*\s*$/i.test(t) || /^node\s+(-v|--version)\s*$/i.test(t);
  if (prog === 'grep' || prog === 'findstr' || prog === 'select-string') return !/--pre\b/.test(t);
  return PLAIN_READ.has(prog);
}

// Specialists write their own notes here; nothing else under ~/.claude is writable without you.
const MEMORY_NOTE = home => new RegExp('^' + flat(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/\\.claude/agent-office/agents/tiro/(pixel|forge|warden|probe|atlas|cabalan|tally|scribe)/memory/[a-z0-9][a-z0-9._-]*\\.md$');
export const isMemoryNote = (p, home = os.homedir()) => !!p && !String(p).includes('..') && MEMORY_NOTE(home).test(flat(p, home));

const inside = (file, dirs, home) => { const f = flat(file, home); return dirs.some(d => { const x = flat(d, home).replace(/\/$/, ''); return f === x || f.startsWith(x + '/'); }); };

// ctx: { home, protectedDirs: [absolute paths], trustedDirs: [absolute paths edits may go to], webAllow: [hosts] }
export function review(tool, input, ctx = {}) {
  const home = ctx.home || os.homedir();
  const no = rule => ({ ok: false, rule });
  tool = String(tool || '');
  if (OUTBOUND_TOOL.test(tool)) return no('acts outside this PC (' + tool.split('__').pop() + ')');

  // The text a tool would act on: a command, or the paths it touches. File contents are not scanned (a checklist that
  // mentions SSH is not an SSH command), but where a file goes always is.
  const pathsOf = i => [i?.file_path, i?.notebook_path, i?.path, i?.pattern && /[\/\\]/.test(i.pattern) ? i.pattern : '', i?.glob, ...(Array.isArray(i?.edits) ? [] : [])].filter(Boolean).join(' ');
  const raw = typeof input === 'string' ? input
    : SHELLS.has(tool) ? String(input?.command ?? '')
    : (READ_ONLY_TOOLS.has(tool) || WRITE_TOOLS.has(tool) || ORCHESTRATION.has(tool)) ? pathsOf(input)
    : tool === 'WebFetch' ? String(input?.url ?? '') : JSON.stringify(input ?? {});
  const text = flat(raw, home);

  // 1. protected places, whatever the tool (the one exception: a specialist's own memory note)
  const ownNote = WRITE_TOOLS.has(tool) && isMemoryNote(input?.file_path, home);
  if (!ownNote) {
    for (const [rule, re] of PROTECTED) if (re.test(text)) return no(rule);
    for (const d of ctx.protectedDirs || []) if (d && (text.includes(flat(d, home).replace(/\/$/, '') + '/') || text.endsWith(flat(d, home)))) return no('a protected Agent Office folder');
  }
  // 2. plain-language blocklist (commands and paths)
  if (!ownNote) for (const [rule, re] of RULES) if (re.test(SHELLS.has(tool) ? raw + '\n' + text : text)) return no(rule);

  // 3. allowlist
  if (READ_ONLY_TOOLS.has(tool) || ORCHESTRATION.has(tool)) return { ok: true };
  if (SHELLS.has(tool)) {
    if (/\n|\r/.test(raw.trim())) return no('multi-line command');
    const segs = raw.split(/&&|\|\||;|\|/);
    return segs.every(safeSegment) ? { ok: true } : no('command is not on the safe list');
  }
  if (WRITE_TOOLS.has(tool)) {
    if (ownNote) return { ok: true };
    const f = input?.file_path ?? input?.notebook_path;
    if (f && !String(f).includes('..') && (ctx.trustedDirs || []).length && inside(f, ctx.trustedDirs, home)) return { ok: true };
    return no('changes a file outside your trusted folders');
  }
  if (tool === 'WebFetch') {
    let u; try { u = new URL(String(input?.url ?? '')); } catch { return no('unreadable URL'); }
    const allow = ctx.webAllow || WEB_ALLOW;
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !allow.includes(u.hostname.toLowerCase())) return no('fetches a page outside the documentation allowlist');
    return { ok: true };
  }
  if (tool.startsWith('mcp__')) return READISH_MCP.test(tool.split('__').pop()) ? { ok: true } : no('MCP tool is not read-only (' + tool.split('__').pop() + ')');
  return no('tool is not on the safe list (' + tool + ')');
}
