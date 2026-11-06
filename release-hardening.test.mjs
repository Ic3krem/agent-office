// Pre-release robustness and safety fixes (H1-H2, M1-M5, L1-L9): untrusted transcripts, notes, layouts, bodies and SOP notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, newAgent } from './transcript.mjs';
import { mdToHtml } from './reports.mjs';
import { agentVault } from './vault.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function startServer(prep) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-rh-')), port = 46900 + Math.floor(Math.random() * 400), uiKey = crypto.randomBytes(24).toString('hex');
  if (prep) prep(tmp);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { env: { ...process.env, USERPROFILE: tmp, HOME: tmp, APPDATA: tmp, LOCALAPPDATA: tmp, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: uiKey, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      const m = /running on http:\/\/localhost:(\d+)/.exec(out);
      if (m) {
        const p = Number(m[1]), cookie = 'ao_ui=' + uiKey;
        const page = await call(p, '/', { method: 'GET', headers: { cookie } });
        const nonce = page.headers['set-cookie'].join(';').match(/ao_nonce=([0-9a-f]+)/)[1];
        return resolve({ child, port: p, tmp, uiKey, cookie, nonce, h: { cookie, 'x-nonce': nonce }, log: () => out });
      }
      if (Date.now() - t0 > 20000) { child.kill(); return reject(new Error('server did not start: ' + out.slice(0, 300))); }
      setTimeout(tick, 150);
    };
    tick();
  });
}
// body: an object is sent as JSON; a string is sent as is. headers default to application/json.
function call(port, p, { method = 'POST', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: host || `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, res => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end(body === undefined ? (method === 'POST' ? '{}' : undefined) : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timed = f => { const t = performance.now(); f(); return performance.now() - t; };

// ---------------------------------------------------------------- H1 transcripts
test('H1: transcript fields of the wrong type are dropped, never stored', () => {
  const a = newAgent('x');
  const odd = { x: 1 };
  apply(a, { type: 'user', cwd: odd, timestamp: new Date().toISOString(), message: { content: '<not a prompt>' } });
  apply(a, { type: 'ai-title', aiTitle: odd });
  apply(a, { type: 'custom-title', customTitle: ['t'] });
  apply(a, { type: 'permission-mode', permissionMode: 7 });
  apply(a, { type: 'assistant', isApiErrorMessage: true, error: odd, message: { model: odd, content: 'not an array', usage: { output_tokens: '9' }, id: 'm' } });
  assert.equal(a.apiError, 'error', 'a non-string error reads as a plain error');
  apply(a, { type: 'assistant', message: { content: [null, { type: 'text', text: odd }, { type: 'tool_use', name: 'Bash', input: null }] } });
  apply(a, { type: 'user', message: { content: [null, { type: 'text', text: 5 }, { type: 'tool_result', content: [null] }] } });
  for (const k of ['cwd', 'mode', 'model', 'apiError']) assert.equal(typeof a[k], 'string', k);
  assert.equal(a.cwd, ''); assert.equal(a.title, undefined);
  assert.equal(path.basename(a.cwd || ''), '', 'the snapshot name fallback works');
  const b = newAgent('y');
  apply(b, { type: 'user', cwd: 'C:\\work\\' + 'x'.repeat(5000), message: { content: 'hi' } });
  assert.ok(b.cwd.length <= 1000, 'cwd is capped');
});

test('H1: a poisoned transcript does not crash the stream or the server', { timeout: 60000 }, async t => {
  const line = JSON.stringify({ type: 'user', cwd: { x: 1 }, aiTitle: { y: 2 }, timestamp: new Date().toISOString(), message: { content: '<not a prompt>' } }) + '\n';
  const dir = tmp => path.join(tmp, '.claude', 'projects', 'C--evil');
  const s = await startServer(tmp => { fs.mkdirSync(dir(tmp), { recursive: true }); fs.writeFileSync(path.join(dir(tmp), 'aaaaaaaa-0000-0000-0000-000000000001.jsonl'), line); });
  t.after(() => { try { s.child.kill(); } catch {} });
  let events = 0;
  const req = http.request({ host: '127.0.0.1', port: s.port, path: '/api/stream', headers: { host: `127.0.0.1:${s.port}`, cookie: s.cookie } }, res => res.on('data', () => { events++; }));
  req.end();
  await sleep(1200);
  fs.writeFileSync(path.join(dir(s.tmp), 'aaaaaaaa-0000-0000-0000-000000000002.jsonl'), line.repeat(3) + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }) + '\n');
  await sleep(3500);
  req.destroy();
  assert.ok(events >= 1, 'the stream sent snapshots');
  assert.doesNotMatch(s.log(), /uncaughtException|TypeError/);
  assert.equal(s.child.exitCode, null, 'still running');
  assert.equal((await call(s.port, '/api/roster', { headers: s.h })).status, 200, 'still answering');
});

// ---------------------------------------------------------------- H2 quadratic regex
test('H2: 200 KB of "[[" renders and graphs in well under 200 ms; the graph is cached until a note changes', () => {
  const big = '[['.repeat(100000);
  assert.ok(timed(() => mdToHtml(big)) < 200, 'mdToHtml');
  assert.ok(timed(() => mdToHtml('a [[b|' + big)) < 200, 'mdToHtml with an open alias');
  assert.match(mdToHtml('see [[Agent Office/Reports/x\\|Title]] and [[note]]'), /<span class="wl">Title<\/span> and <span class="wl">note<\/span>/, 'links still render');
  const V = agentVault(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-rh-v-')));
  fs.writeFileSync(path.join(V.dirs.memory, 'evil-note.md'), '---\nname: evil-note\ndescription: x\n---\n' + big + '\n');
  V.write('a-note', { body: 'Related: [[evil-note]] and [[a-note|self]] and [[missing]]' });
  let g;
  assert.ok(timed(() => { g = V.graph(); }) < 200, 'graph');
  assert.deepEqual(g.edges, [{ from: 'a-note', to: 'evil-note' }]);
  assert.equal(V.graph(), g, 'unchanged folder: the cached graph');
  V.write('b-note', { body: '[[a-note]]' });
  assert.equal(V.graph().nodes.length, 3, 'a new note refreshes the graph');
});

test('H2: markdown over 256 KB is rendered shortened, with a note', () => {
  const html = mdToHtml('word '.repeat(80000));
  assert.match(html, /Shortened: only the first 256 KB is shown/);
  assert.ok(html.length < 300 * 1024);
});
