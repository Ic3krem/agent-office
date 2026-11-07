import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TOWN = path.join(ROOT, 'public/art/town'), OFFICE = path.join(ROOT, 'public/art/office');
const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const pngSize = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('atlas has a frame for every building and decor type in town.json', () => {
  const town = readJson('public/town/town.json'), atlas = readJson('public/art/town/atlas.json');
  const types = new Set([...town.lots.map(l => l.building.type), ...town.decor.map(d => d.type)]);
  for (const t of types) assert.ok(atlas.frames[t], 'missing frame ' + t);
});

test('frames lie inside the atlas; both atlases match its size and are <= 2048', () => {
  const atlas = readJson('public/art/town/atlas.json'), [W, H] = atlas.size;
  assert.ok(W <= 2048 && H <= 2048);
  for (const f of ['atlas.png', 'atlas-shadow.png']) assert.deepEqual(pngSize(path.join(TOWN, f)), [W, H], f);
  for (const [n, r] of Object.entries(atlas.frames)) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= W && r.y + r.h <= H, n);
    assert.ok(Number.isInteger(r.ax) && Number.isInteger(r.ay), n + ' anchor');
  }
});

test('terrain chunks: cols * rows files of at most 512 px', () => {
  const t = readJson('public/art/town/terrain.json');
  assert.equal(t.chunk, 512);
  assert.equal(t.cols, Math.ceil(t.size[0] / 512)); assert.equal(t.rows, Math.ceil(t.size[1] / 512));
  const files = fs.readdirSync(path.join(TOWN, 'terrain')).filter(f => /^r\d+c\d+\.png$/.test(f));
  assert.equal(files.length, t.cols * t.rows);
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    const [w, h] = pngSize(path.join(TOWN, 'terrain', `r${r}c${c}.png`));
    assert.equal(w, Math.min(512, t.size[0] - c * 512)); assert.equal(h, Math.min(512, t.size[1] - r * 512));
  }
});

test('shipped art is under 8 MB', () => {
  const total = walk(path.join(ROOT, 'public/art')).reduce((s, f) => s + fs.statSync(f).size, 0);
  assert.ok(total < 8 * 1024 * 1024, 'art is ' + total + ' bytes');
});

// Minimal decoder for 8-bit PNGs: returns {w, h, bpp, row(y) -> Buffer of palette indices (type 3) or RGBA bytes (type 6)}.
function decodePng(file, type) {
  const b = fs.readFileSync(file), w = b.readUInt32BE(16), h = b.readUInt32BE(20), bpp = { 3: 1, 6: 4 }[type], W = w * bpp;
  assert.equal(b[24], 8, 'bit depth'); assert.equal(b[25], type, 'colour type'); assert.equal(b[28], 0, 'not interlaced');
  const idat = [];
  for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(W * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (W + 1)], src = raw.subarray(y * (W + 1) + 1, (y + 1) * (W + 1)), cur = px.subarray(y * W, (y + 1) * W), up = y ? px.subarray((y - 1) * W, y * W) : Buffer.alloc(W);
    for (let x = 0; x < W; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, u = up[x], c = x >= bpp ? up[x - bpp] : 0;
      const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
      cur[x] = src[x] + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f];
    }
  }
  return { w, h, bpp, row: y => px.subarray(y * W, (y + 1) * W) };
}

test('office styles share the office-modern footprint and are distinct renders', () => {
  const atlas = readJson('public/art/town/atlas.json'), png = decodePng(path.join(TOWN, 'atlas.png'), 3);
  const styles = ['office-modern', 'office-country', 'office-japanese'];
  const crop = n => { const r = atlas.frames[n], h = crypto.createHash('sha256'); h.update(`${r.w}x${r.h}`); for (let y = r.y; y < r.y + r.h; y++) h.update(png.row(y).subarray(r.x, r.x + r.w)); return h.digest('hex'); };
  for (const n of styles) assert.deepEqual(atlas.frames[n].footprint, atlas.frames['office-modern'].footprint, n + ' footprint');
  assert.deepEqual(atlas.frames['office-modern'].footprint, [-90, -50, 90, 50]);
  assert.equal(new Set(styles.map(crop)).size, 3, 'office style frames must differ');
});

test('every shipped art file is in art/MANIFEST.json with a matching sha256', () => {
  const m = readJson('art/MANIFEST.json'), byFile = new Map(m.files.map(f => [f.file, f]));
  for (const f of [...walk(TOWN), ...walk(OFFICE), path.join(ROOT, 'art/palette.json'), path.join(ROOT, 'art/palette-office.json')]) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/'), e = byFile.get(rel);
    assert.ok(e, 'not in manifest: ' + rel);
    assert.equal(e.sha256, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), rel);
    assert.equal(e.license, 'Apache-2.0 (original)');
  }
});

test('office atlas: frames inside it, colour/shadow/glow sheets share its size, <= 2048', () => {
  const atlas = readJson('public/art/office/atlas.json'), [W, H] = atlas.size;
  assert.ok(W <= 2048 && H <= 2048);
  for (const f of ['atlas.png', 'atlas-shadow.png', 'atlas-glow.png']) assert.deepEqual(pngSize(path.join(OFFICE, f)), [W, H], f);
  for (const [n, r] of Object.entries(atlas.frames)) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= W && r.y + r.h <= H, n);
    assert.ok(Number.isInteger(r.ax) && Number.isInteger(r.ay), n + ' anchor');
  }
});

