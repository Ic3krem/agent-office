// Turns Claude Code transcript lines (~/.claude/projects/**/*.jsonl) into office state.
const pad = n => String(n).padStart(2, '0');
export const stamp = d => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
const clip = (s, n = 240) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function toolSummary(name, input = {}) {
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  return clip(v === undefined ? JSON.stringify(input) : v, 160);
}

export function newAgent(id, extra = {}) {
  return { id, name: '', role: 'Terminal', model: '', cwd: '', mode: '', status: 'idle', task: '', logs: [],
    busy: false, lastKind: '', lastTs: 0, seenMsg: new Set(), ...extra };
}

function log(a, k, text, ts) { a.logs.push({ t: stamp(new Date(ts)), k, text: clip(text, 2000) }); if (a.logs.length > 200) a.logs.splice(0, a.logs.length - 200); }

// Applies one parsed transcript entry. Returns output tokens newly seen (for the Tok/s chart) and whether a turn ended.
export function apply(a, j) {
  const ts = Date.parse(j.timestamp) || Date.now();
  let tokens = 0, turnEnded = false;
  if (j.cwd) a.cwd = j.cwd;
  switch (j.type) {
    case 'ai-title': a.name ||= j.aiTitle; a.title = j.aiTitle; break;
    case 'custom-title': a.title = j.customTitle ?? a.title; break;
    case 'permission-mode': a.mode = j.permissionMode; break;
    case 'system':
      if (j.subtype === 'stop_hook_summary' || j.subtype === 'turn_duration') { a.busy = false; a.task = ''; turnEnded = true; }
      break;
    case 'user': {
      if (j.isMeta || j.isCompactSummary) break;
      const c = j.message?.content;
      if (typeof c === 'string') {
        if (c.startsWith('<task-notification')) log(a, 'sys', 'Background task finished', ts);
        else if (c.startsWith('<command-name>')) log(a, 'sys', c.match(/<command-name>([^<]*)/)?.[1] ?? 'command', ts);
        else if (!c.startsWith('<')) { log(a, 'user', c, ts); a.task = clip(c, 80); a.firstPrompt ||= clip(c, 40); a.turnTok = 0; }
        a.busy = true; a.lastKind = 'user'; a.apiError = '';
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'tool_result') {
            const t = Array.isArray(b.content) ? b.content.map(x => x.text ?? '').join(' ') : b.content;
            log(a, b.is_error ? 'err' : 'out', clip(t, 300) || '(no output)', ts);
            a.lastKind = 'result';
          } else if (b.type === 'text' && !b.text.startsWith('<')) { log(a, 'user', b.text, ts); a.lastKind = 'user'; }
        }
        a.busy = true;
      }
      break;
    }
    case 'assistant': {
      const m = j.message ?? {};
      if (m.model && !m.model.startsWith('<')) a.model = m.model;
      if (m.id && m.usage && !a.seenMsg.has(m.id)) { a.seenMsg.add(m.id); tokens = m.usage.output_tokens ?? 0; a.turnTok = (a.turnTok || 0) + tokens; }
      // Claude Code writes API failures as assistant lines: a plan limit shows as rate_limit, anything else is an error.
      a.apiError = j.isApiErrorMessage ? j.error || 'error' : '';
      if (j.isApiErrorMessage) a.errText = clip((m.content ?? []).map(b => b.text ?? '').join(' '), 160);
      for (const b of m.content ?? []) {
        if (b.type === 'text' && b.text.trim()) { log(a, 'agent', b.text, ts); a.lastKind = 'text'; }
        if (b.type === 'tool_use') { const s = toolSummary(b.name, b.input); log(a, 'tool', b.name + ': ' + s, ts); a.task = b.name + ' · ' + clip(s, 60); a.lastKind = 'tool'; a.busy = true; }
      }
      break;
    }
    default: return { tokens, turnEnded };
  }
  if (j.timestamp) a.lastTs = Math.max(a.lastTs, ts); // metadata lines carry no time
  return { tokens, turnEnded };
}

// A turn's final reply is assistant text followed by silence.
export function statusOf(a, now = Date.now()) {
  if (a.perms?.length) return 'blocked';
  if (a.apiError) return a.apiError === 'rate_limit' ? 'limited' : 'error';
  if (!a.busy || now - a.lastTs > 10 * 60e3) return 'idle'; // ponytail: a silent >10 min tool run reads as idle
  if (a.lastKind === 'text' && now - a.lastTs > 6000) return 'idle';
  return 'working';
}
