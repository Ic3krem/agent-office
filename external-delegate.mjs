// mcp__office__delegate: runs an approved prompt on an external specialist's CLI in the background and reports back to Tiro.
// Every dependency is injected (server.mjs wires the real ones), so the rules here are unit-tested without the SDK.
// Rules: one approved request_hire grant buys one run; the team cap counts external runs; the count is always released.
import { buildCommand, parseOutput, providerOf } from './external-agents.mjs';
import { runExternal } from './external-run.mjs';

export const ANSWER_MAX = 20000;
const cliOf = key => (/^ext-(codex|gemini|opencode|custom)-[1-3]$/.exec(String(key)) || [])[1] || null;
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
const lastLine = s => String(s ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || '';
const NOT_INSTALLED = label => label + ' is not installed on this PC (see the Agents panel).';

export function createDelegator({ hires, settings = () => ({}), launch, run = runExternal, redact = s => s, tell, onStart = () => null, onLine = () => {}, onEnd = () => {},
  max, running, inc, dec, cwd, env, nameOf = k => k, timeoutMs = 20 * 60e3 }) {
  const runs = new Map(); // key -> AbortController
  function delegate(key, prompt) {
    const cli = cliOf(key);
    if (!cli) return { ok: false, error: key + ' is not an external specialist (their keys start with ext-). Hire Claude specialists with the Agent tool.' };
    const p = providerOf(cli), name = nameOf(key);
    const chk = hires.check(key, prompt);
    if (!chk.ok) return { ok: false, error: chk.why === 'prompt differs from the approved one'
      ? 'The prompt must be exactly the prompt approved in request_hire. Call request_hire again with the prompt you really want to send.'
      : 'Hiring needs user approval first: call mcp__office__request_hire (specialist, goal_id, why, prompt) and wait for "approved".' };
    if (runs.has(key)) return { ok: false, error: name + ' is already working on a task.' };
    if (running() >= max()) return { ok: false, error: max() + ' specialists are already working. Wait for a report first.' };
    const s = settings(key) || {};
    if (cli === 'custom' && !s.command) return { ok: false, error: 'This desk has no confirmed command; set it in the Agents panel.' };
    const l = launch(cli, s);
    if (!l) return { ok: false, error: NOT_INSTALLED(p.label) };
    if (l.error) return { ok: false, error: l.error };
    let cmd;
    try { cmd = buildCommand(cli, { prompt, model: s.model, auto: !!s.auto, extraArgs: s.args || '', command: s.command || '' }, l); }
    catch (e) { return { ok: false, error: e.message }; }
    hires.consume(key, prompt); // used before spawning: a run that fails still spent its approval
    inc();
    const ac = new AbortController(); runs.set(key, ac);
    let agentId = null; try { agentId = onStart(key, chk.goalId, prompt); } catch {}
    const head = name + ' (' + p.label + ') ';
    const done = (async () => {
      let ok = false, text = '', why = '';
      try {
        const r = await run({ ...cmd, cwd: cwd(), env: typeof env === 'function' ? env() : env, timeoutMs, signal: ac.signal, onLine: line => { try { onLine(agentId, line); } catch {} } });
        const out = parseOutput(p.parse, r.stdoutTail);
        if (r.stopped) why = 'stopped by the user';
        else if (r.timedOut) why = 'timed out after ' + Math.round(timeoutMs / 60e3) + ' minutes';
        else if (r.ok && out.text) { ok = true; text = out.text; }
        else why = out.error || parseOutput('gemini-json', r.stderrTail).error || lastLine(r.stderrTail) || (r.code ? 'exited with code ' + r.code : 'it printed no answer'); // Gemini prints its JSON error on stderr
      } catch (e) {
        why = e?.code === 'ENOENT' ? NOT_INSTALLED(p.label) : (e?.message || String(e));
      } finally { runs.delete(key); dec(); }
      let msg;
      if (ok) { const t = redact(text); msg = head + 'finished: ' + t.slice(0, ANSWER_MAX) + (t.length > ANSWER_MAX ? ' (truncated)' : ''); }
      else msg = head + 'could not finish: ' + oneLine(redact(why));
      try { onEnd(agentId, { ok, summary: ok ? oneLine(redact(text)) : oneLine(redact(why)) }); } catch {}
      try { tell(msg); } catch {}
    })();
    done.catch(() => {});
    return { ok: true, text: 'started' };
  }
  return {
    delegate,
    stop: key => { const ac = runs.get(key); if (!ac) return false; ac.abort(); return true; },
    active: () => [...runs.keys()],
  };
}
