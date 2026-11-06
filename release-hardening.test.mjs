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

// ---------------------------------------------------------------- M1 nonce, JSON and same-origin on every /api write
test('M1: every non-GET /api call needs the nonce, a JSON content type and a same-origin page; /bridge keeps its own key', { timeout: 60000 }, async t => {
  const s = await startServer();
  t.after(() => { try { s.child.kill(); } catch {} });
  const ui = { cookie: s.cookie };
  for (const p of ['/api/interrupt', '/api/goal', '/api/boss', '/api/memory/delete', '/api/memory/link', '/api/names/set', '/api/names/reset', '/api/tidy', '/api/limits', '/api/roster', '/api/visibility'])
    assert.equal((await call(s.port, p, { headers: ui, body: { id: 'x', name: 'x', from: 'a-b', to: 'c-d', key: 'forge' } })).status, 403, p + ' without the nonce');
  const plain = await call(s.port, '/api/names/reset', { headers: { ...s.h, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415, 'text/plain (no CORS preflight) is refused');
  assert.equal((await call(s.port, '/api/names/reset', { headers: { ...s.h, 'content-type': '' }, body: '{}' })).status, 415, 'no content type');
  assert.equal((await call(s.port, '/api/names/reset', { headers: { ...s.h, 'sec-fetch-site': 'same-site' } })).status, 403, 'another localhost port is same-site, not same-origin');
  assert.equal((await call(s.port, '/api/names/reset', { headers: { ...s.h, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await call(s.port, '/api/names/reset', { headers: { ...s.h, 'sec-fetch-site': 'same-origin' } })).status, 200, 'the office page itself');
  assert.equal((await call(s.port, '/api/names/reset', { headers: { ...s.h, 'content-type': 'application/json; charset=utf-8' } })).status, 200, 'charset is fine');
  assert.equal((await call(s.port, '/api/names/reset', { headers: s.h })).status, 200, 'the desktop app (no Sec-Fetch-Site)');
  const bridge = JSON.parse(fs.readFileSync(path.join(s.tmp, '.claude', 'agent-office', 'bridge.json'), 'utf8'));
  assert.equal((await call(s.port, '/bridge/register', { headers: { 'x-key': bridge.key }, body: { session: 's1' } })).status, 200, '/bridge/* needs no nonce');
});

test('M1: every client POST to /api sends the nonce and JSON', () => {
  const files = ['public/Agent Office.html', 'public/island.html', 'public/kiro.html', 'public/office-objects.js', 'public/agent-history.js', 'public/world-edit.js', 'public/office-world.js', 'desktop/main.mjs', 'desktop/preload.cjs', 'desktop/office-preload.cjs', 'desktop/island-preload.cjs'];
  let seen = 0;
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/fetch\([^;]*?method\s*:\s*['"]POST['"][^;]*/g)) {
      seen++;
      assert.match(m[0], /x-nonce/, f + ': ' + m[0].slice(0, 80));
      assert.match(m[0], /application\/json/, f + ': ' + m[0].slice(0, 80));
    }
  }
  assert.ok(seen >= 6, 'found the POST helpers (' + seen + ')');
  const main = fs.readFileSync(path.join(ROOT, 'desktop/main.mjs'), 'utf8');
  assert.doesNotMatch(main, /fetch\(BASE \+ '\/api\//, 'the desktop app posts through uiPost (nonce included)');
  assert.match(main, /uiPost\('\/api\/roster'/); assert.match(main, /uiPost\('\/api\/visibility'/);
});

// ---------------------------------------------------------------- M2 layout validation cost
test('M2: a walled-off pocket full of spots is rejected fast (one flood fill), with at most 10 errors; caps hold', async () => {
  const { loadWorld } = await import('./world-vm.mjs');
  const { WorldModel: WM, WorldPath: W } = loadWorld();
  const J = v => JSON.parse(JSON.stringify(v));
  const pocket = n => {
    const L = J(WM.defaultLayout());
    L.size = { w: 4000, h: 4000 };
    L.zones.push({ id: 'wl', type: 'water', rect: [3900, 3900, 3940, 4000] }, { id: 'wt', type: 'water', rect: [3900, 3900, 4000, 3940] });
    for (let i = 0; i < n; i++) L.spots.push({ id: 'p' + i, x: 3970, y: 3970, face: 'n' });
    return L;
  };
  const free = 300 - J(WM.defaultLayout()).spots.length;
  let r; const t0 = performance.now(); r = WM.validate(pocket(free)); const ms = performance.now() - t0;
  assert.equal(r.ok, false);
  assert.ok(ms < 500, 'validate took ' + Math.round(ms) + ' ms');
  assert.ok(r.errors.length <= 10, r.errors.length + ' errors');
  assert.match(r.errors.join('\n'), /p0 is unreachable from spawn/);
  assert.match(WM.validate(pocket(free + 1)).errors.join('\n'), /spots has more than 300/);
  const many = J(WM.defaultLayout()); many.objects = Array.from({ length: 1001 }, (_, i) => ({ id: 'p' + i, type: 'plant', x: 10, y: 10 }));
  assert.match(WM.validate(many).errors.join('\n'), /objects has more than 1000/);
  // reachFrom agrees with findPath on the default world
  const L = J(WM.defaultLayout()), g = WM.gridOf(L), reach = W.reachFrom(g, L.spawn);
  for (const s of Object.values(WM.spotsOf(L))) assert.equal(reach(s), W.findPath(g, L.spawn, s).length > 0, s.id);
  const walled = W.buildGrid({ w: 100, h: 100, cell: 10, blocks: [[40, 0, 50, 100]] });
  assert.equal(W.reachFrom(walled, { x: 5, y: 5 })({ x: 95, y: 5 }), false);
  assert.equal(W.findPath(walled, { x: 5, y: 5 }, { x: 95, y: 5 }).length, 0);
  assert.equal(W.reachFrom(walled, { x: 5, y: 5 })({ x: 45, y: 50 }), true, 'a blocked target is entered from its free ring, like findPath');
});

test('M2: the default layout and the built-in templates still validate, under the caps', () => {
  return import('./world-vm.mjs').then(({ loadWorld }) => {
    const { WorldModel: WM } = loadWorld();
    const dir = path.join(ROOT, 'public', 'world-templates');
    const layouts = [WM.defaultLayout(), ...fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))];
    assert.ok(layouts.length >= 4);
    for (const l of layouts) {
      const r = WM.validate(JSON.parse(JSON.stringify(l)));
      assert.deepEqual(JSON.parse(JSON.stringify(r.errors)), []);
      assert.ok(l.spots.length <= 300 && l.objects.length <= 1000);
    }
  });
});
