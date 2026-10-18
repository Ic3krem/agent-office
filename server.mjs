// Agent Office: a local dashboard over every Claude Code session on this PC.
// Logs come from transcripts; approvals/replies go through the bridge mod (terminals) or the Agent SDK (dashboard sessions).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { apply, newAgent, statusOf, toolSummary } from './transcript.mjs';
import { review } from './manager.mjs';
import { usageLedger, planLimits, creditLog } from './usage.mjs';
import { goalStore, MANAGER_PROMPT, SPECIALISTS, MAX_SPECIALISTS } from './company.mjs';
import { reportStore, dailyMarkdown, mdToHtml, printPage, reportXlsx, dailyXlsx } from './reports.mjs';
import { findVault, agentVault, seedMemory } from './vault.mjs';
import { switchBox, rack, findClaude } from './office.mjs';

const PORT = Number(process.env.AGENT_OFFICE_PORT) || 4777;
const HOME = os.homedir();
const PROJECTS = path.join(HOME, '.claude', 'projects');
const CFG_DIR = path.join(HOME, '.claude', 'agent-office');
const CFG_FILE = path.join(CFG_DIR, 'bridge.json');
const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Presentation mode: show only Kiro and its specialists, not your other Claude sessions.
const TEAM_ONLY = !!process.env.AGENT_OFFICE_TEAM_ONLY;
const RECENT_MS = 45 * 60e3, TAIL_BYTES = 512 * 1024, DESKS = 8;
// How long a request waits once it is on screen. Office sessions have no terminal to fall back to, so they wait longer;
// bridged terminals fall back to their own dialog.
const ASK_WAIT_MS = 10 * 60e3, BRIDGE_WAIT_MS = 90e3;

