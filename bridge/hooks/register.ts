import type { EngineInterface, Register } from 'claude-code'

// Talks to the local Agent Office server (server.mjs). When it is not running, every hook passes straight through.
type Cfg = { port: number; key: string }
type Res = { ok: boolean; status?: number; text: string }

function call($: EngineInterface, cfg: Cfg, path: string, body?: unknown, token = ''): Promise<Res> {
  return $.http.fetch(`http://127.0.0.1:${cfg.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-key': cfg.key, 'content-type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Promise<Res>
}

export const register: Register = on => {
  let cfg: Cfg | undefined
  let session = ''
  let turnId: string | undefined
  let inboundBlocked = false // the user's crossSessionInbound setting is 'refuse' or 'hold': dashboard messages are not delivered
  // The server binds a registered session to a private token (so another session cannot poll or answer for it). An older server has
  // no /bridge/register (404): then polling stays unbound, exactly as before.
  let token = ''
  let unbound = false
  let fails = 0
  let wait = 0 // poll ticks to skip after a failed registration (backoff: 2, 4, 8 ... up to 20 ticks of 1.5 s)

  // true when this terminal may poll now (it has a token, or the server predates tokens)
  async function ensureToken($: EngineInterface): Promise<boolean> {
    if (token || unbound) return true
    if (wait > 0) { wait--; return false }
    try {
      const rr = await call($, cfg!, '/bridge/register', { session })
      if (rr.status === 404) { unbound = true; return true }
      if (rr.ok) {
        token = (JSON.parse(rr.text) as { token?: string }).token ?? ''
        if (token) { fails = 0; return true }
      }
    } catch {
      // server down: try again after the backoff
    }
    fails++
    wait = Math.min(20, 2 ** fails) // 409 (another live terminal holds this session id) lands here too: back off, never crash
    return false
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      cfg = JSON.parse(await $.fs.read(`${home}/.claude/agent-office/bridge.json`)) as Cfg
      session = await $.session.id()
      // crossSessionInbound from every settings scope Claude Code reads (user, project, local): any 'refuse' or 'hold' blocks delivery.
      inboundBlocked = false
      for (const f of [`${home}/.claude/settings.json`, `${e.cwd}/.claude/settings.json`, `${e.cwd}/.claude/settings.local.json`]) {
        try {
          const mode = (JSON.parse(await $.fs.read(f)) as { crossSessionInbound?: string }).crossSessionInbound
          if (mode === 'refuse' || mode === 'hold') inboundBlocked = true
        } catch {
          // that scope has no settings file
        }
      }
      token = ''; unbound = false; fails = 0; wait = 0
      await ensureToken($)
    } catch {
      cfg = undefined // dashboard never installed: stay out of the way
      return r
    }
    $.clock.every(1500, async () => {
      try {
        if (!(await ensureToken($))) return
        // blocked by the user's crossSessionInbound: only report that this terminal is alive; the queue is left untouched
        const res = await call($, cfg!, `/bridge/poll?session=${encodeURIComponent(session)}${inboundBlocked ? '&hold=1' : ''}`, undefined, token)
        if (res.status === 403) { token = ''; return } // the token no longer matches (another terminal took the session id): register again, with backoff
        if (!res.ok) return
        if (inboundBlocked) return // honour the user's setting: nothing is injected as if the user had typed it
        const { messages, abort } = JSON.parse(res.text) as { messages: string[]; abort: boolean }
        if (abort && turnId) await $.turn.abort({ turnId })
        for (const text of messages) await $.prompt.submit({ text, asUser: true })
      } catch {
        // server down; try again next tick
      }
    })
    return r
  })

  on('turn.start', ($, e, next) => {
    turnId = e.turnId
    return next(e)
  })

  // A permission prompt goes to the dashboard first; no answer (or nobody watching) falls back to the terminal dialog.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision !== 'ask' || !cfg || !e.tool_use_id) return r
    try {
      $.ui.status('Waiting for your answer in Agent Office…')
      const res = await call($, cfg, '/bridge/ask', { session, agentId: e.agentId, tool: e.tool, input: e.input, reason: r.reason }, token)
      const { decision } = JSON.parse(res.text) as { decision: string }
      if (decision === 'allow') return { ...r, decision: 'allow', reason: 'Approved in Agent Office' }
      if (decision === 'deny') return { ...r, decision: 'deny', reason: 'Denied by the user in Agent Office' }
    } catch {
      // server unreachable: let the terminal ask
    } finally {
      $.ui.status(undefined)
    }
    return r
  }).catch(($, e, next) => next(e))
}
