// The company layer: today's goals, the manager's brief, and the specialists it can hire.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

export const MAX_SPECIALISTS = 8;
const OPEN = ['todo', 'doing'];

// ---------- today's goals (one JSON file; unfinished goals carry over to a new day) ----------
export function goalStore(file, today = () => new Date().toLocaleDateString('en-CA')) {
  let state = { date: today(), goals: [] };
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const roll = () => {
    if (state.date === today()) return;
    state = { date: today(), goals: state.goals.filter(g => !['done', 'dismissed'].includes(g.status)) };
    save();
  };
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 1));
  const find = id => { roll(); const g = state.goals.find(x => x.id === id); if (!g) throw new Error('No goal ' + id); return g; };
  return {
    list: () => (roll(), state.goals),
    open: () => (roll(), state.goals.filter(g => OPEN.includes(g.status))),
    add(text, by = 'you', status = 'todo', why = '') {
      roll();
      const g = { id: 'g' + crypto.randomBytes(3).toString('hex'), text: String(text).slice(0, 300), status, by, note: why, priority: 'normal', pace: null, at: Date.now() };
      state.goals.push(g); save(); return g;
    },
    // Take finished goals off the board; their reports stay on the shelf.
    clear(statuses = ['done', 'dismissed']) {
      roll(); const n = state.goals.length;
      state.goals = state.goals.filter(g => !statuses.includes(g.status)); save(); return n - state.goals.length;
    },
    update(id, patch) {
      const g = find(id);
      if (patch.status) g.status = patch.status;
      if (patch.note !== undefined) g.note = String(patch.note).slice(0, 300);
      if (patch.report) g.report = patch.report;
      if (patch.priority) g.priority = patch.priority;
      if (patch.pace !== undefined) g.pace = patch.pace;
      if (['done', 'dismissed'].includes(g.status)) Object.assign(g, { priority: 'normal', pace: null });
      g.at = Date.now(); save(); return g;
    },
  };
}

// ---------- goal pace: the model the goal's next hires run on ----------
export const PACES = { boost: { model: 'opus', effort: 'high' }, speed: { model: 'haiku', effort: 'low' } };
// Why /api/goal/pace refuses a change: { status, error } or null.
export function paceError(goal, pace) {
  if (pace !== null && !PACES[pace]) return { status: 400, error: 'pace must be boost, speed or null' };
  if (!['todo', 'doing', 'blocked'].includes(goal.status)) return { status: 409, error: 'Pace can only be set on an open goal.' };
  return null;
}
// Boost never forces a hire through a breaker: it gives way to the hiring switch, the subscription guard and a full Opus window.
export function paceFor(goal, sw, limits, overLimit) {
  const p = PACES[goal?.pace];
  if (!p) return null;
  if (goal.pace === 'boost') {
    if (!sw.hiring) return { skip: 'Hiring is switched off: Boost will apply when hiring is back on' };
    if (sw.guard && overLimit) return { skip: 'Over the plan limit: Boost will apply when limits reset' };
    if ((limits?.models || []).some(m => /opus/i.test(m.name) && m.pct >= 100)) return { skip: 'The Opus limit is used up: Boost will apply when it resets' };
  }
  return { ...p };
}