// One key gates the page, the API and the bridge; it survives restarts so open terminals keep working.
fs.mkdirSync(CFG_DIR, { recursive: true });
let KEY;
try { KEY = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')).key; } catch {}
KEY ||= crypto.randomBytes(24).toString('hex');
fs.writeFileSync(CFG_FILE, JSON.stringify({ port: PORT, key: KEY }));

const agents = new Map();      // id -> agent (sessionId, or "agent-<id>" for helpers)
const files = new Map();       // transcript path -> { id, offset, mtime }
const asks = new Map();        // askId -> { agentId, resolve, timer }
const sdk = new Map();         // sessionId -> { q, push }
const clients = new Set();     // SSE responses
let tasksDone = 0, version = 0;
const bump = () => version++;
const MGR_FILE = path.join(CFG_DIR, 'manager.json');
const manager = { on: true, approved: 0, escalated: 0, last: '' };
try { manager.on = JSON.parse(fs.readFileSync(MGR_FILE, 'utf8')).on !== false; } catch {}
const goals = goalStore(path.join(CFG_DIR, 'goals.json'));
const V = agentVault(findVault());
const reports = reportStore(V.dirs.reports);
// Reports used to live in ~/.claude/agent-office/reports; move them into the vault once.
const OLD_REPORTS = path.join(CFG_DIR, 'reports');
if (fs.existsSync(OLD_REPORTS)) { fs.cpSync(OLD_REPORTS, V.dirs.reports, { recursive: true, force: false }); fs.rmSync(OLD_REPORTS, { recursive: true, force: true }); }
// First run: start the agents' memory from Claude Code's own memory notes for this user.
if (!fs.readdirSync(V.dirs.memory).length) seedMemory(V, path.join(PROJECTS, HOME.replace(/[:\\/]/g, '-'), 'memory'));
// The filing cabinet: Kiro's brief and each specialist's instructions, editable as vault notes.
V.sop('kiro-brief', MANAGER_PROMPT);
for (const [k, d] of Object.entries(SPECIALISTS)) V.sop('specialist-' + k, d.prompt);
const switches = switchBox(path.join(CFG_DIR, 'switches.json'));
const sw = () => switches.get();
const host = rack();

// The day's summary note in the vault, rewritten shortly after anything on the board changes.
let dailyTimer;
const dailyData = (day = today()) => {
  const u = ledger.summary().find(d => d.day === day) || {};
  return { day, goals: goals.list(), reports: reports.list().filter(r => r.day === day), approvals: manager,
    usage: { tokens: u.tokens || 0, session: limits?.session?.pct ?? null, weekly: limits?.weekly?.pct ?? null, credits: credits.days()[day] || 0 } };
};
const scheduleDaily = () => { clearTimeout(dailyTimer); dailyTimer = setTimeout(() => { try { V.writeDaily(today(), dailyMarkdown(dailyData())); } catch (e) { console.error('daily note:', e.message); } }, 3000); };
for (const k of ['add', 'update', 'clear']) { const fn = goals[k]; goals[k] = (...a) => { const r = fn(...a); scheduleDaily(); return r; }; }
{ const fn = reports.save; reports.save = r => { const out = fn(r); scheduleDaily(); return out; }; }
const ledger = usageLedger(PROJECTS);
let limits = null;
const credits = creditLog(path.join(CFG_DIR, 'credits.json'));
const overLimit = () => !!limits && !limits.error && [limits.session, limits.weekly].some(w => w && w.pct >= 100);
const refreshLimits = () => planLimits(query, LEAN).then(l => { limits = l; credits.observe(l.extra?.used); guard(); bump(); }).catch(e => { limits = { error: e.message, at: Date.now() }; bump(); });
setInterval(() => { ledger.refresh(); bump(); }, 30e3);
// Check limits every 5 minutes, every 2 while Kiro is working (it is what spends them).
let lastLimits = 0;
setInterval(() => { if (Date.now() - lastLimits > (boss.id ? 2 : 5) * 60e3) { lastLimits = Date.now(); refreshLimits(); } }, 30e3);
const BOSS_FILE = path.join(CFG_DIR, 'manager-session.json');
const boss = { id: null, push: null, running: 0, progress: false, autoRuns: 0, paused: '' };
// At a plan limit the guard stops Kiro and its team (so extra-usage credits aren't spent) and resumes after the reset.
function guard() {
  if (sw().guard && overLimit()) {
    const w = [limits.session, limits.weekly].find(x => x && x.pct >= 100);
    const why = (w === limits.session ? '5-hour' : 'weekly') + ' plan limit reached; resumes after ' + new Date(w.resets).toLocaleString();
    if (boss.paused !== why) { boss.paused = why; host.note('Guard: ' + why); stopBoss(); }
  } else if (boss.paused) {
    boss.paused = ''; host.note('Guard: limits back under 100%');
    if (sw().kiro && goals.open().length) tellBoss('Plan limits have reset. Continue with today\'s goals.');
  }
}
function stopBoss() { const live = boss.id && sdk.get(boss.id); if (live) live.q.close(); }

// ---------- transcripts ----------
function readNew(file, f, a) {
  const st = fs.statSync(file);
  if (st.size < f.offset) f.offset = 0;
  if (st.size === f.offset) return;
  const fd = fs.openSync(file, 'r');
  const len = st.size - f.offset, buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, f.offset); fs.closeSync(fd);
  let text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return;                       // wait for a whole line
  text = text.slice(0, lastNl);
  const firstRead = f.offset === f.start;
  f.offset += Buffer.byteLength(text, 'utf8') + 1;
  const lines = text.split('\n');
  if (firstRead && f.start > 0) lines.shift();  // began mid-line
  for (const l of lines) {
    if (!l || l.startsWith('{"type":"api-request') || l.startsWith('{"type":"file-history')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    const r = apply(a, j);
    if (!firstRead && r.turnEnded) tasksDone++;
  }
  bump();
}

function track(file, id, extra) {
  let f = files.get(file);
  const st = fs.statSync(file);
  if (!f) {
    if (Date.now() - st.mtimeMs > RECENT_MS && !agents.has(id)) return;
    const start = Math.max(0, st.size - TAIL_BYTES);
    f = { id, offset: start, start }; files.set(file, f);
    if (!agents.has(id)) agents.set(id, newAgent(id, extra));
  }
  f.mtime = st.mtimeMs;
  const a = agents.get(id); a.mtime = st.mtimeMs;
  readNew(file, f, a);
}

function scan() {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return; }
  const now = Date.now();
  for (const d of dirs) {
    const dir = path.join(PROJECTS, d);
    let names; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const id = n.slice(0, -6), file = path.join(dir, n);
      try { track(file, id); } catch {}
      const sub = path.join(dir, id, 'subagents');
      if (!fs.existsSync(sub)) continue;
      for (const s of fs.readdirSync(sub)) {
        if (!s.endsWith('.jsonl')) continue;
        const sf = path.join(sub, s), sid = s.slice(0, -6);
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(sf.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch {}
        if (meta.finished && now - fs.statSync(sf).mtimeMs > 60e3) continue;
        try { track(sf, sid, { role: 'Helper · ' + (meta.agentType || 'agent'), name: meta.description || 'Helper', parent: id, helper: true }); } catch {}
      }
    }
  }
}

