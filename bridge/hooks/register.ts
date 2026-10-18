import type { EngineInterface, Register } from 'claude-code'

// Talks to the local Agent Office server (server.mjs). When it is not running, every hook passes straight through.
type Cfg = { port: number; key: string }

function call($: EngineInterface, cfg: Cfg, path: string, body?: unknown) {
  return $.http.fetch(`http://127.0.0.1:${cfg.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-key': cfg.key, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const register: Register = on => {
  let cfg: Cfg | undefined
  let session = ''
  let turnId: string | undefined

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      cfg = JSON.parse(await $.fs.read(`${home}/.claude/agent-office/bridge.json`)) as Cfg
      session = await $.session.id()
    } catch {
      cfg = undefined // dashboard never installed: stay out of the way
      return r
    }
    $.clock.every(1500, async () => {
      try {
        const res = await call($, cfg!, `/bridge/poll?session=${encodeURIComponent(session)}`)
        if (!res.ok) return
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
      const res = await call($, cfg, '/bridge/ask', { session, agentId: e.agentId, tool: e.tool, input: e.input, reason: r.reason })
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
