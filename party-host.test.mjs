import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureCloudflared, inviteCode, freePort, CLOUDFLARED } from './party-host.mjs';

test('host: cloudflared is used only after its pinned SHA-256 matches; a bad download is deleted; a good one is reused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-host-')), body = Buffer.from('fake cloudflared');
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  let calls = 0; const fetchImpl = async url => { calls++; assert.match(url, /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\/2026\.10\.7\/cloudflared-linux-amd64$/); return { ok: true, status: 200, arrayBuffer: async () => body }; };
  await assert.rejects(ensureCloudflared(dir, { fetchImpl, platform: 'linux', arch: 'x64' }), /checksum/);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing kept from a bad download');
  const real = CLOUDFLARED['linux-x64'].sha256; CLOUDFLARED['linux-x64'].sha256 = sha;
  try {
    const exe = await ensureCloudflared(dir, { fetchImpl, platform: 'linux', arch: 'x64' });
    assert.equal(fs.readFileSync(exe, 'utf8'), 'fake cloudflared');
    await ensureCloudflared(dir, { fetchImpl, platform: 'linux', arch: 'x64' });
    assert.equal(calls, 2, 'the checked copy is reused, not downloaded again');
  } finally { CLOUDFLARED['linux-x64'].sha256 = real; fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(await ensureCloudflared(dir, { fetchImpl, platform: 'freebsd', arch: 'x64' }), null, 'no build for this machine');
  const r = await ensureCloudflared(dir, { fetchImpl: async () => ({ ok: false, status: 404 }), platform: 'win32', arch: 'x64' }).catch(e => e.message);
  assert.match(r, /HTTP 404/);
});

test('host: invite codes avoid look-alike characters; freePort finds a free local port', async () => {
  for (let i = 0; i < 50; i++) assert.match(inviteCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  const p = await freePort(4880, 20); assert.ok(p >= 4880 && p < 4900);
});
