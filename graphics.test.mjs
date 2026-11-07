import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('./public/graphics.js', import.meta.url), 'utf8'), ctx, { filename: 'graphics.js' });
const G = ctx.Graphics;
const plain = v => JSON.parse(JSON.stringify(v));

test('presets match the spec table', () => {
  assert.deepEqual(plain(G.PRESETS.low), { renderScale: .5, fps: 15, shadows: 'off', ambient: 'off', lighting: 'off', renderer: 'canvas' });
  assert.deepEqual(plain(G.PRESETS.medium), { renderScale: .75, fps: 30, shadows: 'blob', ambient: 'water', lighting: 'tint', renderer: 'auto' });
  assert.deepEqual(plain(G.PRESETS.high), { renderScale: 1, fps: 30, shadows: 'soft', ambient: 'all', lighting: 'glow', renderer: 'gpu' });
  assert.deepEqual(plain(G.PRESETS.ultra), { renderScale: 2, fps: 60, shadows: 'tint', ambient: 'particles', lighting: 'pools', renderer: 'gpu' });
});
test('normalize: junk -> null, custom keeps only valid fields and fills the rest from high', () => {
  for (const j of [null, 5, 'x', { preset: 'mega' }, { preset: 'custom', custom: 'no' }]) assert.equal(G.normalize(j), null);
  assert.deepEqual(plain(G.normalize({ preset: 'low', extra: 1 })), { preset: 'low' });
  assert.deepEqual(plain(G.normalize({ preset: 'custom', custom: { fps: 60, shadows: 'nope', renderScale: 3 } })),
    { preset: 'custom', custom: { ...plain(G.PRESETS.high), fps: 60 } });
});
test('resolve: ultra scale is min(2, dpr); no webgl forces canvas; reduced -> ambient off; saver caps ambientFps at 8', () => {
  const env = { dpr: 1.5, reduced: false, saver: false, webgl: true };
  assert.equal(G.resolve({ preset: 'ultra' }, env).renderScale, 1.5);
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, dpr: 3 }).renderScale, 2);
  assert.equal(G.resolve({ preset: 'high' }, { ...env, webgl: false }).renderer, 'canvas');
  assert.equal(G.resolve({ preset: 'medium' }, env).renderer, 'gpu');
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, reduced: true }).ambient, 'off');
  assert.equal(G.resolve({ preset: 'ultra' }, { ...env, saver: true }).ambientFps, 8);
  assert.equal(G.resolve({ preset: 'ultra' }, env).ambientFps, 60);
});
test('detect: spec rules', () => {
  const hi = { webgl: true, gpuName: 'NVIDIA GeForce RTX 3050', deviceMemory: 8, cores: 16 };
  assert.equal(G.detect(hi), 'high');
  assert.equal(G.detect({ ...hi, webgl: false }), 'low');
  assert.equal(G.detect({ ...hi, deviceMemory: 4 }), 'low');
  assert.equal(G.detect({ ...hi, cores: 4 }), 'low');
  assert.equal(G.detect({ ...hi, gpuName: 'Intel(R) UHD Graphics 620' }), 'medium');
  assert.equal(G.detect({ ...hi, gpuName: 'AMD Radeon(TM) Graphics' }), 'medium');
  assert.equal(G.detect({ ...hi, gpuName: '' }), 'high');
  assert.equal(G.detect({ ...hi, deviceMemory: undefined }), 'high'); // unknown memory is not low
});
test('nightOf matches the office formula; tintOf ends', () => {
  assert.equal(G.nightOf(12), 0); assert.equal(G.nightOf(22), 1); assert.equal(G.nightOf(19), .5); assert.equal(G.nightOf(6), .5);
  assert.equal(G.tintOf(0), 0xffffff); assert.equal(G.tintOf(.5), 0xffd2a8); assert.equal(G.tintOf(1), 0x6f7fb8);
});
