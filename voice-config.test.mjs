import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVoiceConfig, writeVoiceConfig, iceServers } from './voice-config.mjs';

test('iceServers: STUN defaults, TURN added only when valid', () => {
  assert.deepEqual(iceServers({ turn: null }), [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]);
  assert.equal(iceServers({ turn: { url: 'turn:relay.example.org:3478', user: 'u', pass: 'p' } })[1].urls, 'turn:relay.example.org:3478');
  assert.equal(iceServers({ turn: { url: 'https://x', user: 'u', pass: 'p' } }).length, 1, 'an invalid relay is never handed to the page');
});

test('writeVoiceConfig rejects bad TURN urls; a corrupt file reads as no relay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-cfg-'));
  try {
    assert.deepEqual(readVoiceConfig(dir), { turn: null }, 'no file yet');
    for (const turn of [{ url: 'https://x', user: 'u', pass: 'p' }, { url: 'turn:a b', user: 'u', pass: 'p' }, { url: 'turn:a.test', user: 'x'.repeat(300), pass: 'p' }, { url: 'turn:a.test', user: 'u', pass: 5 }])
      assert.throws(() => writeVoiceConfig(dir, { turn }));
    const turn = { url: 'turns:relay.example.org:443?transport=tcp', user: 'u', pass: 'p' };
    writeVoiceConfig(dir, { turn });
    assert.deepEqual(readVoiceConfig(dir), { turn });
    writeVoiceConfig(dir, { turn: null });
    assert.deepEqual(readVoiceConfig(dir), { turn: null });
    fs.writeFileSync(path.join(dir, 'voice.json'), '{not json');
    assert.equal(readVoiceConfig(dir).turn, null);
    fs.writeFileSync(path.join(dir, 'voice.json'), JSON.stringify({ turn: { url: 'https://x', user: 'u', pass: 'p' } }));
    assert.equal(readVoiceConfig(dir).turn, null, 'a hand-edited bad url reads as no relay');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
