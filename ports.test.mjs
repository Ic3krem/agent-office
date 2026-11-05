import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { candidatePorts, listenFirstFree, publishedPort, isAgentOffice, MARKER, DEFAULT_PORT, PORT_SPAN } from './ports.mjs';
import { loadBridgeKey } from './auth.mjs';

const listening = (handler = (q, r) => r.end('x')) => new Promise(res => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
const close = s => new Promise(r => s.close(r));

test('candidate ports: 4777 first then the next ones; AGENT_OFFICE_PORT pins exactly one', () => {
  const c = candidatePorts({});
  assert.equal(c[0], DEFAULT_PORT); assert.equal(c.length, PORT_SPAN); assert.equal(c.at(-1), DEFAULT_PORT + PORT_SPAN - 1);
  assert.deepEqual(candidatePorts({ AGENT_OFFICE_PORT: '47123' }), [47123]);
  assert.equal(candidatePorts({ AGENT_OFFICE_PORT: 'nope' })[0], DEFAULT_PORT);
  assert.equal(candidatePorts({ AGENT_OFFICE_PORT: '70000' })[0], DEFAULT_PORT);
});

test('a port held by an unrelated program is skipped; the bound port is returned', async t => {
  const foreign = await listening(); t.after(() => close(foreign));
  const held = foreign.address().port, s = http.createServer(); t.after(() => close(s));
  const got = await listenFirstFree(s, [held, 0]);
  assert.notEqual(got, held); assert.equal(s.address().port, got);
  assert.equal(s.listenerCount('error'), 0, 'no stray error listener is left behind');
});

test('a port held by another Agent Office is not skipped: already running', async t => {
  const other = await listening((q, r) => { r.setHeader(MARKER, '1'); r.end(); }); t.after(() => close(other));
  const held = other.address().port, s = http.createServer();
  assert.equal(await isAgentOffice(held), true);
  await assert.rejects(listenFirstFree(s, [held, 0]), e => e.code === 'AO_RUNNING' && e.port === held);
  assert.equal(s.listening, false);
});

test('every candidate taken: a clear error', async t => {
  const a = await listening(); t.after(() => close(a));
  await assert.rejects(listenFirstFree(http.createServer(), [a.address().port], { probe: async () => false }), e => e.code === 'AO_NO_PORT');
});

test('bridge.json: a start without a port keeps the published one; the bound port replaces it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ports-')), f = path.join(dir, 'bridge.json');
  const { key } = loadBridgeKey(f, 4779);
  assert.equal(loadBridgeKey(f).key, key);
  assert.equal(publishedPort(f), 4779, 'a copy that has not bound yet (and may find the office already running) leaves the port alone');
  loadBridgeKey(f, 4781);
  assert.equal(publishedPort(f), 4781);
  assert.equal(publishedPort(path.join(dir, 'missing.json')), 0);
});
