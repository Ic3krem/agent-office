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

function sandbox() {
  const calls = [], rafs = [];
  const ctx2d = new Proxy({ calls }, { get: (o, k) => k in o ? o[k] : k === 'drawImage' ? (img, ...a) => calls.push({ url: img.url, a }) : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const files = { '/atlas.json': atlas, '/terrain.json': terrain };
  const globals = {
    fetch: async u => ({ ok: true, json: async () => files[u], blob: async () => ({ url: u }) }),
    createImageBitmap: async b => ({ url: b.url, width: 100, height: 100 }),
    requestAnimationFrame: f => rafs.push(f), cancelAnimationFrame: () => {},
    setInterval: () => 1, clearInterval: () => {}, performance: { now: () => 0 },
    OfficeSprites: { H: 26, get: () => ({ cv: { url: 'char', width: 18, height: 26 }, w: 18, h: 26 }) },
  };
  const ctx = loadWorld({ ctxFactory: () => ctx2d, globals, extra: ['town-render.js', 'town-render-2d.js'] });
  ctx.document.hidden = false; ctx.document.addEventListener = ctx.document.removeEventListener = () => {};
  const canvas = { clientWidth: 90, clientHeight: 100, width: 0, height: 0, getContext: () => ctx2d, addEventListener() {}, removeEventListener() {} };
  const flush = () => { while (rafs.length) rafs.shift()(0); };
  return { ctx, calls, canvas, flush };
}
const mountIn = async s => s.ctx.TownRender2D.mount(s.canvas, { map, atlasUrl: '/atlas.json', terrainUrl: '/terrain.json', graphics: { ...s.ctx.Graphics.PRESETS.low, renderScale: 1 }, hour: 12 });

test('kind is canvas, with the same api as the GPU renderer', async () => {
  const s = sandbox(), api = await mountIn(s);
  assert.equal(api.kind, 'canvas');
  for (const k of ['setPlayer', 'setTravellers', 'travellerAt', 'toWorld', 'setCamera', 'resize', 'setGraphics', 'frameCount', 'stats', 'destroy'])
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