// ---------- the manager ----------
export const OLD_HIRE_LINE = '- Hire specialists with the Agent tool, always with run_in_background: true, so several work at once. At most ${MAX_SPECIALISTS} work at the same time; if you are told the team is full, wait for a report before hiring again.';
export const managerPrompt = keys => `
# You are Tiro, the office manager in Agent Office
The user runs a small "company" of Claude agents from a pixel-office dashboard and a desktop app where you appear as Tiro, a little orange cube-crab. You are its manager. Your replies also show in Tiro's small chat bubble on the user's desktop, so lead with the answer in a sentence or two. You plan, delegate, check work and keep today's goal board honest. Do hands-on work yourself only when it is a quick read or a one-line check.

## Goals
- Today's goals live on the board: read them with mcp__office__list_goals, change them with mcp__office__update_goal.
- When you assign a goal set it to "doing". Set "done" only after you checked the result, with a one-line note saying what was delivered and where. Set "blocked" with a note saying exactly what you need from the user.
- A message starting "New task from the user" is already a goal on the board; work it like the others.
- Reports: whenever a goal produces findings, a review, QA results, a plan or anything the user should read, file it with mcp__office__file_report BEFORE marking the goal done. The chat is not where the user reads results; the Reports shelf is, and it exports to PDF and Excel. Write for a busy manager: a plain-language summary (2-4 sentences, no jargon), the outcome, findings as short rows (item + one-line detail, marked ok/issue/info), and numbered next steps. Put long technical detail only in the details field.
- When every goal is done or blocked, propose up to 3 useful follow-up goals with mcp__office__propose_goal (they wait for the user's OK; never start them yourself), give a 2-3 line end-of-day summary, then stop.

## Team
- Hiring is the exception, not the default. Do the work yourself when it is a quick read, a lookup or a small edit. Reuse a specialist who is already on the team (SendMessage to an idle one) before hiring another. Hire only when a goal truly needs separate hands: work too large or too specialised for you, or independent work that should run in parallel.
- You cannot hire on your own. First call mcp__office__request_hire (specialist, goal_id, why: a concrete reason this needs a sub-agent, prompt: the exact first prompt you will send). The Agent call must then use that prompt unchanged. The user approves or denies it on the dashboard; the call returns their answer. Only after "approved" use the Agent tool, once, for that specialist. A denied request means do the work yourself or mark the goal blocked; do not ask again for the same reason.
- Hire with the Agent tool, always with run_in_background: true. At most ${MAX_SPECIALISTS} work at the same time; if you are told the team is full, wait for a report before requesting another hire.
${teamLine(keys)}
- Each specialist is ONE person with one desk. Never spawn a second copy of a type on your own, and never let a specialist spawn one. If a specialist is short on capacity or needs help, it says so in its report; you then call mcp__office__request_hire for the type that is needed (a second ${helperEg(keys)} is a "${helperEg(keys)} helper" and needs the user's approval like any hire). Tell every specialist you brief: do not spawn, ask for help in your report.
${coderLine(keys)}- Pick the model for each hire with the Agent tool's model field: haiku for lookups and small mechanical edits, sonnet for most work, opus only for hard design or debugging.
- Give each specialist one clear goal, the folder to work in, what "done" looks like, and the goal id to mention in its report.

## Spend tokens like they are the company's money
- Each hire and each of your turns re-reads its whole context, so: one well-scoped specialist beats several overlapping ones; brief in a few lines, not pages.
- Default to haiku for lookups, listings and mechanical edits; sonnet for normal work; opus only when sonnet already failed or the goal is hard design/debugging.
- Hire a reviewer only for code or changes that matter; for read-only work, verify with one targeted command yourself.
- When specialists are working, wait: their reports wake you. Don't poll, re-list the board, or re-check work a reviewer already passed.

## Memory (Obsidian vault)
- Long-term memory is the user's Obsidian vault. Before starting a goal, look for related notes with mcp__office__memory_search (and memory_read for a full note). It costs nothing and saves re-discovering paths, decisions and gotchas.
- After a goal, save what future work will need (where things live, decisions, fixes, gotchas) with mcp__office__memory_write: one fact per note, lowercase-dash names, and link related notes with [[note-name]]. Don't save what the report already says or anything secret (passwords, keys, tokens).

## Approvals
Routine actions are approved automatically by the user's rules. Risky ones (ssh, deletes, git push, secrets, sending mail or payments) wait for the user. If something is denied, do not try another way around it: mark the goal blocked and say why.

Keep your own messages short: what you assigned, to whom, and what is left.
`;

// Explicit tool lists keep each specialist's context small; read-only roles get no Edit/Write.
// "Read-only" is the role's intent, stated in its prompt; what an agent may actually do is decided by Claude Code's permissions (your settings).
const READ_ONLY = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash']; // Bash runs powershell.exe when needed
const HANDS_ON = [...READ_ONLY, 'Edit', 'Write'];
const FOOTER = '\nYou are the only one of your kind: do not spawn sub-agents or copies of yourself. If you lack capacity or need help, say exactly what and which specialist type in your report so the manager can request an approved hire.\nFinish with a short report: what you did, where the result is, and anything left open.';

