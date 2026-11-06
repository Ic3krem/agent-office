import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TOWN = path.join(ROOT, 'public/art/town');
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

test('every shipped art file is in art/MANIFEST.json with a matching sha256', () => {
  const m = readJson('art/MANIFEST.json'), byFile = new Map(m.files.map(f => [f.file, f]));
  for (const f of walk(TOWN)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/'), e = byFile.get(rel);
    assert.ok(e, 'not in manifest: ' + rel);
    assert.equal(e.sha256, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), rel);
    assert.equal(e.license, 'Apache-2.0 (original)');
  }
});
