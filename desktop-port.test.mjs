import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { candidatePorts } from './ports.mjs';

const src = fs.readFileSync(new URL('./desktop/main.mjs', import.meta.url), 'utf8');

test('desktop shell derives its base URL from candidatePorts (AGENT_OFFICE_PORT), not a hardcoded 4777', () => {
  assert.match(src, /candidatePorts\(\)/);
  assert.doesNotMatch(src, /DEFAULT_PORT/);
  assert.doesNotMatch(src, /localhost:4777/);
  assert.match(src, /if \(PINNED\) return false/); // a pinned copy ignores bridge.json
});
test('candidatePorts pins one port, ignores invalid values', () => {
  assert.deepEqual(candidatePorts({ AGENT_OFFICE_PORT: '4790' }), [4790]);
  assert.equal(candidatePorts({ AGENT_OFFICE_PORT: 'x' })[0], 4777);
});