test('every frame a converted office painter asks for is in the office atlas', async () => {
  const { loadWorld } = await import('./world-vm.mjs');
  const w = loadWorld(), F = w.OfficeFurniture, asked = new Set(), real = readJson('public/art/office/atlas.json').frames;
  const NUL = new Proxy(function () {}, { get: () => NUL, apply: () => NUL, set: () => true });
  F.useAtlas({ image: {}, frames: new Proxy({}, { get: (_, n) => { if (typeof n === 'string') asked.add(n); return { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0 }; } }) });
  const inst = F.defaultInstances(), had = new Set(inst.map(p => p.type));
  for (const [type, T] of Object.entries(F.CATALOG)) if (!had.has(type)) inst.push({ id: type, type, x: T.anchor[0], y: T.anchor[1] }); // karinderya, broom corner
  for (let lv = 0; lv <= 6; lv++) { F.state.ex.plantLevel = lv; for (const p of inst) for (const { it } of F.parts(p)) it.fn(NUL); }
  assert.ok(asked.size > 20, 'painters asked for ' + asked.size + ' frames');
  for (const n of asked) assert.ok(real[n], 'missing office frame ' + n);
});

test('the office has its own palette of at most 64 colours, and its atlas uses only those colours', () => {
  const cols = readJson('art/palette-office.json').colors, set = new Set(cols);
  assert.ok(cols.length <= 64, cols.length + ' office colours'); assert.equal(set.size, cols.length);
  assert.ok(readJson('art/palette.json').colors.length <= 64, 'town palette');
  const png = decodePng(path.join(OFFICE, 'atlas.png'), 6), hex = v => v.toString(16).padStart(2, '0'), off = new Set();
  for (let y = 0; y < png.h; y++) { const r = png.row(y); for (let x = 0; x < r.length; x += 4) if (r[x + 3]) { const c = '#' + hex(r[x]) + hex(r[x + 1]) + hex(r[x + 2]); if (!set.has(c)) off.add(c); } }
  assert.deepEqual([...off].slice(0, 5), [], 'colours outside the office palette');
});

test('glass frames keep translucent alpha; every other office frame has binary alpha', () => {
  const atlas = readJson('public/art/office/atlas.json'), png = decodePng(path.join(OFFICE, 'atlas.png'), 6);
  const partial = n => { const r = atlas.frames[n]; let k = 0; for (let y = r.y; y < r.y + r.h; y++) { const row = png.row(y); for (let x = r.x; x < r.x + r.w; x++) { const a = row[x * 4 + 3]; if (a > 0 && a < 255) k++; } } return k; };
  const glass = Object.keys(atlas.frames).filter(n => /^(glass-[xy]@|office-door\.)/.test(n));
  assert.ok(glass.length >= 4, 'glass frames ' + glass);
  for (const n of glass) assert.ok(partial(n) > 50, n + ' is translucent');
  for (const n of Object.keys(atlas.frames)) if (!glass.includes(n)) assert.equal(partial(n), 0, n + ' alpha is binary');
});

test('glass panes stay light: mean alpha of the translucent glass-x/glass-y pixels is at most 0.25', () => {
  const atlas = readJson('public/art/office/atlas.json'), png = decodePng(path.join(OFFICE, 'atlas.png'), 6);
  for (const n of Object.keys(atlas.frames).filter(n => /^glass-[xy]@/.test(n))) {
    const r = atlas.frames[n]; let sum = 0, k = 0;
    for (let y = r.y; y < r.y + r.h; y++) { const row = png.row(y); for (let x = r.x; x < r.x + r.w; x++) { const a = row[x * 4 + 3]; if (a > 0 && a < 255) { sum += a; k++; } } }
    assert.ok(k && sum / k / 255 <= 0.25, n + ' mean glass alpha ' + (sum / k / 255).toFixed(2));
  }
});

test('the room shell is in the office atlas: an opaque 128x64 tile per floor, both wall strips with night panes, the fixture bases', () => {
  const atlas = readJson('public/art/office/atlas.json'), F = atlas.frames, png = decodePng(path.join(OFFICE, 'atlas.png'), 6), glow = decodePng(path.join(OFFICE, 'atlas-glow.png'), 6);
  const alphas = (im, n) => { const r = F[n], a = []; for (let y = r.y; y < r.y + r.h; y++) { const row = im.row(y); for (let x = r.x; x < r.x + r.w; x++) a.push(row[x * 4 + 3]); } return a; };
  for (const k of ['wood', 'carpet', 'grass', 'concrete', 'asphalt', 'pavers', 'water', 'rug', 'terracotta']) {
    const n = 'floor@' + k; assert.ok(F[n], n);
    assert.deepEqual([F[n].w, F[n].h], [128, 64], n);
    assert.ok(alphas(png, n).every(a => a === 255), n + ' is opaque');
  }
  for (const n of ['wall@x', 'wall@y']) { assert.ok(F[n] && F[n].glow, n); assert.ok(alphas(glow, n).filter(a => a).length > 2000, n + ' has night panes'); }
  for (const n of ['wall-today', 'wall-usage', 'wall-whiteboard', 'wall-clock', 'wall-cork', 'wall-breaker']) assert.ok(F[n], n);
  assert.ok(F['karinderya.0'].w < 120, 'the karinderya floor sprite is only its rug: the tiles are the kain zone floor');
});
