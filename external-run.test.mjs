import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExternal, killAll, liveCount } from './external-run.mjs';
import { resolveLaunch, shellPath } from './external-agents.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-cli/fake-cli.mjs', import.meta.url));
const SHIM = fileURLToPath(new URL('./fixtures/fake-cli/fake-cli.cmd', import.meta.url));
const node = { cmd: process.execPath, pre: [FAKE] };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return fn(); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-run-'));
const echoed = r => JSON.parse(r.stdoutTail.trim().split('\n').at(-1));

const PROMPT = 'a & b | c > d % e ^ f "g" !h %PATH% $(x) `y`\nline2 ünï 中文 \u{1f980}';

test('prompt with shell characters arrives intact, on stdin and as one argv element', async () => {
  const cwd = tmp();
  const a = await runExternal({ cmd: node.cmd, args: [...node.pre], stdin: PROMPT, cwd });
  assert.equal(a.ok, true, a.stderrTail);
  assert.equal(echoed(a).stdin, PROMPT);
  const launch = process.platform === 'win32' ? resolveLaunch(SHIM, 'win32', undefined, shellPath()) : node;
  assert.ok(launch, 'the npm-style shim resolves to node + its entry script');
  assert.equal(path.basename(launch.pre[0]), 'fake-cli.mjs');
  const b = await runExternal({ cmd: launch.cmd, args: [...launch.pre, 'run', PROMPT], stdin: '', cwd });
  assert.equal(b.ok, true, b.stderrTail);
  assert.deepEqual(echoed(b).argv, ['run', PROMPT]);
  assert.deepEqual(fs.readdirSync(cwd), [], 'nothing ran: no file d was created');
});

test('timeout kills the whole tree', async () => {
  const pidfile = path.join(tmp(), 'pids.json');
  const t0 = Date.now();
  const r = await runExternal({ cmd: node.cmd, args: [...node.pre, '--sleep', '60000', '--grandchild', '--pidfile', pidfile], timeoutMs: 1500 });
  assert.equal(r.timedOut, true); assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 10000);
  const { pid, grandchild } = JSON.parse(fs.readFileSync(pidfile, 'utf8'));
  assert.ok(grandchild, 'the fake spawned a grandchild');
  assert.ok(await until(() => !alive(pid) && !alive(grandchild), 3000), 'child and grandchild are gone');
  assert.equal(liveCount(), 0);
});

test('abort stops the run', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 500);
  const r = await runExternal({ cmd: node.cmd, args: [...node.pre, '--sleep', '60000'], signal: ac.signal });
  assert.equal(r.stopped, true); assert.equal(r.ok, false);
  const r2 = await runExternal({ cmd: node.cmd, args: [...node.pre], signal: AbortSignal.abort() });
  assert.equal(r2.stopped, true, 'an already aborted signal never starts');
});

test('spew is capped and memory stays flat', async () => {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  let lines = 0;
  const r = await runExternal({ cmd: node.cmd, args: [...node.pre, '--spew', '20'], onLine: () => lines++ });
  assert.equal(r.ok, true);
  assert.ok(r.stdoutTail.length <= 200 * 1024, String(r.stdoutTail.length));
  assert.ok(r.stdoutTail.endsWith('}\n'), 'the tail holds the end of the output');
  assert.ok(lines > 20000, 'onLine sees every line');
  assert.ok(process.memoryUsage().heapUsed - before < 30 * 1024 * 1024, 'heap grew less than 30 MB');
});

test('non-zero exit and a missing program', async () => {
  const r = await runExternal({ cmd: node.cmd, args: [...node.pre, '--exit', '3'] });
  assert.deepEqual([r.ok, r.code], [false, 3]);
  assert.match(r.stderrTail, /fake failure 3/);
  await assert.rejects(runExternal({ cmd: path.join(tmp(), 'no-such-cli.exe'), args: [] }), /ENOENT/);
  assert.equal(liveCount(), 0);
});

test('killAll stops every live run', async () => {
  const p = runExternal({ cmd: node.cmd, args: [...node.pre, '--sleep', '60000'] });
  await until(() => liveCount() === 1, 3000);
  killAll();
  const r = await p;
  assert.equal(r.stopped, true);
  assert.equal(liveCount(), 0);
});
