// The manager approves permission prompts in your place, except anything matching a rule below: those wait for you.
// Rules are checked against the whole tool input, so a risky path or command anywhere in it counts.
export const RULES = [
  ['remote shell or file copy (ssh/scp/sftp/rsync)', /\b(ssh|scp|sftp|plink|putty|rsync)\b|Enter-PSSession|New-PSSession|Invoke-Command\s+-ComputerName/i],
  ['download piped into a shell', /\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|python|node)\b|\b(iex|Invoke-Expression)\b/i],
  ['recursive or forced delete', /\brm\s+(-\w*[rf]\w*\s+)+|\bRemove-Item\b[^\n]*-(Recurse|Force)|\b(del|erase)\s+\/[sq]|\brmdir\s+\/s|\bformat\s+[a-z]:|\bdiskpart\b|\bmkfs\b/i],
  ['history-rewriting or publishing git', /\bgit\s+(push|reset\s+--hard|clean\s+-\w*f|filter-branch|rebase)\b/i],
  ['database destruction', /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*(;|$))/i],
  ['secrets or keys', /\.ssh[\\/]|\bid_(rsa|ed25519|ecdsa)\b|\.env\b|\.pem\b|credentials|\bpasswords?\b|\bsecrets?\b|\btoken\b|agent-office[\\/]bridge\.json|\bop\s+(read|item|signin)\b/i],
  ['system or account change', /\b(sudo|runas|reg\s+(add|delete)|Set-ExecutionPolicy|schtasks|sc(\.exe)?\s+(create|config|delete)|net\s+(user|localgroup)|shutdown|Restart-Computer|Stop-Computer|chmod\s+777|netsh|New-NetFirewallRule|Set-MpPreference)\b/i],
  ['package publish or global install', /\b(npm|pnpm|yarn)\s+(publish|i(nstall)?\s+-g)\b|\bpip\s+install\b|\bwinget\s+install\b|\bchoco\s+install\b|\bdocker\s+push\b/i],
];
// MCP tools that act outside this PC (send mail, delete, pay, publish) always go to you.
const OUTBOUND_TOOL = /^mcp__.*(send|delete|trash|remove|publish|transfer|payment|create_(invoice|event|draft)|forward|reply|update)/i;

export function review(tool, input) {
  if (OUTBOUND_TOOL.test(tool)) return { ok: false, rule: 'acts outside this PC (' + tool.split('__').pop() + ')' };
  // Commands are checked as commands; file writes by where they go, not by what the file says
  // (a checklist that mentions SSH or passwords is not an SSH command or a secret).
  const text = typeof input === 'string' ? input
    : input?.command ?? (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) ? String(input?.file_path ?? input?.notebook_path ?? '') : JSON.stringify(input ?? {}));
  for (const [rule, re] of RULES) if (re.test(text)) return { ok: false, rule };
  return { ok: true };
}
