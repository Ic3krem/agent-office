import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const { WorldModel: WM, WorldPath: W } = loadWorld();
const J = (v) => JSON.parse(JSON.stringify(v)); // vm results have a foreign realm prototype
const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/office-golden.json', import.meta.url), 'utf8'));
const errs = (mut) => { const l = J(WM.defaultLayout()); mut(l); return WM.validate(l).errors.join('\n'); };

test('default layout validates', () => {
  const r = WM.validate(WM.defaultLayout());
  assert.deepEqual(J(r.errors), []);
  assert.equal(r.ok, true);
});

test('default layout reproduces every 1.2.9 spot', () => {
  assert.deepEqual(J(WM.spotsOf(WM.defaultLayout())), gold.spots);
});

test('validate rejects bad layouts', () => {
  assert.match(errs((l) => l.objects.push({ id: 'x', type: 'no-such-thing', x: 1, y: 1 })), /unknown type/);
  assert.match(errs((l) => l.objects.push({ ...l.objects[0] })), /duplicate id/);
  assert.match(errs((l) => l.spots.push({ id: 'far', x: 2000, y: 10, face: 'n', zone: 'garden' })), /outside/);
  assert.match(errs((l) => { l.spawn = { x: 225, y: 70 }; }), /spawn/); // the manager's desk
  assert.match(errs((l) => l.objects.push({ id: 'wall', type: 'glass-y', x: 0, y: 470, w: 1240 })), /unreachable/);
  assert.match(errs((l) => { l.version = WM.VERSION + 1; }), /newer version/);
  assert.match(errs((l) => { l.objects.find((o) => o.type === 'bench').colour = 'red'; }), /unknown field/);
  assert.match(errs((l) => l.spots.push({ id: 'swim', x: 790, y: 105, face: 'n', zone: 'garden' })), /water/);
});

test('garden walk goes round the pond, not through it', () => {
  const l = WM.defaultLayout(), s = WM.spotsOf(l), g = WM.gridOf(l);
  const [x0, y0, x1, y1] = l.zones.find((z) => z.id === 'pond').rect;
  const p = W.findPath(g, s['garden:b1'], s['garden:pS']);
  assert.ok(p.length > 1);
  for (let i = 1; i < p.length; i++) for (let k = 0; k <= 40; k++) {
    const x = p[i - 1].x + (p[i].x - p[i - 1].x) * k / 40, y = p[i - 1].y + (p[i].y - p[i - 1].y) * k / 40;
    assert.ok(!(x > x0 && x < x1 && y > y0 && y < y1), `(${x},${y}) is in the pond`);
  }
});

test('validate never throws on malformed input', () => {
  const ok = J(WM.defaultLayout());
  const cases = [null, undefined, 7, 'x', [], {}, { version: 1 }, { version: 1, size: { w: 1, h: 1 } },
    { ...ok, size: { w: 1e9, h: 1e9 } }, { ...ok, spawn: null }, { ...ok, zones: null }, { ...ok, objects: {} }, { ...ok, spots: 'x' },
    { ...ok, objects: [null] }, { ...ok, spots: [5] }, { ...ok, zones: [{ id: 'z', type: 'path' }] },
    { ...ok, objects: [{ id: 3, type: 'bench', x: 0, y: 0 }] }, { ...ok, spots: [{ id: 's', x: 'a', y: 0 }] },
    { ...ok, objects: [{ id: 'c', type: 'constructor', x: 0, y: 0 }] },
    { ...ok, objects: [{ id: 'd', type: 'dept-desk', x: 0, y: 0, desk: 'no-such-desk' }] }];
  for (const c of cases) {
    const r = WM.validate(c);
    assert.equal(r.ok, false, JSON.stringify(c)?.slice(0, 80));
    assert.ok(r.errors.length > 0);
  }
});

test('the main routes walk mostly on path zones', () => {
  const l = WM.defaultLayout(), s = WM.spotsOf(l), g = WM.gridOf(l);
  const paths = l.zones.filter((q) => q.type === 'path').map((q) => q.rect);
  for (const [a, b] of [['desk-1', 'desk-8'], ['desk-2', 'play:pit'], ['hot:1', 'garden:b2']]) {
    const p = W.findPath(g, s[a], s[b]); let n = 0, on = 0;
    for (let i = 1; i < p.length; i++) {
      const m = Math.max(1, Math.round(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)));
      for (let k = 0; k < m; k++) {
        const x = p[i - 1].x + (p[i].x - p[i - 1].x) * k / m, y = p[i - 1].y + (p[i].y - p[i - 1].y) * k / m;
        n++; if (paths.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) on++;
      }
    }
    assert.ok(on / n >= 0.78, `${a} -> ${b}: ${(on / n).toFixed(3)} on paths`);
  }
});