// ---------- approvals ----------
function ask(agentId, tool, input, { reason = '', canModify = false, wait = ASK_WAIT_MS } = {}) {
  const a = agents.get(agentId) ?? agents.set(agentId, newAgent(agentId)).get(agentId);
  const askId = crypto.randomUUID(), t = new Date().toTimeString().slice(0, 8);
  if (manager.on) {
    const v = review(tool, input);
    if (v.ok) {
      manager.approved++; manager.last = t + ' approved ' + tool + ' ' + toolSummary(tool, input);
      a.logs.push({ t, k: 'sys', text: 'Manager approved: ' + tool + ' ' + toolSummary(tool, input) });
      bump();
      return Promise.resolve({ decision: 'allow' });
    }
    manager.escalated++; manager.last = t + ' escalated ' + tool + ': ' + v.rule;
    reason = 'Manager escalated to you: ' + v.rule + (reason ? ' · ' + reason : '');
  }
  a.perms ||= [];
  a.perms.push({ askId, cmd: tool === 'Bash' ? input.command : tool + ': ' + toolSummary(tool, input), short: tool, why: reason, canModify });
  a.logs.push({ t, k: 'hitl', text: 'Requesting permission: ' + tool + ' ' + toolSummary(tool, input) });
  bump();
  const p = new Promise(resolve => {
    const done = v => { clearTimeout(entry.timer); asks.delete(askId); a.perms = a.perms.filter(p => p.askId !== askId); armHead(a); bump(); resolve(v); };
    const entry = { agentId, wait, resolve: done };
    asks.set(askId, entry);
    armHead(a);
  });
  p.askId = askId;
  return p;
}
// A desk shows one request at a time, so only that one's clock runs; the ones queued behind it wait unseen without timing out.
function armHead(a) {
  const head = a.perms?.[0] && asks.get(a.perms[0].askId);
  if (head && !head.timer) head.timer = setTimeout(() => head.resolve({ decision: 'terminal' }), head.wait);
}

// ---------- dashboard sessions (Agent SDK) ----------
function startSession(text, cwd = HOME, extra = {}) {
  const queue = [], waiters = [];
  const push = m => { const w = waiters.shift(); w ? w({ value: m, done: false }) : queue.push(m); };
  const msg = t => ({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null });
  const input = { [Symbol.asyncIterator]: () => ({ next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise(r => waiters.push(r)) }) };
  const holder = { id: null };
  const q = query({
    prompt: input,
    options: {
      cwd,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      ...extra.options,
      canUseTool: async (tool, toolInput, { signal, decisionReason, suggestions, agentID }) => {
        // A specialist's request shows on its own desk once its transcript is tracked.
        const who = agentID && agents.has('agent-' + agentID) ? 'agent-' + agentID : holder.id;
        const p = ask(who, tool, toolInput, { reason: decisionReason, canModify: tool === 'Bash' });
        signal?.addEventListener('abort', () => asks.get(p.askId)?.resolve({ decision: 'deny' }), { once: true }); // only this call's request
        const r = await p;
        if (r.decision === 'allow') return { behavior: 'allow', updatedInput: r.command ? { ...toolInput, command: r.command } : toolInput, updatedPermissions: r.always ? suggestions : undefined };
        return { behavior: 'deny', message: r.decision === 'terminal' ? 'No answer from Agent Office in time.' : 'Denied by the user in Agent Office.' };
      },
    },
  });
  push(msg(text));
  (async () => {
    try {
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init' && !holder.id) {
          holder.id = m.session_id;
          sdk.set(holder.id, { q, push: t => push(msg(t)) });
          const a = agents.get(holder.id) ?? agents.set(holder.id, newAgent(holder.id)).get(holder.id);
          Object.assign(a, { role: 'Dashboard', dashboard: true, busy: true, task: text.slice(0, 80), firstPrompt: text.slice(0, 40), cwd }, extra.agent);
          extra.onInit?.(holder.id, t => push(msg(t)));
          bump();
        }
        if (m.type === 'result') extra.onResult?.(m);
      }
    } catch (e) {
      const a = holder.id && agents.get(holder.id);
      if (a) { a.logs.push({ t: new Date().toTimeString().slice(0, 8), k: 'err', text: 'Session ended: ' + e.message }); bump(); }
      else console.error('Could not start session:', e.message);
    }
    if (holder.id) { sdk.delete(holder.id); bump(); }
    extra.onEnd?.();
  })();
}