// Server-only fields for every catalog role: tools, effort, the 3-line job card (brief) and the manager's one-line summary (team).
const SPECS = {
  pixel: { tools: HANDS_ON, team: 'frontend: UI, HTML/CSS/JS, accessibility',
    brief: ['Builds and fixes UI: HTML, CSS, JavaScript and components.', 'Matches the existing look, keeps it accessible and responsive.', 'Runs the page or its tests before reporting.'] },
  forge: { tools: HANDS_ON, team: 'backend: APIs, data, scripts, servers',
    brief: ['Builds and fixes servers, APIs, data jobs, scripts and automations.', 'Prefers read-only checks first and the smallest complete change.', 'Reports exactly what it changed and how it verified it.'] },
  warden: { effort: 'medium', tools: READ_ONLY, team: 'security review, read-only',
    brief: ['Audits code, configs and scripts for secrets, injection and unsafe permissions.', 'Read-only: never edits, never prints a secret value.', 'Lists findings by severity with file and line.'] },
  probe: { effort: 'medium', tools: READ_ONLY, team: 'QA: runs tests, reproduces bugs; read-only',
    brief: ["Checks another specialist's work against the goal.", 'Runs tests, builds and reproductions; changes no files.', 'Says it passes, or lists concrete problems.'] },
  atlas: { effort: 'medium', tools: READ_ONLY, team: 'deep research: long multi-source investigations, read-only',
    brief: ['Long, multi-source investigations and comparisons.', 'Cross-checks sources and marks what is fact and what is guess.', 'Read-only: delivers a structured report with citations.'] },
  cabalan: { effort: 'low', tools: READ_ONLY, team: 'quick research: lookups and fact-finding, read-only',
    brief: ['Quick lookups: finds and reads facts in files, the web or systems.', 'Cites where each fact came from.', 'Read-only and brief.'] },
  tally: { effort: 'low', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'], team: 'task checker and organizer: checks work against the board, tidies notes and checklists',
    brief: ["Checks finished work against each goal's definition of done.", 'Keeps checklists, task lists and notes tidy and in order.', 'Flags gaps instead of fixing code.'] },
  scribe: { effort: 'low', tools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'WebFetch', 'WebSearch'], team: 'SOP and document writer; never sends',
    brief: ['Writes SOPs, runbooks, documents, emails and summaries as drafts.', 'Plain language, numbered steps, saved to files.', 'Never sends mail or posts messages.'] },
  it: { tools: HANDS_ON, team: 'IT support and sysadmin: machines, accounts, networks, admin scripts',
    brief: ['Fixes machines, accounts, networks, printers and the scripts that run them.', 'Checks the current state read-only first, then makes the smallest safe change.', 'Reports exactly what it changed and how to undo it.'] },
  accounting: { tools: HANDS_ON, team: 'accountant: books, reconciliations, financial reports from files and exports',
    brief: ['Works books, reconciliations, invoices and financial reports from files and exports.', 'Gives every figure with its source and period, and flags anything that does not tie out.', 'Drafts entries and reports only; never moves money or posts to live systems.'] },
  marketing: { tools: HANDS_ON.filter(t => t !== 'Bash'), team: 'marketing writer: campaigns, posts, newsletters and web copy as drafts; never publishes',
    brief: ['Writes campaigns, social posts, newsletters and web copy as drafts.', 'Matches the brand voice and says who each piece is for.', 'Never publishes, posts or sends.'] },
  auditor: { effort: 'medium', tools: READ_ONLY, team: 'auditor and compliance reviewer, read-only',
    brief: ['Reviews processes, records and policies against rules and controls.', 'Read-only: cites the evidence for every finding (file and line, or record).', 'Rates findings by risk and says what would close each one.'] },
  notetaker: { effort: 'low', tools: [...READ_ONLY, 'Write'], team: 'meeting notes and minutes; never sends',
    brief: ['Turns meeting transcripts and notes into clean minutes.', 'Lists decisions, owners and due dates as action items.', 'Saves drafts to files; never sends them.'] },
};
// Display data comes from the page's own catalog script, so the two can never drift.
const box = {};
vm.runInNewContext(fs.readFileSync(new URL('./public/role-catalog.js', import.meta.url), 'utf8'), box, { filename: 'role-catalog.js' });
export const RoleCatalog = box.RoleCatalog;
const BUILTIN = Object.values(RoleCatalog.BUILTIN_DESKS);
const BUILTIN_DESK = Object.fromEntries(Object.entries(RoleCatalog.BUILTIN_DESKS).map(([d, k]) => [k, d]));
// Every catalog role, key = subagent_type. desk is set only for the eight built-ins (their desk in the default layout).
export const ROSTER = Object.fromEntries(RoleCatalog.ROLES.map(({ key, ...r }) => [key, { ...r, ...SPECS[key], ...(BUILTIN_DESK[key] && { desk: BUILTIN_DESK[key] }) }]));
// {key, desk} of the layout's department desks in desk order; a desk without a role param holds its built-in role. No layout: the eight.
export function activeDesks(layout) {
  if (!layout) return BUILTIN.map(key => ({ key, desk: BUILTIN_DESK[key] }));
  const n = o => Number(String(o.desk).replace(/\D/g, '')) || 0;
  return (layout.objects || []).filter(o => o && typeof o === 'object' && o.type === 'dept-desk').sort((a, b) => n(a) - n(b))
    .map(o => ({ key: o.role || RoleCatalog.BUILTIN_DESKS[o.desk], desk: o.desk })).filter(d => Object.hasOwn(ROSTER, d.key));
}
// Role keys of the layout's department desks in desk order.
export const activeKeys = layout => activeDesks(layout).map(d => d.key);
// The team the office has now, kept in step with the saved layout (store = createWorldStore). at() changes whenever the roles do,
// so the manager's session can tell its team is out of date.
export function liveRoster(store) {
  let desks = activeDesks(store.load().layout), at = 0;
  const keys = () => desks.map(d => d.key);
  return {
    keys, desks: () => desks, at: () => at,
    deskOf: k => desks.find(d => d.key === k)?.desk,
    // Saves the layout, unless it retires a role whose specialist is working (busy(key)): then 409 and nothing is written.
    save(layout, busy = () => false, nameOf = k => ROSTER[k].name) {
      const next = Array.isArray(layout?.objects) ? activeDesks(layout) : null;
      const gone = next && keys().find(k => !next.some(d => d.key === k) && busy(k));
      if (gone) return { ok: false, status: 409, error: nameOf(gone) + ' is working; wait or stop them first' };
      const r = store.save(layout);
      if (!r.ok) return { ...r, status: 400 };
      if (next.map(d => d.key).join() !== keys().join()) at++;
      desks = next;
      return { ok: true };
    },
  };
}
// request_hire and the Agent hook: the roster key for a subagent_type (old names resolve), or why it cannot be hired.
// keys = the desks now; session = the roles Tiro's running session was built with (a newer desk joins after a restart).
export const hireKey = (type, keys, session = keys, nameOf = k => ROSTER[k].name) => {
  const k = ALIASES[type] || type;
  if (!keys.includes(k)) return { error: 'No desk for ' + k + '. Available: ' + keys.filter(x => session.includes(x)).join(', ') };
  return session.includes(k) ? { key: k } : { error: `The ${nameOf(k)} desk is new; ${nameOf(k)} joins after Tiro's next restart.` };
};
// The parts of the manager's brief that name the team.
const andList = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a.join('');
const WORDS = ['no', 'one', 'two', 'three', 'four'];
function teamLine(keys) {
  const old = Object.entries(ALIASES).filter(([, k]) => keys.includes(k)).map(([o, k]) => o + '=' + k).join(', ');
  return `- The team is ${keys.length === 1 ? 'this 1 specialist' : 'these ' + keys.length + ' specialists'}: ` + keys.map(k => k + ' (' + ROSTER[k].team + ')').join(', ') + ', hired by subagent_type.' + (old ? ' Old names still work: ' + old + '.' : '');
}
const helperEg = keys => ROSTER[keys.includes('forge') ? 'forge' : keys[0] || 'forge'].name;
function coderLine(keys) {
  const coders = keys.filter(k => ROSTER[k].kind === 'coder'); if (!coders.length) return '';
  const check = coders.filter(k => ['warden', 'probe'].includes(k)), who = andList(coders);
  return '- ' + who[0].toUpperCase() + who.slice(1) + (coders.length > 1 ? ' are the ' + WORDS[coders.length] + ' coders' : ' is the only coder') +
    (check.length ? '; hire ' + check.join(' or ') + ' to check code that matters instead of marking it done on trust' : '') + '.\n';
}
// ---------- display names (cosmetic only: types/ids/subagent_type never change) ----------
export const NAME_MAX = 20;
// Trim, collapse whitespace, drop control and markup characters, limit length. Returns '' when nothing usable is left.
export const cleanName = v => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>&"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
// Overrides {type:name} for the manager ('tiro') and the roster keys. Unknown keys and invalid names are dropped.
const DEFAULTS = { tiro: 'Tiro', ...Object.fromEntries(Object.entries(ROSTER).map(([k, r]) => [k, r.name])) };
export function sanitizeNames(obj) {
  const out = {}, seen = new Set();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of ['tiro', ...Object.keys(ROSTER)]) {
    const n = cleanName(obj[k]); if (!n) continue;
    const lc = n.toLowerCase(); if (seen.has(lc)) continue;
    if (Object.keys(DEFAULTS).some(o => o !== k && DEFAULTS[o].toLowerCase() === lc)) continue; // another agent's default name
    seen.add(lc);
    out[k] = n;
  }
  return out;
}
// Set (or with a blank name, reset) one override. Throws on unknown type or a name another agent already uses.
export function setAgentName(names, key, name) {
  if (key !== 'tiro' && !ROSTER[key]) throw new Error('Unknown agent type ' + key);
  const next = { ...sanitizeNames(names) }, n = cleanName(name);
  const defaults = DEFAULTS;
  if (!n) {
    delete next[key];
    const d = defaults[key].toLowerCase();
    for (const k of Object.keys(defaults)) if (k !== key && next[k] && next[k].toLowerCase() === d) throw new Error(`Cannot reset: ${next[k]} is now used by ${k}; rename that agent first`);
    return next;
  }
  for (const k of Object.keys(defaults)) if (k !== key && [next[k], defaults[k]].some(v => v && v.toLowerCase() === n.toLowerCase())) throw new Error(`"${n}" is already used by ${k}`);
  next[key] = n; return next;
}
export const displayNames = names => ({ tiro: 'Tiro', ...Object.fromEntries(Object.entries(ROSTER).map(([k, r]) => [k, r.name])), ...sanitizeNames(names) });
// Names live in kiro.json under agentNames; merge on write so the desktop app's own prefs are never lost.
export function nameStore(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    get: () => sanitizeNames(read().agentNames),
    set(key, name) { const cur = read(), next = setAgentName(cur.agentNames, key, name); cur.agentNames = next; fs.writeFileSync(file, JSON.stringify(cur)); return next; },
    reset() { const cur = read(); delete cur.agentNames; fs.writeFileSync(file, JSON.stringify(cur)); return {}; },
  };
}

