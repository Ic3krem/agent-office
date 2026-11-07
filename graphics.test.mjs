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

// ---------- Task 2: store, client, routes ----------
import os from 'node:os';
import path from 'node:path';
import { graphicsStore } from './company.mjs';
const tmpKiro = obj => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ao-gfx-')), 'kiro.json'); if (obj !== undefined) fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('graphicsStore: set keeps other keys, get returns it, invalid throws, junk reads as null', () => {
  const f = tmpKiro({ looks: { it: { prop: 'x' } }, other: 1 });
  const st = graphicsStore(f);
  assert.equal(st.get(), null);
  assert.deepEqual(plain(st.set({ preset: 'low' })), { preset: 'low' });
  assert.deepEqual(plain(st.get()), { preset: 'low' });
  const disk = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(disk.other, 1); assert.deepEqual(disk.looks, { it: { prop: 'x' } });
  assert.throws(() => st.set({ preset: 'x' }), /Invalid graphics settings/);
  assert.deepEqual(plain(st.get()), { preset: 'low' });
  assert.equal(graphicsStore(tmpKiro({ graphics: 'junk' })).get(), null);
});

function clientCtx({ fetchImpl, ls = {} }) {
  const calls = [], listeners = {}, store = { ...ls };
  const c = { calls, store, listeners, document: { cookie: 'ao_nonce=abc', documentElement: { dataset: {} } },
    localStorage: { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); } },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(x => x !== fn); },
    fetch: (u, o) => { calls.push([u, o]); return fetchImpl(u, o); },
    matchMedia: () => ({ matches: false }), devicePixelRatio: 2, navigator: { deviceMemory: 8, hardwareConcurrency: 8 } };
  c.window = c; c.globalThis = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(new URL('./public/graphics.js', import.meta.url), 'utf8'), c, { filename: 'graphics.js' });
  c.Graphics.probe = () => ({ webgl: true, gpuName: 'NVIDIA', deviceMemory: 8, cores: 8 }); // no WebGL in node
  return c;
}
const okJson = j => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });

test('Graphics.load: server null -> detect then POST once, mirrored to localStorage', async () => {
  const c = clientCtx({ fetchImpl: (u, o) => !o || o.method !== 'POST' ? Promise.resolve({ ok: false, status: 405 }) : okJson(u.endsWith('/set') ? { graphics: JSON.parse(o.body) } : { graphics: null }) });
  const r = await c.Graphics.load();
  assert.deepEqual(plain(r), { preset: 'high' });
  const posts = c.calls.filter(([u, o]) => o && o.method === 'POST' && u.endsWith('/set'));
  assert.equal(posts.length, 1); assert.equal(posts[0][0], '/api/graphics/set');
  assert.equal(posts[0][1].headers['x-nonce'], 'abc');
  assert.deepEqual(JSON.parse(c.store['ao.graphics']), { preset: 'high' });
});
test('Graphics.load: server value is used and no POST', async () => {
  const c = clientCtx({ fetchImpl: (u, o) => o && o.method === 'POST' ? okJson({ graphics: { preset: 'ultra' } }) : Promise.resolve({ ok: false, status: 405 }) });
  assert.deepEqual(plain(await c.Graphics.load()), { preset: 'ultra' });
  assert.equal(c.calls.length, 1);
});
test('Graphics.load: fetch rejects -> localStorage value, else detect', async () => {
  const c = clientCtx({ fetchImpl: () => Promise.reject(new Error('down')), ls: { 'ao.graphics': JSON.stringify({ preset: 'low' }) } });
  assert.deepEqual(plain(await c.Graphics.load()), { preset: 'low' });
  const d = clientCtx({ fetchImpl: () => Promise.reject(new Error('down')) });
  assert.deepEqual(plain(await d.Graphics.load()), { preset: 'high' });
});
test('Graphics.onChange fires on storage event and on save; unsubscribe stops it', async () => {
  const c = clientCtx({ fetchImpl: (u, o) => okJson({ graphics: JSON.parse(o.body) }) });
  const got = []; const off = c.Graphics.onChange(s => got.push(plain(s)));
  c.listeners.storage[0]({ key: 'ao.graphics', newValue: JSON.stringify({ preset: 'medium' }) });
  c.listeners.storage[0]({ key: 'other', newValue: '1' });
  await c.Graphics.save({ preset: 'low' });
  assert.deepEqual(got, [{ preset: 'medium' }, { preset: 'low' }]);
  off(); await c.Graphics.save({ preset: 'high' }); assert.equal(got.length, 2);
});
test('Graphics.env reads live: saver default on, reduced from media or data-anim, dpr', () => {
  const c = clientCtx({ fetchImpl: () => okJson({}) });
  assert.deepEqual(plain(c.Graphics.env()), { dpr: 2, reduced: false, saver: true, webgl: true });
  c.store['ao.powerSaver'] = '0'; c.document.documentElement.dataset.anim = 'off';
  const e = c.Graphics.env(); assert.equal(e.saver, false); assert.equal(e.reduced, true);
});
