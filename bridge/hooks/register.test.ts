import { test, expect, mock } from 'claude-code/testing'

const CFG = JSON.stringify({ port: 4777, key: 'k' })

function fakeHost(on: Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[1], answers: Record<string, string>, submitted: string[], asked: unknown[]) {
  on('ui.status', () => ({ value: undefined }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/T' : undefined }))
  on('fs.read', ($, e) => {
    expect(e.path.split('\\').join('/')).toBe('C:/Users/T/.claude/agent-office/bridge.json')
    return { value: CFG }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('http.fetch', ($, e) => {
    expect(e.init?.headers?.['x-key']).toBe('k')
    const path = e.url.replace('http://127.0.0.1:4777', '').split('?')[0]
    if (path === '/bridge/ask') asked.push(JSON.parse(e.init!.body!))
    return { value: { status: 200, ok: true, headers: {}, text: answers[path] ?? '{}' } }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
}

test('an ask goes to the dashboard and its answer wins', async ($, on) => {
  mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = []
  fakeHost(on, { '/bridge/ask': '{"decision":"allow"}', '/bridge/poll': '{"messages":[],"abort":false}' }, submitted, asked)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.check', () => ({ decision: 'ask' as const, reason: 'needs approval' }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf tmp' }, tool_use_id: 'tu1' })
  expect(r.decision).toBe('allow')
  expect(asked).toEqual([expect.objectContaining({ session: 'sess-1', tool: 'Bash' })])
})

test('a terminal answer falls back to the dialog; allowed calls never ask', async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = [], asked: unknown[] = []
  fakeHost(on, { '/bridge/ask': '{"decision":"terminal"}', '/bridge/poll': '{"messages":["hello from the office"],"abort":false}' }, submitted, asked)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.check', ($, e) => ({ decision: (e.tool === 'Read' ? 'allow' : 'ask') as 'allow' | 'ask' }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu2' })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a' }, tool_use_id: 'tu3' })).decision).toBe('allow')
  expect(asked.length).toBe(1)
  await clock.advance(1600)
  expect(submitted).toEqual(['hello from the office'])
})
