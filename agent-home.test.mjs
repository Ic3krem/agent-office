import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentHome, KEYS, redact } from './agent-home.mjs';
import { ROSTER } from './company.mjs';

const mk = () => agentHome(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ah-')), 'agents'));

test('tiro is the parent folder; every roster key has its own memory and history', () => {
  const h = mk(); h.ensureAll();
  assert.deepEqual(KEYS, ['tiro', ...Object.keys(ROSTER)]);
  for (const k of Object.keys(ROSTER)) {
    assert.equal(path.dirname(h.dir(k)), h.dir('tiro'), k + ' sits under tiro');
    assert.ok(fs.existsSync(path.join(h.memoryDir(k), 'MEMORY.md')));
    assert.ok(fs.existsSync(h.histDir(k)));
  }
  assert.equal(new Set(KEYS.map(k => h.memoryDir(k))).size, KEYS.length, 'all memory dirs distinct');
  assert.throws(() => h.dir('..'), /Unknown agent type/);
  assert.throws(() => h.memoryDir('../x'), /Unknown agent type/);
});

test('task history: start, end, summary file, goal link, search, parent index', () => {
  const h = mk();
  const id = h.start('forge', { goalId: 'g6b6c19', title: 'Fix <b>names</b>', brief: 'dup names bug' });
  assert.equal(h.openCount('forge'), 1);
  h.end('forge', { agentId: 'abc', transcript: 'C:/x/agent-abc.jsonl', summary: 'Fixed it. token=abcd1234efgh5678' });
  assert.equal(h.openCount('forge'), 0);
  const [t] = h.tasks('forge');
  assert.equal(t.id, id); assert.equal(t.goalId, 'g6b6c19'); assert.equal(t.transcript, 'C:/x/agent-abc.jsonl');
  assert.ok(t.endedAt && t.startedAt);
  assert.doesNotMatch(t.summary, /abcd1234efgh5678/);
  assert.doesNotMatch(h.read('forge', id), /abcd1234efgh5678/);
  assert.match(h.read('forge', id), /Final report/);
  assert.equal(h.search('forge', 'names').length, 1);
  assert.equal(h.search('forge', 'zzz').length, 0);
  assert.equal(h.tasks('pixel').length, 0, 'other agents unaffected');
  assert.equal(h.tasks('tiro').length, 1, 'tiro lists the hire');
  assert.equal(h.tasks('tiro')[0].hired, 'forge');
  assert.equal(h.read('forge', '../../etc'), '');
  assert.equal(h.overview().find(o => o.key === 'forge').tasks, 1);
});

test('concurrent same-key stops pair FIFO; a stop with no start still records', () => {
  const h = mk();
  const a = h.start('atlas', { title: 'one' }), b = h.start('atlas', { title: 'two' });
  assert.equal(h.end('atlas', { summary: 's1' }), a);
  assert.equal(h.end('atlas', { summary: 's2' }), b);
  assert.equal(h.tasks('atlas').length, 2);
  h.end('scribe', { summary: 'orphan' });
  assert.equal(h.tasks('scribe').length, 1);
});

test('memory note points at the key folder, read-only roles are told they cannot write', () => {
  const h = mk();
  assert.ok(h.note('forge').includes(h.memoryDir('forge')));
  assert.match(h.note('forge'), /fresh context/);
  assert.match(h.note('warden'), /read-only/);
  assert.doesNotMatch(h.note('forge'), /read-only/);
  assert.match(redact('Authorization: Bearer abcdefghijklmnop'), /redacted/);
});

test('server wiring: hooks record history, endpoints exist, package ships the module', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /AH\.start\(k,/); assert.match(src, /AH\.end\(k,/);
  for (const r of ['overview', 'tasks', 'task']) assert.ok(src.includes("/api/agents/" + r));
  assert.match(src, /AH\.note\(ALIASES\[k\] \|\| k\)/);
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('agent-home.mjs'));
  assert.ok(fs.existsSync(new URL('./public/agent-history.js', import.meta.url)));
});

test('redact: short secrets and full PEM go, ordinary prose stays', () => {
  assert.doesNotMatch(redact('password=hunter2'), /hunter2/);
  assert.doesNotMatch(redact('token: ab12'), /ab12/);
  const pem = redact('x -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY----- y');
  assert.equal(pem, 'x [redacted] y');
  assert.equal(redact('Review the password management policy and token usage'), 'Review the password management policy and token usage');
  assert.match(redact('Authorization: Bearer abcdefghijklmnop'), /redacted/);
});

test('read-only note has a space before the secrets sentence', () => {
  assert.match(mk().note('warden'), /for you\. Never store secrets/);
  assert.match(mk().note('forge'), /current\. Never store secrets/);
});
