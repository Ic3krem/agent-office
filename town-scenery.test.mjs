import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWorld } from './world-vm.mjs';

const ctx = loadWorld({ extra: ['town-map.js', 'town-scenery.js'] });
const S = ctx.TownScenery;
const map = JSON.parse(fs.readFileSync(new URL('./public/town/town.json', import.meta.url), 'utf8'));
const lines = JSON.parse(fs.readFileSync(new URL('./public/town/scenery-lines.json', import.meta.url), 'utf8'));
const park = map.spots.find(s => s.id === 'park'), mid = { x: (park.rect[0] + park.rect[2]) / 2, y: (park.rect[1] + park.rect[3]) / 2 };
const away = { x: 1080, y: 900 }; // the path south of the plaza: in no area
const step = (sc, p, t, night = 0, animals = []) => sc.step(p, t, night, animals);

test('lines: every spot has day and night lines, the karinderya and the three animals have theirs', () => {
  for (const s of map.spots) { assert.ok(lines.spots[s.id].day.length >= 1, s.id); assert.ok(lines.spots[s.id].night.length >= 1, s.id); }
  assert.ok(lines.kain.day.length && lines.animals.cow.length && lines.animals.dog.length && lines.animals.cat.length);
  assert.deepEqual([S.SHOW_MS, S.COOLDOWN_MS, S.ANIMAL_R, S.ANIMAL_COOLDOWN_MS], [6000, 60000, 40, 30000]);
});

test('entering the park shows its first day line once; staying inside shows nothing new', () => {
  const sc = S.create(lines, map);
  assert.equal(step(sc, away, 0), null);
  const b = step(sc, mid, 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), { text: lines.spots.park.day[0], until: 1000 + S.SHOW_MS });
  for (let t = 1100; t < 30000; t += 500) assert.equal(step(sc, { x: mid.x + (t % 7), y: mid.y }, t), null);
});

test('cooldown: back within 60 s shows nothing; after 60 s outside the exit rect the next line shows', () => {
  const sc = S.create(lines, map);
  step(sc, mid, 0);
  step(sc, away, 10000); // left at 10 s
  assert.equal(step(sc, mid, 30000), null, 're-entry inside the cooldown');
  step(sc, away, 40000); // left again at 40 s
  assert.equal(step(sc, mid, 40000 + S.COOLDOWN_MS - 1), null, 'one ms short');
  step(sc, away, 120000);
  const b = step(sc, mid, 120000 + S.COOLDOWN_MS);
  assert.equal(b.text, lines.spots.park.day[1], 'the second line');
});

test('edge jitter: oscillating 3 units across the bubble edge for 30 s shows exactly one bubble', () => {
  const sc = S.create(lines, map), edge = park.rect[0] - 20; // the bubble rect is the spot rect grown by 20
  let shown = 0;
  for (let t = 0; t < 30000; t += 100) if (step(sc, { x: edge + (Math.floor(t / 100) % 2 ? 3 : -3), y: mid.y }, t)) shown++;
  assert.equal(shown, 1);
});

test('night lines when night >= 0.5; the karinderya lot uses its day line at night too', () => {
  const sc = S.create(lines, map);
  assert.equal(step(sc, mid, 0, 0.6).text, lines.spots.park.night[0]);
  const kain = map.lots.find(l => l.kind === 'kain').rect;
  assert.equal(step(sc, { x: kain[0] + 10, y: kain[1] + 10 }, 100000, 0.9).text, lines.kain.day[0]);
});

test('animals: within 40 units of a cow its line shows, then that cow cools down for 30 s', () => {
  const sc = S.create(lines, map), cow = { id: 'cow-1', kind: 'cow', x: 1000, y: 900 };
  assert.equal(step(sc, { x: 1000, y: 945 }, 0, 0, [cow]), null, '45 units: too far');
  assert.equal(step(sc, { x: 1000, y: 930 }, 100, 0, [cow]).text, lines.animals.cow[0]);
  assert.equal(step(sc, { x: 1000, y: 930 }, 100 + S.SHOW_MS + 1, 0, [cow]), null, 'still cooling down');
  assert.equal(step(sc, { x: 1000, y: 930 }, 100 + S.ANIMAL_COOLDOWN_MS, 0, [cow]).text, lines.animals.cow[0]);
});

test('one bubble at a time: an animal line does not replace a spot line inside its SHOW_MS', () => {
  const sc = S.create(lines, map), dog = { id: 'dog-1', kind: 'dog', x: mid.x + 10, y: mid.y };
  assert.equal(step(sc, mid, 0, 0, [dog]).text, lines.spots.park.day[0], 'the spot wins the same step');
  assert.equal(step(sc, mid, 3000, 0, [dog]), null, 'no animal line while the spot line shows');
  assert.equal(step(sc, mid, S.SHOW_MS + 1, 0, [dog]).text, lines.animals.dog[0], 'after it fades');
});

test('walking up to the plaza fountain (within 60 units) shows a fountain line', () => {
  const sc = S.create(lines, map), f = map.decor.find(d => d.type === 'fountain');
  assert.ok(lines.fountain.day.length && lines.fountain.night.length);
  assert.equal(step(sc, { x: f.x, y: f.y + 70 }, 0), null, '70 units: not yet');
  assert.equal(step(sc, { x: f.x, y: f.y + 50 }, 100).text, lines.fountain.day[0]);
  assert.equal(step(sc, { x: f.x + 20, y: f.y + 70 }, 200), null, 'still inside the exit circle');
  const night = S.create(lines, map);
  assert.equal(step(night, { x: f.x - 40, y: f.y }, 0, 0.9).text, lines.fountain.night[0]);
});
