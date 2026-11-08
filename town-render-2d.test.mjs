import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

// Canvas2D town renderer in a vm sandbox: a stub 2D context records drawImage calls; images are {url, width, height}.
const terrain = { originPx: [0, 0], chunk: 100, cols: 2, rows: 1, size: [200, 100] };
// Frames a/b/c at distinct atlas x, so a drawImage call names its frame.
const frame = (x) => ({ x, y: 0, w: 10, h: 10, ax: 5, ay: 9, footprint: [-2, -2, 2, 2] });
const atlas = { frames: { a: frame(0), b: frame(20), c: frame(40) } };
// Decor out of depth order; all near the left of the map.
const map = { lots: [], decor: [{ type: 'c', x: 40, y: 40 }, { type: 'a', x: 10, y: 10 }, { type: 'b', x: 25, y: 25 }], spawn: { x: 0, y: 100 } };

function sandbox(extra = {}, scripts = ['town-render.js', 'town-render-2d.js']) {
  const calls = [], rafs = [];
  const ctx2d = new Proxy({ calls, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {}, ...extra }, { get: (o, k) => k in o ? o[k] : k === 'drawImage' ? (img, ...a) => calls.push({ url: img.url, a }) : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const files = { '/atlas.json': atlas, '/terrain.json': terrain };
  const globals = {
    fetch: async u => ({ ok: true, json: async () => files[u], blob: async () => ({ url: u }) }),
    createImageBitmap: async b => ({ url: b.url, width: 100, height: 100 }),
    requestAnimationFrame: f => rafs.push(f), cancelAnimationFrame: () => {},
    setInterval: () => 1, clearInterval: () => {}, performance: { now: () => 0 },
    OfficeSprites: { H: 26, get: () => ({ cv: { url: 'char', width: 18, height: 26 }, w: 18, h: 26 }) },
  };
  const ctx = loadWorld({ ctxFactory: () => ctx2d, globals, extra: scripts });
  ctx.document.hidden = false; ctx.document.addEventListener = ctx.document.removeEventListener = () => {};
  const canvas = { clientWidth: 90, clientHeight: 100, width: 0, height: 0, getContext: () => ctx2d, addEventListener() {}, removeEventListener() {} };
  const flush = () => { while (rafs.length) rafs.shift()(0); };
  return { ctx, calls, canvas, flush };
}
const mountIn = async s => s.ctx.TownRender2D.mount(s.canvas, { map, atlasUrl: '/atlas.json', terrainUrl: '/terrain.json', graphics: { ...s.ctx.Graphics.PRESETS.low, renderScale: 1 }, hour: 12 });

test('kind is canvas, with the same api as the GPU renderer', async () => {
  const s = sandbox(), api = await mountIn(s);
  assert.equal(api.kind, 'canvas');
  for (const k of ['setPlayer', 'setTravellers', 'travellerAt', 'toWorld', 'toScreen', 'setCamera', 'resize', 'setGraphics', 'frameCount', 'stats', 'destroy'])
    assert.equal(typeof api[k], 'function', k);
  s.flush();
  assert.equal(api.frameCount(), 1);
  assert.ok(api.stats().textureBytes > 0);
  s.flush();
  assert.equal(api.frameCount(), 1, 'render on demand: nothing changed, no frame');
});

test('culling: a camera that sees chunk 0 only draws chunk 0, and the other way round', async () => {
  const s = sandbox(), api = await mountIn(s);
  const chunks = () => s.calls.filter(c => /terrain\//.test(c.url)).map(c => c.url);
  s.flush();
  assert.deepEqual(chunks(), ['/terrain/r0c0.png']);
  s.calls.length = 0; api.setCamera(300, 0); s.flush();
  assert.deepEqual(chunks(), ['/terrain/r0c1.png']);
});

test('sprites draw in ascending depthOf, the player after sprites at lower depth', async () => {
  const s = sandbox(), api = await mountIn(s), R = s.ctx.TownRender;
  api.setPlayer({ x: 20, y: 20, face: 's', look: { sig: 'p' } }); s.flush();
  const order = s.calls.filter(c => c.url === '/atlas.png' || c.url === 'char').map(c => c.url === 'char' ? 'p' : 'abc'[c.a[0] / 20]);
  assert.deepEqual(order, ['a', 'p', 'b', 'c']);
  const d = { a: R.depthOf(10, 10), p: R.charPlace(20, 20, 's').z, b: R.depthOf(25, 25), c: R.depthOf(40, 40) };
  for (let i = 1; i < order.length; i++) assert.ok(d[order[i - 1]] < d[order[i]]);
});

test('travellerAt returns the same {id} as the GPU picking math', async () => {
  const s = sandbox(), api = await mountIn(s), R = s.ctx.TownRender;
  const look = { sig: 't' }, list = [{ id: 't1', x: 60, y: 30, face: 's', frame: 1, look, name: 'One' }, { id: 't2', x: 70, y: 20, face: 'w', frame: 2, look, name: 'Two' }];
  api.setTravellers(list); s.flush();
  for (const t of list) {
    const [sx, sy] = R.project(t.x, t.y, 0), cx = sx - 0, cy = sy - 15; // left = top = 0, zoom 1, css = backing px
    assert.equal(api.travellerAt(cx, cy).id, t.id);
    const shown = new Map(list.map(o => [o.id, { x: o.x, y: o.y, name: o.name, dh: 0 }]));
    assert.deepEqual(JSON.parse(JSON.stringify(api.travellerAt(cx, cy))), JSON.parse(JSON.stringify(R.travellerHit(shown, cx, cy, 0, 0, 1, 1))));
  }
  assert.equal(api.travellerAt(89, 2), null);
});

test('tinted copies are dropped when the light goes back to day (no tint): texture bytes return to the day level', async () => {
  const s = sandbox(), low = { ...s.ctx.Graphics.PRESETS.low, renderScale: 1 };
  const api = await s.ctx.TownRender2D.mount(s.canvas, { map, atlasUrl: '/atlas.json', terrainUrl: '/terrain.json', graphics: low, hour: 22 });
  s.flush(); const day = api.stats().textureBytes;
  api.setGraphics({ ...low, lighting: 'tint' }); s.flush();
  const night = api.stats().textureBytes;
  assert.ok(night > day, 'night keeps a tinted atlas copy');
  api.setGraphics(low); s.flush();
  assert.equal(api.stats().textureBytes, day, 'day drops it');
});

test('tint shadows: each pixel is rgb x tint with alpha kept, so 2D night shadows are darker than day (as on the GPU)', async () => {
  const s0 = sandbox(), G = s0.ctx.Graphics, night = G.tintOf(G.nightOf(22));
  const shadow = [26, 34, 64, 90], px = s0.ctx.TownRender2D.mulTint(Uint8ClampedArray.from(shadow), night);
  const t = [night >> 16 & 255, night >> 8 & 255, night & 255];
  for (let c = 0; c < 3; c++) {
    assert.equal(px[c], Math.round(shadow[c] * t[c] / 255), 'channel ' + c + ' = src x tint');
    assert.ok(px[c] < shadow[c], 'channel ' + c + ' darker at night');
  }
  assert.equal(px[3], 90, 'alpha kept');
  // wired in: the tinted shadow copy is the putImageData of src x tint
  const puts = [], s = sandbox({ getImageData: () => ({ data: Uint8ClampedArray.from(shadow) }), putImageData: d => puts.push([...d.data]) });
  const api = await s.ctx.TownRender2D.mount(s.canvas, { map, atlasUrl: '/atlas.json', terrainUrl: '/terrain.json', graphics: { ...G.PRESETS.low, renderScale: 1, shadows: 'tint' }, hour: 22 });
  s.flush();
  assert.ok(puts.length >= 1 && puts.every(p => p.slice(0, 3).every((v, c) => v < shadow[c]) && p[3] === 90), JSON.stringify(puts));
  api.destroy();
});

// ---------- town step 5: spots ----------
test('spots: the tree of life and a seated visitor draw at rest, a shooter with its ball and a dog walker with the dog', async () => {
  const s = sandbox({}, ['town-map.js', 'town-ambient.js', 'town-render.js', 'town-render-2d.js']);
  Object.assign(atlas.frames, { 'tree-of-life': frame(60), ball: frame(80), 'dog.rest': frame(100) });
  const spots = [{ id: 'tree', kind: 'tree', props: [{ type: 'tree-of-life', x: 30, y: 30 }] }, { id: 'court', kind: 'court', props: [{ type: 'hoop', x: 0, y: 0 }] },
    { id: 'park', kind: 'park', props: [], loop: [[50, 20], [90, 50], [60, 80], [40, 50]] }];
  const api = await s.ctx.TownRender2D.mount(s.canvas, { map: { ...map, spots }, atlasUrl: '/atlas.json', terrainUrl: '/terrain.json', graphics: { ...s.ctx.Graphics.PRESETS.low, renderScale: 1 }, hour: 12 });
  const look = { sig: 'v' };
  api.setTravellers([{ id: 'v1', x: 60, y: 45, face: 's', pose: 'sit', spot: 'tree', look, name: 'Sat' }, { id: 'v2', x: 70, y: 30, face: 'n', pose: 'shoot', spot: 'court', look, name: 'Shot' },
    { id: 'v3', x: 90, y: 50, face: 'e', pose: 'dogwalk', spot: 'park', look, name: 'Walk' }]);
  s.flush();
  const atlasX = s.calls.filter(c => c.url === '/atlas.png').map(c => c.a[0]);
  for (const [name, x] of [['tree-of-life', 60], ['ball', 80], ['dog.rest', 100]]) assert.ok(atlasX.includes(x), name + ' drawn');
  assert.equal(s.calls.filter(c => c.url === 'char').length, 3, 'three visitors');
  assert.equal(api.travellerAt(...(() => { const [sx, sy] = s.ctx.TownRender.project(90, 50, 0); return [sx, sy - 15]; })()).id, 'v3', 'the dog walker rests at its point');
  for (const k of ['tree-of-life', 'ball', 'dog.rest']) delete atlas.frames[k];
});