// ---------- the manager: one long-running session that plans, hires specialists and works the goal board ----------
const today = () => new Date().toLocaleDateString('en-CA');
const say = t => { const a = boss.id && agents.get(boss.id); if (a) { a.logs.push({ t: new Date().toTimeString().slice(0, 8), k: 'sys', text: t }); bump(); } };
const officeTools = createSdkMcpServer({
  name: 'office',
  tools: [
    tool('list_goals', "List today's goals with id, status (proposed, todo, doing, blocked, done, dismissed) and note.", {}, async () =>
      ({ content: [{ type: 'text', text: JSON.stringify(goals.list()) }] })),
    tool('update_goal', 'Set a goal to doing, blocked or done, with a one-line note.', { id: z.string(), status: z.enum(['doing', 'blocked', 'done']), note: z.string() }, async ({ id, status, note }) => {
      try { const g = goals.update(id, { status, note }); boss.progress = true; say('Goal ' + status + ': ' + g.text); return { content: [{ type: 'text', text: 'ok' }] }; }
      catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }),
    tool('file_report', 'Save the report the user reads (Reports shelf, exported to PDF/Excel). Use for every goal that produced findings, before marking it done. Write for a busy manager.', {
      goal_id: z.string(), title: z.string().describe('Plain-language title of the result, e.g. "Develop branch QA: builds pass, 1 suite not run"'),
      outcome: z.enum(['done', 'partial', 'blocked', 'info']),
      summary: z.string().describe('2-4 plain sentences: what was asked, what was found or done, what it means'),
      findings: z.array(z.object({ item: z.string(), status: z.enum(['ok', 'issue', 'info']), detail: z.string() })).optional().describe('One row per thing checked or found'),
      next_steps: z.array(z.string()).optional(),
      details: z.string().optional().describe('Optional technical detail in Markdown (commands, file paths, logs)'),
    }, async ({ goal_id, title, outcome, summary, findings, next_steps, details }) => {
      const file = reports.save({ goalId: /^g[0-9a-f]{6}$/.test(goal_id) ? goal_id : '', title, outcome, summary, findings, nextSteps: next_steps, details });
      try { goals.update(goal_id, { report: file }); } catch {}
      boss.progress = true; say('Report filed: ' + title); bump();
      return { content: [{ type: 'text', text: 'Saved as ' + file }] };
    }),
    tool('memory_search', 'Search long-term memory (Obsidian vault notes) by keywords. Free; use before starting work.', { query: z.string() }, async ({ query: q }) =>
      ({ content: [{ type: 'text', text: JSON.stringify(V.search(q)) || '[]' }] })),
    tool('memory_read', 'Read one memory note by name.', { name: z.string() }, async ({ name }) => {
      try { return { content: [{ type: 'text', text: V.read(name).slice(0, 12000) }] }; } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }),
    tool('memory_write', 'Create or replace a memory note: one durable fact (paths, decisions, gotchas). Link related notes with [[note-name]]. Never store secrets.', {
      name: z.string().describe('lowercase-with-dashes'), description: z.string().describe('one line, used to decide relevance later'), body: z.string(),
    }, async ({ name, description, body }) => {
      if (/(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}|-----BEGIN [A-Z ]*PRIVATE KEY/i.test(body)) return { content: [{ type: 'text', text: 'Refused: that note looks like it contains a secret.' }], isError: true };
      try { V.write(name, { description, body }); say('Memory saved: ' + name); return { content: [{ type: 'text', text: 'saved' }] }; } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }),
    tool('propose_goal', 'Suggest a follow-up goal. It waits for the user to accept it; do not start it.', { text: z.string(), why: z.string() }, async ({ text, why }) => {
      goals.add(text, 'manager', 'proposed', why); bump(); return { content: [{ type: 'text', text: 'Proposed; waiting for the user.' }] };
    }),
  ],
});
// Agent sessions skip your global plugins, hooks and MCP servers (measured ~30K tokens re-read every turn),
// but keep the env from your user settings (API endpoint) so they authenticate the same way.
let USER_ENV = {};
try { USER_ENV = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).env || {}; } catch {}
const CLAUDE = findClaude();
if (!CLAUDE) console.error('Claude Code was not found. Install it (https://claude.com/claude-code) and log in, or set CLAUDE_CODE_PATH.');
const LEAN = { settingSources: [], strictMcpConfig: true, env: { ...process.env, ...USER_ENV }, ...(CLAUDE && { pathToClaudeCodeExecutable: CLAUDE }) };
const bossOptions = () => {
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(BOSS_FILE, 'utf8')); } catch {}
  return {
    ...LEAN,
    model: 'sonnet', // cache reads cost the same as Opus, and Kiro mostly plans and delegates
    // Built-in tools are ~26K tokens re-read every turn; Kiro gets what delegating needs, and specialists draw from this set.
    // (No AskUserQuestion: nobody can answer it here, so Kiro would hang.)
    tools: ['Agent', 'SendMessage', 'TaskStop', 'Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch'],
    effort: 'medium',
    resume: saved.date === today() ? saved.id : undefined, // the same manager all day, a fresh one each morning
    systemPrompt: { type: 'preset', preset: 'claude_code', append: V.sop('kiro-brief', MANAGER_PROMPT) + `\n\nThe vault's agent folder is ${V.base} (Memory/, Reports/, Daily/).` },
    agents: Object.fromEntries(Object.entries(SPECIALISTS).map(([k, d]) => [k, { ...d, prompt: V.sop('specialist-' + k, d.prompt) + `\nShared memory: Markdown notes in ${V.dirs.memory} (grep them for context first).` }])),
    mcpServers: { office: officeTools },
    allowedTools: ['list_goals', 'update_goal', 'propose_goal', 'file_report', 'memory_search', 'memory_read', 'memory_write'].map(t => 'mcp__office__' + t),
    hooks: {
      PreToolUse: [{ matcher: 'Agent|Task', hooks: [async input => {
        const no = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
        if (!sw().hiring) return no('Hiring is switched off in the office breaker box. Do the work yourself if it is small, or mark the goal blocked.');
        if (boss.running >= MAX_SPECIALISTS) return no(MAX_SPECIALISTS + ' specialists are already working. Wait for a report, then hire again.');
        boss.running++; boss.progress = true; bump();
        // Espresso: this hire runs on the fast model; the cup is used up.
        if (sw().espresso) { switches.set('espresso', false); return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...input.tool_input, model: 'haiku' } } }; }
        return {};
      }] }],
      SubagentStop: [{ hooks: [async () => { boss.running = Math.max(0, boss.running - 1); bump(); return {}; }] }],
    },
  };
};
function tellBoss(text) {
  if (!sw().kiro || (sw().guard && overLimit())) return false; // switched off, or paused at a plan limit: the goal waits on the board
  if (boss.push) return boss.push(text);
  boss.push = () => {}; // claimed while starting so a second click can't start a second manager
  startSession(text, HOME, {
    options: bossOptions(),
    agent: { role: 'Manager', isManager: true, title: 'Kiro' },
    onInit: (id, push) => { boss.id = id; boss.push = push; fs.writeFileSync(BOSS_FILE, JSON.stringify({ id, date: today() })); },
    onResult: () => {
      // Keep working while the last turn moved something and goals are open; a turn with no progress waits for the user.
      // Busy specialists wake Kiro when they report, so only nudge when nobody is out working.
      if (sw().autopilot && boss.progress && !boss.running && goals.open().length && boss.autoRuns < 30) {
        boss.autoRuns++;
        setTimeout(() => tellBoss("Continue with today's goals: check specialists' reports, update the board, assign what is next."), 3000);
      }
      boss.progress = false;
    },
    onEnd: () => { if (!boss.id) fs.rmSync(BOSS_FILE, { force: true }); Object.assign(boss, { id: null, push: null, running: 0 }); bump(); },
  });
}