// ---------- hiring approvals: the manager asks, the user decides, one approval buys one hire ----------
// Hash of a prompt as the hire gate compares it (line endings and outer whitespace do not matter).
export const promptHash = t => crypto.createHash('sha256').update(String(t ?? '').replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex');

export function hireGate({ now = Date.now, ttl = 10 * 60e3 } = {}) {
  const pending = new Map(), grants = [];
  let n = 0;
  const key = t => ALIASES[t] || t;
  return {
    pending: () => [...pending.values()].map(({ resolve, ...p }) => p),
    // Returns a promise of {approved, reason}; settles when decide() is called or after ttl.
    request(spec) {
      const id = 'h' + (++n).toString(36) + Math.random().toString(36).slice(2, 6);
      return { id, promise: new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve({ approved: false, reason: 'No answer from the user in time. Do the work yourself or mark the goal blocked.' }); }, ttl);
        pending.set(id, { ...spec, id, at: now(), resolve: r => { clearTimeout(timer); resolve(r); } });
      }) };
    },
    decide(id, approve, note = '') {
      const p = pending.get(id); if (!p) return false;
      pending.delete(id);
      if (approve) grants.push({ key: p.key, goalId: p.goalId, promptHash: p.promptHash, until: now() + ttl });
      p.resolve(approve ? { approved: true, reason: 'Approved.' } : { approved: false, reason: 'Denied by the user' + (note ? ': ' + note : '') + '. Do the work yourself or mark the goal blocked.' });
      return true;
    },
    // The Agent-tool hook calls this with the prompt it was given. One grant buys one hire of that type, and only with the
    // prompt the user approved. Returns true (grant used) or false.
    consume(type, prompt) {
      const r = this.check(type, prompt); if (r.ok) grants.splice(r.index, 1); return r.ok;
    },
    // Same test without using the grant: { ok, index, why }.
    check(type, prompt) {
      const k = key(type), t = now();
      for (let i = grants.length - 1; i >= 0; i--) if (grants[i].until < t) grants.splice(i, 1);
      const mine = grants.map((g, index) => ({ g, index })).filter(x => x.g.key === k);
      if (!mine.length) return { ok: false, why: 'no approval' };
      const hit = mine.find(x => !x.g.promptHash || x.g.promptHash === promptHash(prompt));
      return hit ? { ok: true, index: hit.index, goalId: hit.g.goalId } : { ok: false, why: 'prompt differs from the approved one' };
    },
    clear() { for (const p of [...pending.values()]) p.resolve({ approved: false, reason: 'Cancelled.' }); pending.clear(); grants.length = 0; },
  };
}

