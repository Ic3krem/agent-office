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
