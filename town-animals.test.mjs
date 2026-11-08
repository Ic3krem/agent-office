import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'town-animals.js'] });
const { TownAnimals: A, TownMap, WorldPath } = ctx;
const map = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
const grid = TownMap.grid(map), herd = A.herd(map);
const inR = (p, r) => p.x >= r[0] && p.x < r[2] && p.y >= r[1] && p.y < r[3];

test('herd: 3 cows in the pasture, 2 dogs in the park, 3 cats on the plaza and by the karinderya', () => {
  const n = k => herd.filter(a => a.kind === k).length;
  assert.deepEqual([n('cow'), n('dog'), n('cat')], [3, 2, 3]);
  assert.equal(new Set(herd.map(a => a.id)).size, herd.length);
  assert.deepEqual(JSON.parse(JSON.stringify(A.herd({ lots: [], decor: [] }))), [], 'no spots, no plaza: no animals');
});

test('at: deterministic and continuous (no jump between t and t + 50 ms, epoch edges included)', () => {
  for (const a of herd) {
    const max = A.SPEED[a.kind] * 0.05 + 1;
    for (let t = 1e12; t < 1e12 + 3 * A.EPOCH; t += 50) {
      const p = A.at(a, t, grid), q = A.at(a, t + 50, grid);
      assert.ok(Math.hypot(q.x - p.x, q.y - p.y) <= max, a.id + ' jump at ' + t);
    }
    const fresh = loadWorld({ extra: ['town-map.js', 'town-animals.js'] });
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.TownAnimals.at(a, 1e12 + 777, fresh.TownMap.grid(map)))), JSON.parse(JSON.stringify(A.at(a, 1e12 + 777, grid))), 'another page agrees');
  }
});

test('at: always inside home and on a walkable cell (every 500 ms for 10 minutes); animals do walk', () => {
  for (const a of herd) {
    const seen = new Set();
    for (let t = 5e11; t < 5e11 + 600000; t += 500) {
      const p = A.at(a, t, grid);
      assert.ok(inR(p, a.home), a.id + ' outside home at ' + t);
      assert.equal(grid.blocked[WorldPath.cellOf(grid, p)], 0, a.id + ' on a blocked cell at ' + t);
      assert.ok(['l', 'r'].includes(p.face) && ['rest', 'walk0', 'walk1', 'sleep'].includes(p.frame));
      seen.add(Math.round(p.x) + ',' + Math.round(p.y));
    }
    assert.ok(seen.size > 20, a.id + ' moves: ' + seen.size);
  }
});

test('cats nap by day in the second half of an epoch, never at night; cows never sleep', () => {
  const cat = herd.find(a => a.kind === 'cat'), cow = herd.find(a => a.kind === 'cow'), t = 7 * A.EPOCH + A.EPOCH * 0.6;
  const leg = A.at(cat, t, grid, 0);
  assert.ok(['sleep', 'walk0', 'walk1'].includes(leg.frame));
  let naps = 0; for (let e = 0; e < 20; e++) if (A.at(cat, e * A.EPOCH + A.EPOCH * 0.55, grid, 0).frame === 'sleep') naps++;
  assert.ok(naps > 10, 'naps by day ' + naps);
  for (let e = 0; e < 20; e++) assert.notEqual(A.at(cat, e * A.EPOCH + A.EPOCH * 0.55, grid, 0.8).frame, 'sleep');
  for (let e = 0; e < 20; e++) assert.notEqual(A.at(cow, e * A.EPOCH + A.EPOCH * 0.55, grid, 0).frame, 'sleep');
});

test('leashed: dog-1 goes with the first dog walker by id, dog-2 with the second; frame() leaves leashed dogs out', () => {
  const v = [{ id: 'b', pose: 'dogwalk' }, { id: 'a', pose: 'dogwalk' }, { id: 'c', pose: 'sit' }];
  assert.equal(A.leashed('dog-1', v), 'a');
  assert.equal(A.leashed('dog-2', v), 'b');
  assert.equal(A.leashed('dog-1', []), null);
  assert.equal(A.leashed('cow-1', v), null);
  const f = A.frame(herd, 1e12, grid, { on: true, visitors: [{ id: 'a', pose: 'dogwalk' }] });
  assert.deepEqual([...f.filter(a => a.kind === 'dog').map(a => a.id)], ['dog-2']);
  const rest = A.frame(herd, 1e12, grid, { on: false });
  assert.ok(rest.every(a => a.frame === 'rest' || a.frame === 'sleep'));
  assert.deepEqual(JSON.parse(JSON.stringify(rest)), JSON.parse(JSON.stringify(A.frame(herd, 5, grid, { on: false }))), 'off: the same rest spot at any time');
});