export const MANAGER = { name: 'Tiro', role: 'Office manager', color: '#e8793a', accent: '#ffcf6b', desk: 'office' };
// Old subagent_type names keep working: they map onto the new roster.
export const ALIASES = { researcher: 'cabalan', builder: 'forge', ops: 'forge', writer: 'scribe', reviewer: 'probe' };
export const MANAGER_PROMPT = managerPrompt(BUILTIN);
// The built-in brief before desks named the team (b08dbef). A vault brief equal to it is unedited and is replaced by MANAGER_PROMPT.
export const LEGACY_MANAGER_PROMPT = MANAGER_PROMPT.replace(teamLine(BUILTIN), '- The team is exactly eight specialists, hired by subagent_type: ' +
  BUILTIN.map(k => k + ' (' + ROSTER[k].team + ')').join(', ') + '. Old names still work: researcher=cabalan, builder=forge, ops=forge, writer=scribe, reviewer=probe.')
  .replace('a second Forge is', 'a second forge is');
// An edited brief keeps its own team text; when the desks differ from the built-in eight, this note names the team Tiro has now.
export const teamNote = keys => [...keys].sort().join() === [...BUILTIN].sort().join() ? '' : '\n\n## The team now (from the office desks; this replaces any other team list above)\n' + teamLine(keys);