// ---------- snapshot ----------
function snapshot() {
  const now = Date.now();
  const list = [...agents.values()].filter(a => !a.isManager && (!TEAM_ONLY || (boss.id && a.parent === boss.id)) && !(a.hidden && a.hidden === a.mtime && !a.perms?.length) && (a.perms?.length || a.dashboard || (a.bridged && now - a.bridged < 10e3) || now - (a.mtime || 0) < RECENT_MS));
  const rank = a => ({ blocked: 0, error: 0, limited: 1, working: 1, idle: 2 })[statusOf(a, now)] ?? 2;
  list.sort((x, y) => rank(x) - rank(y) || (y.mtime || 0) - (x.mtime || 0));
  const bossAgent = boss.id && agents.get(boss.id);
  const allReports = reports.list(), reportOf = Object.fromEntries(allReports.filter(r => r.goalId).reverse().map(r => [r.goalId, r.file]));
  const shown = list.slice(0, DESKS).sort((x, y) => x.id.localeCompare(y.id)); // stable desks while ranking picks who is in the room
  return {
    manager, goals: goals.list().map(g => ({ ...g, report: g.report || reportOf[g.id] })), reportsN: allReports.length, usage: { days: ledger.summary(), limits, credits: credits.days(), creditsSince: credits.since() }, boss: { active: !!boss.id, running: boss.running, max: MAX_SPECIALISTS, paused: boss.paused }, switches: sw(), rack: host.status(), claudeMissing: !CLAUDE, memoryN: V.graph().nodes.length, doneReports: allReports.filter(r => r.outcome === 'done').length, tasksDone, overflow: Math.max(0, list.length - DESKS),
    agents: (bossAgent ? [bossAgent, ...shown] : shown).map(a => ({
      isManager: !!a.isManager,
      id: a.id, name: a.isManager ? 'Kiro' : a.title || a.name || a.firstPrompt || path.basename(a.cwd || '') || a.id.slice(0, 8),
      role: a.role, model: a.model || 'claude', cwd: a.cwd, mode: a.mode, status: statusOf(a, now), task: statusOf(a, now) === 'idle' ? '' : a.task,
      turnTok: a.turnTok || 0, errText: a.apiError ? a.errText : '',
      logs: a.logs.slice(-60), perm: a.perms?.[0] || null,
      canSend: sdk.has(a.id) || (!!a.bridged && now - a.bridged < 10e3),
    })),
  };
}

