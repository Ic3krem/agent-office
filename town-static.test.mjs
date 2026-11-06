import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const get = (port, p, cookie) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `127.0.0.1:${port}`, ...(cookie ? { cookie } : {}) } }, res => {
    let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on('error', reject); req.end();
});

test('town: page, pixi and art routes are served to the UI only, with strict names', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-town-')), port = 4797, key = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, USERPROFILE: tmp, HOME: tmp, APPDATA: tmp, LOCALAPPDATA: tmp, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_UI_KEY: key, CLAUDE_CODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { try { child.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const t0 = Date.now(); while (!/running on/.test(out)) { if (Date.now() - t0 > 20000) throw new Error('server did not start: ' + out.slice(0, 400)); await new Promise(r => setTimeout(r, 150)); }
  const ck = 'ao_ui=' + key;
  const town = await get(port, '/town', ck);
  assert.equal(town.status, 200); assert.match(town.headers['content-type'], /text\/html/); assert.match(town.body, /id="town"/);
  const pixi = await get(port, '/vendor/pixi.min.js', ck);
  assert.equal(pixi.status, 200); assert.ok(pixi.body.includes('8.22.0'));
  const paths = ['/art/../server.mjs', '/art/..%2fserver.mjs', '/art/x.exe', '/art/missing.png', '/town/missing.json'];
  for (const p of paths) assert.equal((await get(port, p, ck)).status, 404, p);
  for (const j of ['/town-map.js', '/town-render.js', '/world-player.js']) assert.equal((await get(port, j, ck)).status, 200, j);
  for (const p of ['/town', '/vendor/pixi.min.js', '/town-map.js', '/town-render.js', ...paths]) assert.equal((await get(port, p)).status, 401, 'no cookie ' + p);
});