const def = r => ({
  description: r.role + '. ' + r.brief[0],
  prompt: 'You are ' + r.name + ', the office\'s ' + r.role + '.\n' + r.brief.map(l => '- ' + l).join('\n') + FOOTER,
  tools: r.tools, model: r.model, ...(r.effort && { effort: r.effort }),
});
const DEFS = Object.fromEntries(Object.entries(ROSTER).map(([k, r]) => [k, def(r)]));
// What the SDK may hire for a set of desks (the same definition object per key, every time).
export const specialists = keys => Object.fromEntries(keys.filter(k => DEFS[k]).map(k => [k, DEFS[k]]));
export const SPECIALISTS = specialists(BUILTIN);
// One person per roster specialist: of all live agents sharing a specialist key (builder/ops/forge all resolve to forge),
// the earliest-started one is the specialist; every other is labelled "<Name> helper" of it, never drawn as another Forge.
// agents: [{id, born, profile:{key}}]. Returns Map(id -> {helper:false} | {helper:true, helperOf, label}).
export function assignHelpers(agents, names = {}) {
  const out = new Map(), byKey = new Map();
  for (const a of agents) { const k = a.profile?.key; if (!k || !ROSTER[k]) continue; (byKey.get(k) || byKey.set(k, []).get(k)).push(a); }
  for (const [k, list] of byKey) {
    list.sort((x, y) => (x.born || 0) - (y.born || 0) || String(x.id).localeCompare(String(y.id)));
    const base = names[k] || ROSTER[k].name;
    list.forEach((a, i) => out.set(a.id, i === 0 ? { helper: false } : { helper: true, helperOf: list[0].id, label: base + ' helper' + (list.length > 2 ? ' ' + i : '') }));
  }
  return out;
}
// Look and desk for a subagent_type (old names resolve through ALIASES); null for anything else.
// deskOf(key) gives the desk id in the active layout.
export const profileOf = (type, deskOf = k => ROSTER[k].desk) => { const k = ALIASES[type] || type; const r = ROSTER[k]; return r ? { key: k, name: r.name, role: r.role, color: r.color, accent: r.accent, desk: deskOf(k) } : null; };
// Everything the SDK may hire: the team, plus the old names as aliases of the same definitions.
export const withAliases = team => ({ ...team, ...Object.fromEntries(Object.entries(ALIASES).filter(([, k]) => team[k]).map(([o, k]) => [o, team[k]])) });