let sent = -1;
setInterval(() => {
  scan();
  if (sent === version || !clients.size) return;
  sent = version;
  const data = 'data: ' + JSON.stringify(snapshot()) + '\n\n';
  for (const c of clients) c.write(data);
}, 1000);

// ---------- http ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } }); });
const STATIC = { '/': ['Agent Office.html', 'text/html'], '/office-objects.js': ['office-objects.js', 'text/javascript'], '/support.js': ['support.js', 'text/javascript'], '/kiro': ['kiro.html', 'text/html'], '/kiro-art.js': ['kiro-art.js', 'text/javascript'] };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Localhost only: refuse other Host headers (DNS rebinding) and requests without the key.
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) return json(res, 403, { error: 'bad host' });
  const s = STATIC[url.pathname];
  if (s && req.method === 'GET') { res.writeHead(200, { 'content-type': s[1] + '; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'public', s[0])).pipe(res); }
  const key = req.headers['x-key'] || url.searchParams.get('key');
  if (!key || key.length !== KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(KEY))) return json(res, 401, { error: 'bad key' });

  try {
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
      clients.add(res); res.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && /^\/(print|export)\//.test(url.pathname)) {
      const file = url.searchParams.get('file'), day = /^\d{4}-\d\d-\d\d$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : today();
      const dailyMd = () => { const f = path.join(V.dirs.daily, day + '.md'); return day !== today() && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : dailyMarkdown(dailyData(day)); };
      const send = (type, body, name) => { res.writeHead(200, { 'content-type': type, ...(name ? { 'content-disposition': `attachment; filename="${name}"` } : {}) }); res.end(body); };
      const safeName = t => t.replace(/[^\w .-]+/g, '').slice(0, 80).trim() || 'report';
      switch (url.pathname) {
        case '/print/report': { const m = reports.meta(file); return send('text/html; charset=utf-8', printPage(m.title, reports.read(file))); }
        case '/print/daily': return send('text/html; charset=utf-8', printPage('Daily report ' + day, dailyMd()));
        case '/export/report.xlsx': { const m = reports.meta(file); return send('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await reportXlsx(m)), safeName(m.title) + '.xlsx'); }
        case '/export/daily.xlsx': {
          const d = dailyData(day), cr = credits.days();
          return send('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await dailyXlsx({ ...d, reports: reports.list(), usageDays: ledger.summary().map(u => ({ ...u, credits: cr[u.day] || 0 })) })), `Agent Office ${day}.xlsx`);
        }
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method !== 'POST' && url.pathname !== '/bridge/poll') return json(res, 405, { error: 'POST only' });
    const b = req.method === 'POST' ? await readBody(req) : {};
    switch (url.pathname) {
      case '/api/send': {
        const text = String(b.text || '').trim(); if (!text) return json(res, 400, { error: 'empty' });
        if (sdk.has(b.id)) sdk.get(b.id).push(text);
        else { const a = agents.get(b.id); if (!a?.bridged) return json(res, 409, { error: 'This session is watch-only. Restart that terminal so the bridge loads.' }); (a.inbox ||= []).push(text); }
        return json(res, 200, { ok: true });
      }
      case '/api/interrupt': {
        if (sdk.has(b.id)) await sdk.get(b.id).q.interrupt();
        else { const a = agents.get(b.id); if (!a?.bridged) return json(res, 409, { error: 'watch-only' }); a.abort = true; }
        return json(res, 200, { ok: true });
      }
      case '/api/decide': {
        const x = asks.get(b.askId); if (!x) return json(res, 404, { error: 'That request was already answered.' });
        x.resolve({ decision: b.decision === 'allow' ? 'allow' : b.decision === 'terminal' ? 'terminal' : 'deny', command: b.command, always: !!b.always });
        return json(res, 200, { ok: true });
      }
      case '/api/manager': {
        manager.on = !!b.on; fs.writeFileSync(MGR_FILE, JSON.stringify({ on: manager.on })); bump();
        return json(res, 200, { ok: true });
      }
      case '/api/task': {
        const text = String(b.text || '').trim(); if (!text) return json(res, 400, { error: 'empty' });
        const g = goals.add(text, 'you'); bump();
        const started = tellBoss(`New task from the user (goal ${g.id}): ${text}`) !== false;
        return json(res, 200, { ok: true, goal: g, waiting: started ? '' : (boss.paused || 'Kiro is switched off in the breaker box') });
      }
      case '/api/goal': {
        const status = { accept: 'todo', dismiss: 'dismissed', done: 'done', reopen: 'todo' }[b.action];
        if (!status) return json(res, 400, { error: 'unknown action' });
        const g = goals.update(String(b.id), { status }); bump();
        if (status === 'todo') tellBoss(`The user put goal ${g.id} on today's list: ${g.text}`);
        return json(res, 200, { ok: true });
      }
      case '/api/reports': return json(res, 200, { reports: reports.list() });
      case '/api/report': { const file = String(b.file || ''); return json(res, 200, { html: mdToHtml(reports.read(file)), meta: reports.meta(file) }); }
      case '/api/daily': return json(res, 200, { html: mdToHtml(dailyMarkdown(dailyData())), day: today() });
      case '/api/memory/graph': return json(res, 200, { ...V.graph(), vault: path.basename(V.root), base: path.relative(V.root, V.base).split(path.sep).join('/') });
      case '/api/memory/note': { const text = V.read(String(b.name)); return json(res, 200, { text, html: mdToHtml(text) }); }
      case '/api/memory/delete': V.remove(String(b.name)); bump(); return json(res, 200, { ok: true });
      case '/api/memory/link': V.link(String(b.from), String(b.to)); bump(); return json(res, 200, { ok: true });
      case '/api/sops': return json(res, 200, { sops: V.sops() });
      case '/api/sops/save': V.saveSop(String(b.name), String(b.text || '')); return json(res, 200, { ok: true, note: 'Saved. Kiro uses it from its next fresh start.' });
      case '/api/switch': {
        switches.set(String(b.name), b.on); host.note(`Switch ${b.name} ${b.on ? 'on' : 'off'}`);
        if (b.name === 'kiro' && !b.on) stopBoss();
        if (b.name === 'guard') guard();
        if (b.name === 'bridge' && !b.on) [...asks.values()].forEach(x => x.resolve({ decision: 'terminal' }));
        bump(); return json(res, 200, { switches: sw() });
      }
      case '/api/rack': return json(res, 200, host.detail());
      case '/api/limits': await refreshLimits(); return json(res, 200, { limits });
      case '/api/tidy': {
        // Idle desks leave the office until they get new activity; finished goals leave the board.
        let desks = 0;
        for (const a of agents.values()) if (!a.isManager && !a.perms?.length && !sdk.has(a.id) && statusOf(a, Date.now()) === 'idle') { a.hidden = a.mtime; desks++; }
        const cleared = goals.clear(); bump();
        return json(res, 200, { desks, goals: cleared });
      }
      case '/api/boss-reset': {
        // Forget the Manager's conversation; goals and reports stay. Its next start is a fresh session.
        if (boss.running) return json(res, 409, { error: 'Specialists are still working. Wait for them to finish first.' });
        const live = boss.id && sdk.get(boss.id);
        fs.rmSync(BOSS_FILE, { force: true }); boss.autoRuns = 0;
        if (live) live.q.close(); else Object.assign(boss, { id: null, push: null, running: 0 });
        bump();
        return json(res, 200, { ok: true });
      }
      case '/api/boss': {
        tellBoss(goals.open().length ? 'Start working: read the goal board and get the open goals moving.' : 'Check in: read the goal board; if nothing is open, propose up to 3 useful goals for today and stop.');
        return json(res, 200, { ok: true });
      }
      case '/bridge/poll': {
        const id = url.searchParams.get('session');
        const a = agents.get(id) ?? agents.set(id, newAgent(id)).get(id);
        if (!a.bridged) bump();
        a.bridged = Date.now();
        const out = { messages: a.inbox || [], abort: !!a.abort };
        a.inbox = []; a.abort = false;
        return json(res, 200, out);
      }
      case '/bridge/ask': {
        const sessionAgent = agents.get(b.session);
        // Auto mode's classifier stays in charge in the terminal; nobody watching means the terminal asks.
        // Dashboard sessions load the bridge too; their canUseTool already asks, so the bridge stands aside.
        if (!sw().bridge || sdk.has(b.session) || sessionAgent?.mode === 'auto' || sessionAgent?.mode === 'bypassPermissions') return json(res, 200, { decision: 'terminal' });
        // With no tab open only the manager can answer, and only for calls it would approve.
        if (!clients.size && !(manager.on && review(b.tool, b.input).ok)) return json(res, 200, { decision: 'terminal' });
        const target = b.agentId && agents.has('agent-' + b.agentId) ? 'agent-' + b.agentId : b.session;
        let answered = false;
        const p = ask(target, b.tool, b.input || {}, { reason: b.reason, wait: BRIDGE_WAIT_MS });
        res.on('close', () => { if (!answered) asks.get(p.askId)?.resolve({ decision: 'terminal' }); }); // the terminal stopped waiting: hand this one back
        const r = await p; answered = true;
        return json(res, 200, { decision: r.decision });
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});

server.listen(PORT, '127.0.0.1', () => {
  scan(); ledger.refresh(); lastLimits = Date.now(); refreshLimits(); scheduleDaily();
  console.log(`Agent Office: http://localhost:${PORT}/?key=${KEY}`);
});
