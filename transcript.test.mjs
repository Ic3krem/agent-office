import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, newAgent, statusOf } from './transcript.mjs';

const T = '2026-10-17T10:00:00.000Z';
test('a turn goes working -> idle and logs what happened', () => {
  const a = newAgent('s1');
  apply(a, { type: 'ai-title', aiTitle: 'Fix M3 retry' });
  apply(a, { type: 'user', timestamp: T, message: { content: 'fix the retry' } });
  assert.equal(statusOf(a, Date.parse(T)), 'working');
  const r = apply(a, { type: 'assistant', timestamp: T, message: { id: 'm1', model: 'claude-opus-5-5', usage: { output_tokens: 42 }, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } });
  assert.equal(r.tokens, 42);
  assert.equal(apply(a, { type: 'assistant', timestamp: T, message: { id: 'm1', usage: { output_tokens: 42 }, content: [] } }).tokens, 0, 'same message counted once');
  assert.match(a.task, /^Bash · ls -la/);
  apply(a, { type: 'user', timestamp: T, message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } });
  apply(a, { type: 'assistant', timestamp: T, message: { content: [{ type: 'text', text: 'Done.' }] } });
  assert.equal(statusOf(a, Date.parse(T) + 1000), 'working', 'text mid-turn is not the end yet');
  assert.equal(statusOf(a, Date.parse(T) + 10000), 'idle');
  assert.equal(apply(a, { type: 'system', subtype: 'stop_hook_summary', timestamp: T }).turnEnded, true);
  assert.equal(statusOf(a), 'idle');
  assert.deepEqual(a.logs.map(l => l.k), ['user', 'tool', 'err', 'agent']);
  assert.equal(a.title, 'Fix M3 retry');
  a.perms = [{ askId: 'x' }];
  assert.equal(statusOf(a), 'blocked');
});

test('meta and wrapper messages stay out of the chat', () => {
  const a = newAgent('s2');
  apply(a, { type: 'user', isMeta: true, message: { content: 'hidden' } });
  apply(a, { type: 'user', timestamp: T, message: { content: '<system-reminder>x</system-reminder>' } });
  apply(a, { type: 'user', timestamp: T, message: { content: '<command-name>/design-login</command-name>' } });
  assert.deepEqual(a.logs.map(l => [l.k, l.text]), [['sys', '/design-login']]);
});

test('API failures show as limited or error until the next prompt; tokens add up per turn', () => {
  const a = newAgent('s3');
  apply(a, { type: 'user', timestamp: T, message: { content: 'go' } });
  apply(a, { type: 'assistant', timestamp: T, message: { id: 'm1', usage: { output_tokens: 30 }, content: [] } });
  apply(a, { type: 'assistant', timestamp: T, message: { id: 'm2', usage: { output_tokens: 12 }, content: [] } });
  assert.equal(a.turnTok, 42);
  apply(a, { type: 'assistant', timestamp: T, isApiErrorMessage: true, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your session limit" }] } });
  assert.equal(statusOf(a, Date.parse(T)), 'limited');
  apply(a, { type: 'user', timestamp: T, message: { content: 'retry' } });
  assert.equal(statusOf(a, Date.parse(T)), 'working');
  assert.equal(a.turnTok, 0);
});