// The filing cabinet can rewrite any of the eight specialists: a note named specialist-<key>.md replaces its instructions
// (old names such as specialist-researcher are ignored; other names do not add a ninth specialist). Frontmatter can set:
//   ---
//   description: Builds UI                 (what Tiro sees when choosing who to hire)
//   tools: Read, Grep, Glob, Write       (default: read, search, web, Bash, Edit, Write)
//   model: haiku | sonnet | opus         (default: sonnet)
//   ---
// A SOP note may remove tools from a specialist, never add any: only names already in the roster's list are kept. What a kept tool may
// actually do is still decided by Claude Code's permissions.
export function narrowTools(field, builtin) {
  if (!field) return builtin;
  const kept = field.split(/[,\s]+/).filter(Boolean).filter(t => builtin.includes(t));
  return kept.length ? kept : builtin;
}

// Only SOPs for keys on the team apply.
export function teamFromSops(sops, keys = BUILTIN) {
  const base = specialists(keys), team = { ...base };
  for (const { name, text } of sops) {
    const m = name.match(/^specialist-([a-z0-9-]+)$/); if (!m || !(m[1] in base)) continue;
    const fmm = text.match(/^---\n([\s\S]*?)\n---\n?/), head = fmm ? fmm[1] : '', body = (fmm ? text.slice(fmm[0].length) : text).trim();
    const field = k => (head.match(new RegExp('^' + k + ':\s*(.+)$', 'm')) || [])[1]?.trim();
    if (!body) continue; // an emptied note falls back to the built-in role
    const was = base[m[1]] || {};
    const firstLine = body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 200);
    team[m[1]] = {
      ...was,
      description: field('description') || was.description || firstLine,
      prompt: body,
      tools: narrowTools(field('tools'), was.tools || HANDS_ON),
      model: field('model') || was.model || 'sonnet',
    };
  }
  return team;
}

// An existing vault brief (possibly edited by the user) gets the strict-hiring rules: the old hiring bullet is swapped
// for the new policy when unedited, otherwise a Hiring policy section is appended. Returns the new text, or null if already current.
export function migrateBrief(text) {
  if (/request_hire/.test(text)) {
    if (/ONE person/.test(text)) return null;
    const line = MANAGER_PROMPT.split('\n').find(l => /^- Each specialist is ONE person/.test(l));
    return text.replace(/\r/g, '').replace(/\n*$/, '\n\n## One person per specialist (added by Agent Office)\n' + line + '\n');
  }
  const old = OLD_HIRE_LINE.replace('${MAX_SPECIALISTS}', MAX_SPECIALISTS);
  const policy = MANAGER_PROMPT.split('\n').filter(l => /^- (Hiring is the exception|You cannot hire on your own|Hire with the Agent tool)/.test(l)).join('\n');
  const t = text.replace(/\r/g, '');
  if (t.includes(old)) return t.replace(old, () => policy);
  return t.replace(/\n*$/, '\n\n## Hiring policy (added by Agent Office)\n' + policy + '\n');
}

// Role SOP notes (specialist-<key>.md) steer a specialist, so only our own text is trusted on sight. For each key: a missing note
// is written from the built-in prompt and pinned with the hash of that text (not re-read from disk); an existing unpinned note is
// pinned only if it is exactly the built-in text, so a note planted outside the app stays untrusted (the built-in prompt is used).
// sops: [{name, text}]; write(name, text) creates the note only if it is still missing; pins is updated in place.
export function seedRoleSops(keys, { pins, sops, write, hash }) {
  for (const k of keys) {
    if (!DEFS[k]) continue;
    const n = 'specialist-' + k, text = DEFS[k].prompt.trim() + '\n', have = sops.find(x => x.name === n);
    if (!have) { write(n, text); pins[n] = hash(text); } else if (!pins[n] && hash(have.text) === hash(text)) pins[n] = hash(text);
  }
}
export const isRoleSop = name => /^specialist-/.test(name) && Object.hasOwn(ROSTER, name.slice('specialist-'.length));
// A role is working while its hire is open (Agent hook start, no SubagentStop yet) or one of Tiro's specialists of that role
// is live and not idle (e.g. resumed with SendMessage). Same predicate request_hire uses for "idle", inverted.
export const roleBusy = (k, { open, agents, bossId, live, idle }) => open(k) > 0 || agents.some(a => !a.isManager && a.parent === bossId && a.profile?.key === k && live(a.id) && !idle(a));
