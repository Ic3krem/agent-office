import { test, expect, mock } from 'claude-code/testing'

// Runs inside Claude Code's own test harness (it cannot run in this repo's npm test). bridge-register.test.mjs drives the same
// register.ts against the real server with a small host fake and runs in npm test.
const CFG = JSON.stringify({ port: 4777, key: 'k' })

type Seen = { path: string; headers: Record<string, string>; body?: string }
type Opts = { registerAnswer?: { status: number; text: string }; settings?: Record<string, string> }

function fakeHost(on: Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[1], answers: Record<string, string>, submitted: string[], asked: unknown[], seen: Seen[], opts: Opts = {}) {
  on('ui.status', () => ({ value: undefined }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/T' : undefined }))
  on('fs.read', ($, e) => {
    const p = e.path.split('\\').join('/')
    if (p === 'C:/Users/T/.claude/agent-office/bridge.json') return { value: CFG }
    if (opts.settings && p in opts.settings) return { value: opts.settings[p] }
    throw new Error('ENOENT ' + p)
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('http.fetch', ($, e) => {
    expect(e.init?.headers?.['x-key']).toBe('k')
    const path = e.url.replace('http://127.0.0.1:4777', '').split('?')[0]
    seen.push({ path, headers: (e.init?.headers ?? {}) as Record<string, string>, body: e.init?.body })
    if (path === '/bridge/ask') asked.push(JSON.parse(e.init!.body!))
    if (path === '/bridge/register') {
      const r = opts.registerAnswer ?? { status: 200, text: '{"token":"t"}' }
      return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: answers[path] ?? '{}' } }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
}

test('an ask goes to the dashboard and its answer wins, carrying the session token', async ($, on) => {
  mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = [], seen: Seen[] = []
  fakeHost(on, { '/bridge/ask': '{"decision":"allow"}', '/bridge/poll': '{"messages":[],"abort":false}' }, submitted, asked, seen)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.check', () => ({ decision: 'ask' as const, reason: 'needs approval' }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf tmp' }, tool_use_id: 'tu1' })
  expect(r.decision).toBe('allow')
  expect(asked).toEqual([expect.objectContaining({ session: 'sess-1', tool: 'Bash' })])
  const reg = seen.find(s => s.path === '/bridge/register')!
  expect(JSON.parse(reg.body!)).toEqual({ session: 'sess-1' })
  expect(reg.headers['x-session-token']).toBeUndefined()
  expect(seen.find(s => s.path === '/bridge/ask')!.headers['x-session-token']).toBe('t')
})

test('polls carry the session token; a terminal answer falls back to the dialog; allowed calls never ask', async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = [], seen: Seen[] = []
  fakeHost(on, { '/bridge/ask': '{"decision":"terminal"}', '/bridge/poll': '{"messages":["hello from the office"],"abort":false}' }, submitted, asked, seen)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.check', ($, e) => ({ decision: (e.tool === 'Read' ? 'allow' : 'ask') as 'allow' | 'ask' }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu2' })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a' }, tool_use_id: 'tu3' })).decision).toBe('allow')
  expect(asked.length).toBe(1)
  await clock.advance(1600)
  expect(submitted).toEqual(['hello from the office'])
  const poll = seen.find(s => s.path === '/bridge/poll')!
  expect(poll.headers['x-session-token']).toBe('t')
})

test('a duplicate registration (409) backs off without polling or crashing', async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = [], seen: Seen[] = []
  fakeHost(on, { '/bridge/poll': '{"messages":["must not arrive"],"abort":false}' }, submitted, asked, seen, { registerAnswer: { status: 409, text: '{"error":"session already registered"}' } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1600 * 3)
  expect(seen.filter(s => s.path === '/bridge/poll').length).toBe(0)
  expect(seen.filter(s => s.path === '/bridge/register').length).toBeLessThanOrEqual(2) // backoff, not a request every tick
  expect(submitted).toEqual([])
})

test('an older server without /bridge/register (404) is polled unbound, as before', async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = [], seen: Seen[] = []
  fakeHost(on, { '/bridge/poll': '{"messages":["legacy hello"],"abort":false}' }, submitted, asked, seen, { registerAnswer: { status: 404, text: '{"error":"not found"}' } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1600)
  expect(submitted).toEqual(['legacy hello'])
  expect(seen.filter(s => s.path === '/bridge/poll').every(s => s.headers['x-session-token'] === undefined)).toBe(true)
})

test('crossSessionInbound refuse or hold in the user, project or local settings blocks delivery', async ($, on) => {
  for (const [file, value] of [
    ['C:/Users/T/.claude/settings.json', 'refuse'],
    ['C:/x/.claude/settings.json', 'hold'],
    ['C:/x/.claude/settings.local.json', 'refuse'],
  ] as const) {
    const clock = mock.clock(on)
    const submitted: string[] = [], asked: unknown[] = [], seen: Seen[] = []
    fakeHost(on, { '/bridge/poll': '{"messages":["from the dashboard"],"abort":false}' }, submitted, asked, seen, { settings: { [file]: JSON.stringify({ crossSessionInbound: value }) } })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
    await clock.advance(1600)
    expect(submitted).toEqual([])
    expect(seen.find(s => s.path === '/bridge/poll')!.headers['x-session-token']).toBe('t') // still alive, but the queue is not drained
  }
})
